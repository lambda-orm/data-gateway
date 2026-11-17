import { TransportName } from '../../domain/config/dataGatewayConfig'
import { GatewayError, timeout, unavailable } from '../../domain/errors/gatewayError'
import { CONTEXT_FREE_OPERATIONS, GATEWAY_OPERATIONS, MCP_OPERATIONS } from '../../domain/runtime/channelProtocol'
import { SchemaState } from '../../domain/runtime/policies'
import { DataGatewayPort, RequestContext } from '../ports/input/dataGatewayPort'
import { McpServerInfo, McpServerPort } from '../ports/input/mcpServerPort'
import { GatewayHealth, SchemaDirectoryPort, ServedSchema } from '../ports/input/schemaDirectoryPort'
import { SchemaChannelPort } from '../ports/output/runtimePorts'
import { AuthenticatorPort, ClockPort } from '../ports/output/supportPorts'
import { toolError } from '../mcp/resultSerializer'

/** What the edge knows of a schema, fixed at start */
export interface RoutedSchemaSettings {
	path: string
	transports: TransportName[]
	/** 0 = no limit */
	maxConcurrent: number
	timeout: number
	authenticators: Partial<Record<TransportName, AuthenticatorPort>>
	scriptsEnabled?: boolean
}

export const tooManyRequests = (path: string, max: number): GatewayError =>
	new GatewayError(429, 'TooManyRequestsError', `schema "${path || '/'}" has ${max} operations in flight (server.maxConcurrent): retry later`)

const schemaUnavailable = (state: SchemaState): GatewayError =>
	unavailable('SchemaUnavailableError', `schema "${state.path || '/'}" is ${state.status}${state.reason ? `: ${state.reason}` : ''}`)

/** Margin over server.timeout for the channel: the worker answers its own 504 first */
const CHANNEL_MARGIN_MS = 2000

class RoutedSchema {
	public state: SchemaState
	public channel: SchemaChannelPort | undefined
	public info: McpServerInfo | undefined
	public inFlight = 0

	constructor (public readonly settings: RoutedSchemaSettings, now: string) {
		this.state = { path: settings.path, status: 'starting', since: now, restarts: 0 }
	}
}

/**
 * The edge's view of the schema workers: route → channel, state and limits. Answers 503 while a schema is not ready,
 * 429 over its maxConcurrent, 504 when its worker doesn't answer in time. The transports see DataGatewayPort and
 * McpServerPort proxies and don't know there are threads in between.
 */
export class SchemaRouter implements SchemaDirectoryPort {
	private readonly routes = new Map<string, RoutedSchema>()
	private readonly served: ServedSchema[]

	constructor (settings: RoutedSchemaSettings[], private readonly clock: ClockPort, private readonly gatewayVersion: string) {
		for (const s of settings) this.routes.set(s.path, new RoutedSchema(s, clock.now().toISOString()))
		this.served = settings.map(s => this.serve(s.path))
	}

	public schemas (): ServedSchema[] {
		return this.served
	}

	public states (): SchemaState[] {
		return [...this.routes.values()].map(r => ({ ...r.state }))
	}

	public version () {
		return { version: this.gatewayVersion }
	}

	public async health (): Promise<GatewayHealth> {
		const schemas = this.states()
		return {
			message: schemas.every(s => s.status === 'ready') ? 'OK' : 'DEGRADED',
			time: this.clock.now().toISOString(),
			uptime: this.clock.uptimeSeconds(),
			schemas
		}
	}

	/** A new channel to the (re)started worker of a schema */
	public connect (path: string, channel: SchemaChannelPort, info: McpServerInfo): void {
		const route = this.route(path)
		route.channel?.close()
		route.channel = channel
		route.info = info
	}

	public setState (state: SchemaState): void {
		const route = this.route(state.path)
		route.state = { ...state }
		if (state.status !== 'ready') {
			route.channel?.close()
			route.channel = undefined
		}
	}

	public closeAll (): void {
		for (const route of this.routes.values()) route.channel?.close()
	}

	private route (path: string): RoutedSchema {
		const route = this.routes.get(path)
		if (!route) throw new Error(`unknown schema "${path}"`)
		return route
	}

	/** One operation on a schema worker, with the state, concurrency and deadline rules */
	public async call (path: string, target: 'gateway' | 'mcp', op: string, args: unknown[], ctx: RequestContext | undefined): Promise<unknown> {
		const route = this.route(path)
		if (route.state.status !== 'ready' || !route.channel) throw schemaUnavailable(route.state)
		const max = route.settings.maxConcurrent
		if (max > 0 && route.inFlight >= max) throw tooManyRequests(path, max)
		route.inFlight++
		const waitMs = route.settings.timeout + CHANNEL_MARGIN_MS
		let timer: ReturnType<typeof setTimeout> | undefined
		try {
			return await Promise.race([
				route.channel.request({
					target,
					op,
					args,
					principal: ctx ? { name: ctx.principal.name, permissions: [...ctx.principal.permissions] } : undefined,
					transport: ctx?.transport ?? 'edge',
					deadline: Date.now() + waitMs
				}),
				new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(timeout(route.settings.timeout)), waitMs) })
			])
		} finally {
			if (timer) clearTimeout(timer)
			route.inFlight--
		}
	}

	private serve (path: string): ServedSchema {
		const gateway: Record<string, unknown> = {}
		for (const op of GATEWAY_OPERATIONS) {
			gateway[op] = CONTEXT_FREE_OPERATIONS.includes(op)
				? (...args: unknown[]) => this.call(path, 'gateway', op, args, undefined)
				: (ctx: RequestContext, ...args: unknown[]) => this.call(path, 'gateway', op, args, ctx)
		}
		const mcp: Record<string, unknown> = {
			info: (): McpServerInfo => {
				const route = this.route(path)
				if (!route.info) throw schemaUnavailable(route.state)
				return route.info
			}
		}
		for (const op of MCP_OPERATIONS) mcp[op] = (ctx: RequestContext, ...args: unknown[]) => this.call(path, 'mcp', op, args, ctx)
		// a tool call that can't run now (busy, slow) is an error the model can read; a schema down is a JSON-RPC error
		const callTool = mcp.callTool as (...args: unknown[]) => Promise<unknown>
		mcp.callTool = async (...args: unknown[]) => {
			try {
				return await callTool(...args)
			} catch (error) {
				if (error instanceof GatewayError && [429, 504].includes(error.status)) return toolError(error)
				throw error
			}
		}
		const settings = this.route(path).settings
		return {
			path,
			gateway: gateway as unknown as DataGatewayPort,
			mcp: mcp as unknown as McpServerPort,
			features: { scripts: settings.scriptsEnabled ?? false },
			exposedOn: transport => settings.transports.includes(transport),
			authenticator: transport => {
				const authenticator = settings.authenticators[transport]
				if (!authenticator) throw new Error(`schema "${path}" has no authenticator for ${transport}`)
				return authenticator
			}
		}
	}
}
