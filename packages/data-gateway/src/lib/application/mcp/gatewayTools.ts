import { Principal } from '../../domain/auth/principal'
import { JsonSchema } from '../../domain/mcp/mcpTypes'
import { DataGatewayPort } from '../ports/input/dataGatewayPort'
import { GatewayTool, Tool, ToolContext, ToolSpec } from './tool'

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }

const query: JsonSchema = { type: 'string', minLength: 1, description: 'λORM query (lambda expression), for example Products.filter(p => p.price > minPrice).sort(p => desc(p.price))' }
const data: JsonSchema = { type: 'object', description: 'Values of the variables of the query (e.g. { "minPrice": 10 }); for insert / update / delete, the entity (and its includes)' }
const options: JsonSchema = { type: 'object', description: 'Query options, e.g. { "stage": "default" }' }
const name = (what: string, required = false): JsonSchema => ({ type: 'string', description: `Name of the ${what}${required ? '' : '; without it, all of them'}` })

const canWrite = (principal: Principal): boolean => principal.permissions.has('write')

/** How to write a query: the part of the description of orm_execute that teaches the language (with the domain). */
export const QUERY_LANGUAGE_SUMMARY = `Queries are lambda expressions over the entities of the domain (not SQL):
- Entity.filter(p => <condition>).map(p => ({ alias: p.field, other: p.relation.field })).sort(p => desc(p.field)).page(1, 20)
- Conditions: == != > >= < <= && || !, between(p.price, 1, 9), in(p.id, [1, 2]), startsWith(p.name, 'A'), p.name.includes('text') (contains), like(p.name, 'A%'); variables (minPrice) come from "data".
- Relations are navigated with dots in filter/map: Products.filter(p => p.category.name == 'Beverages').
- Aggregates in map group by the other fields: Products.map(p => ({ category: p.category.name, total: count(1), top: max(p.price) })); having(p => ...) filters groups.
- first(p => ...) / last(p => ...) return one row; distinct(p => ...) removes duplicates; page(page, size) paginates (page from 1).
- include(p => p.relation) / include(p => [p.a, p.b.filter(q => ...).map(q => ...)]) adds related rows as nested arrays/objects.
- Functions: year(), month(), day(), today(), now(), addDay(), dayDiff(), upper(), lower(), concat(), substr(), round(), nvl(), isNull().
- Strings use quotes: p.country == 'France'; dates as 'YYYY-MM-DD' strings compared with p.orderDate >= '1997-01-01'.`

const WRITE_SUMMARY = `- Writes (need the write permission): Entity.insert() with the entity in "data"; Orders.insert().include(p => p.details);
  Entity.update(p => ({ field: value })).filter(p => p.id == id); Entity.delete().filter(p => p.id == id); Entity.upsert().
  Writes answer the inserted id / affected rows.`

const executeDescription = (principal: Principal, context: ToolContext): string => [
	canWrite(principal)
		? 'Runs a λORM query and returns its rows (select) or the affected rows / ids (insert, update, delete, upsert).'
		: 'Runs a λORM read query (select) and returns its rows. This credential can only read: writes are refused.',
	'Read lambdaorm://guide/expressions for the full language; use orm_plan to check a query without running it.',
	QUERY_LANGUAGE_SUMMARY,
	canWrite(principal) ? WRITE_SUMMARY : '',
	context.domain
].filter(Boolean).join('\n\n')

