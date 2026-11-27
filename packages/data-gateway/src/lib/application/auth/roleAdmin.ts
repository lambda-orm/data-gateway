import { isPermission, KNOWN_PERMISSIONS, Permission } from '../../domain/auth/permission'
import { Principal } from '../../domain/auth/principal'
import { RoleConfig } from '../../domain/config/dataGatewayConfig'
import { readRoleSchemas, RoleSchemaConfig } from '../../domain/auth/roles'
import { badRequest, forbidden, GatewayError, notFound } from '../../domain/errors/gatewayError'
import { ClockPort, LoggerPort } from '../ports/output/supportPorts'
import { ConfigChange, RoleStorePort, StoredRole } from '../ports/output/statePorts'
import { RoleCatalog } from './roleCatalog'
import { AccessDescription } from './accessView'

/** One of the roles of who asks, as it applies (its configuration and its state together) */
export interface MyRole {
	name: string
	permissions: string[]
	/** where it applies, each with its views and stages there (the first, the one of who doesn't choose); none, every schema */
	schemas?: Record<string, RoleSchemaConfig>
	/** the first, the one of who doesn't choose; none, the one of the schema */
	views?: string[]
	stages?: string[]
	maxRows?: number
	approval?: 'writes'
	/** a role its credential names that the gateway doesn't have: it gives nothing */
	unknown?: boolean
}

/** Where the gateway keeps what is its own (docs/GATEWAY_STATE.md): the source, how it is read, its schema */
export interface StateDescription {
	kind: 'sqlite' | 'orm' | 'memory'
	dialect?: string
	/** without secrets */
	connection?: unknown
	file?: string
	/** in words: SQLite /workspace/.data-gateway/state.sqlite */
	where: string
	managedBy: 'node:sqlite' | 'lambdaORM' | 'memory'
	/** state.source said in the configuration (else the SQLite of the volume, or memory) */
	configured: boolean
	refreshMs: number
	required: boolean
	/** it could be read the last time */
	available: boolean
	/** the lambdaORM.yaml of the system schema of the state (its entities, its mapping, its source) */
	schema?: string
	/** its source and mapping come from the administration (.data-gateway/persist.yaml) */
	persisted: boolean
	/** its mapping can change (a database through λORM) */
	mappingEditable: boolean
}

/** Who asks: its name, its context (the user it is of) and its roles with what each gives */
export interface Me {
	name: string
	permissions: string[]
	context?: Record<string, unknown>
	roles: MyRole[]
}

/** A role as the administration shows it: of the YAML (read only), of the state, and how it applies */
export interface ListedRole {
	name: string
	/** a role kept in the state for one schema (4.4): it doesn't apply, it is listed to remove it */
	schema?: string
	ignored?: boolean
	/** yaml: of the configuration (only extended); state: kept in the state of the gateway */
	source: 'yaml' | 'state'
	config: Partial<RoleConfig>
	locked?: boolean
	updatedAt?: string
	updatedBy?: string
}

const ROLE_KEYS = ['permissions', 'schemas', 'views', 'stages', 'maxRows', 'approval', 'scope']

/** What a role of the state may say: as in the YAML, but never locked (that is of the YAML) */
export const roleOfBody = (raw: unknown): Partial<RoleConfig> => {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('ValidationError', 'a role is { permissions, schemas, views, stages, maxRows, approval, scope }')
	const body = raw as Record<string, unknown>
	const unknown = Object.keys(body).filter(k => !ROLE_KEYS.includes(k))
	if (unknown.length) throw badRequest('ValidationError', `unknown keys of a role: ${unknown.join(', ')} (${ROLE_KEYS.join(', ')})`)
	const role: Partial<RoleConfig> = {}
	if (body.permissions !== undefined) {
		if (!Array.isArray(body.permissions) || body.permissions.some(p => !isPermission(p))) throw badRequest('ValidationError', `permissions: a list of ${KNOWN_PERMISSIONS.join(', ')}`)
		role.permissions = [...new Set(body.permissions as Permission[])]
	}
	if (body.schemas !== undefined) {
		const issues: string[] = []
		const schemas = readRoleSchemas(body.schemas, 'schemas', issues)
		if (issues.length) throw badRequest('ValidationError', issues.join('; '))
		if (schemas) role.schemas = schemas
	}
	for (const key of ['views', 'stages'] as const) {
		const value = body[key]
		if (value === undefined) continue
		if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || !v)) throw badRequest('ValidationError', `${key}: a list of names`)
		role[key] = [...new Set(value as string[])]
	}
	if (body.maxRows !== undefined) {
		if (!Number.isInteger(body.maxRows) || (body.maxRows as number) < 1) throw badRequest('ValidationError', 'maxRows: an integer, 1 or more')
		role.maxRows = body.maxRows as number
	}
	if (body.approval !== undefined) {
		if (body.approval !== 'writes') throw badRequest('ValidationError', 'approval: writes')
		role.approval = 'writes'
	}
	if (body.scope !== undefined) {
		if (body.scope !== 'any') throw badRequest('ValidationError', 'scope: any')
		role.scope = 'any'
	}
	return role
}

