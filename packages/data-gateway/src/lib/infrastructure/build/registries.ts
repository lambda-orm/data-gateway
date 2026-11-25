import { AdminService } from '../../application/admin/adminService'
import { CommandService } from '../../application/admin/commandService'
import { AuthenticatorPort, LoggerPort, MetricsPort } from '../../application/ports/output/supportPorts'
import { SchemaDirectoryPort } from '../../application/ports/input/schemaDirectoryPort'
import { AuthenticationConfig, DataGatewayConfig, TransportName } from '../../domain/config/dataGatewayConfig'
import { parseSize } from '../../domain/config/sizes'
import { ApiKeyAuthenticator, BasicAuthenticator, BearerAuthenticator, MethodsAuthenticator, NoneAuthenticator } from '../output/auth/authenticators'
import { JwtAuthenticator } from '../output/auth/jwtAuthenticator'
import { HttpTransport } from '../input/http/httpTransport'
import { McpHttpTransport } from '../input/mcp/mcpHttpTransport'
import { McpWebSocketTransport } from '../input/mcp/mcpWebSocketTransport'
import { WebSocketTransport } from '../input/websocket/webSocketTransport'
import { Transport } from '../input/transport'
import { TransportInfo } from '../input/http/httpTransport'
import { TransportsConfig } from '../../domain/config/dataGatewayConfig'
import { AuditPort, ClockPort } from '../../application/ports/output/supportPorts'
import { SessionService } from '../../application/session/sessionService'
import { MemorySessionStore, NodeSessionSecrets, SqliteSessionStore } from '../output/session/sessionStores'
import { ClientAddress } from '../input/http/clientAddress'
import { SystemClock } from '../output/clock/systemClock'
import { StdoutAuditAdapter } from '../output/audit/stdoutAuditAdapter'
import path from 'path'

/** The transports of the configuration as GET /transports tells them */
export const transportsOf = (t: TransportsConfig): TransportInfo[] => [
	...(t.http ? [{ name: 'http' as const, port: t.http.port, basePath: t.http.basePath, ...(t.http.swagger.enabled ? { docs: '/openapi.json' } : {}) }] : []),
	...(t.webSocket ? [{ name: 'webSocket' as const, port: t.webSocket.port, basePath: t.webSocket.basePath, schemaPath: '/{schema}', ...(t.webSocket.asyncapi.enabled ? { docs: '/asyncapi.json' } : {}) }] : []),
	...(t.mcpHttp ? [{ name: 'mcpHttp' as const, port: t.mcpHttp.port, basePath: t.mcpHttp.basePath, schemaPath: '/{schema}/mcp' }] : []),
	...(t.mcpWebSocket ? [{ name: 'mcpWebSocket' as const, port: t.mcpWebSocket.port, basePath: t.mcpWebSocket.basePath, schemaPath: '/{schema}', ...(t.mcpWebSocket.asyncapi.enabled ? { docs: '/asyncapi.json' } : {}) }] : [])
]

type AuthenticatorFactory = (config: AuthenticationConfig) => AuthenticatorPort

/** Authenticators by `adapter` (and `type` for local): a new one is a class plus one line here, not a switch. */
export class AuthenticatorRegistry {
	private readonly factories = new Map<string, AuthenticatorFactory>()

	constructor () {
		this.register('none', () => new NoneAuthenticator())
		this.register('local:bearer', c => new BearerAuthenticator(c.credentials))
		this.register('local:apikey', c => new ApiKeyAuthenticator(c.credentials, c.header))
		this.register('local:basic', c => new BasicAuthenticator(c.credentials))
		this.register('jwt', c => new JwtAuthenticator(c.jwt!))
		this.register('methods', c => new MethodsAuthenticator((c.methods ?? []).map(m => this.build(m))))
	}

	public register (key: string, factory: AuthenticatorFactory): void {
		this.factories.set(key, factory)
	}

	public build (config: AuthenticationConfig): AuthenticatorPort {
		const key = config.adapter === 'local' ? `local:${config.type}` : config.adapter
		const factory = this.factories.get(key)
		if (!factory) throw new Error(`no authenticator registered for ${key}`)
		return factory(config)
	}
}

export interface TransportDeps {
	config: DataGatewayConfig
	/** The schemas the transports serve: real facades (inline) or channels to the schema workers (edge) */
	directory: SchemaDirectoryPort
	metrics: MetricsPort
	logger: LoggerPort
	/** transports.management: the administration of the workspaces (REST, on the management transport) */
	admin?: { service: AdminService, commands: CommandService }
	clock?: ClockPort
	/** the audit of the logins and revocations of management; else stdout, when audit.enabled */
	audit?: AuditPort
}

