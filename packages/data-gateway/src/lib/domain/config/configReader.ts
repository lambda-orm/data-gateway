import { ALL_PERMISSIONS, isPermission, Permission } from '../auth/permission'
import {
	AuthenticationConfig, AuthenticationType, ConfigReading, CredentialConfig, DataGatewayConfig, HttpTransportConfig,
	LoggerConfig, SchemaConfig, TransportsConfig
} from './dataGatewayConfig'

/** Transports of the design that this version does not serve yet (docs/DATA_GATEWAY_PLAN.md). */
const LATER_TRANSPORTS = ['mcpHttp', 'mcpWebSocket', 'webSocket']
/** Sections of the design read by later versions: accepted without a warning. */
const LATER_SECTIONS = ['mcp', 'runtime']
const KNOWN_SECTIONS = ['orm', 'server', 'logger', 'metrics', 'audit', 'authentication', 'rateLimit', 'scripts', 'transports', ...LATER_SECTIONS]

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
				requestBodySize: this.str(raw.server?.requestBodySize, '14MB')
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
			transports: this.transports(raw.transports)
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
					if (!isObject(entry) || typeof entry.path !== 'string') {
						this.issues.push(`orm.schemas[${i}]: path is required`)
						return
					}
					schemas.push({ path: entry.path.replace(/^\/+|\/+$/g, ''), workspace: entry.workspace })
				})
			}
		}
		const explicit = schemas.filter(s => s.workspace !== undefined)
		if (!workspacePath && explicit.length === 0) {
			this.issues.push('orm.workspacePath (or an orm.schemas entry with workspace) is required')
		}
		// one schema served at the root: several schemas arrive with the runtime of docs/DATA_GATEWAY_PLAN.md phase 4
		if (schemas.some(s => s.path !== '') || (workspacePath && explicit.length > 0) || explicit.length > 1) {
			this.issues.push('orm: this version serves a single schema at the root (orm.workspacePath, or one orm.schemas entry with path "" and workspace); several schemas arrive in 3.0.0')
		}
		return { workspacePath, schemas }
	}

	private logger (raw: Raw | undefined): LoggerConfig {
		const adapter = this.str(raw?.adapter, 'console')
		const level = this.str(raw?.level, 'info')
		if (!['console', 'winston'].includes(adapter)) this.issues.push(`logger.adapter "${adapter}" is not console or winston`)
		if (!['error', 'warn', 'info', 'debug'].includes(level)) this.issues.push(`logger.level "${level}" is not error, warn, info or debug`)
		return { adapter: adapter as LoggerConfig['adapter'], level: level as LoggerConfig['level'] }
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
			if (name !== 'http') {
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
			const http: HttpTransportConfig = {
				port,
				host,
				basePath: this.basePath(section.basePath, `transports.${name}.basePath`),
				swagger: { enabled: this.bool(section.swagger?.enabled, true, `transports.${name}.swagger.enabled`) }
			}
			const authentication = this.authentication(section.authentication, `transports.${name}.authentication`)
			if (authentication) http.authentication = authentication
			transports.http = http
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
