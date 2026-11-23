import http from 'http'
import { Duplex } from 'stream'
import { WebSocket, WebSocketServer } from 'ws'
import { EXPIRING_NOTICE_MS, SessionService } from '../../../application/session/sessionService'
import { SchemaDirectoryPort } from '../../../application/ports/input/schemaDirectoryPort'
import { LoggerPort } from '../../../application/ports/output/supportPorts'
import { chooseProtocol, sessionFromProtocols } from '../../../domain/auth/protocolCredential'
import { toHttpError } from './httpErrors'
import { ClientAddress } from './clientAddress'
import { SESSION_HEADER } from './sessionRoutes'

export interface ManagementEventsOptions {
	basePath: string
	maxPayload: number
	/** ping every this long; a socket without its pong in twice this is closed */
	pingMs?: number
	/** this replica tells which sessions have a socket here, and checks their revocations, this often */
	presenceMs?: number
	checkMs?: number
}

interface Connected {
	sessionId: string
	alive: boolean
	expiring?: NodeJS.Timeout
	lastActivity: number
}

/** close code of a session that ended (revoked, expired): the IDE tells why and doesn't reconnect with it */
export const SESSION_ENDED = 4401

/**
 * The WebSocket of events of management (docs/DATA_GATEWAY_SESSIONS_PLAN.md §4): {basePath}/events, authenticated with
 * a session in the upgrade (X-Data-Gateway-Session, or the subprotocol lambdaorm.session.<token> from a browser). It
 * only pushes events (JSON-RPC notifications): session.revoked / session.expiring, schema.statusChanged and
 * workspace.changed; the IDE only tells its session.activity. A session with its socket open is "connected".
 */
export class ManagementEvents {
	private readonly wss: WebSocketServer
	private readonly sockets = new Map<WebSocket, Connected>()
	private readonly timers: NodeJS.Timeout[] = []
	private readonly unsubscribe: (() => void)[] = []

	constructor (
		private readonly options: ManagementEventsOptions,
		private readonly sessions: SessionService,
		private readonly address: ClientAddress,
		private readonly directory: SchemaDirectoryPort,
		private readonly logger: LoggerPort
	) {
		this.wss = new WebSocketServer({ noServer: true, maxPayload: options.maxPayload, handleProtocols: chooseProtocol })
	}

	public get path (): string {
		return `${this.options.basePath}/events`
	}

	public get connections (): number {
		return this.sockets.size
	}

	/** Takes the upgrades of its route on the server of management, and starts its timers */
	public attach (server: http.Server): void {
		server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head))
		const ping = this.options.pingMs ?? 25000
		this.timers.push(setInterval(() => this.ping(), ping))
		this.timers.push(setInterval(() => this.tellPresence(), this.options.presenceMs ?? 15000))
		this.timers.push(setInterval(() => this.checkEnded(), this.options.checkMs ?? 5000))
		for (const timer of this.timers) timer.unref()
		this.unsubscribe.push(this.sessions.ended.subscribe(({ id, error }) => this.closeSession(id, error)))
		this.unsubscribe.push(this.directory.onStateChange(state =>
			this.broadcast('schema.statusChanged', { path: state.path, status: state.status, reason: state.reason, pending: state.pending })))
		this.unsubscribe.push(this.directory.onWorkspaceChange(change => this.broadcast('workspace.changed', change)))
	}

	public async close (): Promise<void> {
		for (const timer of this.timers) clearInterval(timer)
		for (const off of this.unsubscribe) off()
		for (const [ws, connected] of this.sockets) {
			if (connected.expiring) clearTimeout(connected.expiring)
			ws.terminate()
		}
		this.sockets.clear()
		try { this.sessions.presence([]) } catch { /* the store is closing */ }
		await new Promise<void>(resolve => this.wss.close(() => resolve()))
	}

	private upgrade (req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
		const url = new URL(req.url ?? '/', 'http://localhost')
		if (url.pathname !== this.path) {
			socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
			return
		}
		const header = req.headers[SESSION_HEADER]
		const token = (Array.isArray(header) ? header[0] : header) ?? sessionFromProtocols(req.headers['sec-websocket-protocol'])
		let sessionId: string
		let expiringIn: number
		try {
			const auth = this.sessions.authenticate(token, this.address.of(req.socket.remoteAddress, req.headers['x-forwarded-for']))
			sessionId = auth.session.id
			expiringIn = this.sessions.expiringInMs(auth.session)
		} catch (error) {
			const { status, body } = toHttpError(error)
			const text = JSON.stringify(body)
			socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`)
			return
		}
		this.wss.handleUpgrade(req, socket, head, ws => this.connected(ws, sessionId, expiringIn))
	}

	private connected (ws: WebSocket, sessionId: string, expiringIn: number): void {
		const connected: Connected = { sessionId, alive: true, lastActivity: 0 }
		this.sockets.set(ws, connected)
		// a timer longer than ~24.8 days would fire at once: such a lifetime gets no notice
		if (expiringIn <= 2 ** 31 - 1) {
			connected.expiring = setTimeout(() => this.notify(ws, 'session.expiring', { inMs: EXPIRING_NOTICE_MS }), expiringIn)
			connected.expiring.unref()
		}
		ws.on('pong', () => { connected.alive = true })
		ws.on('message', data => this.message(connected, data))
		ws.on('close', () => {
			if (connected.expiring) clearTimeout(connected.expiring)
			this.sockets.delete(ws)
			this.tellPresence()
		})
		ws.on('error', () => ws.terminate())
		this.tellPresence()
	}

	/** From the IDE, only session.activity { schema?, tab? }, at most every 10 s per socket; anything else is ignored */
	private message (connected: Connected, data: unknown): void {
		let message: any
		try { message = JSON.parse(String(data)) } catch { return }
		if (message?.method !== 'session.activity' || typeof message.params !== 'object') return
		const now = Date.now()
		if (now - connected.lastActivity < 10000) return
		connected.lastActivity = now
		try { this.sessions.activity(connected.sessionId, message.params) } catch (error: any) { this.logger.warn(`[data-gateway] management events: ${error?.message ?? error}`) }
	}

	private notify (ws: WebSocket, method: string, params: unknown): void {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
	}

	private broadcast (method: string, params: unknown): void {
		for (const ws of this.sockets.keys()) this.notify(ws, method, params)
	}

	/** A session that ended: its sockets get why (session.revoked) and close with SESSION_ENDED */
	private closeSession (id: string, error: { name: string, message: string }): void {
		for (const [ws, connected] of this.sockets) {
			if (connected.sessionId !== id) continue
			this.notify(ws, 'session.revoked', { error: error.name, message: error.message })
			ws.close(SESSION_ENDED, error.name)
		}
	}

	private ping (): void {
		for (const [ws, connected] of this.sockets) {
			if (!connected.alive) { ws.terminate(); continue }
			connected.alive = false
			ws.ping()
		}
	}

	private tellPresence (): void {
		try {
			this.sessions.presence([...new Set([...this.sockets.values()].map(c => c.sessionId))])
		} catch (error: any) {
			this.logger.warn(`[data-gateway] management events: the presence could not be written: ${error?.message ?? error}`)
		}
	}

	/** Sessions revoked or expired in another replica (or by time): their sockets here close */
	private checkEnded (): void {
		const ids = [...new Set([...this.sockets.values()].map(c => c.sessionId))]
		if (!ids.length) return
		try {
			for (const { id, error } of this.sessions.check(ids)) this.closeSession(id, error)
		} catch (error: any) {
			this.logger.warn(`[data-gateway] management events: the sessions could not be checked: ${error?.message ?? error}`)
		}
	}
}
