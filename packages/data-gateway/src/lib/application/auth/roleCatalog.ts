import { DataGatewayConfig, RoleConfig } from '../../domain/config/dataGatewayConfig'
import { extendGrant, extendSchemaEntry, grantInSchema, grantOf, RoleGrant, RoleSchemaConfig } from '../../domain/auth/roles'
import { Permission } from '../../domain/auth/permission'
import { Principal } from '../../domain/auth/principal'
import { StoredRole } from '../ports/output/statePorts'

/** The roles of a principal as they apply in a schema (the edge puts them in the principal it sends to the schema) */
export interface RoleGrantsPort {
	grantsOf (principal: Principal, schema: string): RoleGrant[]
}

/** What the edge needs of a role before it knows the schema: its permissions and whether its writes wait */
export interface RoleLookupPort {
	permissionsOf (roles: readonly string[]): Permission[]
	approvalOf (roles: readonly string[]): 'writes' | undefined
	/** the role exists in some level (YAML, a schema, the state) */
	has (role: string): boolean
}

/**
 * The roles of the gateway (docs/ROLE_SCOPES.md): authorization.roles, and those of the state of the gateway, which
 * extend them unless they are locked (a role of the state that the YAML doesn't have is a new one). A role says the
 * schemas where it applies (none, every schema): in another one it gives nothing. A role kept in the state for one
 * schema (4.4) doesn't apply: the administration lists it to remove it.
 */
export class RoleCatalog implements RoleGrantsPort, RoleLookupPort {
	private readonly base: Record<string, RoleConfig>
	private stored: StoredRole[] = []

	constructor (config: Pick<DataGatewayConfig, 'authorization'>) {
		this.base = { ...config.authorization?.roles }
	}

	/** the roles of the state (loaded at the start, and again when they change) */
	public load (roles: StoredRole[]): void {
		this.stored = roles
	}

	public storedRoles (): StoredRole[] {
		return this.stored
	}

	/** the roles of the YAML (they can't be removed from the administration) */
	public yamlRoles (): { name: string, config: Partial<RoleConfig> }[] {
		return Object.entries(this.base).map(([name, config]) => ({ name, config }))
	}

	public locked (name: string): boolean {
		return this.base[name]?.locked === true
	}

	/** the role of the state that applies: the one of the gateway (one of a schema, of 4.4, doesn't) */
	private storedOf (name: string): StoredRole | undefined {
		return this.stored.find(r => r.name === name && r.schema === undefined)
	}

	/**
	 * the schemas where a role applies, each with what it may use there (the YAML and the state together); undefined,
	 * every schema. An extension adds schemas (and views and stages in one) to a role that names some; one that applies
	 * everywhere keeps applying everywhere, with what the extension says of a schema.
	 */
	public schemasOf (name: string): Record<string, RoleSchemaConfig> | undefined {
		const base = this.base[name]?.schemas
		const own = this.locked(name) ? undefined : this.storedOf(name)?.config.schemas
		if (!this.base[name]) return own
		if (!base) return undefined
		if (!own) return base
		return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(own)])].map(path => [path, extendSchemaEntry(base[path], own[path])]))
	}

	/** what a role says of one schema: undefined, it doesn't apply there; {} applies with its views and stages */
	private entryOf (name: string, schema: string): RoleSchemaConfig | undefined {
		const schemas = this.schemasOf(name)
		if (schemas) return schemas[schema]
		// everywhere: what the state said of this schema (an extension of a role of the YAML without schemas)
		const own = this.locked(name) ? undefined : this.storedOf(name)?.config.schemas?.[schema]
		return own ?? {}
	}

	/** a role (in a schema: nothing where it doesn't apply, and its views and stages there): the YAML extended by the state */
	public grantOf (name: string, schema?: string): RoleGrant | undefined {
		let grant: RoleGrant | undefined = this.base[name] ? grantOf(name, this.base[name]) : undefined
		if (!this.locked(name)) {
			const global = this.storedOf(name)
			if (global) grant = extendGrant(grant, global.config, name)
		}
		if (grant && schema !== undefined) {
			const entry = this.entryOf(name, schema)
			if (!entry) return undefined
			return grantInSchema(grant, entry)
		}
		return grant
	}

	public has (role: string): boolean {
		return this.base[role] !== undefined || this.storedOf(role) !== undefined
	}

	/** before a schema: the permissions of the roles, whatever their schemas (the administration, the sessions) */
	public permissionsOf (roles: readonly string[]): Permission[] {
		return [...new Set(roles.flatMap(r => this.grantOf(r)?.permissions ?? []))]
	}

	public approvalOf (roles: readonly string[]): 'writes' | undefined {
		return roles.some(r => this.grantOf(r)?.approval === 'writes') ? 'writes' : undefined
	}

	public grantsOf (principal: Principal, schema: string): RoleGrant[] {
		return grantsFor(principal, roles => roles.map(r => this.grantOf(r, schema)).filter((g): g is RoleGrant => g !== undefined))
	}
}

/**
 * The grants of a principal: those of its roles, or one of its own (the anonymous of adapter none, a principal made by a
 * test). Its own scope: all its permissions, in its view and the stage of the schema.
 */
export const grantsFor = (principal: Principal, of: (roles: readonly string[]) => RoleGrant[]): RoleGrant[] => {
	if (principal.grants) return [...principal.grants]
	if (principal.roles?.length) return of(principal.roles)
	return [ownGrant(principal)]
}

export const ownGrant = (principal: Principal): RoleGrant => ({
	role: principal.name,
	permissions: [...principal.permissions],
	...(principal.view ? { views: [principal.view] } : {}),
	...(principal.approval ? { approval: principal.approval } : {})
})
