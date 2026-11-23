import http from 'http'
import path from 'path'
import fs from 'fs'
import { Duplex } from 'stream'
import { AddressInfo } from 'net'
import { WebSocket, WebSocketServer } from 'ws'
import { RequestContext } from '../../../application/ports/input/dataGatewayPort'
import { SchemaDirectoryPort, ServedSchema } from '../../../application/ports/input/schemaDirectoryPort'
import { AuthenticatorPort, LoggerPort } from '../../../application/ports/output/supportPorts'
import { RpcDispatcher } from '../../../application/rpc/rpcDispatcher'
import { Principal } from '../../../domain/auth/principal'
import { RpcCallError } from '../../../domain/errors/gatewayError'
import { toHttpError } from '../http/httpErrors'
import { Transport } from '../transport'
import { chooseProtocol, headersFromProtocols } from '../../../domain/auth/protocolCredential'
const YAML = require('js-yaml')

export interface WebSocketTransportOptions {
	port: number
	host: string
	basePath: string
	maxConnections: number
	maxPayload: number
	asyncapiEnabled: boolean
}

export interface WebSocketTransportDeps {
	directory: SchemaDirectoryPort
	/** Authentication of a connection to the root when no schema is served there (general.*, gateway.schemas) */
	rootAuthenticator: AuthenticatorPort
	logger: LoggerPort
	dispatcher?: RpcDispatcher
}

export const TRANSPORT_NAME = 'webSocket'

type Id = string | number | null

interface RpcResponse {
	jsonrpc: '2.0'
	id: Id
	result?: unknown
	error?: { code: number, message: string, data?: unknown }
}

/** An error as JSON-RPC: routing problems with their code; the rest -32000 with the name and the status REST would give */
export const toRpcError = (error: unknown): RpcResponse['error'] => {
	if (error instanceof RpcCallError) return { code: error.rpcCode, message: error.message }
	const { status, body } = toHttpError(error)
	const data: Record<string, unknown> = { name: body.error, status }
	if (body.code !== undefined) data.code = body.code
	if (body.suggestions) data.suggestions = body.suggestions
	return { code: -32000, message: body.message, data }
}

/**
 * The λORM API over WebSocket (JSON-RPC 2.0, docs/DATA_GATEWAY.md §7): a connection per schema route, authenticated
 * in the upgrade; the root (without a schema there) answers general.* and gateway.schemas. Besides answers, the
 * server notifies queue.completed / queue.failed (executeQueued with notify) and schema.statusChanged.
 */
export class WebSocketTransport implements Transport {
	public readonly name = TRANSPORT_NAME
	private server: http.Server | undefined
	private readonly wss: WebSocketServer
	private readonly dispatcher: RpcDispatcher
	private readonly asyncapi: unknown

	constructor (private readonly options: WebSocketTransportOptions, private readonly deps: WebSocketTransportDeps) {
		// a browser sends its credential in the subprotocols (it can't send headers): lambdaorm is answered
		this.wss = new WebSocketServer({ noServer: true, maxPayload: options.maxPayload, handleProtocols: chooseProtocol })
		this.dispatcher = deps.dispatcher ?? new RpcDispatcher()
		this.asyncapi = options.asyncapiEnabled ? this.loadAsyncapi() : undefined
		deps.directory.onSchemasChange(() => this.closeRemoved())
	}

	/** The schema of each connection ('' the root too, when no schema is there: undefined) */
	private readonly schemaOf = new Map<WebSocket, string | undefined>()

	/** The connections to a schema that went are closed (4404); the root ones learn it by workspace.changed */
	private closeRemoved (): void {
		const paths = new Set(this.served.map(s => s.path))
		for (const [ws, path] of this.schemaOf) {
			if (path !== undefined && !paths.has(path)) ws.close(4404, `schema "${path || '/'}" was removed`)
		}
	}

	public get address () {
		const info = this.server?.address() as AddressInfo | null | undefined
		return info ? { host: info.address, port: info.port } : undefined
	}

