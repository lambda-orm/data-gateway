import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import { rateLimit } from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import swaggerUi from 'swagger-ui-express'
import { h3lp } from 'h3lp'
import { GeneralService, SchemaService, QueryService, StageService, Queue, Logger } from '../application'
import { GeneralRoutes, SchemaRoutes, QueryRoutes, StageRoutes } from './routes'
import path from 'path'
import http from 'http'
import { IOrm, Orm } from '@lambdaorm/lib'
import { ServiceSchema, ServiceConfig } from '../domain'
import { beautifyJsonMiddleware } from './middleware/beautifyJsonMiddleware'
import { LoggerBuilder } from './logger/loggerBuilder'
import { QueueBuilder } from './queued/queueBuilder'
import { MetricBuilder } from './metric/metricBuilder'
import { serviceToken } from './middleware/serviceTokenMiddleware'
const YAML = require('js-yaml')

/**
 * The service's settings without the values whose environment variable was not defined: λORM leaves "$VAR" as it is,
 * and e.g. requestBodySize "$REQUEST_BODY_SIZE" made the service fail to start. Those fall back to the defaults.
 */
export const withoutUnresolved = <T extends object>(config: T): T => Object.fromEntries(Object.entries(config || {})
	.filter(([, value]) => !(typeof value === 'string' && /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value.trim())))) as T

export class Server {
	private app: express.Express | undefined
	private server: http.Server | undefined
	private orm: IOrm | undefined
	private queue: Queue | undefined
	private schema:ServiceSchema | undefined
	public config: ServiceConfig | undefined
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly logger:Logger = new LoggerBuilder().build()) {}

	public async start () {
		this.app = express()
		try {
			this.orm = new Orm()
			this.schema = await this.orm.init(process.env.WORKSPACE || '/workspace') as ServiceSchema
			this.config = withoutUnresolved(this.schema.infrastructure.service || {})
			if (h3lp.val.isNotNull(this.schema.infrastructure.queue)) {
				this.queue = new QueueBuilder().build(this.orm, this.logger)
				this.queue.start(this.schema.infrastructure.queue)
			}
			const port = this.config?.port || process.env.PORT || 80
			const host = this.config?.host || process.env.HOST || 'http://localhost'
			const requestBodySize = this.config.requestBodySize || process.env.REQUEST_BODY_SIZE
			const rateLimitWindowMs = parseInt(this.config.rateLimitWindowMs || process.env.RATE_LIMIT_WINDOWS_MS || '30000')
			// RATE_LIMIT_MAX=0: no rate limit (an internal service behind its own gateway) — L9
			const rateLimitMax = parseInt(String(this.config.rateLimitMax ?? process.env.RATE_LIMIT_MAX ?? '30'))
			const swagger = YAML.load(await h3lp.fs.read(path.join(__dirname, './swagger.yaml')))
			const swaggerSetup = swaggerUi.setup(swagger)
			swagger.servers = [{ description: 'default', url: `${host}:${port}` }]
			swagger.info.version = await this.getVersion()
			this.app.use(bodyParser.json({ limit: requestBodySize || '14MB' }))
			this.app.use(bodyParser.json())
			this.app.use(bodyParser.urlencoded({ extended: true }))
			this.app.use(cors())
			if (rateLimitMax > 0) {
				this.app.use(this.rateLimit(rateLimitWindowMs || 3000, rateLimitMax))
			}
			// SERVICE_TOKEN: every request but the health ones needs "Authorization: Bearer <token>" — L12
			const token = this.config.token ?? process.env.SERVICE_TOKEN
			if (token) {
				this.app.use(serviceToken(String(token), ['/ping', '/health', '/metrics']))
			}
			this.logger.info(`rate limit: ${rateLimitMax > 0 ? `${rateLimitMax} per ${rateLimitWindowMs} ms` : 'off'}; service token: ${token ? 'required' : 'not required'}`)
			this.app.use(express.json())
			this.app.use(express.urlencoded({ extended: false }))
			this.app.use(beautifyJsonMiddleware)
			this.app.use(cookieParser())
			const metric = new MetricBuilder().build()
			this.app.use('', new GeneralRoutes(new GeneralService(await this.getVersion(), this.orm), metric).getRoutes())
			const scripts = {
				enabled: String(this.config.scriptEnabled ?? process.env.SCRIPT_ENABLED ?? 'false').toLowerCase() === 'true',
				maxLength: parseInt(String(this.config.scriptMaxLength ?? process.env.SCRIPT_MAX_LENGTH ?? '20000')),
				timeoutMs: parseInt(String(this.config.scriptTimeoutMs ?? process.env.SCRIPT_TIMEOUT_MS ?? '30000'))
			}
			this.logger.info(`scripts (POST /script): ${scripts.enabled ? `enabled, max ${scripts.maxLength} chars, timeout ${scripts.timeoutMs} ms` : 'disabled'}`)
			this.app.use('', new QueryRoutes(new QueryService(this.orm, scripts), this.queue).getRoutes())
			this.app.use('', new SchemaRoutes(new SchemaService(this.orm)).getRoutes())
			this.app.use('', new StageRoutes(new StageService(this.orm)).getRoutes())
			this.app.use('/api-docs', swaggerUi.serve, swaggerSetup)
			this.app.use('/doc', swaggerUi.serve, swaggerSetup)
			this.app.use('/', swaggerUi.serve, swaggerSetup)
			this.server = http.createServer(this.app).listen(port, async () => {
				this.logger.info(`Server running at: ${host}:${port}`)
			})
		} catch (error: any) {
			this.logger.error(error.message)
		}
	}

	private async getVersion (): Promise<string> {
		if (await h3lp.fs.exists(path.join(__dirname, '../package.json'))) {
			return require('../package.json').version
		} else if (await h3lp.fs.exists(path.join(__dirname, '../../package.json'))) {
			return require('../../package.json').version
		} else {
			return '0.0.0'
		}
	}

	private rateLimit (rateLimitWindowMs:number, rateLimitMax:number) {
		return rateLimit({
			windowMs: rateLimitWindowMs,
			max: rateLimitMax, // Limit each IP to 30 requests per `window` (here, per 30 seconds)
			standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
			legacyHeaders: false // Disable the `X-RateLimit-*` headers
		})
	}

	public async stop () {
		try {
			if (this.server !== undefined) {
				this.server.close()
				this.logger.info(`Server on port ${this.config?.port} shut down`)
			}
			if (this.queue !== undefined) {
				await this.queue.stop()
			}
			if (this.orm !== undefined) {
				await this.orm.end()
			}
		} catch (error: any) {
			this.logger.error(error.message)
		}
	}
}
