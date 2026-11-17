import express from 'express'
import cors from 'cors'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { AddressInfo } from 'net'
import { rateLimit } from 'express-rate-limit'
import swaggerUi from 'swagger-ui-express'
import { DataGatewayPort, RequestContext } from '../../../application/ports/input/dataGatewayPort'
import { SchemaDirectoryPort, ServedSchema } from '../../../application/ports/input/schemaDirectoryPort'
import { AuthenticatorPort, LoggerPort, MetricsPort } from '../../../application/ports/output/supportPorts'
import { Principal } from '../../../domain/auth/principal'
import { Transport } from '../transport'
import { toHttpError } from './httpErrors'
const YAML = require('js-yaml')

export interface HttpTransportOptions {
	port: number
	host: string
	basePath: string
	requestBodySize: string
	rateLimit: { windowMs: number, max: number }
	swaggerEnabled: boolean
	/** Serve the query UI (packages/data-gateway/ui-app) at {basePath}/ui */
	uiEnabled?: boolean
	/** Folder of the built UI (default: ui next to this file) */
	uiDir?: string
}

export interface HttpTransportDeps {
	directory: SchemaDirectoryPort
	metrics: MetricsPort
	logger: LoggerPort
}

/** Paths that never need a credential: Kubernetes probes and Prometheus. */
const OPEN_PATHS = ['/ping', '/health', '/metrics']
export const TRANSPORT_NAME = 'http'

type Handler = (req: express.Request, ctx: RequestContext) => Promise<unknown>

/**
 * The REST API (the endpoints of the former service) on its own port, for every schema exposed on it: under
 * {basePath}/{schema} (or at {basePath} for the only schema at the root). {basePath}/schemas lists them; /health is
 * aggregated when there are several.
 */
export class HttpTransport implements Transport {
	public readonly name = TRANSPORT_NAME
	public readonly app: express.Express
	private server: http.Server | undefined

	constructor (private readonly options: HttpTransportOptions, private readonly deps: HttpTransportDeps) {
		this.app = this.createApp()
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
		const address = this.address
		const schemas = this.served.map(s => `/${s.path}`).join(', ')
		this.deps.logger.info(`[data-gateway] http listening on ${address?.host}:${address?.port}${this.options.basePath || '/'} (schemas ${schemas})`)
	}

	private get served (): ServedSchema[] {
		return this.deps.directory.schemas().filter(s => s.exposedOn(TRANSPORT_NAME))
	}

	private schemaBase (schema: ServedSchema): string {
		return `${this.options.basePath}${schema.path ? `/${schema.path}` : ''}`
	}

