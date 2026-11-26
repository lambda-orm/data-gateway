import { CONTEXT_FREE_OPERATIONS, DataChangeSummary, GATEWAY_OPERATIONS, MCP_OPERATIONS } from '../../domain/runtime/channelProtocol'
import { RoleGrantsPort } from '../auth/roleCatalog'
import { TransportName } from '../../domain/config/dataGatewayConfig'
import { SchemaState } from '../../domain/runtime/policies'
import { WorkspaceChange } from '../../domain/runtime/workspaces'
import { DataGatewayPort, RequestContext } from '../ports/input/dataGatewayPort'
import { CommandOperation } from '../../domain/runtime/channelProtocol'
import { McpServerPort } from '../ports/input/mcpServerPort'
import { GatewayHealth, SchemaDirectoryPort, ServedSchema } from '../ports/input/schemaDirectoryPort'
import { AuthenticatorPort, ClockPort, QueueOutcome } from '../ports/output/supportPorts'
import { Listeners } from './listeners'

export interface InlineSchema {
	path: string
	workspace?: string
	commands?: { run (ctx: RequestContext, op: CommandOperation, args: unknown[]): Promise<unknown> }
	gateway: DataGatewayPort
	mcp: McpServerPort
	transports: TransportName[]
	authenticators: Partial<Record<TransportName, AuthenticatorPort>>
	features?: { scripts: boolean }
	/** Where its queue reports the end of background executions */
	queueOutcomes?: Listeners<QueueOutcome>
	/** Where its writes through λORM are told (docs/SUBSCRIPTIONS.md) */
	dataChanges?: Listeners<DataChangeSummary[]>
}

/**
 * Schemas in the same thread as the transports (no workers): tests, and transports wired straight to the facade.
 * Every schema is ready; there is nobody to restart. add / remove change the set (tests of the transports).
 */
export class InlineSchemaDirectory implements SchemaDirectoryPort {
	private served: ServedSchema[]
	private readonly started: string
	private readonly schemasChanges = new Listeners<void>()
	private readonly workspaceChanges = new Listeners<WorkspaceChange>()

	constructor (schemas: InlineSchema[], private readonly clock: ClockPort, private readonly gatewayVersion: string) {
		this.started = clock.now().toISOString()
		this.served = schemas.map(s => this.serve(s))
	}

	public add (schema: InlineSchema): void {
		this.served = [...this.served.filter(s => s.path !== schema.path), this.serve(schema)].sort((a, b) => a.path.localeCompare(b.path))
		this.schemasChanges.emit()
	}

	public remove (path: string): void {
		this.served = this.served.filter(s => s.path !== path)
		this.schemasChanges.emit()
	}

	public workspaceChanged (change: WorkspaceChange): void {
		this.workspaceChanges.emit(change)
	}

	public onSchemasChange (listener: () => void): () => void {
		return this.schemasChanges.subscribe(listener)
	}

	public onWorkspaceChange (listener: (change: WorkspaceChange) => void): () => void {
		return this.workspaceChanges.subscribe(listener)
	}

	/** the roles of who calls as they apply in each schema (docs/ROLE_SCOPES.md) */
	public grants?: RoleGrantsPort

	private granted (ctx: RequestContext, path: string): RequestContext {
		return this.grants ? { ...ctx, principal: { ...ctx.principal, grants: this.grants.grantsOf(ctx.principal, path) } } : ctx
	}

	private serve (s: InlineSchema): ServedSchema {
		// the facade and the MCP server, with the grants of who calls in this schema (looked up when called: a test may give
		// a partial one)
		const gateway: Record<string, unknown> = {}
		for (const op of GATEWAY_OPERATIONS) {
			gateway[op] = CONTEXT_FREE_OPERATIONS.includes(op)
				? (...args: unknown[]) => (s.gateway as any)[op](...args)
				: (ctx: RequestContext, ...args: unknown[]) => (s.gateway as any)[op](this.granted(ctx, s.path), ...args)
		}
		const mcp: Record<string, unknown> = { info: () => s.mcp.info() }
		for (const op of MCP_OPERATIONS) mcp[op] = (ctx: RequestContext, ...args: unknown[]) => (s.mcp as any)[op](this.granted(ctx, s.path), ...args)
		return {
			path: s.path,
			workspace: s.workspace,
			commands: s.commands ? (ctx, op, args) => s.commands!.run(this.granted(ctx, s.path), op, args) : undefined,
			gateway: gateway as unknown as DataGatewayPort,
			mcp: mcp as unknown as McpServerPort,
			features: s.features ?? { scripts: false },
			onQueueOutcome: listener => s.queueOutcomes?.subscribe(listener) ?? (() => undefined),
			onDataChange: listener => s.dataChanges?.subscribe(listener) ?? (() => undefined),
			exposedOn: transport => s.transports.includes(transport),
			authenticator: transport => {
				const authenticator = s.authenticators[transport]
				if (!authenticator) throw new Error(`schema "${s.path}" has no authenticator for ${transport}`)
				return authenticator
			}
		}
	}

	public schemas (): ServedSchema[] {
		return this.served
	}

	public states (): SchemaState[] {
		return this.served.map(s => ({ path: s.path, status: 'ready', since: this.started, restarts: 0 }))
	}

	public async health (): Promise<GatewayHealth> {
		return { message: 'OK', time: this.clock.now().toISOString(), uptime: this.clock.uptimeSeconds(), schemas: this.states() }
	}

	/** Inline schemas are always ready */
	public onStateChange (): () => void {
		return () => undefined
	}

	public version () {
		return { version: this.gatewayVersion }
	}
}
