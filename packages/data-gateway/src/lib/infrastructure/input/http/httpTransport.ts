import { createHash } from 'crypto'
import { requestTracer } from '../telemetry/requestTracer'
import { ConnectionSubscriptions } from '../../../application/subscriptions/subscriptions'
import express from 'express'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { AddressInfo } from 'net'
import { rateLimit } from 'express-rate-limit'
import swaggerUi from 'swagger-ui-express'
import { DataGatewayPort, RequestContext } from '../../../application/ports/input/dataGatewayPort'
import { SchemaDirectoryPort, ServedSchema } from '../../../application/ports/input/schemaDirectoryPort'
import { AuthenticatorPort, CredentialScheme, LoggerPort, MetricsPort } from '../../../application/ports/output/supportPorts'
import { Principal, refusalOf, withActor } from '../../../domain/auth/principal'
import { Transport } from '../transport'
import { toHttpError } from './httpErrors'
import { closestNames } from '@lambdaorm/base'
import { badRequest } from '../../../domain/errors/gatewayError'
import { withSecurity } from './openApi'
import { adminRouter } from './adminRoutes'
import { AdminService } from '../../../application/admin/adminService'
import { CommandService } from '../../../application/admin/commandService'
import { SessionDeps, sessionAuthentication, sessionRouter } from './sessionRoutes'
import { ManagementEvents } from './managementEvents'
import { parseSize } from '../../../domain/config/sizes'
const YAML = require('js-yaml')

export interface HttpTransportOptions {
	/** http (the clients) or management (the data-gateway-ide: every schema, and the administration at /admin) */
	name?: HttpTransportName
	port: number
	host: string
	basePath: string
	requestBodySize: string
	rateLimit: { windowMs: number, max: number }
	swaggerEnabled: boolean
	/** The transports of this gateway, told at GET {basePath}/transports (an IDE finds there its WebSocket and MCP) */
	transports?: TransportInfo[]
}

/** A transport of the gateway as a client sees it: where it listens (its port; behind a proxy its public URL differs) */
export interface TransportInfo {
	name: 'http' | 'webSocket' | 'mcpHttp' | 'mcpWebSocket'
	port: number
	basePath: string
	/** where its document is, relative to its base path: openapi.json (http), asyncapi.json (webSocket, mcpWebSocket) */
	docs?: string
	/** how a schema is reached: {basePath}/{schema} (webSocket), {basePath}/{schema}/mcp (mcpHttp, mcpWebSocket) */
	schemaPath?: string
}

export interface HttpTransportDeps {
	directory: SchemaDirectoryPort
	metrics: MetricsPort
	logger: LoggerPort
	/** management: the administration of the workspaces at {basePath}/admin, with this authentication */
	admin?: { service: AdminService, commands?: CommandService, authenticator: AuthenticatorPort }
	/**
	 * management: every request needs a session (docs/DATA_GATEWAY_SESSIONS_PLAN.md), given at {basePath}/sessions
	 * with the credential; a credential sent directly is refused
	 */
	sessions?: SessionDeps
}

/** Paths that never need a credential: Kubernetes probes and Prometheus. */
const OPEN_PATHS = ['/ping', '/health', '/metrics']
export const TRANSPORT_NAME = 'http'
export type HttpTransportName = 'http' | 'management'

type Handler = (req: express.Request, ctx: RequestContext) => Promise<unknown>

/**
 * The REST API (the endpoints of the former service) on its own port, for every schema exposed on it: under
 * {basePath}/{schema} (or at {basePath} for the only schema at the root). {basePath}/schemas lists them; /health is
 * aggregated when there are several. As management, the same routes plus the administration at {basePath}/admin, for
 * the data-gateway-ide. No CORS: a browser reaches it through a backend of its own origin (docs/DATA_GATEWAY.md §12).
 */
export class HttpTransport implements Transport {
	public readonly name: HttpTransportName
	public readonly app: express.Express
	private server: http.Server | undefined
	/** The routes of the schemas, rebuilt when one is added or removed (orm.watch) */
	private schemaRouter: express.Router = express.Router()
	private routes: { method: string, path: string }[] = []
	private swaggerDocument: any
	/** management: its WebSocket of events ({basePath}/events) */
	private events?: ManagementEvents

	constructor (private readonly options: HttpTransportOptions, private readonly deps: HttpTransportDeps) {
		this.name = options.name ?? TRANSPORT_NAME
		this.app = this.createApp()
		this.mountSchemas()
		deps.directory.onSchemasChange(() => this.mountSchemas())
	}