/**
 * The roles kept in the state of the gateway (docs/ROLE_SCOPES.md §5): listed with those of the YAML, added, extended,
 * removed. With the permission roles; nobody gives a role a permission it doesn't have, nor touches a locked one. Each
 * change is recorded (who, when, before and after) and the catalog of this replica is loaded again at once; the others
 * see the new version within state.refresh.
 */
export class RoleAdmin {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly store: RoleStorePort,
		private readonly catalog: RoleCatalog,
		private readonly clock: ClockPort,
		private readonly id: () => string,
		private readonly logger: LoggerPort,
		private readonly accessOf: () => AccessDescription = () => ({ permissions: KNOWN_PERMISSIONS, authentications: [] }),
		private readonly stateOf?: () => StateDescription
	) {}

	/** where the gateway keeps its state (sessions, roles, its observability) and its schema, without secrets */
	public state (who: Principal): StateDescription {
		// who administers the roles, or where the state is kept
		if (!who.permissions.has('roles') && !who.permissions.has('persist')) throw forbidden(who.name, 'persist')
		if (!this.stateOf) throw notFound('this gateway says nothing of its state')
		return this.stateOf()
	}

	/** who may come in (the authentications, their keys and roles, never a secret) and every permission there is */
	public access (who: Principal): AccessDescription {
		this.require(who)
		return this.accessOf()
	}

	private require (who: Principal): void {
		if (!who.permissions.has('roles')) throw forbidden(who.name, 'roles')
	}

	/** who asks and its roles, as they apply: any credential, about itself (no permission needed) */
	public me (who: Principal): Me {
		return {
			name: who.name,
			permissions: [...who.permissions],
			...(who.context ? { context: who.context } : {}),
			roles: (who.roles ?? []).map(name => {
				const grant = this.catalog.grantOf(name)
				if (!grant) return { name, permissions: [], unknown: true }
				const schemas = this.catalog.schemasOf(name)
				return {
					name,
					permissions: grant.permissions,
					...(schemas ? { schemas } : {}),
					...(grant.views ? { views: grant.views } : {}),
					...(grant.stages ? { stages: grant.stages } : {}),
					...(grant.maxRows !== undefined ? { maxRows: grant.maxRows } : {}),
					...(grant.approval ? { approval: grant.approval } : {})
				}
			})
		}
	}

	public async list (who: Principal): Promise<ListedRole[]> {
		this.require(who)
		return [
			...this.catalog.yamlRoles().map(r => ({ name: r.name, source: 'yaml' as const, config: r.config, ...(r.config.locked ? { locked: true } : {}) })),
			...this.catalog.storedRoles().map(r => ({ name: r.name, ...(r.schema !== undefined ? { schema: r.schema, ignored: true } : {}), source: 'state' as const, config: r.config, updatedAt: r.updatedAt, updatedBy: r.updatedBy }))
		]
	}

	public async put (who: Principal, name: string, schema: string | undefined, body: unknown, reason?: string): Promise<StoredRole> {
		this.require(who)
		if (!/^[A-Za-z0-9_.:@-]{1,200}$/.test(name)) throw badRequest('ValidationError', 'the name of a role: letters, digits and _ . : @ - (up to 200)')
		// a role is of the gateway: where it applies is said by its schemas (docs/ROLE_SCOPES.md §2)
		if (schema !== undefined) throw badRequest('ValidationError', 'a role is of the gateway: the schemas where it applies go in its config (schemas: [...])')
		if (this.catalog.locked(name)) throw new GatewayError(403, 'ForbiddenError', `the role "${name}" is locked in the configuration: it can't be extended`)
		const config = roleOfBody(body)
		// nobody gives what it doesn't have
		const more = (config.permissions ?? []).filter(p => !who.permissions.has(p))
		if (more.length) throw new GatewayError(403, 'ForbiddenError', `"${who.name}" can't give the permissions it doesn't have: ${more.join(', ')}`)
		const before = this.catalog.storedRoles().find(r => r.name === name && r.schema === schema)
		const at = this.clock.now().toISOString()
		const role: StoredRole = { name, ...(schema ? { schema } : {}), config, updatedAt: at, updatedBy: who.name }
		await this.store.put(role, this.change(who, name, schema, before?.config, config, at, reason))
		await this.reload()
		this.logger.info(`[data-gateway] roles: "${who.name}" saved the role "${name}"${schema ? ` of ${schema}` : ''}`)
		return role
	}

	public async remove (who: Principal, name: string, schema: string | undefined, reason?: string): Promise<void> {
		this.require(who)
		const before = this.catalog.storedRoles().find(r => r.name === name && r.schema === schema)
		if (!before) throw notFound(`the state of the gateway has no role "${name}"${schema ? ` of ${schema}` : ''} (one of the configuration can't be removed)`)
		// removing what one has given itself is fine; what would leave nobody with roles is not
		if (before.config.permissions?.includes('roles') && !this.othersCanAdminister(name, schema)) {
			throw new GatewayError(409, 'ConflictError', `nobody would keep the permission roles without "${name}"`)
		}
		const at = this.clock.now().toISOString()
		await this.store.remove(name, schema, this.change(who, name, schema, before.config, undefined, at, reason))
		await this.reload()
	}

	public async changes (who: Principal, limit: number): Promise<ConfigChange[]> {
		this.require(who)
		return (await this.store.changes(Math.min(Math.max(Math.trunc(limit) || 100, 1), 1000))).filter(c => c.area === 'roles')
	}

	/** a role of the YAML, or another of the state, still gives roles */
	private othersCanAdminister (name: string, schema: string | undefined): boolean {
		return this.catalog.yamlRoles().some(r => r.config.permissions?.includes('roles')) ||
			this.catalog.storedRoles().some(r => !(r.name === name && r.schema === schema) && r.config.permissions?.includes('roles'))
	}

	private change (who: Principal, name: string, schema: string | undefined, before: unknown, after: unknown, at: string, reason?: string): ConfigChange {
		return { id: this.id(), area: 'roles', key: schema ? `${name}@${schema}` : name, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), by: who.name, at, ...(reason ? { reason: String(reason).slice(0, 1000) } : {}) }
	}

	public async reload (): Promise<void> {
		this.catalog.load(await this.store.roles())
	}
}

