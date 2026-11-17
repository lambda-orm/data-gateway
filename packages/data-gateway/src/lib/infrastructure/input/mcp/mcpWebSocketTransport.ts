import http from 'http'
import path from 'path'
import fs from 'fs'
import { Duplex } from 'stream'
import { AddressInfo } from 'net'
import { WebSocket, WebSocketServer } from 'ws'
import { Transport as SdkTransport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { JSONRPCMessage, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'
import { McpServerPort } from '../../../application/ports/input/mcpServerPort'
import { AuthenticatorPort, LoggerPort } from '../../../application/ports/output/supportPorts'
import { Principal } from '../../../domain/auth/principal'
import { Transport } from '../transport'
import { createSdkServer } from './sdkMcpServer'
const YAML = require('js-yaml')

export interface McpWebSocketTransportOptions {
	port: number
	host: string
	basePath: string
	schemaPath: string
	maxConnections: number
	/** Bytes of a message */
	maxPayload: number
	asyncapiEnabled: boolean
}

export interface McpWebSocketTransportDeps {
	server: McpServerPort
	authenticator: AuthenticatorPort
	logger: LoggerPort
}

export const TRANSPORT_NAME = 'mcpWebSocket'
const SUBPROTOCOL = 'mcp'

/** The SDK transport over one accepted socket: one JSON-RPC message per WebSocket text message */
class ServerSocketTransport implements SdkTransport {
	public onclose?: () => void
	public onerror?: (error: Error) => void
	public onmessage?: (message: JSONRPCMessage) => void

	constructor (private readonly socket: WebSocket) {}

	public async start (): Promise<void> {
		this.socket.on('message', (data, isBinary) => {
			if (isBinary) {
				this.reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'binary messages are not accepted' } })
				return
			}
			let message: JSONRPCMessage
			try {
				message = JSONRPCMessageSchema.parse(JSON.parse(data.toString()))
			} catch (error: any) {
				this.reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `parse error: ${error?.message ?? error}` } })
				return
			}
			this.onmessage?.(message)
		})
		this.socket.on('close', () => this.onclose?.())
		this.socket.on('error', error => this.onerror?.(error))
	}

	private reply (message: unknown): void {
		if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
	}

	public async send (message: JSONRPCMessage): Promise<void> {
		this.reply(message)
	}

	public async close (): Promise<void> {
		this.socket.close()
	}
}

/**
 * MCP over WebSocket (not standard; for clients and gateways that speak it): upgrade at {basePath}/{schema}/mcp,
 * authenticated in the handshake (401 and closed without credentials). One MCP server per connection, with the
 * tools of its credential. Plus GET {basePath}/status and /asyncapi over HTTP.
 */
export class McpWebSocketTransport implements Transport {
	public readonly name = TRANSPORT_NAME
	private server: http.Server | undefined
	private readonly wss: WebSocketServer
	private readonly asyncapi: unknown

	constructor (private readonly options: McpWebSocketTransportOptions, private readonly deps: McpWebSocketTransportDeps) {
		this.wss = new WebSocketServer({
			noServer: true,
			maxPayload: options.maxPayload,
			handleProtocols: protocols => protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false
		})
		this.asyncapi = options.asyncapiEnabled ? this.loadAsyncapi() : undefined
	}

	public get address () {
		const info = this.server?.address() as AddressInfo | null | undefined
		return info ? { host: info.address, port: info.port } : undefined
	}

	private get path (): string {
		return `${this.options.basePath}${this.options.schemaPath ? `/${this.options.schemaPath}` : ''}/mcp`
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
		this.deps.logger.info(`[data-gateway] mcpWebSocket listening on ws://${address?.host}:${address?.port}${this.path}`)
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

	public status () {
		return { transport: TRANSPORT_NAME, schemas: [{ path: this.options.schemaPath, mcp: this.path }], connections: this.wss.clients.size, max: this.options.maxConnections }
	}

	private http (req: http.IncomingMessage, res: http.ServerResponse): void {
		const url = new URL(req.url ?? '/', 'http://localhost')
		const base = this.options.basePath
		const send = (status: number, body: unknown, type = 'application/json') => {
			res.writeHead(status, { 'Content-Type': type })
			res.end(typeof body === 'string' ? body : JSON.stringify(body))
		}
		if (req.method === 'GET' && url.pathname === `${base}/status`) return send(200, this.status())
		if (req.method === 'GET' && url.pathname === `${base}/health`) return send(200, { message: 'OK' })
		if (req.method === 'GET' && this.asyncapi && url.pathname === `${base}/asyncapi.json`) return send(200, this.asyncapi)
		if (req.method === 'GET' && this.asyncapi && url.pathname === `${base}/asyncapi`) return send(200, YAML.dump(this.asyncapi), 'application/yaml')
		if (url.pathname === this.path) return send(426, { error: 'UpgradeRequired', message: `connect with WebSocket (subprotocol "${SUBPROTOCOL}")` })
		send(404, { error: 'NotFound', message: `${req.method} ${url.pathname}` })
	}

	private reject (socket: Duplex, status: number, message: string): void {
		const body = JSON.stringify({ error: http.STATUS_CODES[status], message })
		socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
	}

	private async upgrade (req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
		const url = new URL(req.url ?? '/', 'http://localhost')
		if (url.pathname !== this.path) return this.reject(socket, 404, `no MCP server at ${url.pathname}`)
		if (this.wss.clients.size >= this.options.maxConnections) return this.reject(socket, 503, `too many connections (maxConnections ${this.options.maxConnections})`)
		let principal: Principal | undefined
		try {
			const result = await this.deps.authenticator.authenticate(req.headers)
			if (!result.valid || !result.principal) return this.reject(socket, 401, result.reason ?? 'a valid credential is required')
			principal = result.principal
		} catch (error) {
			this.deps.logger.error(error as Error)
			return this.reject(socket, 500, 'authentication failed')
		}
		this.wss.handleUpgrade(req, socket, head, ws => {
			const server = createSdkServer(this.deps.server, { principal: principal!, transport: TRANSPORT_NAME }, this.deps.logger)
			ws.on('close', () => { server.close().catch(() => undefined) })
			server.connect(new ServerSocketTransport(ws)).catch(error => {
				this.deps.logger.error(error as Error)
				ws.close(1011)
			})
		})
	}

	private loadAsyncapi (): unknown {
		const file = path.join(__dirname, 'asyncapi.yaml')
		if (!fs.existsSync(file)) {
			this.deps.logger.warn(`asyncapi.yaml not found next to the mcpWebSocket transport (${file}): /asyncapi not served`)
			return undefined
		}
		const document = YAML.load(fs.readFileSync(file, 'utf8'))
		document.servers = { gateway: { host: `localhost:${this.options.port}`, protocol: 'ws', pathname: this.path } }
		return document
	}
}
