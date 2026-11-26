/** What the workbench can do with a query or a script, as the gateway names them */
export type Operation = 'plan' | 'metadata' | 'model' | 'parameters' | 'constraints' | 'execute' | 'executeQueued' | 'executeScript'

export const ALL_OPERATIONS: Operation[] = ['plan', 'metadata', 'model', 'parameters', 'constraints', 'execute', 'executeQueued', 'executeScript']

/** Operations on the text of a query (the others run it) */
export const QUERY_INSPECTIONS: Operation[] = ['plan', 'metadata', 'model', 'parameters', 'constraints']

/** Who the credential is on a schema (GET /{schema}/whoami) */
export interface WhoAmI {
	name: string
	permissions: string[]
	schema: string
	/** scripts.enabled of the schema */
	scripts: boolean
	/** the view of λORM of the credential (gateway 4.1.0): what of the domain it sees */
	view?: string
	/** data-gateway 4.4 (docs/ROLE_SCOPES.md): its stage without choosing, and the views and stages it may choose */
	stage?: string
	views?: string[]
	stages?: string[]
	roles?: string[]
	maxRows?: number
}

export interface Availability {
	enabled: boolean
	/** Why not, to show next to the disabled action */
	reason?: string
}

/**
 * Whether an action can be offered (the gateway decides anyway): inspections and execute need read (a write also
 * needs write: the gateway answers 403), executeQueued needs queue, executeScript needs script and scripts enabled.
 */
export const availability = (operation: Operation, whoami: WhoAmI | undefined): Availability => {
	if (!whoami) return { enabled: false, reason: 'no credential yet' }
	const has = (permission: string) => whoami.permissions.includes(permission)
	switch (operation) {
	case 'executeScript':
		if (!whoami.scripts) return { enabled: false, reason: 'scripts are disabled on this schema' }
		return has('script') ? { enabled: true } : { enabled: false, reason: `"${whoami.name}" has no script permission` }
	case 'executeQueued':
		return has('queue') ? { enabled: true } : { enabled: false, reason: `"${whoami.name}" has no queue permission` }
	case 'execute':
		return has('read') || has('write') ? { enabled: true } : { enabled: false, reason: `"${whoami.name}" has no read permission` }
	default:
		return has('read') ? { enabled: true } : { enabled: false, reason: `"${whoami.name}" has no read permission` }
	}
}