	public get address () {
		const info = this.server?.address() as AddressInfo | null | undefined
		return info ? { host: info.address, port: info.port } : undefined
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
		if (this.deps.sessions) {
			this.events = new ManagementEvents(
				{ basePath: this.options.basePath, maxPayload: parseSize(this.options.requestBodySize) ?? 1024 * 1024, ...this.deps.sessions.events },
				this.deps.sessions.service, this.deps.sessions.address, this.deps.directory, this.deps.logger)
			this.events.attach(this.server!)
		}
		const address = this.address
		const schemas = this.served.map(s => `/${s.path}`).join(', ')
		this.deps.logger.info(`[data-gateway] ${this.name} listening on ${address?.host}:${address?.port}${this.options.basePath || '/'} (schemas ${schemas})`)
	}

	private get served (): ServedSchema[] {
		return this.deps.directory.schemas().filter(s => s.exposedOn(this.name))
	}

	/** the route template of a request, for its span: the schema as {schema} (its routes are mounted under each schema) */
	private routeOf (req: express.Request): string | undefined {
		const relative = req.route?.path as string | undefined
		if (relative === undefined) return undefined
		const tail = relative === '/' ? '' : relative
		const schema = this.served.find(s => s.path && this.schemaBase(s) === req.baseUrl)
		return schema ? `${this.options.basePath}/{schema}${tail}` : `${req.baseUrl}${tail}` || '/'
	}

	private schemaBase (schema: ServedSchema): string {
		return `${this.options.basePath}${schema.path ? `/${schema.path}` : ''}`
	}

	public async stop (): Promise<void> {
		await this.events?.close()
		this.events = undefined
		const server = this.server
		this.server = undefined
		if (!server) return
		await new Promise<void>(resolve => server.close(() => resolve()))
		server.closeAllConnections?.()
	}

	// ─── app ─────────────────────────────────────────────────────────────────

