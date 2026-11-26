import { AuthenticationConfig, DataGatewayConfig, RoleConfig } from '../../domain/config/dataGatewayConfig'
import { extendGrant, grantOf, RoleGrant } from '../../domain/auth/roles'
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

/** The roles of the methods jwt (as before 4.4) of an authentication, and of its methods */
const jwtRolesOf = (authentication: AuthenticationConfig | undefined): Record<string, RoleConfig> => {
	if (!authentication) return {}
	const methods = authentication.adapter === 'methods' ? authentication.methods ?? [] : [authentication]
	return Object.assign({}, ...methods.map(m => m.jwt?.principal.permissions?.roles ?? {}))
}

/**
 * The roles of the gateway (docs/ROLE_SCOPES.md): authorization.roles and those of the methods jwt (the base), those of
 * each schema (orm.schemas[].roles) and those of the state of the gateway, which extend them unless they are locked.
 * A role of the state that the YAML doesn't have is a new one.
 */
export class RoleCatalog implements RoleGrantsPort, RoleLookupPort {
	private readonly base: Record<string, RoleConfig>
	private readonly bySchema: Record<string, Record<string, Partial<RoleConfig>>>
	private stored: StoredRole[] = []

	constructor (config: Pick<DataGatewayConfig, 'authorization' | 'authentication' | 'orm'> & { transports?: DataGatewayConfig['transports'] }) {
		const transports = Object.values(config.transports ?? {}).map(t => (t as { authentication?: AuthenticationConfig } | undefined)?.authentication)
		this.base = Object.assign({}, ...transports.map(jwtRolesOf), jwtRolesOf(config.authentication), config.authorization?.roles)
		this.bySchema = {}
		for (const schema of config.orm.schemas) {
			const roles = { ...jwtRolesOf(schema.authentication), ...schema.roles }
			if (Object.keys(roles).length) this.bySchema[schema.path] = roles
		}
	}

	/** the roles of the state (loaded at the start, and again when they change) */
	public load (roles: StoredRole[]): void {
		this.stored = roles
	}

	public storedRoles (): StoredRole[] {
		return this.stored
	}

	/** the roles of the YAML (they can't be removed from the administration) */
	public yamlRoles (): { name: string, schema?: string, config: Partial<RoleConfig> }[] {
		return [
			...Object.entries(this.base).map(([name, config]) => ({ name, config })),
			...Object.entries(this.bySchema).flatMap(([schema, roles]) => Object.entries(roles).map(([name, config]) => ({ name, schema, config })))
		]
	}

	public locked (name: string): boolean {
		return this.base[name]?.locked === true
	}

	private storedOf (name: string, schema: string | undefined): StoredRole | undefined {
		return this.stored.find(r => r.name === name && r.schema === schema)
	}

	/** a role in a schema: the YAML, extended by the schema, by the state (global) and by the state of the schema */
	public grantOf (name: string, schema?: string): RoleGrant | undefined {
		let grant: RoleGrant | undefined = this.base[name] ? grantOf(name, this.base[name]) : undefined
		const schemaRole = schema !== undefined ? this.bySchema[schema]?.[name] : undefined
		if (schemaRole) grant = extendGrant(grant, schemaRole, name)
		if (!this.locked(name)) {
			const global = this.storedOf(name, undefined)
			if (global) grant = extendGrant(grant, global.config, name)
			const own = schema !== undefined ? this.storedOf(name, schema) : undefined
			if (own) grant = extendGrant(grant, own.config, name)
		}
		return grant
	}

	public has (role: string): boolean {
		return this.base[role] !== undefined || Object.values(this.bySchema).some(r => r[role] !== undefined) || this.stored.some(r => r.name === role)
	}

	/** before a schema: the permissions of the roles in no schema (the administration, the sessions) */
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
 * The grants of a principal: those of its roles, or one of its own (a key with its permissions and its view, as before
 * 4.4; a principal made by a test). Its own scope: all its permissions, in its view and the stage of the schema.
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
