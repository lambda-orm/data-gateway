/**
 * The operations of the common API (docs/DATA_GATEWAY_CLIENTS_PLAN.md §3) and how each transport calls them: the
 * route of the REST API, the method of the JSON-RPC API and the tool of the MCP server of the schema.
 */
export type Operation =
	| 'execute' | 'executeScript' | 'executeQueued' | 'plan' | 'metadata' | 'model' | 'parameters' | 'constraints'
	| 'schema' | 'schemaVersion' | 'domain' | 'entities' | 'entity' | 'search' | 'describe' | 'enums' | 'enum' | 'sources' | 'source'
	| 'mappings' | 'mapping' | 'entityMapping' | 'stages' | 'stage' | 'views'
	| 'stageExists' | 'stageExport' | 'stageImport' | 'version' | 'health' | 'whoami'

export type Args = Record<string, any>
type Route<T> = (args: Args) => T

const q = (a: Args) => ({ query: a.query, options: a.options })
const enc = encodeURIComponent

/** [method, path under the route of the schema, body] */
export const REST: Partial<Record<Operation, Route<[string, string, unknown?]>>> = {
	execute: a => ['POST', '/execute', { query: a.query, data: a.data ?? {}, options: a.options }],
	executeScript: a => ['POST', '/script', { script: a.script, data: a.data ?? {}, options: a.options }],
	executeQueued: a => ['POST', '/execute-queued', { topic: a.topic, query: a.query, data: a.data ?? {}, chunk: a.chunk, options: a.options }],
	plan: a => ['POST', '/plan', q(a)],
	metadata: a => ['POST', '/metadata', { query: a.query }],
	model: a => ['POST', '/model', { query: a.query }],
	parameters: a => ['POST', '/parameters', { query: a.query }],
	constraints: a => ['POST', '/constraints', { query: a.query }],
	schema: () => ['GET', '/schema'],
	schemaVersion: () => ['GET', '/schema/version'],
	domain: () => ['GET', '/domain'],
	entities: () => ['GET', '/entities'],
	entity: a => ['GET', `/entities/${enc(a.entity)}`],
	search: a => ['GET', `/search?q=${enc(a.text)}`],
	describe: a => ['GET', `/describe?entities=${(a.entities as string[]).map(enc).join(',')}`],
	enums: () => ['GET', '/enums'],
	enum: a => ['GET', `/enums/${enc(a.enum)}`],
	sources: () => ['GET', '/sources'],
	source: a => ['GET', `/sources/${enc(a.source)}`],
	mappings: () => ['GET', '/mappings'],
	mapping: a => ['GET', `/mappings/${enc(a.mapping)}`],
	entityMapping: a => ['GET', `/mappings/${enc(a.mapping)}/${enc(a.entity)}`],
	stages: () => ['GET', '/stages'],
	stage: a => ['GET', `/stages/${enc(a.stage)}`],
	views: () => ['GET', '/views'],
	stageExists: a => ['GET', `/stages/${enc(a.stage)}/exists`],
	stageExport: a => ['GET', `/stages/${enc(a.stage)}/export`],
	stageImport: a => ['POST', `/stages/${enc(a.stage)}/import`, a.data],
	version: () => ['GET', '/version'],
	health: () => ['GET', '/health'],
	whoami: () => ['GET', '/whoami']
}

/** [method, params] */
export const RPC: Partial<Record<Operation, Route<[string, Args]>>> = {
	execute: a => ['query.execute', { query: a.query, data: a.data ?? {}, options: a.options }],
	executeScript: a => ['query.script', { script: a.script, data: a.data ?? {}, options: a.options }],
	executeQueued: a => ['query.executeQueued', { topic: a.topic, query: a.query, data: a.data ?? {}, chunk: a.chunk, options: a.options, notify: true }],
	plan: a => ['query.plan', q(a)],
	metadata: a => ['query.metadata', { query: a.query }],
	model: a => ['query.model', { query: a.query }],
	parameters: a => ['query.parameters', { query: a.query }],
	constraints: a => ['query.constraints', { query: a.query }],
	schema: () => ['schema.schema', {}],
	schemaVersion: () => ['schema.version', {}],
	domain: () => ['schema.domain', {}],
	entities: () => ['schema.entities', {}],
	entity: a => ['schema.entity', { entity: a.entity }],
	search: a => ['schema.search', { text: a.text }],
	describe: a => ['schema.describe', { entities: a.entities }],
	enums: () => ['schema.enums', {}],
	enum: a => ['schema.enum', { enum: a.enum }],
	sources: () => ['schema.sources', {}],
	source: a => ['schema.source', { source: a.source }],
	mappings: () => ['schema.mappings', {}],
	mapping: a => ['schema.mapping', { mapping: a.mapping }],
	entityMapping: a => ['schema.entityMapping', { mapping: a.mapping, entity: a.entity }],
	stages: () => ['schema.stages', {}],
	stage: a => ['schema.stage', { stage: a.stage }],
	views: () => ['schema.views', {}],
	stageExists: a => ['stage.exists', { stage: a.stage }],
	stageExport: a => ['stage.export', { stage: a.stage }],
	stageImport: a => ['stage.import', { stage: a.stage, data: a.data }],
	version: () => ['general.version', {}],
	health: () => ['general.health', {}]
}

/** [tool, arguments] */
export const MCP: Partial<Record<Operation, Route<[string, Args]>>> = {
	execute: a => ['orm_execute', { query: a.query, data: a.data ?? {}, options: a.options }],
	executeScript: a => ['orm_execute_script', { script: a.script, data: a.data ?? {}, options: a.options }],
	executeQueued: a => ['orm_execute_queued', { topic: a.topic, query: a.query, data: a.data ?? {}, chunk: a.chunk, options: a.options }],
	plan: a => ['orm_plan', q(a)],
	metadata: a => ['orm_metadata', { query: a.query }],
	model: a => ['orm_model', { query: a.query }],
	parameters: a => ['orm_parameters', { query: a.query }],
	constraints: a => ['orm_constraints', { query: a.query }],
	schema: () => ['schema_get', {}],
	schemaVersion: () => ['schema_version', {}],
	domain: () => ['schema_domain', {}],
	entities: () => ['schema_entities', {}],
	entity: a => ['schema_entities', { entity: a.entity }],
	search: a => ['schema_search', { text: a.text }],
	describe: a => ['schema_describe', { entities: a.entities }],
	enums: () => ['schema_enums', {}],
	enum: a => ['schema_enums', { enum: a.enum }],
	sources: () => ['schema_sources', {}],
	source: a => ['schema_sources', { source: a.source }],
	mappings: () => ['schema_mappings', {}],
	mapping: a => ['schema_mappings', { mapping: a.mapping }],
	entityMapping: a => ['schema_mappings', { mapping: a.mapping, entity: a.entity }],
	stages: () => ['schema_stages', {}],
	stage: a => ['schema_stages', { stage: a.stage }],
	views: () => ['schema_views', {}],
	stageExists: a => ['stage_exists', { stage: a.stage }],
	stageExport: a => ['stage_export', { stage: a.stage }],
	stageImport: a => ['stage_import', { stage: a.stage, data: a.data }],
	version: () => ['gateway_version', {}],
	health: () => ['gateway_health', {}]
}

/** where an operation that a transport doesn't have can be found */
export const WHERE: Partial<Record<Operation, string>> = {
	whoami: 'use an http(s):// connection'
}

/** drops what is undefined (options not given), as JSON would */
export const clean = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))
