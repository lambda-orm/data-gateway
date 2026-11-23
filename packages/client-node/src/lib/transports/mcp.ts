import { ConnectionTarget } from '../connection'
import { gatewayError, GatewayError, transportError, unsupported, TransportName } from '../errors'
import { Args, clean, MCP, Operation, WHERE } from '../operations'
import { RpcMessage, RpcSocket } from './rpcSocket'
import { Transport, withTimeout } from './transport'

const PROTOCOL_VERSION = '2025-03-26'
const INITIALIZE = { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: '@lambdaorm/data-gateway-client', version: '0' } }

interface ToolResult {
	content?: { type: string, text?: string }[]
	structuredContent?: Record<string, any>
	isError?: boolean
}

/**
 * The MCP server of a schema as a transport: each operation is the tool with its name (orm_execute, schema_entities,
 * …), and its answer what REST answers (docs/DATA_GATEWAY_CLIENTS_PLAN.md §6). The channel (Streamable HTTP, the
 * legacy HTTP+SSE or a WebSocket) is what the subclasses add.
 */
abstract class McpTransport implements Transport {
	public abstract readonly name: TransportName
	// eslint-disable-next-line no-useless-constructor
	constructor (protected readonly target: ConnectionTarget) {}

	public abstract open (): Promise<void>
	public abstract close (): Promise<void>
	protected abstract request (method: string, params: any): Promise<RpcMessage>

	protected async initialize (): Promise<void> {
		const answer = await this.request('initialize', INITIALIZE)
		if (answer.error) throw this.rpcError(answer.error)
	}

	public async call (operation: Operation, args: Args): Promise<unknown> {
		const route = MCP[operation]
		if (!route) throw unsupported(this.name, operation, WHERE[operation] ?? 'not on this transport')
		const [tool, toolArgs] = route(args)
		const message = await withTimeout(this.request('tools/call', { name: tool, arguments: clean(toolArgs) }), this.target.timeout,
			() => new GatewayError({ code: 'timeout', message: `${operation} took longer than ${this.target.timeout} ms`, transport: this.name, operation }))
		if (message.error) throw this.rpcError(message.error)
		return this.toolResult(message.result as ToolResult)
	}

	/** a JSON-RPC error of the MCP server: not authenticated (-32001), an unknown tool, invalid arguments */
	protected rpcError (error: { code: number, message: string }): GatewayError {
		if (error.code === -32603 && /closed/.test(error.message)) return transportError(this.name, error.message)
		return gatewayError(this.name, { status: error.code === -32001 ? 401 : 400, errorName: 'McpError', message: error.message })
	}

	/** the JSON of the text, or the error of an isError result with the name, status and code of its structuredContent */
	protected toolResult (result: ToolResult): unknown {
		const text = result?.content?.find(c => c.type === 'text')?.text
		if (result?.isError) {
			const s = result.structuredContent ?? {}
			const errorName = s.error ?? (text && text.includes(':') ? text.slice(0, text.indexOf(':')) : undefined)
			throw gatewayError(this.name, { status: s.status, errorName, dbCode: s.code, suggestions: s.suggestions, message: s.message ?? text ?? 'error' })
		}
		const value = text === undefined || text === '' ? null : JSON.parse(text)
		if (value && typeof value === 'object' && value.truncated === true && Array.isArray(value.rows) && this.target.onTruncated === 'error') {
			throw new GatewayError({
				code: 'truncated',
				message: `${value.returned} of ${value.total} rows (mcp.maxRows of the gateway): ${value.hint ?? 'ask for less with page()'}`,
				transport: this.name
			})
		}
		return value
	}
}

/** MCP Streamable HTTP: every request a POST to {schema}/mcp (the answer as JSON, or as one event of a stream) */
export class McpHttpTransport extends McpTransport {
	public readonly name = 'mcp+http' as const
	private next = 1
	private session?: string

	private get endpoint (): string { return this.target.url + '/mcp' }

	private async post (body: Record<string, any>): Promise<RpcMessage | undefined> {
		let response: Response
		try {
			response = await fetch(this.endpoint, {
				method: 'POST',
				headers: {
					...this.target.headers,
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					...(this.session ? { 'Mcp-Session-Id': this.session } : {})
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this.target.timeout)
			})
		} catch (error: any) {
			if (error?.name === 'TimeoutError') throw new GatewayError({ code: 'timeout', message: `the MCP server took longer than ${this.target.timeout} ms`, transport: this.name })
			throw transportError(this.name, `POST ${this.endpoint}: ${error?.cause?.message ?? error?.message ?? error}`)
		}
		this.session = response.headers.get('mcp-session-id') ?? this.session
		const text = await response.text()
		if (body.id === undefined) return undefined
		const type = response.headers.get('content-type') ?? ''
		const json = type.includes('text/event-stream')
			? text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean).pop()
			: text
		if (!json) throw gatewayError(this.name, { status: response.status, message: `POST ${this.endpoint} answered ${response.status} without a body` })
		return JSON.parse(json)
	}

	protected async request (method: string, params: any): Promise<RpcMessage> {
		return (await this.post({ jsonrpc: '2.0', id: this.next++, method, params })) as RpcMessage
	}

	public async open (): Promise<void> {
		await this.initialize()
		await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
	}

	public async close (): Promise<void> {
		if (!this.session) return
		// a stateful server keeps a session: end it
		await fetch(this.endpoint, { method: 'DELETE', headers: { ...this.target.headers, 'Mcp-Session-Id': this.session } }).catch(() => undefined)
	}
}