/** The sessions of management: in the SQLite of the volume (shared by the replicas) or, without one, in memory */
export const buildSessions = ({ config, logger, metrics, clock, audit }: TransportDeps): SessionService => {
	const management = config.transports.management!
	const { sessions } = management
	const file = config.orm.workspacePath && sessions.store === 'auto'
		? path.join(path.resolve(config.orm.workspacePath), '.data-gateway', 'state.sqlite')
		: undefined
	if (!file) logger.warn('[data-gateway] management: the sessions are kept in memory (no orm.workspacePath, or sessions.store: memory): another replica doesn\'t see them, and a restart forgets them')
	const service = new SessionService(
		{ idleTimeoutMs: sessions.idleTimeoutMs, maxLifetimeMs: sessions.maxLifetimeMs, maxPerCredential: sessions.maxPerCredential },
		file ? new SqliteSessionStore(file) : new MemorySessionStore(),
		new NodeSessionSecrets(),
		clock ?? new SystemClock(),
		logger,
		audit ?? (config.audit.enabled ? new StdoutAuditAdapter() : undefined))
	metrics.gauge('data_gateway_management_sessions', 'Sessions of management that can be used now, and those with the IDE connected', ['state'], () => {
		const { active, connected } = service.count()
		return [{ labels: { state: 'active' }, value: active }, { labels: { state: 'connected' }, value: connected }]
	})
	return service
}

type TransportFactory = (deps: TransportDeps) => Transport

/** Transports by their key in `transports:`. */
export class TransportRegistry {
	private readonly factories = new Map<string, TransportFactory>()

	constructor () {
		this.register('http', ({ config, directory, metrics, logger }) => {
			const http = config.transports.http!
			return new HttpTransport({
				name: 'http',
				port: http.port,
				host: http.host,
				basePath: http.basePath,
				requestBodySize: config.server.requestBodySize,
				rateLimit: config.rateLimit,
				swaggerEnabled: http.swagger.enabled,
				transports: transportsOf(config.transports)
			}, { directory, metrics, logger })
		})
		// the API of the data-gateway-ide: the routes of http for every schema and the administration (no rate limit, no
		// Swagger: a person in an IDE, not clients)
		this.register('management', (deps) => {
			const { config, directory, metrics, logger, admin } = deps
			const management = config.transports.management!
			const authenticator = new AuthenticatorRegistry().build(management.authentication ?? config.authentication)
			return new HttpTransport({
				name: 'management',
				port: management.port,
				host: management.host,
				basePath: management.basePath,
				requestBodySize: config.server.requestBodySize,
				rateLimit: { windowMs: config.rateLimit.windowMs, max: 0 },
				swaggerEnabled: false,
				transports: transportsOf(config.transports)
			}, {
				directory,
				metrics,
				logger,
				admin: admin ? { ...admin, authenticator } : undefined,
				sessions: { service: buildSessions(deps), authenticator, address: new ClientAddress(management.trustedProxies) }
			})
		})
		this.register('mcpHttp', ({ config, directory, metrics, logger }) => {
			const t = config.transports.mcpHttp!
			return new McpHttpTransport({
				port: t.port,
				host: t.host,
				basePath: t.basePath,
				requestBodySize: config.server.requestBodySize,
				rateLimit: config.rateLimit,
				legacySse: t.legacySse,
				stateful: t.stateful,
				maxConnections: t.maxConnections
			}, { directory, metrics, logger })
		})
		this.register('webSocket', ({ config, directory, logger }) => {
			const t = config.transports.webSocket!
			return new WebSocketTransport({
				port: t.port,
				host: t.host,
				basePath: t.basePath,
				maxConnections: t.maxConnections,
				maxPayload: parseSize(config.server.requestBodySize) ?? 14 * 1024 * 1024,
				asyncapiEnabled: t.asyncapi.enabled
			}, { directory, logger, rootAuthenticator: new AuthenticatorRegistry().build(t.authentication ?? config.authentication) })
		})
		this.register('mcpWebSocket', ({ config, directory, logger }) => {
			const t = config.transports.mcpWebSocket!
			return new McpWebSocketTransport({
				port: t.port,
				host: t.host,
				basePath: t.basePath,
				maxConnections: t.maxConnections,
				maxPayload: parseSize(config.server.requestBodySize) ?? 14 * 1024 * 1024,
				asyncapiEnabled: t.asyncapi.enabled
			}, { directory, logger })
		})
	}

	public register (name: TransportName | string, factory: TransportFactory): void {
		this.factories.set(name, factory)
	}

	/** One transport per configured (exposed) transport */
	public build (deps: TransportDeps): Transport[] {
		return Object.keys(deps.config.transports).map(name => {
			const factory = this.factories.get(name)
			if (!factory) throw new Error(`no transport registered for ${name}`)
			return factory(deps)
		})
	}
}
