import { DataChangeSummary } from '../../domain/runtime/channelProtocol'
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

	private serve (s: InlineSchema): ServedSchema {
		return {
			path: s.path,
			workspace: s.workspace,
			commands: s.commands ? (ctx, op, args) => s.commands!.run(ctx, op, args) : undefined,
			gateway: s.gateway,
			mcp: s.mcp,
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
