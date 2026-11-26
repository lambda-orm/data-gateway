import { ObservabilityConfig } from '@lambdaorm/base'
import { Permission } from '../auth/permission'

/** A credential of a `local` authenticator. The secret is `value` (bearer token, API key) or `password` (basic). */
export interface CredentialConfig {
	name: string
	value?: string
	username?: string
	password?: string
	permissions: Permission[]
	/** the view of λORM of its requests (docs/VIEWS_BY_IDENTITY.md); none, the one of the schema */
	view?: string
	/** its writes wait for a person to approve them, on every transport (docs/MUTATION_APPROVAL.md) */
	approval?: 'writes'
}

/** A role of the tokens of an issuer: its permissions, the view of λORM of who has it, and whether its writes wait */
export interface RoleConfig {
	permissions: Permission[]
	view?: string
	approval?: 'writes'
}

export type AuthenticationType = 'bearer' | 'apikey' | 'basic'

/** adapter: jwt — the tokens of an identity provider (docs/JWT.md) */
export interface JwtConfig {
	/** iss of the tokens; with it the jwksUri is discovered (OIDC) when not given */
	issuer: string
	/** aud: the token must have one of them; none, not checked */
	audience: string[]
	jwksUri?: string
	/** a shared secret (HS256): for development and tests, from a variable */
	secret?: string
	algorithms: string[]
	clockToleranceSec: number
	principal: {
		/** the claim of the name (a path with dots); default sub */
		name: string
		permissions?: {
			/** the claim of the roles: a list, or a text separated by spaces (as scope) */
			claim: string
			/** role → its permissions and its view */
			roles: Record<string, RoleConfig>
		}
	}
	/** variable of the context of λORM → the claim it takes (a path with dots) */
	context: Record<string, string>
}

export interface AuthenticationConfig {
	/** methods: several, in order; the first that recognizes the credential decides */
	adapter: 'none' | 'local' | 'jwt' | 'methods'
	type?: AuthenticationType
	/** Header of an API key (lower case); default x-api-key */
	header?: string
	credentials: CredentialConfig[]
	jwt?: JwtConfig
	methods?: AuthenticationConfig[]
}

export type RuntimeMode = 'thread' | 'process'