	public async stop (): Promise<void> {
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
		app.use(cors())
		app.use(express.json({ limit: this.options.requestBodySize }))
		app.use(express.urlencoded({ extended: true, limit: this.options.requestBodySize }))
		if (this.options.rateLimit.max > 0) {
			app.use(rateLimit({ windowMs: this.options.rateLimit.windowMs, max: this.options.rateLimit.max, standardHeaders: true, legacyHeaders: false }))
		}
		app.use(this.beautify)
		// the documentation is public (it holds no data): its "Authorize" button takes the credential
		if (this.options.swaggerEnabled) this.swagger(app)
		if (this.options.uiEnabled) this.ui(app)
		const base = this.options.basePath
		const directory = this.deps.directory
		const root = this.served.find(s => s.path === '')
		app.get(`${base}/metrics`, async (_req, res) => {
			const { contentType, body } = await this.deps.metrics.render()
			res.status(200).type(contentType).send(body)
		})
		app.get(`${base}/schemas`, this.handle(async () => directory.states()))
		if (!root) {
			// several schemas (or one under a route): the gateway's own general routes at the base
			app.get(`${base}/health`, this.handle(() => directory.health()))
			app.get(`${base}/ping`, this.handle(async () => ({ message: 'pong', time: new Date().toISOString() })))
			app.get(`${base}/version`, this.handle(async () => directory.version()))
		}
		for (const schema of this.served) {
			const router = express.Router()
			this.generalRoutes(router, schema.gateway)
			router.use(this.authenticate(schema.authenticator(TRANSPORT_NAME)))
			// who the credential is and what this schema offers: the UI enables its actions with it
			router.get('/whoami', this.handle(async (_req, ctx) => ({
				name: ctx.principal.name,
				permissions: [...ctx.principal.permissions],
				schema: schema.path,
				scripts: schema.features.scripts
			})))
			router.get('/typings', async (req, res) => {
				try {
					const ctx: RequestContext = { principal: res.locals.principal as Principal, transport: TRANSPORT_NAME }
					res.status(200).type('text/plain; charset=utf-8').send(await schema.gateway.typings(ctx))
				} catch (error: any) {
					const httpError = toHttpError(error)
					res.status(httpError.status).json(httpError.body)
				}
			})
			this.queryRoutes(router, schema.gateway)
			this.schemaRoutes(router, schema.gateway)
			this.stageRoutes(router, schema.gateway)
			app.use(this.schemaBase(schema) || '/', router)
		}
		app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
			if (res.headersSent) return next(err)
			// body too large / invalid JSON (body-parser), with its own status
			const status = Number.isInteger(err?.status) ? err.status : 500
			res.status(status).json({ error: err?.type ?? err?.name ?? 'Error', message: err?.message ?? String(err) })
		})
		return app
	}

	/** ?format=beautiful: indented JSON */
	private readonly beautify = (req: express.Request, res: express.Response, next: express.NextFunction) => {
		const format = req.query.format
		if (typeof format === 'string' && format.toLowerCase() === 'beautiful') {
			res.json = (body: unknown) => res.type('application/json').send(JSON.stringify(body, null, 2))
		}
		next()
	}

	private authenticate (authenticator: AuthenticatorPort) {
		return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
		if (OPEN_PATHS.includes(req.path)) return next()
		try {
			const result = await authenticator.authenticate(req.headers)
			if (!result.valid || !result.principal) {
				res.status(401).json({ error: 'Unauthorized', message: result.reason ?? 'a valid credential is required' })
				return
			}
			res.locals.principal = result.principal
			next()
		} catch (error) {
			next(error)
		}
		}
	}

	private handle (handler: Handler) {
		return async (req: express.Request, res: express.Response) => {
			try {
				const ctx: RequestContext = { principal: res.locals.principal as Principal, transport: TRANSPORT_NAME }
				const payload = await handler(req, ctx)
				if (payload === undefined) {
					res.status(204).end()
					return
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

	private queryRoutes (router: express.Router, gw: DataGatewayPort): void {
		const body = (req: express.Request): any => req.body ?? {}
		router.post('/constraints', this.handle((req, ctx) => gw.constraints(ctx, body(req))))
		router.post('/metadata', this.handle((req, ctx) => gw.metadata(ctx, body(req))))
		router.post('/model', this.handle((req, ctx) => gw.model(ctx, body(req))))
		router.post('/parameters', this.handle((req, ctx) => gw.parameters(ctx, body(req))))
		router.post('/plan', this.handle((req, ctx) => gw.plan(ctx, body(req))))
		router.post('/execute', this.handle((req, ctx) => gw.execute(ctx, body(req))))
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

	/**
	 * The query UI: static files with long cache for the hashed assets, and headers that keep it from loading anything
	 * from elsewhere or being framed (docs/DATA_GATEWAY.md §10.4). It calls the REST API of the same origin.
	 */
	private ui (app: express.Express): void {
		const dir = this.options.uiDir ?? path.join(__dirname, 'ui')
		if (!fs.existsSync(path.join(dir, 'index.html'))) {
			this.deps.logger.warn(`transports.http.ui.enabled but the UI is not built (${dir}): /ui not served`)
			return
		}
		const base = `${this.options.basePath}/ui`
		app.use(base, (_req, res, next) => {
			res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'")
			res.setHeader('X-Frame-Options', 'DENY')
			res.setHeader('Referrer-Policy', 'no-referrer')
			res.setHeader('X-Content-Type-Options', 'nosniff')
			next()
		}, express.static(dir, {
			index: 'index.html',
			setHeaders: (res, file) => {
				res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
			}
		}))
	}

	private swagger (app: express.Express): void {
		const file = path.join(__dirname, 'swagger.yaml')
		if (!fs.existsSync(file)) {
			this.deps.logger.warn(`swagger.yaml not found next to the http transport (${file}): /doc not served`)
			return
		}
		const document = YAML.load(fs.readFileSync(file, 'utf8'))
		document.servers = this.served.map(schema => ({ description: `schema ${schema.path || '/'}`, url: this.schemaBase(schema) || '/' }))
		const base = this.options.basePath
		app.use(`${base}/api-docs`, swaggerUi.serve, swaggerUi.setup(document))
		app.use(`${base}/doc`, swaggerUi.serve, swaggerUi.setup(document))
		app.get(base || '/', (_req, res) => res.redirect(`${base}/doc/`))
	}
}
