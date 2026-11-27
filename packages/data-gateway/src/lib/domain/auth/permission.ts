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
 * - approve: approve or reject the writes that wait for a person (docs/MUTATION_APPROVAL.md), never its own
 * - destructive: with ddl, a push or a migration that loses data (allowDestructive; docs/ROLE_SCOPES.md §3)
 * - roles: see and change the roles kept in the state of the gateway (docs/ROLE_SCOPES.md §5)
 * - observability: see and change the observability of the gateway (its metrics, logs and traces, where they go and
 *   where they are seen); a change restarts the edge and the workers whose SDK changes (docs/DATA_GATEWAY.md §8.2)
 */
export type DataPermission = 'read' | 'write' | 'script' | 'queue' | 'stageImport'
export type AdminPermission = 'schemaRead' | 'schemaWrite' | 'schemaAdmin' | 'workbenchWrite' | 'ddl' | 'build' | 'sessionAdmin' | 'approve' | 'destructive' | 'roles' | 'observability'
export type Permission = DataPermission | AdminPermission

/** What a credential without a list of permissions gets: every permission of the data, none of the administration */
export const ALL_PERMISSIONS: readonly Permission[] = ['read', 'write', 'script', 'queue', 'stageImport']

export const ADMIN_PERMISSIONS: readonly AdminPermission[] = ['schemaRead', 'schemaWrite', 'schemaAdmin', 'workbenchWrite', 'ddl', 'build', 'sessionAdmin', 'approve', 'destructive', 'roles', 'observability']

export const KNOWN_PERMISSIONS: readonly Permission[] = [...ALL_PERMISSIONS, ...ADMIN_PERMISSIONS]

export const isPermission = (value: unknown): value is Permission =>
	typeof value === 'string' && (KNOWN_PERMISSIONS as readonly string[]).includes(value)
