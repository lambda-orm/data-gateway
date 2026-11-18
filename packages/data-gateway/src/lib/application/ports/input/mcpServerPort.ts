import {
	Page, ResourceContent, ResourceDefinition, ResourceTemplateDefinition, ToolDefinition, ToolResult
} from '../../../domain/mcp/mcpTypes'
import { RequestContext } from './dataGatewayPort'

export interface McpServerInfo {
	name: string
	version: string
	/** What the server is for, sent in initialize: the client gives it to the model */
	instructions: string
}

/**
 * The MCP server of one schema, independent of the protocol: the MCP transports (Streamable HTTP, SSE, WebSocket)
 * translate JSON-RPC to these calls. Unknown tools / resources and invalid arguments throw McpRequestError.
 */
export interface McpServerPort {
	info (): McpServerInfo
	listTools (ctx: RequestContext, cursor?: string): Promise<Page<ToolDefinition>>
	callTool (ctx: RequestContext, name: string, args: Record<string, unknown> | undefined): Promise<ToolResult>
	listResources (ctx: RequestContext, cursor?: string): Promise<Page<ResourceDefinition>>
	listResourceTemplates (ctx: RequestContext): Promise<ResourceTemplateDefinition[]>
	readResource (ctx: RequestContext, uri: string): Promise<ResourceContent>
}
