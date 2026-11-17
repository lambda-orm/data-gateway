/**
 * What a credential may do (docs/DATA_GATEWAY.md §6.2):
 * - read: schema, plan, metadata, model, parameters, constraints, stage exists / export, and execute when every
 *   sentence of the query is a select
 * - write: execute with inserts, updates, deletes, upserts, merges, bulk operations
 * - script: executeScript (a 3xpr script can do anything inside: it is not classified)
 * - queue: executeQueued (plus write when the query writes)
 * - stageImport: import data into a stage
 */
export type Permission = 'read' | 'write' | 'script' | 'queue' | 'stageImport'

export const ALL_PERMISSIONS: readonly Permission[] = ['read', 'write', 'script', 'queue', 'stageImport']

export const isPermission = (value: unknown): value is Permission =>
	typeof value === 'string' && (ALL_PERMISSIONS as readonly string[]).includes(value)
