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

export type RuntimeMode = 'thread' | 'process'

/** What a schema may override (docs/DATA_GATEWAY.md §2.2): schema → transport → global, the most specific replaces */
export interface SchemaOverrides {
	/** Transports that expose it (default: all exposed) */
	transports?: TransportName[]
	authentication?: AuthenticationConfig
	/** Variables its worker receives on top of its .env and the base variables */
	env?: Record<string, string>
	scripts?: Partial<ScriptsConfig>
	mcp?: { maxRows?: number, tools?: { include: string[], exclude: string[] } }
	server?: { timeout?: number, maxConcurrent?: number, maxResponseBytes?: number }
	runtime?: { mode?: RuntimeMode, maxMemoryMb?: number, checkConnections?: boolean }
}

export interface SchemaConfig extends SchemaOverrides {
	/** Route of the schema ('' = served at the root) */
	path: string
	/** Folder with lambdaORM.yaml (or the file itself); without it the entry adjusts a discovered schema */
	workspace?: string
}

export interface RuntimeConfig {
	/** shared: every transport in one edge worker */
	transports: 'shared'
	schemas: RuntimeMode
	maxMemoryMb: number
	/** Open a connection of each source when a schema starts: a database down leaves it in error (and retried) */
	checkConnections: boolean
	/** UV_THREADPOOL_SIZE; undefined = auto */
	threadpoolSize?: number
	heartbeat: { intervalMs: number, timeoutMs: number }
	restart: { initialDelayMs: number, maxDelayMs: number }
	env: { isolate: boolean, passthrough: string[] }
}

export interface OrmConfig {
	workspacePath?: string
	schemas: SchemaConfig[]
}

export interface ServerConfig {
	timeout: number
	requestBodySize: string
	/** Operations in flight per schema; over it 429. 0 = no limit */
	maxConcurrent: number
	/** Bytes of a serialized result; over it 413. 0 = no limit */
	maxResponseBytes: number
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
	runtime: RuntimeConfig
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