/**
 * The roles of the state in this replica: loaded at the start and again when their version moves (another replica
 * saved one), every refreshMs. Without the source, the YAML alone (never a permission more): said, and tried again.
 */
export class RoleRefresher {
	private timer?: ReturnType<typeof setInterval>
	private seen = -1
	public available = false

	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly store: RoleStorePort, private readonly catalog: RoleCatalog, private readonly refreshMs: number, private readonly logger: LoggerPort) {}

	public async refresh (): Promise<void> {
		try {
			const version = await this.store.version()
			if (version !== this.seen) {
				this.catalog.load(await this.store.roles())
				this.seen = version
			}
			if (!this.available) this.logger.info('[data-gateway] state: the roles of the state loaded')
			this.available = true
		} catch (error: any) {
			if (this.available || this.seen === -1) this.logger.warn(`[data-gateway] state: the roles of the state can't be read (${error?.message ?? error}): the roles of the configuration alone`)
			this.available = false
			this.seen = -2
		}
	}

	public start (): void {
		if (this.refreshMs > 0 && !this.timer) {
			this.timer = setInterval(() => { this.refresh().catch(() => undefined) }, this.refreshMs)
			this.timer.unref?.()
		}
	}

	public stop (): void {
		if (this.timer) clearInterval(this.timer)
		this.timer = undefined
	}
}
