import { ObservabilityConfig } from '@lambdaorm/base'
import { ALL_PERMISSIONS, isPermission, KNOWN_PERMISSIONS, Permission } from '../auth/permission'
import {
	AuthenticationConfig, AuthenticationType, ConfigReading, CredentialConfig, DataGatewayConfig, JwtConfig, RoleConfig, CacheConfig, ClusterConfig, OutboxConfig, OutboxDestinationConfig, LoggerConfig, McpConfig,
	OrmConfig, RuntimeConfig, RuntimeMode, SchemaConfig, SessionsConfig, TransportConfig, TransportName, TransportsConfig, WatchConfig
} from './dataGatewayConfig'
import { parseDuration } from './durations'
import { normalizeSchemaPath, schemaPathIssues } from '../runtime/schemaPath'
import { parseSize } from './sizes'

/** Transports of the design that this version does not serve yet (docs/DATA_GATEWAY_PLAN.md). */
const LATER_TRANSPORTS: string[] = []
const TRANSPORTS = ['http', 'mcpHttp', 'mcpWebSocket', 'webSocket', 'management']
const KNOWN_SECTIONS = ['orm', 'admin', 'server', 'logger', 'metrics', 'observability', 'audit', 'authentication', 'rateLimit', 'scripts', 'mcp', 'runtime', 'transports', 'cache', 'outbox', 'cluster']
const SCHEMA_KEYS = ['path', 'workspace', 'transports', 'authentication', 'env', 'scripts', 'mcp', 'server', 'runtime', 'view', 'queries', 'cache', 'outbox']
/** The tools of docs/DATA_GATEWAY.md §5.1: mcp.tools.include / exclude must name them */
export const TOOL_NAMES = [
	'orm_execute', 'orm_execute_script', 'orm_execute_queued', 'approval_status', 'orm_plan', 'orm_metadata', 'orm_model', 'orm_parameters',
	'orm_constraints', 'schema_get', 'schema_version', 'schema_domain', 'schema_entities', 'schema_search', 'schema_describe', 'schema_enums', 'schema_sources',
	'schema_mappings', 'schema_views', 'schema_stages', 'stage_exists', 'stage_export', 'stage_import', 'gateway_version',
	'gateway_health', 'admin_schema_get', 'admin_schema_validate', 'admin_stage_fetch'
]

type Raw = Record<string, any>

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Turns the configuration file (already parsed, with its environment variables resolved: an undefined variable is
 * undefined) into a DataGatewayConfig with defaults, or the list of problems. Values that come from environment
 * variables are strings: numbers and booleans are accepted as strings too.
 */
export class ConfigReader {
	private issues: string[] = []
	private warnings: string[] = []
	private notes: string[] = []

	public read (raw: unknown): ConfigReading {
		this.issues = []
		this.warnings = []
		this.notes = []
		if (!isObject(raw)) {
			return { issues: ['the configuration must be a YAML object'], warnings: [], notes: [] }
		}
		for (const key of Object.keys(raw)) {
			if (!KNOWN_SECTIONS.includes(key)) this.warnings.push(`unknown section "${key}" ignored`)
		}
		const authentication = this.authentication(raw.authentication, 'authentication') ?? { adapter: 'none', credentials: [] }
		const config: DataGatewayConfig = {
			orm: this.orm(raw.orm),
			admin: {
				enabled: false,
				allowAnonymous: this.bool(raw.admin?.allowAnonymous, false, 'admin.allowAnonymous'),
				maxFileBytes: this.size(raw.admin?.maxFileBytes, 2 * 1024 ** 2, 'admin.maxFileBytes'),
				commandTimeoutMs: this.int(raw.admin?.commandTimeoutMs, 600000, 'admin.commandTimeoutMs', 1000)
			},
			server: {
				timeout: this.int(raw.server?.timeout, 120000, 'server.timeout', 1),
				requestBodySize: this.str(raw.server?.requestBodySize, '14MB'),
				maxConcurrent: this.int(raw.server?.maxConcurrent, 64, 'server.maxConcurrent', 0),
				maxResponseBytes: this.size(raw.server?.maxResponseBytes, 256 * 1024 ** 2, 'server.maxResponseBytes')
			},
			logger: this.logger(raw.logger),
			metrics: { enabled: this.bool(raw.metrics?.enabled, true, 'metrics.enabled') },
			observability: this.observability(raw.observability),
			audit: {
				enabled: this.bool(raw.audit?.enabled, true, 'audit.enabled'),
				includeData: this.bool(raw.audit?.includeData, false, 'audit.includeData')
			},
			authentication,
			rateLimit: {
				windowMs: this.int(raw.rateLimit?.windowMs, 30000, 'rateLimit.windowMs', 1),
				max: this.int(raw.rateLimit?.max, 30, 'rateLimit.max', 0)
			},
			scripts: {
				enabled: this.bool(raw.scripts?.enabled, false, 'scripts.enabled'),
				maxLength: this.int(raw.scripts?.maxLength, 20000, 'scripts.maxLength', 1),
				timeoutMs: this.int(raw.scripts?.timeoutMs, 30000, 'scripts.timeoutMs', 1),
				maxIterations: this.int(raw.scripts?.maxIterations, 100000, 'scripts.maxIterations', 1)
			},
			mcp: this.mcp(raw.mcp),
			cache: this.cache(raw.cache, 'cache'),
			outbox: this.outbox(raw.outbox, 'outbox'),
			cluster: this.cluster(raw.cluster),
			runtime: this.runtime(raw.runtime),
			transports: this.transports(raw.transports)
		}
		for (const schema of config.orm.schemas) {
			for (const transport of schema.transports ?? []) {
				if (!TRANSPORTS.includes(transport)) this.issues.push(`orm.schemas "${schema.path}": unknown transport "${transport}"`)
			}
		}
		// since 4.0.0 the administration is on when its transport is exposed
		config.admin.enabled = config.transports.management !== undefined
		if (raw.admin?.enabled !== undefined) {
			this.warnings.push('admin.enabled was removed in 4.0.0: ignored; the administration is on when transports.management has a port')
		}
		if (config.admin.enabled && !config.orm.workspacePath) this.notes.push('transports.management without orm.workspacePath: the workspaces can be edited, but none can be created')
		if (config.admin.enabled && config.authentication.adapter === 'none' && !config.admin.allowAnonymous) {
			this.warnings.push('transports.management with authentication none: nobody can administer (admin.allowAnonymous: true, only for local development)')
		}
		const reading: ConfigReading = { issues: this.issues, warnings: this.warnings, notes: this.notes }
		if (this.issues.length === 0) reading.config = config
		return reading
	}

