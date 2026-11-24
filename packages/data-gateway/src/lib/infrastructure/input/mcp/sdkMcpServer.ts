import { requestTracer } from '../telemetry/requestTracer'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
	CallToolRequestSchema, ErrorCode, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema,
	McpError, ReadResourceRequestSchema, SubscribeRequestSchema, UnsubscribeRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { RequestContext } from '../../../application/ports/input/dataGatewayPort'
import { McpServerPort } from '../../../application/ports/input/mcpServerPort'
import { GatewayError, McpRequestError } from '../../../domain/errors/gatewayError'
import { LoggerPort } from '../../../application/ports/output/supportPorts'

/** A failure outside a tool call: JSON-RPC error. Request problems are invalid params; the rest, internal errors. */
const toMcpError = (error: unknown, logger: LoggerPort): McpError => {
	if (error instanceof McpError) return error
	if (error instanceof McpRequestError) return new McpError(ErrorCode.InvalidParams, error.message)
	if (error instanceof GatewayError) return new McpError(ErrorCode.InvalidRequest, `${error.name}: ${error.message}`)
	logger.error(error as Error)
	return new McpError(ErrorCode.InternalError, (error as any)?.message ?? String(error))
}

/**
 * An MCP SDK Server bound to the McpServerPort for one caller: created per request (stateless Streamable HTTP) or per
 * connection (SSE, WebSocket, stateful sessions), so the tools listed are those of that credential.
 */
export const createSdkServer = (port: McpServerPort, ctx: RequestContext, logger: LoggerPort): Server => {
	const info = port.info()
	const server = new Server(
		{ name: info.name, version: info.version },
		{ capabilities: { tools: { listChanged: false }, resources: { subscribe: true, listChanged: false } }, instructions: info.instructions }
	)
	const guard = async <T>(run: () => Promise<T>): Promise<T> => {
		try {
			return await run()
		} catch (error) {
			throw toMcpError(error, logger)
		}
	}
	server.setRequestHandler(ListToolsRequestSchema, request => guard(async () => {
		const page = await port.listTools(ctx, request.params?.cursor)
		return { tools: page.items as any[], nextCursor: page.nextCursor }
	}))
	// a span per call (MCP over HTTP or WebSocket), child of the traceparent of its _meta if it brings one
	const traced = <T>(method: string, attributes: Record<string, string>, meta: unknown, run: () => Promise<T>): Promise<T> =>
		requestTracer.call(attributes['gen_ai.tool.name'] ? `${method} ${attributes['gen_ai.tool.name']}` : method,
			{ 'mcp.method.name': method, 'enduser.id': ctx.principal.name, ...attributes }, meta as Record<string, unknown> | undefined, run)
	server.setRequestHandler(CallToolRequestSchema, request => guard(() => traced('tools/call',
		{ 'gen_ai.tool.name': request.params.name, 'gen_ai.operation.name': 'execute_tool' }, request.params._meta,
		async () => await port.callTool(ctx, request.params.name, request.params.arguments) as any)))
	server.setRequestHandler(ListResourcesRequestSchema, request => guard(async () => {
		const page = await port.listResources(ctx, request.params?.cursor)
		return { resources: page.items, nextCursor: page.nextCursor }
	}))
	server.setRequestHandler(ListResourceTemplatesRequestSchema, () => guard(async () =>
		({ resourceTemplates: await port.listResourceTemplates(ctx) })))
	server.setRequestHandler(ReadResourceRequestSchema, request => guard(() => traced('resources/read',
		{ 'mcp.resource.uri': request.params.uri }, request.params._meta,
		async () => ({ contents: [await port.readResource(ctx, request.params.uri)] }))))
	// the schema doesn't change while running: nothing to notify
	server.setRequestHandler(SubscribeRequestSchema, async () => ({}))
	server.setRequestHandler(UnsubscribeRequestSchema, async () => ({}))
	return server
}
