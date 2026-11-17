import { Permission } from '../auth/permission'

/** A credential of a `local` authenticator. The secret is `value` (bearer token, API key) or `password` (basic). */
export interface CredentialConfig {
	name: string
	value?: string
	username?: string
	password?: string
	permissions: Permission[]
}

export type AuthenticationType = 'bearer' | 'apikey' | 'basic'

export interface AuthenticationConfig {
	adapter: 'none' | 'local'
	type?: AuthenticationType
	/** Header of an API key (lower case); default x-api-key */
	header?: string
	credentials: CredentialConfig[]
}

export interface SchemaConfig {
	/** Route of the schema ('' = served at the root) */
	path: string
	/** Folder with lambdaORM.yaml (or the file itself) */
	workspace?: string
}

export interface OrmConfig {
	workspacePath?: string
	schemas: SchemaConfig[]
}

export interface ServerConfig {
	timeout: number
	requestBodySize: string
}

export interface ScriptsConfig {
	enabled: boolean
	maxLength: number
	timeoutMs: number
	maxIterations: number
}

export interface RateLimitConfig {
	windowMs: number
	/** 0 = no rate limit */
	max: number
}

export interface LoggerConfig {
	adapter: 'console' | 'winston'
	level: 'error' | 'warn' | 'info' | 'debug'
}

export interface MetricsConfig {
	enabled: boolean
}

export interface AuditConfig {
	enabled: boolean
	includeData: boolean
}

export interface TransportConfig {
	port: number
	host: string
	basePath: string
	/** Replaces the global authentication for this transport */
	authentication?: AuthenticationConfig
}

export interface HttpTransportConfig extends TransportConfig {
	swagger: { enabled: boolean }
}

export interface McpHttpTransportConfig extends TransportConfig {
	/** HTTP+SSE (deprecated by the specification) besides Streamable HTTP */
	legacySse: boolean
	/** Streamable HTTP with sessions; false = every POST stands alone (any replica answers it) */
	stateful: boolean
	/** Open SSE streams / stateful sessions */
	maxConnections: number
}

export interface McpWebSocketTransportConfig extends TransportConfig {
	maxConnections: number
	asyncapi: { enabled: boolean }
}

export interface TransportsConfig {
	http?: HttpTransportConfig
	mcpHttp?: McpHttpTransportConfig
	mcpWebSocket?: McpWebSocketTransportConfig
}

export interface McpConfig {
	/** Name the MCP server gives in initialize */
	name: string
	tools: { include: string[], exclude: string[] }
	/** Page size of tools/list and resources/list */
	pageSize: number
	/** Rows of orm_execute / orm_execute_script; 0 = no limit */
	maxRows: number
}

export type TransportName = keyof TransportsConfig

export interface DataGatewayConfig {
	orm: OrmConfig
	server: ServerConfig
	logger: LoggerConfig
	metrics: MetricsConfig
	audit: AuditConfig
	authentication: AuthenticationConfig
	rateLimit: RateLimitConfig
	scripts: ScriptsConfig
	mcp: McpConfig
	/** Only the transports with a port (docs/DATA_GATEWAY.md §2.1) */
	transports: TransportsConfig
}

/** The result of reading a configuration: the config, or the problems that stop the process, plus warnings. */
export interface ConfigReading {
	config?: DataGatewayConfig
	issues: string[]
	warnings: string[]
	/** Informative notes (transports not exposed, …) */
	notes: string[]
}
