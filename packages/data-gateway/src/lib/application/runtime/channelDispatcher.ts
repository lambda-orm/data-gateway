import { principal } from '../../domain/auth/principal'
import { GatewayError } from '../../domain/errors/gatewayError'
import {
	ChannelRequest, ChannelResponse, COMMAND_OPERATIONS, CommandOperation, CONTEXT_FREE_OPERATIONS, GATEWAY_OPERATIONS, MCP_OPERATIONS, WireError
} from '../../domain/runtime/channelProtocol'
import { DataGatewayPort, RequestContext } from '../ports/input/dataGatewayPort'
import { McpServerPort } from '../ports/input/mcpServerPort'
import { LoggerPort, NO_TRACING, TracingPort } from '../ports/output/supportPorts'

export const responseTooLarge = (bytes: number, max: number): GatewayError =>
	new GatewayError(413, 'ResponseTooLargeError', `the result has ${bytes} bytes, more than server.maxResponseBytes (${max}): use .page(1, n), aggregate in the query or filter more`)

const encoder = new TextEncoder()

/**
 * The schema worker's side of the channel: runs an operation of the edge on the real facade or MCP server and
 * answers with the result already serialized (bytes, transferable without a copy) or a wire error. Only the
 * operations of the ports are callable; a request past its deadline is skipped (nobody waits for it).
 */
export class ChannelDispatcher {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly gateway: DataGatewayPort,
		private readonly mcp: McpServerPort,
		private readonly maxResponseBytes: number,
		private readonly logger: LoggerPort,
		/** runtime.metrics: this worker's metrics, for the edge to aggregate */
		private readonly metrics?: () => Promise<unknown>,
		/** the commands of the workspace (admin) */
		private readonly commands?: { run (ctx: RequestContext, op: CommandOperation, args: unknown[]): Promise<unknown> },
		/** the trace of the edge: what the worker does is part of it */
		private readonly tracing: TracingPort = NO_TRACING
	) {}

	public async dispatch (request: ChannelRequest): Promise<ChannelResponse | undefined> {
		if (Date.now() > request.deadline) return undefined
		try {
			const result = await this.tracing.within(request.trace, () => this.run(request))
			if (result === undefined) return { type: 'response', id: request.id }
			const json = encoder.encode(JSON.stringify(result))
			if (this.maxResponseBytes > 0 && json.byteLength > this.maxResponseBytes) throw responseTooLarge(json.byteLength, this.maxResponseBytes)
			return { type: 'response', id: request.id, json }
		} catch (error: any) {
			return { type: 'response', id: request.id, error: this.wire(error) }
		}
	}

	private wire (error: any): WireError {
		const wire: WireError = { name: error?.name ?? 'Error', message: error?.message ?? String(error) }
		const status = error?.status ?? error?.statusCode
		if (Number.isInteger(status)) wire.status = status
		if (error?.code !== undefined && error?.code !== null) wire.code = String(error.code)
		if (Array.isArray(error?.suggestions) && error.suggestions.length > 0) wire.suggestions = error.suggestions
		const thrown = error?.value
		if (thrown && typeof thrown === 'object') {
			wire.value = {}
			if (Number.isInteger(thrown.status)) wire.value.status = thrown.status
			if (typeof thrown.message === 'string') wire.value.message = thrown.message
			if (thrown.code !== undefined && thrown.code !== null) wire.value.code = String(thrown.code)
		}
		if (!(error instanceof GatewayError) && wire.status === undefined && !wire.code && !wire.value) this.logger.error(error)
		return wire
	}

	private run (request: ChannelRequest): Promise<unknown> {
		const ctx: RequestContext | undefined = request.principal
			? { principal: principal(request.principal.name, request.principal.permissions, request.principal.actor), transport: request.transport }
			: undefined
		if (request.target === 'gateway' && (GATEWAY_OPERATIONS as readonly string[]).includes(request.op)) {
			const method = (this.gateway as any)[request.op] as (...args: unknown[]) => Promise<unknown>
			if (CONTEXT_FREE_OPERATIONS.includes(request.op)) return method.apply(this.gateway, request.args)
			if (!ctx) throw new GatewayError(401, 'UnauthorizedError', 'the operation needs a principal')
			return method.apply(this.gateway, [ctx, ...request.args])
		}
		if (request.target === 'mcp' && (MCP_OPERATIONS as readonly string[]).includes(request.op)) {
			if (!ctx) throw new GatewayError(401, 'UnauthorizedError', 'the operation needs a principal')
			const method = (this.mcp as any)[request.op] as (...args: unknown[]) => Promise<unknown>
			return method.apply(this.mcp, [ctx, ...request.args])
		}
		if (request.target === 'runtime' && request.op === 'metrics') return this.metrics ? this.metrics() : Promise.resolve([])
		if (request.target === 'commands' && this.commands && (COMMAND_OPERATIONS as readonly string[]).includes(request.op)) {
			if (!ctx) throw new GatewayError(401, 'UnauthorizedError', 'the operation needs a principal')
			return this.commands.run(ctx, request.op as CommandOperation, request.args)
		}
		throw new GatewayError(400, 'ChannelError', `unknown operation ${request.target}.${request.op}`)
	}
}