	private get served (): ServedSchema[] {
		return this.deps.directory.schemas().filter(s => s.exposedOn(TRANSPORT_NAME))
	}

	private route (schema: ServedSchema): string {
		return `${this.options.basePath}${schema.path ? `/${schema.path}` : ''}` || '/'
	}

	public async start (): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const server = http.createServer((req, res) => this.http(req, res))
			server.on('upgrade', (req, socket, head) => { this.upgrade(req, socket, head).catch(error => this.deps.logger.error(error)) })
			server.once('error', reject)
			server.listen(this.options.port, this.options.host, () => {
				server.off('error', reject)
				resolve()
			})
			this.server = server
		})
		const address = this.address
		this.deps.logger.info(`[data-gateway] webSocket listening on ws://${address?.host}:${address?.port}: ${this.served.map(s => this.route(s)).join(', ')}`)
	}

	public async stop (): Promise<void> {
		for (const client of this.wss.clients) client.terminate()
		await new Promise<void>(resolve => this.wss.close(() => resolve()))
		const server = this.server
		this.server = undefined
		if (!server) return
		server.closeAllConnections?.()
		await new Promise<void>(resolve => server.close(() => resolve()))
	}

	public get connections (): number {
		return this.wss.clients.size
	}

	public status () {
		return { transport: TRANSPORT_NAME, schemas: this.served.map(s => ({ path: s.path, url: this.route(s) })), connections: this.wss.clients.size, max: this.options.maxConnections }
	}

	private http (req: http.IncomingMessage, res: http.ServerResponse): void {
		const url = new URL(req.url ?? '/', 'http://localhost')
		const base = this.options.basePath
		const send = (status: number, body: unknown, type = 'application/json') => {
			// its documents and status are read from any page (an IDE elsewhere), as the http transport answers
			res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' })
			res.end(typeof body === 'string' ? body : JSON.stringify(body))
		}
		if (req.method === 'GET' && url.pathname === `${base}/status`) return send(200, this.status())
		if (req.method === 'GET' && url.pathname === `${base}/health`) {
			this.deps.directory.health().then(health => send(200, health), () => send(500, { error: 'Error' }))
			return
		}
		if (req.method === 'GET' && this.asyncapi && url.pathname === `${base}/asyncapi.json`) return send(200, this.asyncapi)
		if (req.method === 'GET' && this.asyncapi && url.pathname === `${base}/asyncapi`) return send(200, YAML.dump(this.asyncapi), 'application/yaml')
		send(426, { error: 'UpgradeRequired', message: 'connect with WebSocket to a schema route' })
	}

	private reject (socket: Duplex, status: number, message: string): void {
		const body = JSON.stringify({ error: http.STATUS_CODES[status], message })
		socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
	}

	private async upgrade (req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
		const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/'
		const schema = this.served.find(s => this.route(s) === pathname)
		const atRoot = !schema && pathname === (this.options.basePath || '/')
		if (!schema && !atRoot) return this.reject(socket, 404, `no schema at ${pathname}`)
		if (this.wss.clients.size >= this.options.maxConnections) return this.reject(socket, 503, `too many connections (maxConnections ${this.options.maxConnections})`)
		let principal: Principal
		try {
			const authenticator = schema ? schema.authenticator(TRANSPORT_NAME) : this.deps.rootAuthenticator
			const result = await authenticator.authenticate({ ...headersFromProtocols(req.headers['sec-websocket-protocol']), ...req.headers })
			if (!result.valid || !result.principal) return this.reject(socket, 401, result.reason ?? 'a valid credential is required')
			principal = result.principal
		} catch (error) {
			this.deps.logger.error(error as Error)
			return this.reject(socket, 500, 'authentication failed')
		}
		this.wss.handleUpgrade(req, socket, head, ws => this.connection(ws, { principal, transport: TRANSPORT_NAME }, schema))
	}

	/** One connection: its requests, and the notifications it asked for */
	private connection (ws: WebSocket, ctx: RequestContext, schema: ServedSchema | undefined): void {
		const send = (message: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)) }
		const notify = (method: string, params: unknown) => send({ jsonrpc: '2.0', method, params })
		const awaited = new Set<string>()
		// an execution can end before its queueId is answered: the latest ends are kept a while
		const recent = new Map<string, { queueId: string, ok: boolean }>()
		const done = (outcome: { queueId: string, ok: boolean }) => notify(outcome.ok ? 'queue.completed' : 'queue.failed', outcome)
		const unsubscribe: (() => void)[] = []
		this.schemaOf.set(ws, schema?.path)
		unsubscribe.push(() => this.schemaOf.delete(ws))
		// what changed in its workspace (a connection to the root: in every workspace)
		unsubscribe.push(this.deps.directory.onWorkspaceChange(change => {
			if (!schema || schema.path === change.path) notify('workspace.changed', change)
		}))
		if (schema) {
			unsubscribe.push(schema.onQueueOutcome(outcome => {
				if (awaited.delete(outcome.queueId)) return done(outcome)
				recent.set(outcome.queueId, outcome)
				if (recent.size > 200) recent.delete(recent.keys().next().value!)
			}))
			unsubscribe.push(this.deps.directory.onStateChange(state => {
				if (state.path === schema.path) notify('schema.statusChanged', { path: state.path, status: state.status, reason: state.reason, pending: state.pending })
			}))
		}
		ws.on('close', () => { for (const off of unsubscribe) off() })
		ws.on('message', async (data, isBinary) => {
			let message: any
			try {
				if (isBinary) throw new Error('binary messages are not accepted')
				message = JSON.parse(data.toString())
			} catch (error: any) {
				send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `parse error: ${error?.message ?? error}` } })
				return
			}
			if (Array.isArray(message) || typeof message !== 'object' || message === null || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
				send({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'invalid request: one JSON-RPC 2.0 object with a method (no batches)' } })
				return
			}
			const id: Id = message.id ?? null
			const isNotification = !('id' in message)
			try {
				const result = await this.call(ctx, schema, message.method, message.params)
				const queueId = message.method === 'query.executeQueued' && message.params?.notify ? (result as any)?.queueId : undefined
				if (queueId) {
					const ended = recent.get(queueId)
					if (ended) {
						recent.delete(queueId)
						setImmediate(() => done(ended))
					} else {
						awaited.add(queueId)
					}
				}
				if (!isNotification) send({ jsonrpc: '2.0', id, result })
			} catch (error) {
				if (!isNotification) send({ jsonrpc: '2.0', id, error: toRpcError(error) })
			}
		})
	}

	private async call (ctx: RequestContext, schema: ServedSchema | undefined, method: string, params: unknown): Promise<unknown> {
		if (method === 'gateway.schemas') {
			if (schema && schema.path !== '') throw new RpcCallError(-32601, 'gateway.schemas is a method of the root connection')
			return this.deps.directory.states()
		}
		if (!schema) {
			if (method === 'general.version') return this.deps.directory.version()
			if (method === 'general.health') return this.deps.directory.health()
			if (method === 'general.ping') return { message: 'pong', time: new Date().toISOString() }
			throw new RpcCallError(-32601, `method "${method}" not found at the root: connect to a schema route`)
		}
		return this.dispatcher.dispatch(schema.gateway, ctx, method, params)
	}

	private loadAsyncapi (): unknown {
		const file = path.join(__dirname, 'asyncapi.yaml')
		if (!fs.existsSync(file)) {
			this.deps.logger.warn(`asyncapi.yaml not found next to the webSocket transport (${file}): /asyncapi not served`)
			return undefined
		}
		const document = YAML.load(fs.readFileSync(file, 'utf8'))
		document.servers = Object.fromEntries(this.served.map(s => [s.path || 'root', { host: `localhost:${this.options.port}`, protocol: 'ws', pathname: this.route(s) }]))
		return document
	}
}
