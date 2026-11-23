import { SessionStorePort } from '../application/ports'

type Headers = () => Record<string, string> | Promise<Record<string, string>>

/** The session of the credential, in the gateway (GET/PUT {baseUrl}/admin/session): it follows the person to any browser */
export class GatewaySessionStore implements SessionStorePort {
	private readonly baseUrl: string
	constructor (baseUrl: string, private readonly headers: Headers = () => ({}), private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {
		this.baseUrl = baseUrl.replace(/\/+$/, '')
	}

	public async load (): Promise<unknown> {
		const response = await this.fetcher(`${this.baseUrl}/admin/session`, { headers: await this.headers() })
		if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
		return (await response.json())?.state ?? undefined
	}

	public async save (session: unknown, options: { keepalive?: boolean } = {}): Promise<void> {
		const response = await this.fetcher(`${this.baseUrl}/admin/session`, {
			method: 'PUT',
			headers: { ...(await this.headers()), 'content-type': 'application/json' },
			body: JSON.stringify({ state: session }),
			keepalive: options.keepalive
		})
		if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
	}
}

/** The session in this browser (localStorage): when the gateway doesn't keep it */
export class BrowserSessionStore implements SessionStorePort {
	constructor (private readonly key: string) {}
	public async load (): Promise<unknown> {
		try { const text = globalThis.localStorage?.getItem(this.key); return text ? JSON.parse(text) : undefined } catch { return undefined }
	}

	public async save (session: unknown): Promise<void> {
		try { globalThis.localStorage?.setItem(this.key, JSON.stringify(session)) } catch { /* no storage: nothing kept */ }
	}
}

/** The gateway's, and the browser's when the gateway can't (no administration, an older gateway, no workspace) */
export class FallbackSessionStore implements SessionStorePort {
	private use?: SessionStorePort
	constructor (private readonly primary: SessionStorePort, private readonly fallback: SessionStorePort) {}

	public async load (): Promise<unknown> {
		try {
			const session = await this.primary.load()
			this.use = this.primary
			return session
		} catch {
			this.use = this.fallback
			return this.fallback.load()
		}
	}

	public async save (session: unknown, options?: { keepalive?: boolean }): Promise<void> {
		const store = this.use ?? this.primary
		try { await store.save(session, options) } catch {
			if (store !== this.fallback) { this.use = this.fallback; await this.fallback.save(session, options) }
		}
	}
}
