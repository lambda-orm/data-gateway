import { NotificationListener } from './transport'

export interface RpcMessage {
	jsonrpc?: '2.0'
	id?: number | string | null
	method?: string
	params?: any
	result?: any
	error?: { code: number, message: string, data?: any }
}

/**
 * JSON-RPC 2.0 over a WebSocket (Node ≥ 22 has WebSocket): requests matched to their answers by id, and the
 * notifications of the server to their listeners. The handshake carries the headers (the credential).
 */
export class RpcSocket {
	private socket?: WebSocket
	private next = 1
	private readonly pending = new Map<number, (message: RpcMessage) => void>()
	private readonly listeners = new Map<string, Set<NotificationListener>>()

	// eslint-disable-next-line no-useless-constructor
	/** headers: those of the handshake, asked for on every opening (a token given by a function may have changed) */
	constructor (private readonly url: string, private readonly headers: () => Promise<Record<string, string>>) {}

	public async open (): Promise<void> {
		const headers = await this.headers()
		return new Promise((resolve, reject) => {
			// Node's WebSocket (undici) takes the headers of the handshake as an option
			const socket = new (WebSocket as any)(this.url, { headers }) as WebSocket
			this.socket = socket
			let opened = false
			socket.onopen = () => { opened = true; resolve() }
			socket.onerror = () => { if (!opened) reject(new Error(`can't connect to ${this.url} (refused, or the credential was rejected)`)) }
			socket.onmessage = (event: MessageEvent) => this.receive(String(event.data))
			socket.onclose = () => {
				for (const waiting of this.pending.values()) waiting({ error: { code: -32603, message: 'the connection was closed' } })
				this.pending.clear()
			}
		})
	}

	private receive (text: string): void {
		let message: RpcMessage
		try { message = JSON.parse(text) } catch { return }
		if (message.id !== undefined && message.id !== null) {
			const waiting = this.pending.get(Number(message.id))
			if (waiting) { this.pending.delete(Number(message.id)); waiting(message) }
			return
		}
		if (message.method) for (const listener of this.listeners.get(message.method) ?? []) listener(message.params)
	}

	public get isOpen (): boolean { return this.socket?.readyState === 1 }

	public request (method: string, params: any): Promise<RpcMessage> {
		if (!this.isOpen) return Promise.resolve({ error: { code: -32603, message: 'the connection is closed' } })
		const id = this.next++
		return new Promise(resolve => {
			this.pending.set(id, resolve)
			this.socket!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
		})
	}

	public notify (method: string, params?: any): void {
		if (this.isOpen) this.socket!.send(JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) }))
	}

	public on (method: string, listener: NotificationListener): () => void {
		const set = this.listeners.get(method) ?? new Set()
		set.add(listener)
		this.listeners.set(method, set)
		return () => { set.delete(listener) }
	}

	public close (): void { this.socket?.close() }
}
