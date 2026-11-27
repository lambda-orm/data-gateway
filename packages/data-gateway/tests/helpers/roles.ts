// The catalog of the roles of a test: the only place a credential gets what it may do (docs/ROLE_SCOPES.md).
import { RoleCatalog, RoleGrantsPort } from '../../src/lib/application/auth/roleCatalog'
import { CredentialConfig, RoleConfig } from '../../src/lib/domain/config/dataGatewayConfig'
import { Permission } from '../../src/lib/domain/auth/permission'

export const catalogOf = (roles: Record<string, Permission[] | Partial<RoleConfig>> = {}): RoleCatalog =>
	new RoleCatalog({
		authorization: {
			roles: Object.fromEntries(Object.entries(roles).map(([name, r]) => [name, (Array.isArray(r) ? { permissions: r } : { permissions: [], ...r }) as RoleConfig])),
			stages: 'restricted'
		}
	})

/** A credential of a test as it was before roles: what it may do, said by itself */
export interface OwnCredential {
	name: string
	value?: string
	username?: string
	password?: string
	permissions: Permission[]
	view?: string
	approval?: 'writes'
	context?: Record<string, string | number | boolean>
}

/** Each credential with a role of its own name, which says what it said by itself: the credentials and their catalog */
export const ownRoles = (list: OwnCredential[]): { credentials: CredentialConfig[], roles: RoleCatalog } => ({
	credentials: list.map(({ permissions, view, approval, ...credential }) => ({ ...credential, roles: [credential.name] })),
	roles: catalogOf(Object.fromEntries(list.map(c => [c.name, { permissions: c.permissions, ...(c.view ? { views: [c.view] } : {}), ...(c.approval ? { approval: c.approval } : {}) }])))
})

/** A directory of schemas (inline or the edge router) that looks the roles up in the catalog */
export const withGrants = <T extends { grants?: RoleGrantsPort }>(directory: T, roles: RoleGrantsPort): T => {
	directory.grants = roles
	return directory
}
