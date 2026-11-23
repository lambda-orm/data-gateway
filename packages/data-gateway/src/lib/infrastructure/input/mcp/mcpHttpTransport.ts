import express from 'express'
import http from 'http'
import { randomUUID } from 'crypto'
import { AddressInfo } from 'net'
import { rateLimit } from 'express-rate-limit'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SchemaDirectoryPort, ServedSchema } from '../../../application/ports/input/schemaDirectoryPort'
import { AuthenticatorPort, LoggerPort, MetricsPort } from '../../../application/ports/output/supportPorts'
import { Principal } from '../../../domain/auth/principal'
import { Transport } from '../transport'
import { createSdkServer } from './sdkMcpServer'

export interface McpHttpTransportOptions {
	port: number
	host: string
	basePath: string
	requestBodySize: string
	rateLimit: { windowMs: number, max: number }
	legacySse: boolean
	stateful: boolean
	maxConnections: number
}

export interface McpHttpTransportDeps {
	directory: SchemaDirectoryPort
	metrics: MetricsPort
	logger: LoggerPort
}

export const TRANSPORT_NAME = 'mcpHttp'

interface Session<T> {
	transport: T
	server: Server
	credential: string
	/** Route of its schema: a session id only works under it */
	schema: string
}

const rpcError = (res: express.Response, status: number, code: number, message: string): void => {
	res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null })
}

/**
 * MCP over HTTP, one MCP server per schema: Streamable HTTP at {basePath}/{schema}/mcp (stateless by default: every POST stands alone, so any
 * replica answers it) and, with legacySse, the deprecated HTTP+SSE at /sse + /messages. Authenticates every request.
 */
export class McpHttpTransport implements Transport {
	public readonly name = TRANSPORT_NAME
	public readonly app: express.Express
	private server: http.Server | undefined
	private readonly sseSessions = new Map<string, Session<SSEServerTransport>>()
	private readonly streamSessions = new Map<string, Session<StreamableHTTPServerTransport>>()
	private schemaRouter: express.Router = express.Router()

	constructor (private readonly options: McpHttpTransportOptions, private readonly deps: McpHttpTransportDeps) {
		this.app = this.createApp()
		this.mountSchemas()
		deps.directory.onSchemasChange(() => this.mountSchemas())
	}

	public get address () {
		const info = this.server?.address() as AddressInfo | null | undefined
		return info ? { host: info.address, port: info.port } : undefined
	}

	private get served (): ServedSchema[] {
		return this.deps.directory.schemas().filter(s => s.exposedOn(TRANSPORT_NAME))
	}

	private prefix (schema: ServedSchema): string {
		return `${this.options.basePath}${schema.path ? `/${schema.path}` : ''}`
	}

