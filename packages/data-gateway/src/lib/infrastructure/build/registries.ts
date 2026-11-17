import { AuthenticatorPort, LoggerPort, MetricsPort } from '../../application/ports/output/supportPorts'
import { SchemaDirectoryPort } from '../../application/ports/input/schemaDirectoryPort'
import { AuthenticationConfig, DataGatewayConfig, TransportName } from '../../domain/config/dataGatewayConfig'
import { parseSize } from '../../domain/config/sizes'
import { ApiKeyAuthenticator, BasicAuthenticator, BearerAuthenticator, NoneAuthenticator } from '../output/auth/authenticators'
import { HttpTransport } from '../input/http/httpTransport'
import { McpHttpTransport } from '../input/mcp/mcpHttpTransport'
import { McpWebSocketTransport } from '../input/mcp/mcpWebSocketTransport'
import { Transport } from '../input/transport'

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
}

type TransportFactory = (deps: TransportDeps) => Transport

/** Transports by their key in `transports:`. */
export class TransportRegistry {
	private readonly factories = new Map<string, TransportFactory>()

	constructor () {
		this.register('http', ({ config, directory, metrics, logger }) => {
			const http = config.transports.http!
			return new HttpTransport({
				port: http.port,
				host: http.host,
				basePath: http.basePath,
				requestBodySize: config.server.requestBodySize,
				rateLimit: config.rateLimit,
				swaggerEnabled: http.swagger.enabled
			}, { directory, metrics, logger })
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