/** MCP HTTP+SSE (legacy): GET {schema}/sse opens the stream; its first event says where to POST the requests */
export class McpSseTransport extends McpTransport {
	public readonly name = 'mcp+sse' as const
	private next = 1
	private readonly pending = new Map<number, (message: RpcMessage) => void>()
	private abort?: AbortController
	private reading?: Promise<void>
	private messages?: string

	public async open (): Promise<void> {
		const url = this.target.url + '/sse'
		this.abort = new AbortController()
		let response: Response
		try {
			response = await fetch(url, { headers: { ...this.target.headers, Accept: 'text/event-stream' }, signal: this.abort.signal })
		} catch (error: any) {
			throw transportError(this.name, `GET ${url}: ${error?.cause?.message ?? error?.message ?? error}`)
		}
		if (!response.ok || !response.body) {
			throw gatewayError(this.name, { status: response.status, errorName: 'McpError', message: `GET ${url} answered ${response.status}` })
		}
		let onEndpoint!: (path: string) => void
		const endpoint = new Promise<string>(resolve => { onEndpoint = resolve })
		this.reading = this.read(response.body.getReader(), onEndpoint)
		const path = await withTimeout(endpoint, this.target.timeout, () => transportError(this.name, `${url} sent no endpoint event`))
		this.messages = new URL(path, url).toString()
		await this.initialize()
		await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
	}

	private async read (reader: ReadableStreamDefaultReader<Uint8Array>, onEndpoint: (path: string) => void): Promise<void> {
		const decoder = new TextDecoder()
		let buffer = ''
		try {
			for (;;) {
				const { value, done } = await reader.read()
				if (done) break
				buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
				let end: number
				while ((end = buffer.indexOf('\n\n')) >= 0) {
					const raw = buffer.slice(0, end)
					buffer = buffer.slice(end + 2)
					let event = 'message'
					const data: string[] = []
					for (const line of raw.split('\n')) {
						if (line.startsWith('event:')) event = line.slice(6).trim()
						else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
					}
					if (event === 'endpoint') onEndpoint(data.join('\n'))
					else if (event === 'message' && data.length) this.receive(data.join('\n'))
				}
			}
		} catch { /* closed or aborted */ }
		for (const waiting of this.pending.values()) waiting({ error: { code: -32603, message: 'the SSE stream was closed' } })
		this.pending.clear()
	}

	private receive (text: string): void {
		let message: RpcMessage
		try { message = JSON.parse(text) } catch { return }
		const waiting = message.id !== undefined && message.id !== null ? this.pending.get(Number(message.id)) : undefined
		if (waiting) { this.pending.delete(Number(message.id)); waiting(message) }
	}

	private async post (body: Record<string, any>): Promise<void> {
		let response: Response
		try {
			response = await fetch(this.messages!, { method: 'POST', headers: { ...this.target.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
		} catch (error: any) {
			throw transportError(this.name, `POST ${this.messages}: ${error?.cause?.message ?? error?.message ?? error}`)
		}
		await response.text()
		if (!response.ok) throw gatewayError(this.name, { status: response.status, errorName: 'McpError', message: `POST ${this.messages} answered ${response.status}` })
	}

	protected async request (method: string, params: any): Promise<RpcMessage> {
		const id = this.next++
		const answer = new Promise<RpcMessage>(resolve => this.pending.set(id, resolve))
		await this.post({ jsonrpc: '2.0', id, method, params })
		return answer
	}

	public async close (): Promise<void> {
		this.abort?.abort()
		await this.reading
	}
}

/** MCP over WebSocket (not standard): the same JSON-RPC messages on a socket at {schema}/mcp */
export class McpWebSocketTransport extends McpTransport {
	public readonly name = 'mcp+ws' as const
	private readonly socket: RpcSocket

	constructor (target: ConnectionTarget) {
		super(target)
		this.socket = new RpcSocket(target.url + '/mcp', target.headers)
	}

	public async open (): Promise<void> {
		try {
			await withTimeout(this.socket.open(), this.target.timeout, () => new Error(`no answer from ${this.target.url}/mcp in ${this.target.timeout} ms`))
		} catch (error: any) {
			throw transportError(this.name, error.message)
		}
		await this.initialize()
		this.socket.notify('notifications/initialized')
	}

	protected request (method: string, params: any): Promise<RpcMessage> { return this.socket.request(method, params) }
	public async close (): Promise<void> { this.socket.close() }
}