	public async start (): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const server = http.createServer(this.app)
			server.once('error', reject)
			server.listen(this.options.port, this.options.host, () => {
				server.off('error', reject)
				resolve()
			})
			this.server = server
		})
		const address = this.address
		this.deps.logger.info(`[data-gateway] mcpHttp listening on ${address?.host}:${address?.port}: ${this.served.map(s => `${this.prefix(s)}/mcp`).join(', ')}` +
			`${this.options.stateful ? ' (stateful)' : ''}${this.options.legacySse ? ' (and /sse)' : ''}`)
	}

	public async stop (): Promise<void> {
		const sessions = [...this.sseSessions.values(), ...this.streamSessions.values()]
		this.sseSessions.clear()
		this.streamSessions.clear()
		await Promise.all(sessions.map(session => session.server.close().catch(() => undefined)))
		const server = this.server
		this.server = undefined
		if (!server) return
		server.closeAllConnections?.()
		await new Promise<void>(resolve => server.close(() => resolve()))
	}

	public status () {
		return {
			transport: TRANSPORT_NAME,
			schemas: this.served.map(s => ({ path: s.path, mcp: `${this.prefix(s)}/mcp`, sse: this.options.legacySse ? `${this.prefix(s)}/sse` : undefined })),
			stateful: this.options.stateful,
			sessions: { sse: this.sseSessions.size, streamable: this.streamSessions.size, max: this.options.maxConnections }
		}
	}

	// ─── app ─────────────────────────────────────────────────────────────────

	private createApp (): express.Express {
		const app = express()
		const { metrics } = this.deps
		app.disable('x-powered-by')
		app.use((req, res, next) => {
			const end = metrics.startTimer()
			res.on('finish', () => end({
				method: req.method,
				route: req.route?.path ?? 'unmatched',
				code: res.statusCode,
				credential: (res.locals.principal as Principal | undefined)?.name ?? '-'
			}))
			next()
		})
		if (this.options.rateLimit.max > 0) {
			app.use(rateLimit({ windowMs: this.options.rateLimit.windowMs, max: this.options.rateLimit.max, standardHeaders: true, legacyHeaders: false }))
		}
		const base = this.options.basePath
		app.get(`${base}/status`, (_req, res) => { res.json(this.status()) })
		app.get(`${base}/health`, async (_req, res) => { res.json(await this.deps.directory.health()) })
		// the schemas: the router of the moment (a schema added or removed replaces it)
		app.use((req, res, next) => this.schemaRouter(req, res, next))
		app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
			if (res.headersSent) return next(err)
			const status = Number.isInteger(err?.status) ? err.status : 500
			rpcError(res, status, status === 400 ? -32700 : -32603, err?.message ?? String(err))
		})
		return app
	}

	/** The routes of every schema served now; the sessions of a schema that went are closed */
	private mountSchemas (): void {
		const router = express.Router()
		const json = express.json({ limit: this.options.requestBodySize })
		for (const schema of this.served) {
			const prefix = this.prefix(schema)
			const authenticate = this.authenticate(schema.authenticator(TRANSPORT_NAME))
			router.post(`${prefix}/mcp`, json, authenticate, (req, res) => this.streamable(schema, req, res))
			router.get(`${prefix}/mcp`, authenticate, (req, res) => this.streamableSession(schema, req, res))
			router.delete(`${prefix}/mcp`, authenticate, (req, res) => this.streamableSession(schema, req, res))
			if (this.options.legacySse) {
				router.get(`${prefix}/sse`, authenticate, (req, res) => this.sse(schema, req, res))
				router.post(`${prefix}/messages`, json, authenticate, (req, res) => this.sseMessage(schema, req, res))
			}
		}
		this.schemaRouter = router
		const paths = new Set(this.served.map(s => s.path))
		for (const sessions of [this.sseSessions, this.streamSessions] as Map<string, Session<any>>[]) {
			for (const [id, session] of sessions) {
				if (paths.has(session.schema)) continue
				sessions.delete(id)
				session.server.close().catch(() => undefined)
			}
		}
	}

	private authenticate (authenticator: AuthenticatorPort) {
		return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
		try {
			const result = await authenticator.authenticate(req.headers)
			if (!result.valid || !result.principal) {
				rpcError(res, 401, -32001, result.reason ?? 'a valid credential is required')
				return
			}
			res.locals.principal = result.principal
			next()
		} catch (error) {
			next(error)
		}
		}
	}

	private context (res: express.Response) {
		return { principal: res.locals.principal as Principal, transport: TRANSPORT_NAME }
	}

	public get connections (): number {
		return this.sseSessions.size + this.streamSessions.size
	}

	// ─── Streamable HTTP ─────────────────────────────────────────────────────

	private async streamable (schema: ServedSchema, req: express.Request, res: express.Response): Promise<void> {
		try {
			if (this.options.stateful) {
				await this.statefulPost(schema, req, res)
				return
			}
			// stateless: a server and a transport per request, closed with the response
			const server = createSdkServer(schema.mcp, this.context(res), this.deps.logger)
			const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
			res.on('close', () => {
				transport.close().catch(() => undefined)
				server.close().catch(() => undefined)
			})
			await server.connect(transport)
			await transport.handleRequest(req, res, req.body)
		} catch (error) {
			this.deps.logger.error(error as Error)
			if (!res.headersSent) rpcError(res, 500, -32603, 'internal error')
		}
	}

	private async statefulPost (schema: ServedSchema, req: express.Request, res: express.Response): Promise<void> {
		const id = req.header('mcp-session-id')
		if (id) {
			const session = this.ownSession(this.streamSessions, schema, id, res)
			if (session) await session.transport.handleRequest(req, res, req.body)
			return
		}
		if (this.connections >= this.options.maxConnections) {
			rpcError(res, 503, -32000, `too many sessions (maxConnections ${this.options.maxConnections})`)
			return
		}
		const ctx = this.context(res)
		const server = createSdkServer(schema.mcp, ctx, this.deps.logger)
		const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: sessionId => {
				this.streamSessions.set(sessionId, { transport, server, credential: ctx.principal.name, schema: schema.path })
			}
		})
		transport.onclose = () => {
			if (transport.sessionId) this.streamSessions.delete(transport.sessionId)
		}
		await server.connect(transport)
		await transport.handleRequest(req, res, req.body)
	}

	private async streamableSession (schema: ServedSchema, req: express.Request, res: express.Response): Promise<void> {
		if (!this.options.stateful) {
			res.setHeader('Allow', 'POST')
			rpcError(res, 405, -32000, 'method not allowed: this server is stateless, send every message with POST')
			return
		}
		const id = req.header('mcp-session-id')
		if (!id) {
			rpcError(res, 400, -32000, 'mcp-session-id header is required')
			return
		}
		const session = this.ownSession(this.streamSessions, schema, id, res)
		if (session) await session.transport.handleRequest(req, res)
	}

	/** The session, if it exists, is of this schema and belongs to the same credential (a session id is not a credential) */
	private ownSession<T> (sessions: Map<string, Session<T>>, schema: ServedSchema, id: string, res: express.Response): Session<T> | undefined {
		const session = sessions.get(id)
		if (!session || session.schema !== schema.path || session.credential !== this.context(res).principal.name) {
			rpcError(res, 404, -32001, `session "${id}" not found`)
			return undefined
		}
		return session
	}

	// ─── HTTP+SSE (deprecated) ───────────────────────────────────────────────

	private async sse (schema: ServedSchema, _req: express.Request, res: express.Response): Promise<void> {
		if (this.connections >= this.options.maxConnections) {
			rpcError(res, 503, -32000, `too many SSE connections (maxConnections ${this.options.maxConnections})`)
			return
		}
		const ctx = this.context(res)
		const transport = new SSEServerTransport(`${this.prefix(schema)}/messages`, res)
		const server = createSdkServer(schema.mcp, ctx, this.deps.logger)
		this.sseSessions.set(transport.sessionId, { transport, server, credential: ctx.principal.name, schema: schema.path })
		res.on('close', () => {
			this.sseSessions.delete(transport.sessionId)
			server.close().catch(() => undefined)
		})
		await server.connect(transport)
	}

	private async sseMessage (schema: ServedSchema, req: express.Request, res: express.Response): Promise<void> {
		const id = String(req.query.sessionId ?? '')
		const session = this.ownSession(this.sseSessions, schema, id, res)
		if (session) await session.transport.handlePostMessage(req, res, req.body)
	}
}