	private createApp (): express.Express {
		const app = express()
		const { metrics } = this.deps
		app.disable('x-powered-by')
		// the span of the request first: everything after runs inside it
		app.use(requestTracer.http(req => this.routeOf(req)))
		app.use((req, res, next) => {
			const end = metrics.startTimer()
			res.on('finish', () => end({
				method: req.method,
				route: req.route?.path ?? 'unmatched',
				template: this.routeOf(req) ?? '',
				code: res.statusCode,
				credential: (res.locals.principal as Principal | undefined)?.name ?? '-'
			}))
			next()
		})
		app.use(express.json({ limit: this.options.requestBodySize }))
		app.use(express.urlencoded({ extended: true, limit: this.options.requestBodySize }))
		if (this.options.rateLimit.max > 0) {
			app.use(rateLimit({ windowMs: this.options.rateLimit.windowMs, max: this.options.rateLimit.max, standardHeaders: true, legacyHeaders: false }))
		}
		app.use(this.beautify)
		// the documentation is public (it holds no data): its "Authorize" button takes the credential
		if (this.options.swaggerEnabled) this.swagger(app)
		const base = this.options.basePath
		app.get(`${base}/metrics`, async (_req, res) => {
			const { contentType, body } = await this.deps.metrics.render()
			res.status(200).type(contentType).send(body)
		})
		app.get(`${base}/schemas`, this.handle(async () => this.deps.directory.states()))
		// its transports (no credential: as /schemas, what a client needs to find them)
		if (this.options.transports) app.get(`${base}/transports`, this.handle(async () => this.options.transports))
		if (this.deps.sessions) app.use(`${base}/sessions`, sessionRouter(this.deps.sessions))
		if (this.deps.admin) app.use(`${base}/admin`, adminRouter(this.deps.admin.service, this.authenticate(this.deps.admin.authenticator), this.deps.admin.commands, this.deps.directory))
		// the schemas: the router of the moment (a schema added or removed replaces it)
		app.use((req, res, next) => this.schemaRouter(req, res, next))
		// a route that doesn't exist: JSON like every other answer, with the closest routes (L42)
		app.use((req: express.Request, res: express.Response) => {
			const near = closestNames(req.path, this.routes.filter(r => r.method === req.method).map(r => r.path), 3)
			const hint = near.length ? `; did you mean ${near.map(p => `${req.method} ${p}`).join(', ')}?` : `; the schemas are at ${base || ''}/schemas`
			res.status(404).json({ error: 'NotFoundError', message: `${req.method} ${req.path} is not a route of this gateway${hint}` })
		})
		app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
			if (res.headersSent) return next(err)
			// body too large / invalid JSON (body-parser), with its own status
			const status = Number.isInteger(err?.status) ? err.status : 500
			res.status(status).json({ error: err?.type ?? err?.name ?? 'Error', message: err?.message ?? String(err) })
		})
		return app
	}

	/** The routes of every schema served now, and the general ones at the base when no schema is at the root */
	private mountSchemas (): void {
		const app = express.Router()
		const base = this.options.basePath
		const directory = this.deps.directory
		const root = this.served.find(s => s.path === '')
		const routes: { method: string, path: string }[] = [{ method: 'GET', path: `${base}/schemas` }]
		if (!root) {
			// several schemas (or one under a route): the gateway's own general routes at the base
			app.get(`${base}/health`, this.handle(() => directory.health()))
			app.get(`${base}/ping`, this.handle(async () => ({ message: 'pong', time: new Date().toISOString() })))
			app.get(`${base}/version`, this.handle(async () => directory.version()))
			routes.push(...this.routesOf(app, ''))
		}
		for (const schema of this.served) {
			const router = express.Router()
			this.generalRoutes(router, schema.gateway)
			// the metrics of this schema: its operations and its worker
			router.get('/metrics', async (_req, res) => {
				const { contentType, body } = await this.deps.metrics.render({ schema: schema.path || '/' })
				res.status(200).type(contentType).send(body)
			})
			router.use(this.authenticate(schema.authenticator(this.name)))
			// who the credential is and what this schema offers: the UI enables its actions with it
			router.get('/whoami', this.handle(async (_req, ctx) => ({
				name: ctx.principal.name,
				permissions: [...ctx.principal.permissions],
				// the view of λORM of the credential (its key, its roles); without one, the schema's or the domain
				...(ctx.principal.view ? { view: ctx.principal.view } : {}),
				schema: schema.path,
				scripts: schema.features.scripts
			})))
			router.get('/typings', async (req, res) => {
				try {
					const ctx: RequestContext = { principal: res.locals.principal as Principal, transport: this.name }
					res.status(200).type('text/plain; charset=utf-8').send(await schema.gateway.typings(ctx))
				} catch (error: any) {
					const httpError = toHttpError(error)
					res.status(httpError.status).json(httpError.body)
				}
			})
			this.queryRoutes(router, schema.gateway)
			router.get('/subscribe', (req, res) => this.subscribe(req, res, schema))
			this.schemaRoutes(router, schema.gateway)
			this.stageRoutes(router, schema.gateway)
			app.use(this.schemaBase(schema) || '/', router)
			routes.push(...this.routesOf(router, this.schemaBase(schema)))
		}
		this.schemaRouter = app
		this.routes = routes
		if (this.swaggerDocument) this.swaggerDocument.servers = this.servers()
	}

	private servers () {
		return this.served.map(schema => ({ description: `schema ${schema.path || '/'}`, url: this.schemaBase(schema) || '/' }))
	}

	/** A required text of the query string: a BadRequest that says which, when it is missing */
	private queryText (req: express.Request, name: string): string {
		const value = req.query[name]
		if (typeof value !== 'string' || value.trim() === '') throw badRequest('ValidationError', `the query string needs ${name} (?${name}=…)`)
		return value
	}

	/** The routes of a router under its base: the ones a 404 suggests */
	private routesOf (router: express.Router, base: string): { method: string, path: string }[] {
		return (router.stack as any[])
			.filter(layer => layer.route && typeof layer.route.path === 'string')
			.flatMap(layer => Object.keys(layer.route.methods).map(method => ({ method: method.toUpperCase(), path: `${base}${layer.route.path}` })))
	}

		/** ?format=beautiful: indented JSON */
	private readonly beautify = (req: express.Request, res: express.Response, next: express.NextFunction) => {
		const format = req.query.format
		if (typeof format === 'string' && format.toLowerCase() === 'beautiful') {
			res.json = (body: unknown) => res.type('application/json').send(JSON.stringify(body, null, 2))
		}
		next()
	}

	private authenticate (authenticator: AuthenticatorPort): express.RequestHandler {
		// management: the session, whatever the schema's authentication says (the login used management's)
		if (this.deps.sessions) return sessionAuthentication(this.deps.sessions, OPEN_PATHS)
		return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
		if (OPEN_PATHS.includes(req.path)) return next()
		try {
			const result = await authenticator.authenticate(req.headers)
			if (!result.valid || !result.principal) {
				const refusal = refusalOf(result)
				if (refusal.challenge) res.setHeader('WWW-Authenticate', refusal.challenge)
				res.status(refusal.status).json({ error: refusal.status === 401 ? 'Unauthorized' : 'Unavailable', message: refusal.message })
				return
			}
			res.locals.principal = withActor(result.principal, { ip: req.socket.remoteAddress })
			next()
		} catch (error) {
			next(error)
		}
		}
	}

	/**
	 * validators: the answer carries an ETag (the hash of its JSON) and Cache-Control private, no-cache; a request whose
	 * If-None-Match is that ETag gets 304 without body (docs/RESULT_CACHE.md §5). Express does it only for GET.
	 */
	private handle (handler: Handler, validators = false) {
		return async (req: express.Request, res: express.Response) => {
			try {
				const ctx: RequestContext = { principal: res.locals.principal as Principal, transport: this.name }
				const payload = await handler(req, ctx)
				if (payload === undefined) {
					res.status(204).end()
					return
				}
				if (validators) {
					const etag = `W/"${createHash('sha1').update(JSON.stringify(payload)).digest('base64url')}"`
					res.setHeader('ETag', etag)
					res.setHeader('Cache-Control', 'private, no-cache')
					const sent = String(req.headers['if-none-match'] ?? '').split(',').map(tag => tag.trim())
					if (sent.includes(etag) || sent.includes(etag.slice(2))) {
						res.status(304).end()
						return
					}
				}
				// JSON for every value, also numbers (affected rows), 0, strings, booleans and null
				res.status(200).json(payload)
			} catch (error: any) {
				const httpError = toHttpError(error)
				if (httpError.status >= 500 && httpError.status !== 503) this.deps.logger.error(error)
				if (httpError.status === 429) res.setHeader('Retry-After', '1')
				res.status(httpError.status).json(httpError.body)
			}
		}
	}

	// ─── routes ──────────────────────────────────────────────────────────────

	private generalRoutes (router: express.Router, gw: DataGatewayPort): void {
		router.get('/version', this.handle(() => gw.version()))
		router.get('/health', this.handle(() => gw.health()))
		router.get('/ping', this.handle(() => gw.ping()))
	}

	/**
	 * GET /subscribe?entity=… | ?query=…&data=… | ?name=…&data=…: the subscriptions as Server-Sent Events
	 * (docs/SUBSCRIPTIONS.md §3): one per stream, with the identity of who asks; a comment every 25 s keeps it open.
	 */
	private async subscribe (req: express.Request, res: express.Response, schema: ServedSchema): Promise<void> {
		const ctx: RequestContext = { principal: res.locals.principal as Principal, transport: this.name }
		const write = (event: string, params: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(params)}\n\n`)
		const subscriptions = new ConnectionSubscriptions(schema.gateway, ctx, listener => schema.onDataChange(listener), write, { max: 1, debounceMs: 200 })
		try {
			const text = (name: string) => typeof req.query[name] === 'string' ? req.query[name] as string : undefined
			let data: unknown = {}
			if (text('data')) {
				try { data = JSON.parse(text('data')!) } catch { throw badRequest('ValidationError', 'data must be JSON') }
			}
			const started = text('entity') !== undefined
				? await subscriptions.entity(text('entity'))
				: await subscriptions.query({ query: text('query'), name: text('name'), data })
			res.status(200)
			res.setHeader('Content-Type', 'text/event-stream')
			res.setHeader('Cache-Control', 'no-cache')
			res.setHeader('Connection', 'keep-alive')
			res.flushHeaders()
			write('subscribed', started)
			const beat = setInterval(() => res.write(': keep-alive\n\n'), 25000)
			beat.unref?.()
			req.on('close', () => { clearInterval(beat); subscriptions.close() })
		} catch (error: any) {
			subscriptions.close()
			const httpError = toHttpError(error)
			res.status(httpError.status).json(httpError.body)
		}
	}

	private queryRoutes (router: express.Router, gw: DataGatewayPort): void {
		const body = (req: express.Request): any => req.body ?? {}
		router.post('/constraints', this.handle((req, ctx) => gw.constraints(ctx, body(req))))
		router.post('/metadata', this.handle((req, ctx) => gw.metadata(ctx, body(req))))
		router.post('/model', this.handle((req, ctx) => gw.model(ctx, body(req))))
		router.post('/parameters', this.handle((req, ctx) => gw.parameters(ctx, body(req))))
		router.post('/plan', this.handle((req, ctx) => gw.plan(ctx, body(req))))
		router.post('/execute', this.handle((req, ctx) => gw.execute(ctx, body(req)), true))
		// the queries of application.queries, by their name (docs/NAMED_QUERIES.md)
		router.get('/queries', this.handle((_req, ctx) => gw.queries(ctx)))
		router.post('/queries/:name', this.handle((req, ctx) => gw.query(ctx, String(req.params.name), { data: body(req).data, options: body(req).options }), true))
		router.post('/script', this.handle((req, ctx) => gw.executeScript(ctx, body(req))))
		// answers the id of the execution as a string, like the former service
		router.post('/execute-queued', this.handle(async (req, ctx) => (await gw.executeQueued(ctx, body(req))).queueId))
	}

	private schemaRoutes (router: express.Router, gw: DataGatewayPort): void {
		router.get('/schema', this.handle((_req, ctx) => gw.schema(ctx)))
		router.get('/schema/version', this.handle((_req, ctx) => gw.schemaVersion(ctx)))
		router.get('/domain', this.handle((_req, ctx) => gw.domain(ctx)))
		router.get('/sources', this.handle((_req, ctx) => gw.sources(ctx)))
		router.get('/sources/:source', this.handle((req, ctx) => gw.source(ctx, String(req.params.source))))
		router.get('/entities', this.handle((_req, ctx) => gw.entities(ctx)))
		router.get('/entities/:entity', this.handle((req, ctx) => gw.entity(ctx, String(req.params.entity))))
		// for a person or a model over a large schema: compact text (L42)
		router.get('/search', this.handle((req, ctx) => gw.search(ctx, this.queryText(req, 'q'))))
		router.get('/describe', this.handle((req, ctx) => gw.describe(ctx, this.queryText(req, 'entities').split(',').map(p => p.trim()).filter(Boolean))))
		router.get('/enums', this.handle((_req, ctx) => gw.enums(ctx)))
		router.get('/enums/:enum', this.handle((req, ctx) => gw.enum(ctx, String(req.params.enum))))
		router.get('/mappings', this.handle((_req, ctx) => gw.mappings(ctx)))
		router.get('/mappings/:mapping', this.handle((req, ctx) => gw.mapping(ctx, String(req.params.mapping))))
		router.get('/mappings/:mapping/:entity', this.handle((req, ctx) => gw.entityMapping(ctx, String(req.params.mapping), String(req.params.entity))))
		router.get('/stages', this.handle((_req, ctx) => gw.stages(ctx)))
		router.get('/stages/:stage', this.handle((req, ctx) => gw.stage(ctx, String(req.params.stage))))
		router.get('/views', this.handle((_req, ctx) => gw.views(ctx)))
	}

	private stageRoutes (router: express.Router, gw: DataGatewayPort): void {
		router.get('/stages/:stage/exists', this.handle((req, ctx) => gw.stageExists(ctx, String(req.params.stage))))
		router.get('/stages/:stage/export', this.handle((req, ctx) => gw.stageExport(ctx, String(req.params.stage))))
		router.post('/stages/:stage/import', this.handle((req, ctx) => gw.stageImport(ctx, String(req.params.stage), req.body)))
	}

	private swagger (app: express.Express): void {
		const file = path.join(__dirname, 'swagger.yaml')
		if (!fs.existsSync(file)) {
			this.deps.logger.warn(`swagger.yaml not found next to the http transport (${file}): /doc not served`)
			return
		}
		const document = YAML.load(fs.readFileSync(file, 'utf8'))
		// the version of this gateway, not the one written in the file
		document.info = { ...document.info, version: this.deps.directory.version().version }
		document.servers = this.servers()
		this.swaggerDocument = document
		// Authorize offers how the credential of these schemas is sent (an API key in its header, a token, basic)
		const schemes = this.served.map(schema => schema.authenticator(this.name).scheme?.()).filter((s): s is CredentialScheme => s !== undefined)
		const secured = withSecurity(document, schemes)
		document.components = secured.components
		document.security = secured.security
		const base = this.options.basePath
		// serveFiles: the document of this transport (serve keeps one for the whole process: the last one set up)
		// the document itself (an IDE shows it with the credential of its connection)
		app.get(`${base}/openapi.json`, (_req, res) => { res.json(document) })
		app.use(`${base}/api-docs`, swaggerUi.serveFiles(document), swaggerUi.setup(document))
		app.use(`${base}/doc`, swaggerUi.serveFiles(document), swaggerUi.setup(document))
		app.get(base || '/', (_req, res) => res.redirect(`${base}/doc/`))
	}
}