	// ─── sections ────────────────────────────────────────────────────────────

	private orm (raw: unknown): OrmConfig {
		if (raw !== undefined && !isObject(raw)) {
			this.issues.push('orm must be an object')
			return { schemas: [], watch: { enabled: false, intervalMs: 0, debounceMs: 0 } }
		}
		const workspacePath = raw?.workspacePath !== undefined ? this.str(raw.workspacePath, '') || undefined : undefined
		const schemas: SchemaConfig[] = []
		if (raw?.schemas !== undefined) {
			if (!Array.isArray(raw.schemas)) {
				this.issues.push('orm.schemas must be a list')
			} else {
				raw.schemas.forEach((entry: unknown, i: number) => {
					const schema = this.schema(entry, `orm.schemas[${i}]`)
					if (schema) schemas.push(schema)
				})
			}
		}
		if (!workspacePath && !schemas.some(s => s.workspace !== undefined)) {
			this.issues.push('orm.workspacePath (or an orm.schemas entry with workspace) is required')
		}
		return { workspacePath, schemas, watch: this.watch(raw?.watch) }
	}

	/** orm.watch: true / false, or { enabled, intervalMs, debounceMs } */
	private watch (raw: unknown): WatchConfig {
		const object = isObject(raw) ? raw : { enabled: raw }
		return {
			enabled: this.bool(object.enabled, true, 'orm.watch.enabled'),
			intervalMs: this.int(object.intervalMs, 5000, 'orm.watch.intervalMs', 0),
			debounceMs: this.int(object.debounceMs, 300, 'orm.watch.debounceMs', 0)
		}
	}

