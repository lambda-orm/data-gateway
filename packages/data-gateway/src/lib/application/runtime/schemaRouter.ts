import { TransportName } from '../../domain/config/dataGatewayConfig'
import { GatewayError, timeout, unavailable } from '../../domain/errors/gatewayError'
import { CONTEXT_FREE_OPERATIONS, GATEWAY_OPERATIONS, MCP_OPERATIONS, DataChangeSummary } from '../../domain/runtime/channelProtocol'
import { SchemaState } from '../../domain/runtime/policies'
import { WorkspaceChange } from '../../domain/runtime/workspaces'
import { DataGatewayPort, RequestContext } from '../ports/input/dataGatewayPort'
import { McpServerInfo, McpServerPort } from '../ports/input/mcpServerPort'
import { GatewayHealth, SchemaDirectoryPort, ServedSchema } from '../ports/input/schemaDirectoryPort'
import { SchemaChannelPort } from '../ports/output/runtimePorts'
import { AuthenticatorPort, ClockPort, QueueOutcome, NO_TRACING, TracingPort } from '../ports/output/supportPorts'
import { Listeners } from './listeners'
import { toolError } from '../mcp/resultSerializer'

/** What the edge knows of a schema, fixed when it is added */
export interface RoutedSchemaSettings {
	path: string
	workspace?: string
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
	public readonly queueOutcomes = new Listeners<QueueOutcome>()
	public readonly dataChanges = new Listeners<DataChangeSummary[]>()

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
	private served: ServedSchema[] = []
	private readonly stateChanges = new Listeners<SchemaState>()
	private readonly schemasChanges = new Listeners<void>()
	private readonly workspaceChanges = new Listeners<WorkspaceChange>()

	constructor (settings: RoutedSchemaSettings[], private readonly clock: ClockPort, private readonly gatewayVersion: string,
		private readonly tracing: TracingPort = NO_TRACING) {
		for (const s of settings) this.routes.set(s.path, new RoutedSchema(s, clock.now().toISOString()))
		this.serveAll()
	}

	private serveAll (): void {
		this.served = [...this.routes.keys()].sort().map(path => this.serve(path))
	}

	/** A schema that appeared (a new workspace): starting until its worker connects */
	public add (settings: RoutedSchemaSettings): void {
		if (this.routes.has(settings.path)) return
		this.routes.set(settings.path, new RoutedSchema(settings, this.clock.now().toISOString()))
		this.serveAll()
		this.schemasChanges.emit()
	}

	/** A schema that went: its requests in flight end with their channel, the next ones are 404 */
	public remove (path: string): void {
		const route = this.routes.get(path)
		if (!route) return
		route.channel?.close()
		this.routes.delete(path)
		this.serveAll()
		this.schemasChanges.emit()
	}

	public onSchemasChange (listener: () => void): () => void {
		return this.schemasChanges.subscribe(listener)
	}

	public onWorkspaceChange (listener: (change: WorkspaceChange) => void): () => void {
		return this.workspaceChanges.subscribe(listener)
	}

	/** the versions of the lambdaORM.yaml that the administration wrote and announced (with who), by their hash */
	private readonly announced = new Map<string, number>()

	/**
	 * A change of a workspace, to the IDEs. One of the administration comes with who and what; the monitor sees the same
	 * file a moment later: that second one is not announced again. One from outside (an editor, git) goes as it comes.
	 */
	public workspaceChanged (change: WorkspaceChange): void {
		const now = Date.now()
		for (const [version, at] of this.announced) if (now - at > 60000) this.announced.delete(version)
		if (change.change?.version) {
			this.announced.set(change.change.version, now)
		} else if (change.kind === 'schema' && change.version && this.announced.delete(change.version.slice(0, 16))) {
			return
		}
		this.workspaceChanges.emit(change)
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
		const route = this.routes.get(path)
		if (!route) {
			channel.close()
			return
		}
		// a reload: the requests in flight on the old channel finish there, the new ones go to the new worker
		const old = route.channel
		if (old) setTimeout(() => old.close(), route.settings.timeout + CHANNEL_MARGIN_MS).unref?.()
		route.channel = channel
		route.info = info
		channel.onEvent(event => {
			if (event.event === 'queue') route.queueOutcomes.emit(event.outcome)
			else if (event.event === 'data') route.dataChanges.emit(event.changes)
		})
	}

	public onStateChange (listener: (state: SchemaState) => void): () => void {
		return this.stateChanges.subscribe(listener)
	}

	public setState (state: SchemaState): void {
		const route = this.routes.get(state.path)
		// a state that arrives after the schema was removed
		if (!route) return
		const changed = route.state.status !== state.status || route.state.pending !== state.pending
		route.state = { ...state }
		if (state.status !== 'ready') {
			route.channel?.close()
			route.channel = undefined
		}
		if (changed) this.stateChanges.emit({ ...state })
	}

	public closeAll (): void {
		for (const route of this.routes.values()) route.channel?.close()
	}

	private route (path: string): RoutedSchema {
		const route = this.routes.get(path)
		if (!route) throw new Error(`unknown schema "${path}"`)
		return route
	}

	/** The metrics of a schema worker (JSON of its registry); [] when it isn't ready */
	public async workerMetrics (path: string): Promise<unknown[]> {
		const route = this.route(path)
		if (route.state.status !== 'ready' || !route.channel) return []
		const result = await route.channel.request({ target: 'runtime', op: 'metrics', args: [], transport: 'edge', deadline: Date.now() + 5000 })
		return Array.isArray(result) ? result : []
	}

	/** One operation on a schema worker, with the state, concurrency and deadline rules */
	public async call (path: string, target: 'gateway' | 'mcp' | 'runtime' | 'commands', op: string, args: unknown[], ctx: RequestContext | undefined, timeoutMs?: number): Promise<unknown> {
		const route = this.route(path)
		if (route.state.status !== 'ready' || !route.channel) throw schemaUnavailable(route.state)
		const max = route.settings.maxConcurrent
		if (max > 0 && route.inFlight >= max) throw tooManyRequests(path, max)
		route.inFlight++
		const limit = timeoutMs ?? route.settings.timeout
		const waitMs = limit + CHANNEL_MARGIN_MS
		let timer: ReturnType<typeof setTimeout> | undefined
		try {
			return await Promise.race([
				route.channel.request({
					target,
					op,
					args,
					principal: ctx ? { name: ctx.principal.name, permissions: [...ctx.principal.permissions], actor: ctx.principal.actor, ...(ctx.principal.context ? { context: ctx.principal.context } : {}), ...(ctx.principal.view ? { view: ctx.principal.view } : {}) } : undefined,
					transport: ctx?.transport ?? 'edge',
					deadline: Date.now() + waitMs,
					trace: this.tracing.carrier()
				}),
				new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(timeout(limit)), waitMs) })
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
			workspace: settings.workspace,
			commands: (ctx, op, args, timeoutMs) => this.call(path, 'commands', op, args, ctx, timeoutMs),
			gateway: gateway as unknown as DataGatewayPort,
			mcp: mcp as unknown as McpServerPort,
			features: { scripts: settings.scriptsEnabled ?? false },
			onQueueOutcome: listener => this.route(path).queueOutcomes.subscribe(listener),
			onDataChange: listener => this.route(path).dataChanges.subscribe(listener),
			exposedOn: transport => settings.transports.includes(transport),
			authenticator: transport => {
				const authenticator = settings.authenticators[transport]
				if (!authenticator) throw new Error(`schema "${path}" has no authenticator for ${transport}`)
				return authenticator
			}
		}
	}
}
