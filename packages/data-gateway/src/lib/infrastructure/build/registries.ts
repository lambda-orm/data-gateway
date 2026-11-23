import { AdminService } from '../../application/admin/adminService'
import { CommandService } from '../../application/admin/commandService'
import { AuthenticatorPort, LoggerPort, MetricsPort } from '../../application/ports/output/supportPorts'
import { SchemaDirectoryPort } from '../../application/ports/input/schemaDirectoryPort'
import { AuthenticationConfig, DataGatewayConfig, TransportName } from '../../domain/config/dataGatewayConfig'
import { parseSize } from '../../domain/config/sizes'
import { ApiKeyAuthenticator, BasicAuthenticator, BearerAuthenticator, NoneAuthenticator } from '../output/auth/authenticators'
import { HttpTransport } from '../input/http/httpTransport'
import { McpHttpTransport } from '../input/mcp/mcpHttpTransport'
import { McpWebSocketTransport } from '../input/mcp/mcpWebSocketTransport'
import { WebSocketTransport } from '../input/websocket/webSocketTransport'
import { Transport } from '../input/transport'
import { TransportInfo } from '../input/http/httpTransport'
import { TransportsConfig } from '../../domain/config/dataGatewayConfig'

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
	}

	public register (key: string, factory: AuthenticatorFactory): void {
		this.factories.set(key, factory)
	}

	public build (config: AuthenticationConfig): AuthenticatorPort {
		const key = config.adapter === 'none' ? 'none' : `${config.adapter}:${config.type}`
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
		this.register('management', ({ config, directory, metrics, logger, admin }) => {
			const management = config.transports.management!
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
				admin: admin ? { ...admin, authenticator: new AuthenticatorRegistry().build(management.authentication ?? config.authentication) } : undefined
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