/** What a schema may override (docs/DATA_GATEWAY.md §2.2): schema → transport → global, the most specific replaces */
export interface SchemaOverrides {
	/** Transports that expose it (default: all exposed) */
	transports?: TransportName[]
	authentication?: AuthenticationConfig
	/** the view of λORM of a caller without one (docs/VIEWS_BY_IDENTITY.md); none, default (the domain) */
	view?: string
	/** Variables its worker receives on top of its .env and the base variables */
	env?: Record<string, string>
	scripts?: Partial<ScriptsConfig>
	mcp?: { maxRows?: number, tools?: { include: string[], exclude: string[] }, freeQueries?: boolean, approval?: ApprovalMode, approvalExpiresMs?: number }
	/** its outbox dispatcher: replaces the global one */
	outbox?: OutboxConfig
	/** its cache: replaces the global one */
	cache?: CacheConfig
	/** the limits of its named queries, by name */
	queries?: Record<string, NamedQueryLimitsConfig>
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

/**
 * orm.watch: the workspaces are watched while the gateway runs: a folder with a lambdaORM.yaml that appears is a new
 * schema, one that goes is removed, a lambdaORM.yaml or .env that changes reloads its schema (docs/DATA_GATEWAY_ADMIN_PLAN.md
 * §2.1). The file events are the fast path; a scan every intervalMs catches what they miss (some mounted volumes).
 */
export interface WatchConfig {
	enabled: boolean
	/** the scan of the workspaces, in ms (0: only the file events) */
	intervalMs: number
	/** how long the changes are gathered before they are applied (an editor writes a file in several steps) */
	debounceMs: number
}

export interface OrmConfig {
	workspacePath?: string
	schemas: SchemaConfig[]
	watch: WatchConfig
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

export interface WebSocketTransportConfig extends TransportConfig {
	maxConnections: number
	asyncapi: { enabled: boolean }
}

export interface TransportsConfig {
	http?: HttpTransportConfig
	mcpHttp?: McpHttpTransportConfig
	mcpWebSocket?: McpWebSocketTransportConfig
	webSocket?: WebSocketTransportConfig
	/**
	 * The API of the data-gateway-ide (the routes of http for every schema, plus the administration at /admin), on its
	 * own port so a deployment can leave it out (docs/DATA_GATEWAY.md §12)
	 */
	management?: ManagementTransportConfig
}

/** The sessions of management (docs/DATA_GATEWAY_SESSIONS_PLAN.md §5) */
export interface SessionsConfig {
	idleTimeoutMs: number
	maxLifetimeMs: number
	/** 0 = no limit */
	maxPerCredential: number
	/** auto: the SQLite of <orm.workspacePath>/.data-gateway (memory without it); memory: this replica only */
	store: 'auto' | 'memory'
}

export interface ManagementTransportConfig extends TransportConfig {
	sessions: SessionsConfig
	/** addresses or CIDR networks whose X-Forwarded-For is read (the backend of the IDE) */
	trustedProxies: string[]
}

/** none: writes run at once; writes: they wait for a person to approve them (docs/MUTATION_APPROVAL.md) */
export type ApprovalMode = 'none' | 'writes'

export interface McpConfig {
	/** Name the MCP server gives in initialize */
	name: string
	tools: { include: string[], exclude: string[] }
	/** Page size of tools/list and resources/list */
	pageSize: number
	/** Rows of orm_execute / orm_execute_script; 0 = no limit */
	maxRows: number
	/**
	 * false: an agent has only the queries of application.queries (query_<name>) and the tools of the schema, without
	 * orm_execute, orm_execute_script, orm_execute_queued nor orm_plan (docs/NAMED_QUERIES.md §3)
	 */
	freeQueries: boolean
	/** writes: every write by MCP waits for a person to approve it (docs/MUTATION_APPROVAL.md) */
	approval: ApprovalMode
	/** how long a write waits before it expires */
	approvalExpiresMs: number
}

/** The cache of the results of the reads (docs/RESULT_CACHE.md) */
export interface CacheConfig {
	enabled: boolean
	ttlMs: number
	maxEntries: number
	/** a result larger than this (its JSON) is not kept */
	maxBytes: number
	entities: Record<string, { enabled?: boolean, ttlMs?: number }>
}

/** Where the events of the outbox go (docs/OUTBOX_DISPATCHER.md §2); entities: only theirs */
export type OutboxDestinationConfig =
	| { type: 'webhook', url: string, secret?: string, timeoutMs: number, entities?: string[] }
	| { type: 'kafka', topic: string, entities?: string[] }

/** The dispatcher of the outbox of a schema (docs/OUTBOX_DISPATCHER.md) */
export interface OutboxConfig {
	/** this replica dispatches (one per outbox: λORM doesn't lock its rows); DATA_GATEWAY_OUTBOX_DISPATCH=false turns it off */
	dispatch: boolean
	intervalMs: number
	batch: number
	destinations: OutboxDestinationConfig[]
}

/** A Valkey (or Redis) shared by the replicas (docs/REPLICAS.md): the changes of the data and the lock of the outbox */
export interface ValkeyConfig {
	/** valkey://, valkeys:// (TLS), redis:// or rediss:// */
	url: string
	/** what its channels and keys start with: to share a Valkey with other things */
	prefix: string
}

/** The replicas of a gateway together (docs/REPLICAS.md) */
export interface ClusterConfig {
	valkey?: ValkeyConfig
}

/** The limits of a query of application.queries (docs/NAMED_QUERIES.md §4) */
export interface NamedQueryLimitsConfig {
	maxRows?: number
	timeoutMs?: number
}

export type TransportName = keyof TransportsConfig

/**
 * admin: the administration of the workspaces from the gateway (docs/DATA_GATEWAY_ADMIN_PLAN.md): create, edit and
 * remove schemas, what is saved in them. Off by default; on, it is still only for credentials with its permissions.
 */
export interface AdminConfig {
	/** transports.management is exposed (since 4.0.0 there is no admin.enabled: the transport decides) */
	enabled: boolean
	/** with authentication none, anyone may administer (local development only) */
	allowAnonymous: boolean
	/** the largest file that can be written (a lambdaORM.yaml, a saved query) */
	maxFileBytes: number
	/** how long a command may take (push, export of a whole stage) */
	commandTimeoutMs: number
}

export interface DataGatewayConfig {
	orm: OrmConfig
	admin: AdminConfig
	server: ServerConfig
	logger: LoggerConfig
	metrics: MetricsConfig
	/**
	 * The OpenTelemetry of the gateway (docs/OBSERVABILITY.md): the same shape as infrastructure.observability of a
	 * lambdaORM.yaml; the OTEL_* variables override it. Its SDK is the one of λORM too.
	 */
	observability?: ObservabilityConfig
	audit: AuditConfig
	authentication: AuthenticationConfig
	rateLimit: RateLimitConfig
	scripts: ScriptsConfig
	mcp: McpConfig
	cache: CacheConfig
	outbox: OutboxConfig
	/** the replicas together, by a Valkey (docs/REPLICAS.md) */
	cluster: ClusterConfig
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
