import { ALL_PERMISSIONS, isPermission, Permission } from '../auth/permission'
import {
	AuthenticationConfig, AuthenticationType, ConfigReading, CredentialConfig, DataGatewayConfig, LoggerConfig, McpConfig,
	RuntimeConfig, RuntimeMode, SchemaConfig, TransportConfig, TransportName, TransportsConfig
} from './dataGatewayConfig'
import { normalizeSchemaPath, schemaPathIssues } from '../runtime/schemaPath'
import { parseSize } from './sizes'

/** Transports of the design that this version does not serve yet (docs/DATA_GATEWAY_PLAN.md). */
const LATER_TRANSPORTS = ['webSocket']
const TRANSPORTS = ['http', 'mcpHttp', 'mcpWebSocket']
const KNOWN_SECTIONS = ['orm', 'server', 'logger', 'metrics', 'audit', 'authentication', 'rateLimit', 'scripts', 'mcp', 'runtime', 'transports']
const SCHEMA_KEYS = ['path', 'workspace', 'transports', 'authentication', 'env', 'scripts', 'mcp', 'server', 'runtime']
/** The tools of docs/DATA_GATEWAY.md §5.1: mcp.tools.include / exclude must name them */
export const TOOL_NAMES = [
	'orm_execute', 'orm_execute_script', 'orm_execute_queued', 'orm_plan', 'orm_metadata', 'orm_model', 'orm_parameters',
	'orm_constraints', 'schema_get', 'schema_version', 'schema_domain', 'schema_entities', 'schema_enums', 'schema_sources',
	'schema_mappings', 'schema_views', 'schema_stages', 'stage_exists', 'stage_export', 'stage_import', 'gateway_version',
	'gateway_health'
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
			server: {
				timeout: this.int(raw.server?.timeout, 120000, 'server.timeout', 1),
				requestBodySize: this.str(raw.server?.requestBodySize, '14MB'),
				maxConcurrent: this.int(raw.server?.maxConcurrent, 64, 'server.maxConcurrent', 0),
				maxResponseBytes: this.size(raw.server?.maxResponseBytes, 256 * 1024 ** 2, 'server.maxResponseBytes')
			},
			logger: this.logger(raw.logger),
			metrics: { enabled: this.bool(raw.metrics?.enabled, true, 'metrics.enabled') },
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
			runtime: this.runtime(raw.runtime),
			transports: this.transports(raw.transports)
		}
		for (const schema of config.orm.schemas) {
			for (const transport of schema.transports ?? []) {
				if (!TRANSPORTS.includes(transport)) this.issues.push(`orm.schemas "${schema.path}": unknown transport "${transport}"`)
			}
		}
		const reading: ConfigReading = { issues: this.issues, warnings: this.warnings, notes: this.notes }
		if (this.issues.length === 0) reading.config = config
		return reading
	}

	// ─── sections ────────────────────────────────────────────────────────────

	private orm (raw: unknown): { workspacePath?: string, schemas: SchemaConfig[] } {
		if (raw !== undefined && !isObject(raw)) {
			this.issues.push('orm must be an object')
			return { schemas: [] }
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
		return { workspacePath, schemas }
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
			maxRows: this.int(section.maxRows, 500, 'mcp.maxRows', 0)
		}
	}

	private toolNames (raw: unknown, key: string): string[] {
		if (raw === undefined || raw === null) return []
		if (!Array.isArray(raw)) {
			this.issues.push(`${key} must be a list`)
			return []
		}
		const unknown = raw.filter(name => !TOOL_NAMES.includes(String(name)))
		if (unknown.length) this.issues.push(`${key}: unknown tools ${unknown.join(', ')}`)
		return raw.map(String).filter(name => TOOL_NAMES.includes(name))
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
					swagger: { enabled: this.bool(section.swagger?.enabled, true, `${key}.swagger.enabled`) },
					ui: { enabled: this.bool(section.ui?.enabled, false, `${key}.ui.enabled`) }
				}
			} else if (name === 'mcpHttp') {
				transports.mcpHttp = {
					...base,
					legacySse: this.bool(section.legacySse, true, `${key}.legacySse`),
					stateful: this.bool(section.stateful, false, `${key}.stateful`),
					maxConnections: this.int(section.maxConnections, 100, `${key}.maxConnections`, 1)
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
		const adapter = this.str(raw.adapter, 'none')
		if (adapter === 'none') return { adapter: 'none', credentials: [] }
		if (adapter !== 'local') {
			this.issues.push(`${key}.adapter "${adapter}" is not none or local`)
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
		if (invalid.length) this.issues.push(`${key}: unknown permissions ${invalid.join(', ')} (valid: ${ALL_PERMISSIONS.join(', ')})`)
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
