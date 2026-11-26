import { RoleConfig } from '../../../domain/config/dataGatewayConfig'

/** A role kept in the state of the gateway (docs/ROLE_SCOPES.md §5): new, or what it adds to one of the YAML */
export interface StoredRole {
	name: string
	/** undefined: global; else the path of the schema it is for */
	schema?: string
	config: Partial<RoleConfig>
	updatedAt: string
	updatedBy: string
}

/** A change of the configuration kept in the state (docs/GATEWAY_STATE.md §4): who, when, before and after */
export interface ConfigChange {
	id: string
	area: 'roles'
	/** the role (and its schema: name@schema) */
	key: string
	before?: unknown
	after?: unknown
	by: string
	at: string
	reason?: string
}

/**
 * The roles of the state, their changes and the version of each area (docs/GATEWAY_STATE.md §3): a SQLite of the
 * volume or a database through λORM; every replica that uses the same one sees the same.
 */
export interface RoleStorePort {
	roles (): Promise<StoredRole[]>
	/** saves (or replaces) a role, with its change, and moves the version of the roles */
	put (role: StoredRole, change: ConfigChange): Promise<void>
	/** removes a role, with its change; false when there was none */
	remove (name: string, schema: string | undefined, change: ConfigChange): Promise<boolean>
	changes (limit: number): Promise<ConfigChange[]>
	/** the version of the roles: it moves with every change */
	version (): Promise<number>
}
