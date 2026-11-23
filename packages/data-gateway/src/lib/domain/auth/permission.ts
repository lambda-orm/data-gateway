/**
 * What a credential may do (docs/DATA_GATEWAY.md §6.2):
 * - read: schema, plan, metadata, model, parameters, constraints, stage exists / export, and execute when every
 *   sentence of the query is a select; with admin, read what is saved in the workspaces (workbench/)
 * - write: execute with inserts, updates, deletes, upserts, merges, bulk operations
 * - script: executeScript (a 3xpr script can do anything inside: it is not classified)
 * - queue: executeQueued (plus write when the query writes)
 * - stageImport: import data into a stage
 *
 * The administration of the workspaces (transports.management, docs/DATA_GATEWAY_ADMIN_PLAN.md): never given by default, only
 * when a credential lists them:
 * - schemaRead: the lambdaORM.yaml of each workspace (without secrets) and its validation
 * - schemaWrite: change the lambdaORM.yaml
 * - schemaAdmin: create and remove workspaces
 * - workbenchWrite: save queries, scripts and diagrams in the workspaces (without touching the schema)
 * - ddl: change the structure of the databases of a stage (push, drop)
 * - build: generate the code of the domain (model and repositories) in src/ of the workspace
 * - sessionAdmin: list every session of management and revoke those of other credentials
 *   (docs/DATA_GATEWAY_SESSIONS_PLAN.md); without it, a credential sees and closes only its own
 */
export type DataPermission = 'read' | 'write' | 'script' | 'queue' | 'stageImport'
export type AdminPermission = 'schemaRead' | 'schemaWrite' | 'schemaAdmin' | 'workbenchWrite' | 'ddl' | 'build' | 'sessionAdmin'
export type Permission = DataPermission | AdminPermission

/** What a credential without a list of permissions gets: every permission of the data, none of the administration */
export const ALL_PERMISSIONS: readonly Permission[] = ['read', 'write', 'script', 'queue', 'stageImport']

export const ADMIN_PERMISSIONS: readonly AdminPermission[] = ['schemaRead', 'schemaWrite', 'schemaAdmin', 'workbenchWrite', 'ddl', 'build', 'sessionAdmin']

export const KNOWN_PERMISSIONS: readonly Permission[] = [...ALL_PERMISSIONS, ...ADMIN_PERMISSIONS]

export const isPermission = (value: unknown): value is Permission =>
	typeof value === 'string' && (KNOWN_PERMISSIONS as readonly string[]).includes(value)
