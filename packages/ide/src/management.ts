import { Credential, headersOf, Who } from './shared'
import { viaProxy } from './proxy'

/**
 * The IDE and the management of a gateway (docs/DATA_GATEWAY_SESSIONS_PLAN.md §8): a login with the credential of the
 * connection gives a session; every request carries its token (kept in this tab), never the credential. When the session
 * expires (inactivity, lifetime) and the key is at hand, it logs in again by itself; when it is revoked, it says so and
 * waits for the person. Its WebSocket of events tells what changed (and makes this session "connected").
 */
export interface ManagementState {
	/** who the session is: the credential and its permissions */
	who?: Who
	/** why it can't be used now (a refused key, a revoked session, an unreachable gateway) */
	problem?: string
	/** its WebSocket of events is open */
	live: boolean
	/** the session ends soon (session.expiring) */
	expiring?: boolean
}

export interface ManagementTexts {
	invalid: string
	unreachable: string
	needsKey: string
	sessionEnded: string
}

const SESSION_HEADER = 'X-Data-Gateway-Session'
const ENDED = ['SessionExpiredError', 'SessionRevokedError', 'SessionRequiredError']

const tokenKey = (id: string) => `data-gateway-ide.session.${id}`
const readToken = (id: string): string | undefined => { try { return window.sessionStorage.getItem(tokenKey(id)) ?? undefined } catch { return undefined } }
const writeToken = (id: string, token: string | undefined) => {
	try { if (token) window.sessionStorage.setItem(tokenKey(id), token); else window.sessionStorage.removeItem(tokenKey(id)) } catch { /* private window */ }
}

/** An error of the gateway or of the backend of the IDE, with what it says */
const failure = async (response: Response) => {
	const body = await response.clone().json().catch(() => undefined)
	return Object.assign(new Error(body?.message ?? `HTTP ${response.status}`), { status: response.status, error: body?.error as string | undefined })
}

export class ManagementClient {
	private token?: string
	private state: ManagementState = { live: false }
	private readonly listeners = new Set<(state: ManagementState) => void>()
	private readonly changeListeners = new Set<() => void>()
	private socket?: WebSocket
	private retryMs = 1000
	private retry?: ReturnType<typeof setTimeout>
	private closed = false
	private loggingIn?: Promise<Who>
	private lastActivity?: string

	/**
	 * @param id the connection (its token is kept in this tab under it)
	 * @param url the management of the gateway, as the backend of the IDE reaches it
	 * @param credential the credential of the connection, or undefined when its key is not at hand
	 */
	constructor (private readonly id: string, private readonly url: string, private readonly credential: () => Credential | undefined, private readonly texts: ManagementTexts) {
		this.token = readToken(id)
	}

	/** Its management through the backend of the IDE */
	public get base (): string {
		return viaProxy(this.url)
	}

	public get current (): ManagementState {
		return this.state
	}

	public subscribe (listener: (state: ManagementState) => void): () => void {
		this.listeners.add(listener)
		return () => { this.listeners.delete(listener) }
	}

	/** For the workspace: called when the gateway says something changed */
	public readonly changes = (listener: () => void): (() => void) => {
		this.changeListeners.add(listener)
		return () => { this.changeListeners.delete(listener) }
	}

	/** Starts: with a token kept in this tab it goes on with it; else it logs in when the key is at hand */
	public async start (): Promise<void> {
		if (this.token) {
			try {
				const current = await this.fetch(`${this.base}/sessions/current`)
				if (!current.ok) throw await failure(current)
				const session = await current.json()
				this.set({ who: { name: session.credential, permissions: this.state.who?.permissions ?? [] }, problem: undefined })
				// its permissions: the login gave them; after a reload, whoami of the session says them
				await this.readWho()
				this.connectEvents()
				return
			} catch { /* the session is gone: a new one below */ }
		}
		if (!this.credential()) {
			this.set({ who: undefined, problem: this.texts.needsKey })
			return
		}
		await this.login().catch(() => undefined)
	}

	/** A new session with the credential of the connection */
	public login (): Promise<Who> {
		this.loggingIn ??= this.doLogin().finally(() => { this.loggingIn = undefined })
		return this.loggingIn
	}

