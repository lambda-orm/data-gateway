import { JsonSchema } from '../../domain/mcp/mcpTypes'
import { DataGatewayPort, RequestContext } from '../ports/input/dataGatewayPort'
import { NamedQueryInfo } from '../usecases/namedQueryUseCases'
import { Tool } from './tool'

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const WRITES = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }

/** The JSON schema of a parameter of λORM (its type) */
const schemaOf = (type: string | undefined): JsonSchema => {
	switch (type) {
	case 'integer': return { type: 'integer' }
	case 'decimal': case 'number': return { type: 'number' }
	case 'boolean': return { type: 'boolean' }
	case 'date': return { type: 'string', description: 'a date, YYYY-MM-DD' }
	case 'dateTime': return { type: 'string', description: 'a date and time, ISO 8601' }
	case 'json': case 'any': return {}
	default:
		if (type?.endsWith('[]')) return { type: 'array', items: schemaOf(type.slice(0, -2)) }
		return { type: 'string' }
	}
}

/** What the query gives, as text: its fields and types (an agent knows what comes back) */
const fieldsOf = (info: NamedQueryInfo): string =>
	info.model.length ? `Returns rows with: ${info.model.map(m => `${m.name}: ${m.type}`).join(', ')}.` : ''

/** The tool of a named query: query_<name>, its parameters as arguments, run by its name (never its text) */
export const namedQueryTool = (gateway: DataGatewayPort, info: NamedQueryInfo): Tool => ({
	name: `query_${info.name}`,
	returnsRows: true,
	// listed only to who can use it: the list comes in the view of who calls; a write needs write
	visibleTo: principal => principal.permissions.has('read') && (!info.writes || principal.permissions.has('write')),
	definition: () => ({
		name: `query_${info.name}`,
		title: info.name,
		description: [info.description ?? `The query ${info.name} of the schema.`, fieldsOf(info)].filter(Boolean).join(' '),
		inputSchema: {
			type: 'object',
			properties: Object.fromEntries(info.parameters.map(p => [p.name, schemaOf(p.type)])),
			additionalProperties: false
		},
		annotations: info.writes ? WRITES : READ_ONLY
	}),
	execute: (ctx: RequestContext, args: Record<string, unknown>) => gateway.query(ctx, info.name, { data: args })
})

/** The tools of the named queries of who calls (docs/NAMED_QUERIES.md): those of its view */
export const namedQueryTools = (gateway: DataGatewayPort) => async (ctx: RequestContext): Promise<Tool[]> =>
	(await gateway.queries(ctx)).map(info => namedQueryTool(gateway, info))

/** The tools of free queries: without them (mcp.freeQueries: false) an agent has only the named ones */
export const FREE_QUERY_TOOLS = ['orm_execute', 'orm_execute_script', 'orm_execute_queued', 'orm_plan']

/** the tools of the gateway an agent gets: without the free queries when mcp.freeQueries is false */
export const curatedTools = (tools: Tool[], freeQueries: boolean): Tool[] =>
	freeQueries ? tools : tools.filter(tool => !FREE_QUERY_TOOLS.includes(tool.name))