const SPECS: ToolSpec[] = [
	{
		name: 'orm_execute',
		title: 'Execute query',
		description: executeDescription,
		properties: { query, data, options },
		required: ['query'],
		permissions: ['read', 'write'],
		annotations: principal => canWrite(principal) ? DESTRUCTIVE : READ_ONLY,
		returnsRows: true,
		run: (gw, ctx, a) => gw.execute(ctx, { query: a.query, data: a.data, options: a.options })
	},
	{
		name: 'orm_execute_script',
		title: 'Execute script',
		description: 'Runs a 3xpr script on the server with access to orm (e.g. several queries and logic between them). ' +
			'The last expression is the result. Disabled unless scripts.enabled; limited in length, time and iterations.',
		properties: { script: { type: 'string', minLength: 1, description: 'The script' }, data: { type: 'object', description: 'Variables of the script' }, options },
		required: ['script'],
		permissions: ['script'],
		annotations: DESTRUCTIVE,
		returnsRows: true,
		run: (gw, ctx, a) => gw.executeScript(ctx, { script: a.script, data: a.data, options: a.options })
	},
	{
		name: 'orm_execute_queued',
		title: 'Execute queued',
		description: 'Publishes a query to the queue (Kafka) to be run asynchronously; answers the id of the execution. ' +
			'Writes need the write permission too.',
		properties: {
			topic: { type: 'string', minLength: 1, description: 'Topic of the queue' },
			query,
			data,
			chunk: { type: 'integer', minimum: 1, description: 'Rows per message' },
			options
		},
		required: ['topic', 'query'],
		permissions: ['queue'],
		annotations: DESTRUCTIVE,
		run: (gw, ctx, a) => gw.executeQueued(ctx, { topic: a.topic, query: a.query, data: a.data, chunk: a.chunk, options: a.options })
	},
	{
		name: 'orm_plan',
		title: 'Query plan',
		description: 'Returns the sentences (SQL or the database equivalent) a query would run, without running it: use it to check a query.',
		properties: { query, options },
		required: ['query'],
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => gw.plan(ctx, { query: a.query, options: a.options })
	},
	{
		name: 'orm_metadata',
		title: 'Query metadata',
		description: 'Returns the tree of a query (sentences, entities, clauses) as λORM parses it.',
		properties: { query },
		required: ['query'],
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => gw.metadata(ctx, { query: a.query })
	},
	{
		name: 'orm_model',
		title: 'Query model',
		description: 'Returns the fields (name and type) of the rows a query returns.',
		properties: { query },
		required: ['query'],
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => gw.model(ctx, { query: a.query })
	},
	{
		name: 'orm_parameters',
		title: 'Query parameters',
		description: 'Returns the variables (name and type) a query expects in "data".',
		properties: { query },
		required: ['query'],
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => gw.parameters(ctx, { query: a.query })
	},
	{
		name: 'orm_constraints',
		title: 'Query constraints',
		description: 'Returns the constraints (required fields, validations) a write query checks.',
		properties: { query },
		required: ['query'],
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => gw.constraints(ctx, { query: a.query })
	},
	{
		name: 'schema_get',
		title: 'Schema',
		description: 'Returns the schema: version and domain.',
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx) => gw.schema(ctx)
	},
	{
		name: 'schema_version',
		title: 'Schema version',
		description: 'Returns the version of the schema.',
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx) => gw.schemaVersion(ctx)
	},
	{
		name: 'schema_domain',
		title: 'Domain',
		description: 'Returns the domain as JSON: entities (properties, relations, keys, constraints) and enums. Large for a ' +
			'big schema: to write a query, schema_search and schema_describe give the part it needs.',
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx) => gw.domain(ctx)
	},
	{
		name: 'schema_entities',
		title: 'Entities',
		description: 'Returns the entities as JSON (the same as REST /entities), or one entity with its properties and relations. ' +
			'All of them is large for a big schema: to write a query, schema_search and schema_describe are compact.',
		properties: { entity: name('entity') },
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => a.entity ? gw.entity(ctx, a.entity) : gw.entities(ctx)
	},
	{
		name: 'schema_search',
		title: 'Search the schema',
		description: 'Finds entities, properties and relations whose name contains a text (case-insensitive), compact: ' +
			'`Entity.property: type (pk, required)`, `Entity.relation → Target[]`, or a whole entity when its name matches. ' +
			'`Areas.name` searches only in Areas. When nothing contains it, the closest names (didYouMean).',
		properties: { text: { type: 'string', minLength: 1, description: 'Part of a name: area, status, Devices.location' } },
		required: ['text'],
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => gw.search(ctx, a.text)
	},
	{
		name: 'schema_describe',
		title: 'Describe entities',
		description: 'Describes some entities compactly, two lines each: properties (type, pk, required, enum) and relations ' +
			'(`relation → Target[]` when it is a list). What to read before writing a query over them.',
		properties: { entities: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30, description: 'Names of the entities' } },
		required: ['entities'],
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => gw.describe(ctx, a.entities)
	},
	{
		name: 'schema_enums',
		title: 'Enums',
		description: 'Returns the enums, or one enum with its values.',
		properties: { enum: name('enum') },
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => a.enum ? gw.enum(ctx, a.enum) : gw.enums(ctx)
	},
	{
		name: 'schema_sources',
		title: 'Sources',
		description: 'Returns the data sources (name and dialect), or one of them.',
		properties: { source: name('source') },
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => a.source ? gw.source(ctx, a.source) : gw.sources(ctx)
	},
	{
		name: 'schema_mappings',
		title: 'Mappings',
		description: 'Returns the mappings (entity → table / collection), a mapping, or the mapping of one entity.',
		properties: { mapping: name('mapping'), entity: { type: 'string', description: 'Name of the entity (with mapping)' } },
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => a.mapping ? (a.entity ? gw.entityMapping(ctx, a.mapping, a.entity) : gw.mapping(ctx, a.mapping)) : gw.mappings(ctx)
	},
	{
		name: 'schema_views',
		title: 'Views',
		description: 'Returns the names of the views.',
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx) => gw.views(ctx)
	},
	{
		name: 'schema_stages',
		title: 'Stages',
		description: 'Returns the stages (which source serves each entity), or one stage.',
		properties: { stage: name('stage') },
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => a.stage ? gw.stage(ctx, a.stage) : gw.stages(ctx)
	},
	{
		name: 'stage_exists',
		title: 'Stage exists',
		description: 'Says whether the tables / collections of a stage exist in its sources.',
		properties: { stage: name('stage', true) },
		required: ['stage'],
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => gw.stageExists(ctx, a.stage)
	},
	{
		name: 'stage_export',
		title: 'Stage export',
		description: 'Exports all the data of a stage (every entity). Can be large.',
		properties: { stage: name('stage', true) },
		required: ['stage'],
		permissions: ['read'],
		annotations: READ_ONLY,
		run: (gw, ctx, a) => gw.stageExport(ctx, a.stage)
	},
	{
		name: 'stage_import',
		title: 'Stage import',
		description: 'Imports data (as stage_export returns it) into a stage.',
		properties: { stage: name('stage', true), data: { type: 'object', description: 'The data, as stage_export returns it' } },
		required: ['stage', 'data'],
		permissions: ['stageImport'],
		annotations: DESTRUCTIVE,
		run: async (gw, ctx, a) => { await gw.stageImport(ctx, a.stage, a.data); return { imported: true } }
	},
	{
		name: 'gateway_version',
		title: 'Gateway version',
		description: 'Returns the version of the data-gateway.',
		permissions: ['read'],
		annotations: READ_ONLY,
		run: gw => gw.version()
	},
	{
		name: 'gateway_health',
		title: 'Gateway health',
		description: 'Returns the health of the data-gateway (uptime).',
		permissions: ['read'],
		annotations: READ_ONLY,
		run: gw => gw.health()
	}
]

/** The tools of docs/DATA_GATEWAY.md §5.1, in that order */
export const gatewayTools = (gateway: DataGatewayPort): Tool[] => SPECS.map(spec => new GatewayTool(spec, gateway))