	private async doLogin (): Promise<Who> {
		const credential = this.credential()
		if (!credential) {
			this.set({ who: undefined, problem: this.texts.needsKey })
			throw new Error(this.texts.needsKey)
		}
		let response: Response
		try {
			response = await fetch(`${this.base}/sessions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...headersOf(credential) },
				body: JSON.stringify({ client: { app: 'data-gateway-ide', version: __APP_VERSION__, kind: 'web' } })
			})
		} catch (e) {
			this.set({ who: undefined, problem: this.texts.unreachable })
			throw e
		}
		if (!response.ok) {
			const error = await failure(response)
			this.set({ who: undefined, problem: this.problemOf(error) })
			throw error
		}
		const session = await response.json()
		this.setToken(session.token)
		const who: Who = { name: session.credential, permissions: session.permissions ?? [] }
		this.set({ who, problem: undefined, expiring: false })
		this.connectEvents()
		return who
	}

	/** The fetch of the workspace: the session in every request; an ended one, a new login (once) when it may */
	public readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
		if (!this.token && this.credential() && !this.revoked) await this.login().catch(() => undefined)
		const send = () => {
			const headers = new Headers(init.headers)
			if (this.token) headers.set(SESSION_HEADER, this.token)
			return fetch(input, { ...init, headers })
		}
		const response = await send()
		if (response.status !== 401) return response
		const error = await failure(response)
		if (!ENDED.includes(error.error ?? '')) return response
		this.ended(error)
		if (this.revoked || !this.credential()) return response
		try { await this.login() } catch { return response }
		return send()
	}

	/** Revoked by someone: no new login by itself (that would undo the revocation) until the person connects again */
	private revoked = false

	private ended (error: { error?: string, message: string }): void {
		this.setToken(undefined)
		this.closeEvents()
		this.revoked = error.error === 'SessionRevokedError'
		this.set({ who: this.revoked ? undefined : this.state.who, problem: this.revoked ? this.texts.sessionEnded.replace('{reason}', error.message) : this.state.problem, expiring: false })
	}

	/** Connect again by hand (after a revocation, or a key given) */
	public async reconnect (): Promise<Who> {
		this.revoked = false
		this.setToken(undefined)
		return this.login()
	}

	public async logout (): Promise<void> {
		if (this.token) await this.fetch(`${this.base}/sessions/current`, { method: 'DELETE' }).catch(() => undefined)
		this.setToken(undefined)
		this.closeEvents()
	}

	/** What the person is looking at, told to the gateway (at most when it changes) */
	public activity (activity: { schema?: string, tab?: string }): void {
		const text = JSON.stringify(activity)
		if (text === this.lastActivity) return
		this.lastActivity = text
		if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'session.activity', params: activity }))
	}

	/** Stops: its socket closes (the session stays, for this tab) */
	public close (): void {
		this.closed = true
		this.closeEvents()
		this.listeners.clear()
		this.changeListeners.clear()
	}

	private async readWho (): Promise<void> {
		const schemas = await fetch(`${this.base}/schemas`).then(r => r.json()).catch(() => [])
		const ready = Array.isArray(schemas) ? schemas.find((s: any) => s.status === 'ready') : undefined
		if (!ready) return
		const response = await this.fetch(`${this.base}${ready.path ? `/${ready.path}` : ''}/whoami`)
		if (response.ok) {
			const who = await response.json()
			this.set({ who: { name: who.name, permissions: who.permissions ?? [] } })
		}
	}

	private problemOf (error: { status?: number, error?: string, message: string }): string {
		if (error.error === 'ForbiddenTargetError') return error.message
		if (error.status === 401 || error.status === 403) return this.texts.invalid
		if (error.status === 502 || error.status === 504) return this.texts.unreachable
		return error.message
	}

	private setToken (token: string | undefined): void {
		this.token = token
		writeToken(this.id, token)
	}

	private set (patch: Partial<ManagementState>): void {
		this.state = { ...this.state, ...patch }
		for (const listener of [...this.listeners]) listener(this.state)
	}

	private connectEvents (): void {
		if (this.closed || !this.token || this.socket) return
		const url = viaProxy(this.url.replace(/^http/, 'ws'))
		// the session in the subprotocols: a browser's WebSocket can't send headers
		const socket = new WebSocket(`${url}/events`, ['lambdaorm', `lambdaorm.session.${this.token}`])
		this.socket = socket
		socket.onopen = () => {
			this.retryMs = 1000
			this.set({ live: true })
			if (this.lastActivity) socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'session.activity', params: JSON.parse(this.lastActivity) }))
		}
		socket.onmessage = event => {
			let message: any
			try { message = JSON.parse(String(event.data)) } catch { return }
			switch (message?.method) {
			case 'schema.statusChanged':
			case 'workspace.changed':
				for (const listener of [...this.changeListeners]) listener()
				break
			case 'session.expiring':
				// with the key at hand, a new session before this one ends; else, the person is told
				if (this.credential()) {
					this.closeEvents()
					this.setToken(undefined)
					this.login().catch(() => undefined)
				} else this.set({ expiring: true })
				break
			case 'session.revoked':
				this.ended({ error: message.params?.error, message: message.params?.message ?? '' })
				break
			}
		}
		socket.onclose = event => {
			if (this.socket === socket) this.socket = undefined
			this.set({ live: false })
			if (this.closed) return
			// its session ended (4401): no reconnection with it; the next request tells why and logs in if it may
			if (event.code === 4401) {
				if (this.token) this.ended({ error: event.reason, message: event.reason })
				return
			}
			// else (a restart of the gateway, the network): again, waiting longer each time, up to 30 s
			clearTimeout(this.retry)
			this.retry = setTimeout(() => this.connectEvents(), this.retryMs)
			this.retryMs = Math.min(this.retryMs * 2, 30000)
		}
	}

	private closeEvents (): void {
		clearTimeout(this.retry)
		const socket = this.socket
		this.socket = undefined
		if (socket) {
			socket.onclose = null
			socket.close()
		}
		this.set({ live: false })
	}
}

/** Test a connection: a session opened and closed at once (it leaves none behind) */
export const testConnection = async (url: string, credential: Credential): Promise<Who> => {
	const base = viaProxy(url)
	const response = await fetch(`${base}/sessions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headersOf(credential) },
		body: JSON.stringify({ client: { app: 'data-gateway-ide', version: __APP_VERSION__, kind: 'web' } })
	})
	if (!response.ok) throw await failure(response)
	const session = await response.json()
	await fetch(`${base}/sessions/current`, { method: 'DELETE', headers: { [SESSION_HEADER]: session.token } }).catch(() => undefined)
	return { name: session.credential, permissions: session.permissions ?? [] }
}
