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

/** What the administration changes in the state: the roles, the settings of the gateway (its observability) */
export type ConfigArea = 'roles' | 'observability'

/** A setting of the gateway kept in the state (its observability): it replaces what the YAML says of it */
export interface StoredSetting {
	key: ConfigArea
	value: unknown
	updatedAt: string
	updatedBy: string
}

/** A change of the configuration kept in the state (docs/GATEWAY_STATE.md §4): who, when, before and after */
export interface ConfigChange {
	id: string
	area: ConfigArea
	/** the role (and its schema: name@schema), or the setting */
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

/** The settings of the gateway kept in the state (docs/GATEWAY_STATE.md §3), with their changes and their version */
export interface SettingStorePort {
	setting (key: ConfigArea): Promise<StoredSetting | undefined>
	/** saves (or replaces) a setting, with its change, and moves the version of its area */
	putSetting (setting: StoredSetting, change: ConfigChange): Promise<void>
	/** removes a setting (back to the YAML), with its change; false when there was none */
	removeSetting (key: ConfigArea, change: ConfigChange): Promise<boolean>
	/** the version of an area: it moves with every change of it */
	areaVersion (area: ConfigArea): Promise<number>
}
