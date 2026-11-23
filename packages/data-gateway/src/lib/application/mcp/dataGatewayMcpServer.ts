import { McpRequestError } from '../../domain/errors/gatewayError'
import {
	Page, ResourceContent, ResourceDefinition, ResourceTemplateDefinition, ToolDefinition, ToolResult
} from '../../domain/mcp/mcpTypes'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { McpServerInfo, McpServerPort } from '../ports/input/mcpServerPort'
import { OrmSchemaPort } from '../ports/output/ormPorts'
import { validateArguments } from './argumentValidator'
import { describeDomain } from './domainDescription'
import { EXPRESSIONS_GUIDE } from './expressionsGuide'
import { limitRows, toolError, toolSuccess } from './resultSerializer'
import { ToolCatalog } from './toolCatalog'
import { authorize } from '../../domain/auth/authorizationPolicy'

export interface McpServerSettings {
	name: string
	version: string
	pageSize: number
	maxRows: number
}

const RESOURCES: ResourceDefinition[] = [
	{ uri: 'lambdaorm://schema/domain', name: 'domain', description: 'The domain of the schema: entities (properties, relations), enums', mimeType: 'application/json' },
	{ uri: 'lambdaorm://guide/expressions', name: 'expressions guide', description: 'The λORM query language: select, aggregations, include, functions, writes', mimeType: 'text/markdown' }
]

const TEMPLATES: ResourceTemplateDefinition[] = [
	{ uriTemplate: 'lambdaorm://entities/{entity}', name: 'entity', description: 'One entity of the domain with its properties and relations', mimeType: 'application/json' }
]

const ENTITY_URI = /^lambdaorm:\/\/entities\/([^/]+)$/

/** Opaque cursor of the paginated lists: the offset */
const paginate = <T>(items: T[], pageSize: number, cursor?: string): Page<T> => {
	// null too: undefined arguments cross a process channel as null
	const offset = cursor === undefined || cursor === null ? 0 : Number(Buffer.from(cursor, 'base64url').toString())
	if (!Number.isInteger(offset) || offset < 0 || offset > items.length) throw new McpRequestError(`invalid cursor "${cursor}"`)
	const page: Page<T> = { items: items.slice(offset, offset + pageSize) }
	if (offset + pageSize < items.length) page.nextCursor = Buffer.from(String(offset + pageSize)).toString('base64url')
	return page
}

/**
 * The MCP server of a schema over the gateway: the same operations (and authorization, audit, timeout) as REST.
 * Tools listed per credential, results cut at mcp.maxRows, errors of execution as isError for the model to correct.
 */
export class DataGatewayMcpServer implements McpServerPort {
	private domainText: string | undefined

	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly catalog: ToolCatalog,
		private readonly schema: OrmSchemaPort,
		private readonly settings: McpServerSettings
	) {}

	public info (): McpServerInfo {
		return {
			name: this.settings.name,
			version: this.settings.version,
			instructions: 'λORM data gateway of one schema. Query its domain with orm_execute using λORM lambda expressions ' +
				'(not SQL): read lambdaorm://guide/expressions first. The entities are in the description of orm_execute; in a ' +
				'large schema, find them with schema_search and read them with schema_describe.'
		}
	}

	/** Described once: the schema doesn't change while running */
	private get domain (): string {
		if (this.domainText === undefined) this.domainText = describeDomain(this.schema.domain())
		return this.domainText
	}

	public async listTools (ctx: RequestContext, cursor?: string): Promise<Page<ToolDefinition>> {
		const definitions = this.catalog.visible(ctx.principal).map(tool => tool.definition(ctx.principal, { domain: this.domain }))
		return paginate(definitions, this.settings.pageSize, cursor)
	}

	public async callTool (ctx: RequestContext, name: string, args: Record<string, unknown> | undefined): Promise<ToolResult> {
		const tool = this.catalog.find(ctx.principal, name)
		if (!tool) throw new McpRequestError(`unknown tool "${name}"`)
		const valid = validateArguments(name, tool.definition(ctx.principal, { domain: '' }).inputSchema, args)
		try {
			const result = await tool.execute(ctx, valid)
			return toolSuccess(tool.returnsRows ? limitRows(result, this.settings.maxRows) : result)
		} catch (error) {
			return toolError(error)
		}
	}

	public async listResources (ctx: RequestContext, cursor?: string): Promise<Page<ResourceDefinition>> {
		authorize(ctx.principal, 'schema')
		return paginate(RESOURCES, this.settings.pageSize, cursor)
	}

	public async listResourceTemplates (ctx: RequestContext): Promise<ResourceTemplateDefinition[]> {
		authorize(ctx.principal, 'schema')
		return TEMPLATES
	}

	public async readResource (ctx: RequestContext, uri: string): Promise<ResourceContent> {
		authorize(ctx.principal, 'schema')
		if (uri === 'lambdaorm://guide/expressions') return { uri, mimeType: 'text/markdown', text: EXPRESSIONS_GUIDE }
		if (uri === 'lambdaorm://schema/domain') return { uri, mimeType: 'application/json', text: JSON.stringify(this.schema.domain()) }
		const match = ENTITY_URI.exec(uri)
		if (match) {
			const entity = this.schema.entity(decodeURIComponent(match[1]))
			if (entity) return { uri, mimeType: 'application/json', text: JSON.stringify(entity) }
		}
		throw new McpRequestError(`unknown resource "${uri}"`)
	}
}
