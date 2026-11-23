import { Permission } from '../../domain/auth/permission'
import { Principal } from '../../domain/auth/principal'
import { JsonSchema, ToolAnnotations, ToolDefinition } from '../../domain/mcp/mcpTypes'
import { DataGatewayPort, RequestContext } from '../ports/input/dataGatewayPort'

/** What a tool's description may use: the domain of the schema, already described for a model */
export interface ToolContext {
	domain: string
}

/** One MCP tool. The catalog lists the visible ones and calls them; the gateway authorizes every call again. */
export interface Tool {
	readonly name: string
	/** Results that are rows: mcp.maxRows applies */
	readonly returnsRows: boolean
	/** A credential sees the tool when it has any of these permissions (the model doesn't see what it can't use) */
	visibleTo (principal: Principal): boolean
	definition (principal: Principal, context: ToolContext): ToolDefinition
	execute (ctx: RequestContext, args: Record<string, unknown>): Promise<unknown>
}

export interface ToolSpec {
	name: string
	title: string
	/** The description; a function when it depends on the credential or the domain */
	description: string | ((principal: Principal, context: ToolContext) => string)
	properties?: Record<string, JsonSchema>
	required?: string[]
	/** Any of them makes the tool visible */
	permissions: Permission[]
	annotations: ToolAnnotations | ((principal: Principal) => ToolAnnotations)
	returnsRows?: boolean
	run: (gateway: DataGatewayPort, ctx: RequestContext, args: Record<string, any>) => Promise<unknown>
}

/** A tool described by a ToolSpec, running against the DataGatewayPort (so with the same rules as REST) */
export class GatewayTool implements Tool {
	public readonly name: string
	public readonly returnsRows: boolean

	constructor (private readonly spec: ToolSpec, private readonly gateway: DataGatewayPort) {
		this.name = spec.name
		this.returnsRows = spec.returnsRows ?? false
	}

	public visibleTo (principal: Principal): boolean {
		return this.spec.permissions.some(permission => principal.permissions.has(permission))
	}

	public definition (principal: Principal, context: ToolContext): ToolDefinition {
		const { spec } = this
		const description = typeof spec.description === 'function' ? spec.description(principal, context) : spec.description
		const annotations = typeof spec.annotations === 'function' ? spec.annotations(principal) : spec.annotations
		return {
			name: spec.name,
			title: spec.title,
			description,
			inputSchema: { type: 'object', properties: spec.properties ?? {}, required: spec.required ?? [], additionalProperties: false },
			annotations: { title: spec.title, ...annotations }
		}
	}

	public execute (ctx: RequestContext, args: Record<string, unknown>): Promise<unknown> {
		return this.spec.run(this.gateway, ctx, args)
	}
}
