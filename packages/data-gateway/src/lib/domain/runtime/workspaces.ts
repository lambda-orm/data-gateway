/**
 * What changed in a workspace (docs/DATA_GATEWAY_ADMIN_PLAN.md §2.4): a schema that appeared or went, its
 * lambdaORM.yaml or its .env (the schema is reloaded), or other files of it (workbench/, data/, src/: only notified).
 */
export type WorkspaceChangeKind = 'added' | 'removed' | 'schema' | 'env' | 'files'

export interface WorkspaceChange {
	/** the route of the schema */
	path: string
	kind: WorkspaceChangeKind
	/** the files that changed, relative to the workspace (kind files, schema, env) */
	files?: string[]
	at: string
}

/** The kind of a file of a workspace, by its path relative to it */
export const changeKindOf = (file: string): WorkspaceChangeKind => {
	if (file === 'lambdaORM.yaml') return 'schema'
	if (file === '.env') return 'env'
	return 'files'
}

/** Files of a workspace that are never notified: the state λORM writes and editors' temporary files */
export const ignoredWorkspaceFile = (file: string): boolean =>
	/(^|\/)(node_modules|\.git)(\/|$)/.test(file) ||
	/(^|\/)orm_state(\/|$)/.test(file) ||
	// the state of the UI of each credential (SQLite): not a file of a schema
	/(^|\/)\.data-gateway(\/|$)/.test(file) ||
	/(~|\.swp|\.swx|\.tmp|\.lock)$/.test(file) ||
	/(^|\/)\.#/.test(file) ||
	/(^|\/)4913$/.test(file)