	/** An entry of orm.schemas: with workspace it defines a schema, without it adjusts a discovered one */
	private schema (entry: unknown, at: string): SchemaConfig | undefined {
		if (!isObject(entry) || entry.path === undefined || entry.path === null) {
			this.issues.push(`${at}: path is required`)
			return undefined
		}
		const path = normalizeSchemaPath(String(entry.path))
		const key = `orm.schemas "${path || '/'}"`
		for (const name of Object.keys(entry)) {
			if (!SCHEMA_KEYS.includes(name)) this.warnings.push(`${key}: unknown key "${name}" ignored`)
		}
		this.issues.push(...schemaPathIssues(path))
		const schema: SchemaConfig = { path }
		if (entry.workspace !== undefined && entry.workspace !== null && entry.workspace !== '') schema.workspace = String(entry.workspace)
		if (entry.transports !== undefined) {
			if (!Array.isArray(entry.transports)) this.issues.push(`${key}.transports must be a list`)
			else schema.transports = entry.transports.map(String) as TransportName[]
		}
		const authentication = this.authentication(entry.authentication, `${key}.authentication`)
		if (authentication) schema.authentication = authentication
		if (entry.view !== undefined) {
			const view = this.viewName(entry.view, `${key}.view`)
			if (view) schema.view = view
		}
		if (entry.cache !== undefined) schema.cache = this.cache(entry.cache, `${key}.cache`)
		if (entry.outbox !== undefined) schema.outbox = this.outbox(entry.outbox, `${key}.outbox`)
		if (entry.queries !== undefined) {
			if (!isObject(entry.queries)) this.issues.push(`${key}.queries must be an object (the name of a query: its limits)`)
			else {
				schema.queries = {}
				for (const [name, limits] of Object.entries(entry.queries)) {
					const at = `${key}.queries.${name}`
					if (!isObject(limits)) { this.issues.push(`${at} must be { maxRows, timeout }`); continue }
					schema.queries[name] = {
						...(limits.maxRows !== undefined ? { maxRows: this.int(limits.maxRows, 0, `${at}.maxRows`, 1) } : {}),
						...(limits.timeout !== undefined ? { timeoutMs: this.duration(limits.timeout, 0, `${at}.timeout`) } : {})
					}
				}
			}
		}
		if (entry.env !== undefined) {
			if (!isObject(entry.env)) {
				this.issues.push(`${key}.env must be an object`)
			} else {
				// a variable of the gateway that is not defined leaves the key out: the schema fails alone when it connects
				schema.env = Object.fromEntries(Object.entries(entry.env).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]))
			}
		}
		if (isObject(entry.scripts)) {
			const scripts: SchemaConfig['scripts'] = {}
			if (entry.scripts.enabled !== undefined) scripts.enabled = this.bool(entry.scripts.enabled, false, `${key}.scripts.enabled`)
			if (entry.scripts.maxLength !== undefined) scripts.maxLength = this.int(entry.scripts.maxLength, 20000, `${key}.scripts.maxLength`, 1)
			if (entry.scripts.timeoutMs !== undefined) scripts.timeoutMs = this.int(entry.scripts.timeoutMs, 30000, `${key}.scripts.timeoutMs`, 1)
			if (entry.scripts.maxIterations !== undefined) scripts.maxIterations = this.int(entry.scripts.maxIterations, 100000, `${key}.scripts.maxIterations`, 1)
			schema.scripts = scripts
		}
		if (isObject(entry.mcp)) {
			schema.mcp = {}
			if (entry.mcp.maxRows !== undefined) schema.mcp.maxRows = this.int(entry.mcp.maxRows, 500, `${key}.mcp.maxRows`, 0)
			if (entry.mcp.freeQueries !== undefined) schema.mcp.freeQueries = this.bool(entry.mcp.freeQueries, true, `${key}.mcp.freeQueries`)
			const approval = this.approvalMode(entry.mcp.approval, `${key}.mcp.approval`)
			if (approval) schema.mcp.approval = approval
			if (entry.mcp.approvalExpires !== undefined) schema.mcp.approvalExpiresMs = this.duration(entry.mcp.approvalExpires, 3600000, `${key}.mcp.approvalExpires`)
			if (entry.mcp.tools !== undefined) {
				schema.mcp.tools = {
					include: this.toolNames(entry.mcp.tools?.include, `${key}.mcp.tools.include`),
					exclude: this.toolNames(entry.mcp.tools?.exclude, `${key}.mcp.tools.exclude`)
				}
			}
		}
		if (isObject(entry.server)) {
			schema.server = {}
			if (entry.server.timeout !== undefined) schema.server.timeout = this.int(entry.server.timeout, 120000, `${key}.server.timeout`, 1)
			if (entry.server.maxConcurrent !== undefined) schema.server.maxConcurrent = this.int(entry.server.maxConcurrent, 64, `${key}.server.maxConcurrent`, 0)
			if (entry.server.maxResponseBytes !== undefined) schema.server.maxResponseBytes = this.size(entry.server.maxResponseBytes, 0, `${key}.server.maxResponseBytes`)
		}
		if (isObject(entry.runtime)) {
			schema.runtime = {}
			if (entry.runtime.mode !== undefined) schema.runtime.mode = this.mode(entry.runtime.mode, `${key}.runtime.mode`)
			if (entry.runtime.maxMemoryMb !== undefined) schema.runtime.maxMemoryMb = this.int(entry.runtime.maxMemoryMb, 512, `${key}.runtime.maxMemoryMb`, 16)
			if (entry.runtime.checkConnections !== undefined) schema.runtime.checkConnections = this.bool(entry.runtime.checkConnections, true, `${key}.runtime.checkConnections`)
		}
		return schema
	}

	private mode (raw: unknown, key: string): RuntimeMode {
		const mode = this.str(raw, 'thread')
		if (mode !== 'thread' && mode !== 'process') {
			this.issues.push(`${key} "${mode}" is not thread or process`)
			return 'thread'
		}
		return mode
	}

	private runtime (raw: unknown): RuntimeConfig {
		if (raw !== undefined && !isObject(raw)) this.issues.push('runtime must be an object')
		const r: Raw = isObject(raw) ? raw : {}
		const transports = this.str(r.transports, 'shared')
		if (transports !== 'shared') {
			if (['thread', 'process'].includes(transports)) this.warnings.push(`runtime.transports "${transports}" is not available in this version: every transport runs in the shared edge worker`)
			else this.issues.push(`runtime.transports "${transports}" is not shared, thread or process`)
		}
		let threadpoolSize: number | undefined
		if (r.threadpoolSize !== undefined && r.threadpoolSize !== null && String(r.threadpoolSize) !== 'auto') {
			threadpoolSize = this.int(r.threadpoolSize, 4, 'runtime.threadpoolSize', 1)
			if (threadpoolSize > 1024) this.issues.push('runtime.threadpoolSize must be at most 1024')
		}
		const passthrough = r.env?.passthrough ?? []
		if (!Array.isArray(passthrough)) this.issues.push('runtime.env.passthrough must be a list')
		const heartbeat = {
			intervalMs: this.int(r.heartbeat?.intervalMs, 5000, 'runtime.heartbeat.intervalMs', 10),
			timeoutMs: this.int(r.heartbeat?.timeoutMs, 30000, 'runtime.heartbeat.timeoutMs', 10)
		}
		if (heartbeat.timeoutMs <= heartbeat.intervalMs) this.issues.push('runtime.heartbeat.timeoutMs must be greater than intervalMs')
		return {
			transports: 'shared',
			schemas: this.mode(r.schemas, 'runtime.schemas'),
			maxMemoryMb: this.int(r.maxMemoryMb, 512, 'runtime.maxMemoryMb', 16),
			checkConnections: this.bool(r.checkConnections, true, 'runtime.checkConnections'),
			threadpoolSize,
			heartbeat,
			restart: {
				initialDelayMs: this.int(r.restart?.initialDelayMs, 1000, 'runtime.restart.initialDelayMs', 1),
				maxDelayMs: this.int(r.restart?.maxDelayMs, 300000, 'runtime.restart.maxDelayMs', 1)
			},
			env: {
				isolate: this.bool(r.env?.isolate, true, 'runtime.env.isolate'),
				passthrough: Array.isArray(passthrough) ? passthrough.map(String) : []
			}
		}
	}

	/** checked in full (with its trace rules) when the gateway starts, where 3xpr is: here only its form */
	private observability (raw: unknown): ObservabilityConfig | undefined {
		if (raw === undefined || raw === null) return undefined
		if (typeof raw !== 'object' || Array.isArray(raw)) {
			this.issues.push('observability must be an object (the same shape as infrastructure.observability of a lambdaORM.yaml)')
			return undefined
		}
		if ((raw as any).exporter?.headers !== undefined) {
			this.issues.push('observability.exporter.headers is not allowed: the headers carry tokens; use OTEL_EXPORTER_OTLP_HEADERS')
		}
		return raw as ObservabilityConfig
	}

	private logger (raw: Raw | undefined): LoggerConfig {
		const adapter = this.str(raw?.adapter, 'console')
		const level = this.str(raw?.level, 'info')
		if (!['console', 'winston'].includes(adapter)) this.issues.push(`logger.adapter "${adapter}" is not console or winston`)
		if (!['error', 'warn', 'info', 'debug'].includes(level)) this.issues.push(`logger.level "${level}" is not error, warn, info or debug`)
		return { adapter: adapter as LoggerConfig['adapter'], level: level as LoggerConfig['level'] }
	}

	private mcp (raw: unknown): McpConfig {
		if (raw !== undefined && !isObject(raw)) this.issues.push('mcp must be an object')
		const section: Raw = isObject(raw) ? raw : {}
		return {
			name: this.str(section.name, 'data-gateway'),
			tools: {
				include: this.toolNames(section.tools?.include, 'mcp.tools.include'),
				exclude: this.toolNames(section.tools?.exclude, 'mcp.tools.exclude')
			},
			pageSize: this.int(section.pageSize, 50, 'mcp.pageSize', 1),
			maxRows: this.int(section.maxRows, 500, 'mcp.maxRows', 0),
			freeQueries: this.bool(section.freeQueries, true, 'mcp.freeQueries'),
			approval: this.approvalMode(section.approval, 'mcp.approval') ?? 'none',
			approvalExpiresMs: this.duration(section.approvalExpires, 3600000, 'mcp.approvalExpires')
		}
	}

	private toolNames (raw: unknown, key: string): string[] {
		if (raw === undefined || raw === null) return []
		if (!Array.isArray(raw)) {
			this.issues.push(`${key} must be a list`)
			return []
		}
		// query_<name>: a query of application.queries (docs/NAMED_QUERIES.md), checked when the schema loads
		const known = (name: string) => TOOL_NAMES.includes(name) || /^query_[A-Za-z_][A-Za-z0-9_]*$/.test(name)
		const unknown = raw.filter(name => !known(String(name)))
		if (unknown.length) this.issues.push(`${key}: unknown tools ${unknown.join(', ')}`)
		return raw.map(String).filter(known)
	}

	private transports (raw: unknown): TransportsConfig {
		const transports: TransportsConfig = {}
		if (raw === undefined) {
			this.issues.push('no transport exposed: configure transports.<name>.port')
			return transports
		}
		if (!isObject(raw)) {
			this.issues.push('transports must be an object')
			return transports
		}
		const endpoints = new Map<string, string>()
		for (const [name, section] of Object.entries(raw)) {
			if (LATER_TRANSPORTS.includes(name)) {
				this.warnings.push(`transports.${name} is not available in this version: not exposed`)
				continue
			}
			if (!TRANSPORTS.includes(name)) {
				this.issues.push(`unknown transport "${name}"`)
				continue
			}
			if (!isObject(section) || section.port === undefined || section.port === null || section.port === '') {
				this.notes.push(`${name} not exposed: no port configured`)
				continue
			}
			const port = Number(section.port)
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				this.issues.push(`transports.${name}.port "${section.port}" is not an integer between 1 and 65535`)
				continue
			}
			const host = this.str(section.host, '0.0.0.0')
			const endpoint = `${host}:${port}`
			if (endpoints.has(endpoint)) {
				this.issues.push(`transports.${name} and transports.${endpoints.get(endpoint)} use the same ${endpoint}`)
				continue
			}
			endpoints.set(endpoint, name)
			const key = `transports.${name}`
			const base: TransportConfig = { port, host, basePath: this.basePath(section.basePath, `${key}.basePath`) }
			const authentication = this.authentication(section.authentication, `${key}.authentication`)
			if (authentication) base.authentication = authentication
			if (name === 'http') {
				transports.http = {
					...base,
					swagger: { enabled: this.bool(section.swagger?.enabled, true, `${key}.swagger.enabled`) }
				}
				if (section.ui !== undefined) this.warnings.push(`${key}.ui was removed in 4.0.0 (the gateway serves no UI): ignored; the UI is the data-gateway-ide, through transports.management`)
			} else if (name === 'management') {
				transports.management = {
					...base,
					sessions: this.sessions(section.sessions, `${key}.sessions`),
					trustedProxies: this.addresses(section.trustedProxies, `${key}.trustedProxies`)
				}
			} else if (name === 'mcpHttp') {
				transports.mcpHttp = {
					...base,
					legacySse: this.bool(section.legacySse, true, `${key}.legacySse`),
					stateful: this.bool(section.stateful, false, `${key}.stateful`),
					maxConnections: this.int(section.maxConnections, 100, `${key}.maxConnections`, 1)
				}
			} else if (name === 'webSocket') {
				transports.webSocket = {
					...base,
					maxConnections: this.int(section.maxConnections, 100, `${key}.maxConnections`, 1),
					asyncapi: { enabled: this.bool(section.asyncapi?.enabled, true, `${key}.asyncapi.enabled`) }
				}
			} else {
				transports.mcpWebSocket = {
					...base,
					maxConnections: this.int(section.maxConnections, 100, `${key}.maxConnections`, 1),
					asyncapi: { enabled: this.bool(section.asyncapi?.enabled, true, `${key}.asyncapi.enabled`) }
				}
			}
		}
		if (Object.keys(transports).length === 0 && !this.issues.some(i => i.startsWith('transports'))) {
			this.issues.push('no transport exposed: configure transports.<name>.port')
		}
		return transports
	}

	private sessions (raw: unknown, key: string): SessionsConfig {
		const r = isObject(raw) ? raw : {}
		if (raw !== undefined && !isObject(raw)) this.issues.push(`${key} must be an object`)
		const store = this.str(r.store, 'auto')
		if (store !== 'auto' && store !== 'memory') this.issues.push(`${key}.store "${store}" is not auto or memory`)
		const sessions: SessionsConfig = {
			idleTimeoutMs: this.duration(r.idleTimeout, 30 * 60000, `${key}.idleTimeout`),
			maxLifetimeMs: this.duration(r.maxLifetime, 12 * 3600000, `${key}.maxLifetime`),
			maxPerCredential: this.int(r.maxPerCredential, 0, `${key}.maxPerCredential`, 0),
			store: store === 'memory' ? 'memory' : 'auto'
		}
		if (sessions.idleTimeoutMs > sessions.maxLifetimeMs) this.warnings.push(`${key}.idleTimeout is longer than maxLifetime: a session ends at maxLifetime`)
		return sessions
	}

	/** '30m', '12h', a number of ms; at least a second */
	private duration (value: unknown, defaultValue: number, key: string): number {
		if (value === undefined || value === null || value === '') return defaultValue
		const ms = parseDuration(value as string | number)
		if (ms === undefined || ms < 1000) {
			this.issues.push(`${key} "${value}" is not a duration of at least 1s (30s, 30m, 12h, 7d)`)
			return defaultValue
		}
		return ms
	}

	/** IPv4 / IPv6 addresses or networks in CIDR (10.0.0.0/8, ::1) */
	private addresses (raw: unknown, key: string): string[] {
		if (raw === undefined || raw === null) return []
		const list = Array.isArray(raw) ? raw : [raw]
		const valid: string[] = []
		for (const entry of list.map(String)) {
			const match = /^([0-9a-fA-F:.]+)(?:\/(\d{1,3}))?$/.exec(entry.trim())
			const ipv4 = match && /^\d{1,3}(\.\d{1,3}){3}$/.test(match[1])
			const ipv6 = match && !ipv4 && match[1].includes(':')
			const prefix = match?.[2] !== undefined ? Number(match[2]) : undefined
			if (!match || (!ipv4 && !ipv6) || (prefix !== undefined && prefix > (ipv4 ? 32 : 128))) {
				this.issues.push(`${key}: "${entry}" is not an IP address or a CIDR network (10.0.0.0/8, ::1)`)
				continue
			}
			valid.push(entry.trim())
		}
		return valid
	}

	private basePath (raw: unknown, key: string): string {
		const value = this.str(raw, '')
		if (value === '' || value === '/') return ''
		if (!/^(\/[a-zA-Z0-9_.-]+)+\/?$/.test(value)) {
			this.issues.push(`${key} "${value}" must look like /segment/segment`)
			return ''
		}
		return value.replace(/\/+$/, '')
	}

	/**
	 * `none`, or `local` with one credential (token / value / username+password: every permission) or a list
	 * (tokens / keys / users, each with name and permissions). A local credential without its secret stops the
	 * process: a forgotten variable must never leave the gateway open.
	 */
	private authentication (raw: unknown, key: string): AuthenticationConfig | undefined {
		if (raw === undefined) return undefined
		if (!isObject(raw)) {
			this.issues.push(`${key} must be an object`)
			return undefined
		}
		if (raw.methods !== undefined) return this.methods(raw, key)
		const adapter = this.str(raw.adapter, 'none')
		if (adapter === 'none') return { adapter: 'none', credentials: [] }
		if (adapter === 'jwt') {
			const jwt = this.jwt(raw, key)
			return jwt ? { adapter: 'jwt', credentials: [], jwt } : undefined
		}
		if (adapter !== 'local') {
			this.issues.push(`${key}.adapter "${adapter}" is not none, local or jwt`)
			return undefined
		}
		const type = this.str(raw.type, '') as AuthenticationType
		const listKey = { bearer: 'tokens', apikey: 'keys', basic: 'users' }[type]
		if (!listKey) {
			this.issues.push(`${key}.type must be bearer, apikey or basic`)
			return undefined
		}
		const credentials: CredentialConfig[] = []
		if (raw[listKey] !== undefined) {
			if (!Array.isArray(raw[listKey]) || raw[listKey].length === 0) {
				this.issues.push(`${key}.${listKey} must be a non empty list`)
				return undefined
			}
			raw[listKey].forEach((entry: unknown, i: number) => {
				const at = `${key}.${listKey}[${i}]`
				if (!isObject(entry)) {
					this.issues.push(`${at} must be an object`)
					return
				}
				const name = type === 'basic' ? this.str(entry.username, '') : this.str(entry.name, '')
				if (!name) {
					this.issues.push(`${at}: ${type === 'basic' ? 'username' : 'name'} is required`)
					return
				}
				const credential = this.credential(type, entry, at, name, true)
				if (credential) credentials.push(credential)
			})
		} else {
			const credential = this.credential(type, { ...raw, permissions: undefined }, key, type === 'basic' ? this.str(raw.username, 'default') : 'default', false)
			if (credential) credentials.push(credential)
		}
		const names = credentials.map(c => c.name)
		const duplicated = names.filter((name, i) => names.indexOf(name) !== i)
		if (duplicated.length) this.issues.push(`${key}: duplicated credential names ${[...new Set(duplicated)].join(', ')}`)
		const header = type === 'apikey' ? this.str(raw.header, 'x-api-key').toLowerCase() : undefined
		return { adapter: 'local', type, header, credentials }
	}

	/** methods: several authentications in order (jwt for the users, local keys for the services); none is not one */
	private methods (raw: Raw, key: string): AuthenticationConfig | undefined {
		if (raw.adapter !== undefined && raw.adapter !== 'methods') {
			this.issues.push(`${key}: adapter and methods together; use methods alone`)
			return undefined
		}
		if (!Array.isArray(raw.methods) || raw.methods.length === 0) {
			this.issues.push(`${key}.methods must be a non empty list`)
			return undefined
		}
		const methods: AuthenticationConfig[] = []
		raw.methods.forEach((entry: unknown, i: number) => {
			const at = `${key}.methods[${i}]`
			if (isObject(entry) && (entry.methods !== undefined || this.str(entry.adapter, 'none') === 'none')) {
				this.issues.push(`${at}: a method is local or jwt (none would let everyone in; methods don't nest)`)
				return
			}
			const method = this.authentication(entry, at)
			if (method) methods.push(method)
		})
		return methods.length === raw.methods.length ? { adapter: 'methods', credentials: [], methods } : undefined
	}

	/** adapter: jwt (docs/JWT.md): the tokens of an issuer, their roles mapped to permissions and their claims to the context */
	private jwt (raw: Raw, key: string): JwtConfig | undefined {
		const before = this.issues.length
		const url = (value: unknown, at: string): string | undefined => {
			if (value === undefined) return undefined
			try {
				const parsed = new URL(String(value))
				if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(parsed.protocol)
				return String(value)
			} catch {
				this.issues.push(`${at} "${value}" is not an http(s) URL`)
				return undefined
			}
		}
		const issuer = url(raw.issuer, `${key}.issuer`)
		if (raw.issuer === undefined) this.issues.push(`${key}.issuer is required (the iss of the tokens)`)
		const audience = raw.audience === undefined ? [] : (Array.isArray(raw.audience) ? raw.audience : [raw.audience]).map(String).filter(Boolean)
		const jwksUri = url(raw.jwksUri, `${key}.jwksUri`)
		const secret = raw.secret === undefined || raw.secret === null || raw.secret === '' ? undefined : String(raw.secret)
		if (raw.secret !== undefined && !secret) this.issues.push(`${key}.secret is empty (a variable not given?)`)
		if (secret && jwksUri) this.issues.push(`${key}: secret and jwksUri together; a secret (HS256) is for development, the keys of the issuer for the rest`)
		const algorithms = raw.algorithms === undefined
			? (secret ? ['HS256'] : ['RS256', 'ES256', 'PS256'])
			: (Array.isArray(raw.algorithms) ? raw.algorithms.map(String) : [])
		if (!algorithms.length) this.issues.push(`${key}.algorithms must be a non empty list`)
		for (const algorithm of algorithms) {
			const shared = algorithm.startsWith('HS')
			if (!/^(RS|PS|ES|HS)(256|384|512)$|^EdDSA$/.test(algorithm)) this.issues.push(`${key}.algorithms: "${algorithm}" is not RS, PS, ES or HS 256/384/512, nor EdDSA`)
			else if (shared !== !!secret) this.issues.push(`${key}.algorithms: ${algorithm} ${shared ? 'needs a secret' : 'is for the keys of the issuer, not a secret'}`)
		}
		const clockToleranceSec = raw.clockTolerance === undefined ? 30 : Math.round((parseDuration(raw.clockTolerance as string | number) ?? -1) / 1000)
		if (clockToleranceSec < 0 || clockToleranceSec > 300) this.issues.push(`${key}.clockTolerance "${raw.clockTolerance}" is not a duration up to 5m (30s)`)
		const principalRaw = raw.principal === undefined ? {} : raw.principal
		if (!isObject(principalRaw)) this.issues.push(`${key}.principal must be an object`)
		const p = isObject(principalRaw) ? principalRaw : {}
		const name = this.str(p.name, 'sub')
		let permissions: JwtConfig['principal']['permissions']
		if (p.permissions !== undefined) {
			const at = `${key}.principal.permissions`
			if (!isObject(p.permissions) || !this.str(p.permissions.claim, '') || !isObject(p.permissions.roles)) {
				this.issues.push(`${at} needs claim (where the roles are) and roles (role → permissions)`)
			} else {
				const roles: Record<string, RoleConfig> = {}
				for (const [role, value] of Object.entries(p.permissions.roles)) {
					// a role says its permissions (a list, or { permissions, view }): one without them must not end up with all
					const list = isObject(value) ? value.permissions : value
					if (!Array.isArray(list)) { this.issues.push(`${at}.roles.${role} must be a list of permissions, or { permissions, view }`); continue }
					const view = isObject(value) && value.view !== undefined ? this.viewName(value.view, `${at}.roles.${role}.view`) : undefined
					const approval = isObject(value) ? this.approvalMode(value.approval, `${at}.roles.${role}.approval`) : undefined
					roles[role] = { permissions: this.permissions(list, `${at}.roles.${role}`), ...(view ? { view } : {}), ...(approval === 'writes' ? { approval } : {}) }
					if (view) this.stageWithView(roles[role].permissions, `${at}.roles.${role}`)
				}
				permissions = { claim: String(p.permissions.claim), roles }
			}
		}
		const context: Record<string, string> = {}
		if (raw.context !== undefined) {
			if (!isObject(raw.context)) this.issues.push(`${key}.context must be an object (variable: claim)`)
			else {
				for (const [variable, path] of Object.entries(raw.context)) {
					if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) this.issues.push(`${key}.context: "${variable}" is not a name of a variable`)
					else if (typeof path !== 'string' || !path) this.issues.push(`${key}.context.${variable} must be the claim it takes`)
					else context[variable] = path
				}
			}
		}
		if (this.issues.length > before || !issuer) return undefined
		return { issuer, audience, ...(jwksUri ? { jwksUri } : {}), ...(secret ? { secret } : {}), algorithms, clockToleranceSec, principal: { name, ...(permissions ? { permissions } : {}) }, context }
	}

	/** outbox (docs/OUTBOX_DISPATCHER.md §2): its destinations; without them, nothing is dispatched */
	private outbox (raw: unknown, key: string): OutboxConfig {
		const none: OutboxConfig = { dispatch: true, intervalMs: 1000, batch: 100, destinations: [] }
		if (raw === undefined) return none
		if (!isObject(raw)) {
			this.issues.push(`${key} must be an object`)
			return none
		}
		const destinations: OutboxDestinationConfig[] = []
		if (raw.destinations !== undefined && !Array.isArray(raw.destinations)) this.issues.push(`${key}.destinations must be a list`)
		;(Array.isArray(raw.destinations) ? raw.destinations : []).forEach((entry: unknown, i: number) => {
			const at = `${key}.destinations[${i}]`
			if (!isObject(entry)) { this.issues.push(`${at} must be an object`); return }
			const entities = entry.entities === undefined ? undefined : (Array.isArray(entry.entities) ? entry.entities.map(String) : (this.issues.push(`${at}.entities must be a list`), undefined))
			if (entry.type === 'webhook') {
				let url = ''
				try {
					const parsed = new URL(String(entry.url))
					if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(parsed.protocol)
					url = String(entry.url)
				} catch { this.issues.push(`${at}.url "${entry.url}" is not an http(s) URL`); return }
				if (entry.secret !== undefined && !String(entry.secret)) this.issues.push(`${at}.secret is empty (a variable not given?)`)
				destinations.push({ type: 'webhook', url, ...(entry.secret ? { secret: String(entry.secret) } : {}), timeoutMs: this.duration(entry.timeout, 5000, `${at}.timeout`), ...(entities ? { entities } : {}) })
			} else if (entry.type === 'kafka') {
				if (!this.str(entry.topic, '')) { this.issues.push(`${at}.topic is required`); return }
				destinations.push({ type: 'kafka', topic: String(entry.topic), ...(entities ? { entities } : {}) })
			} else {
				this.issues.push(`${at}.type must be webhook or kafka`)
			}
		})
		return {
			dispatch: this.bool(raw.dispatch, true, `${key}.dispatch`),
			intervalMs: this.duration(raw.interval, none.intervalMs, `${key}.interval`),
			batch: this.int(raw.batch, none.batch, `${key}.batch`, 1),
			destinations
		}
	}

	/** none or writes (docs/MUTATION_APPROVAL.md §2); not given, undefined */
	private approvalMode (raw: unknown, key: string): 'none' | 'writes' | undefined {
		if (raw === undefined || raw === null) return undefined
		if (raw === 'none' || raw === 'writes') return raw
		this.issues.push(`${key} must be none or writes`)
		return undefined
	}

	/** cluster (docs/REPLICAS.md §2): a Valkey shared by the replicas; without it, each replica on its own */
	private cluster (raw: unknown): ClusterConfig {
		if (raw === undefined) return {}
		if (!isObject(raw)) { this.issues.push('cluster must be an object'); return {} }
		for (const key of Object.keys(raw)) if (key !== 'valkey') this.warnings.push(`unknown key "cluster.${key}" ignored`)
		if (raw.valkey === undefined) return {}
		if (!isObject(raw.valkey)) { this.issues.push('cluster.valkey must be an object: { url, prefix }'); return {} }
		const url = typeof raw.valkey.url === 'string' ? raw.valkey.url.trim() : ''
		// a url whose variable is not defined: not set, as a transport without its port
		if (!url) { this.warnings.push('cluster.valkey has no url (a variable not given?): each replica on its own'); return {} }
		try {
			const protocol = new URL(url).protocol
			if (!['valkey:', 'valkeys:', 'redis:', 'rediss:'].includes(protocol)) throw new Error(protocol)
		} catch {
			this.issues.push('cluster.valkey.url must be valkey://, valkeys://, redis:// or rediss://')
			return {}
		}
		const prefix = this.str(raw.valkey.prefix, 'data-gateway')
		if (!/^[A-Za-z0-9_.:-]+$/.test(prefix)) this.issues.push('cluster.valkey.prefix: letters, digits and _ . : - only')
		return { valkey: { url, prefix } }
	}

	/** cache (docs/RESULT_CACHE.md §2): off unless enabled; ttl, maxEntries, maxRowBytes and its entities */
	private cache (raw: unknown, key: string): CacheConfig {
		const off: CacheConfig = { enabled: false, ttlMs: 60000, maxEntries: 10000, maxBytes: 1024 * 1024, entities: {} }
		if (raw === undefined) return off
		if (!isObject(raw)) {
			this.issues.push(`${key} must be an object`)
			return off
		}
		if (raw.store !== undefined && raw.store !== 'memory') this.issues.push(`${key}.store "${raw.store}" is not memory (redis comes later)`)
		const entities: CacheConfig['entities'] = {}
		if (raw.entities !== undefined) {
			if (!isObject(raw.entities)) this.issues.push(`${key}.entities must be an object (an entity: { enabled, ttl })`)
			else {
				for (const [entity, value] of Object.entries(raw.entities)) {
					if (!isObject(value)) { this.issues.push(`${key}.entities.${entity} must be { enabled, ttl }`); continue }
					entities[entity] = {
						...(value.enabled !== undefined ? { enabled: this.bool(value.enabled, true, `${key}.entities.${entity}.enabled`) } : {}),
						...(value.ttl !== undefined ? { ttlMs: this.duration(value.ttl, off.ttlMs, `${key}.entities.${entity}.ttl`) } : {})
					}
				}
			}
		}
		return {
			enabled: this.bool(raw.enabled, false, `${key}.enabled`),
			ttlMs: this.duration(raw.ttl, off.ttlMs, `${key}.ttl`),
			maxEntries: this.int(raw.maxEntries, off.maxEntries, `${key}.maxEntries`, 1),
			maxBytes: this.size(raw.maxRowBytes, off.maxBytes, `${key}.maxRowBytes`),
			entities
		}
	}

	/** the name of a view of λORM (it is checked against the schema when it loads) */
	private viewName (value: unknown, key: string): string | undefined {
		if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) {
			this.issues.push(`${key} must be the name of a view of the schema`)
			return undefined
		}
		return value
	}

	/** the commands of stage see the whole schema, whatever the view (docs/VIEWS_BY_IDENTITY.md §4): said, not stopped */
	private stageWithView (permissions: Permission[], key: string): void {
		const whole = permissions.filter(p => p === 'stageImport' || p === 'ddl')
		if (whole.length) this.warnings.push(`${key} has a view and ${whole.join(', ')}: the commands of stage see the whole schema, not the view`)
	}

	private credential (type: AuthenticationType, entry: Raw, at: string, name: string, listed: boolean): CredentialConfig | undefined {
		const secret = type === 'bearer' ? (entry.token ?? entry.value) : type === 'apikey' ? entry.value : entry.password
		const secretKey = type === 'bearer' ? (listed ? 'value' : 'token') : type === 'apikey' ? 'value' : 'password'
		if (secret === undefined || secret === null || String(secret) === '') {
			this.issues.push(`${at}: ${secretKey} is not defined (a local credential without its secret would leave the gateway open)`)
			return undefined
		}
		if (type === 'basic' && !this.str(entry.username, '')) {
			this.issues.push(`${at}: username is required`)
			return undefined
		}
		const permissions = this.permissions(entry.permissions, `${at}.permissions`)
		const credential: CredentialConfig = { name, permissions }
		if (this.approvalMode(entry.approval, `${at}.approval`) === 'writes') credential.approval = 'writes'
		if (entry.view !== undefined) {
			const view = this.viewName(entry.view, `${at}.view`)
			if (view) {
				credential.view = view
				this.stageWithView(permissions, at)
			}
		}
		if (type === 'basic') {
			credential.username = String(entry.username)
			credential.password = String(secret)
		} else {
			credential.value = String(secret)
		}
		return credential
	}

	private permissions (raw: unknown, key: string): Permission[] {
		if (raw === undefined) return [...ALL_PERMISSIONS]
		if (!Array.isArray(raw)) {
			this.issues.push(`${key} must be a list`)
			return []
		}
		const invalid = raw.filter(p => !isPermission(p))
		if (invalid.length) this.issues.push(`${key}: unknown permissions ${invalid.join(', ')} (valid: ${KNOWN_PERMISSIONS.join(', ')})`)
		return raw.filter(isPermission)
	}

	// ─── values ──────────────────────────────────────────────────────────────

	private str (value: unknown, defaultValue: string): string {
		return value === undefined || value === null ? defaultValue : String(value)
	}

	private size (value: unknown, defaultValue: number, key: string): number {
		if (value === undefined || value === null || value === '') return defaultValue
		const bytes = parseSize(value as string | number)
		if (bytes === undefined) {
			this.issues.push(`${key} "${value}" must be a size (bytes, or like 256MB)`)
			return defaultValue
		}
		return bytes
	}

	private int (value: unknown, defaultValue: number, key: string, min: number): number {
		if (value === undefined || value === null || value === '') return defaultValue
		const number = Number(value)
		if (!Number.isInteger(number) || number < min) {
			this.issues.push(`${key} "${value}" must be an integer >= ${min}`)
			return defaultValue
		}
		return number
	}

	private bool (value: unknown, defaultValue: boolean, key: string): boolean {
		if (value === undefined || value === null || value === '') return defaultValue
		if (typeof value === 'boolean') return value
		const text = String(value).toLowerCase()
		if (text === 'true') return true
		if (text === 'false') return false
		this.issues.push(`${key} "${value}" must be true or false`)
		return defaultValue
	}
}
