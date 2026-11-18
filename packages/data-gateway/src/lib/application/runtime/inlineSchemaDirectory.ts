import { TransportName } from '../../domain/config/dataGatewayConfig'
import { SchemaState } from '../../domain/runtime/policies'
import { DataGatewayPort } from '../ports/input/dataGatewayPort'
import { McpServerPort } from '../ports/input/mcpServerPort'
import { GatewayHealth, SchemaDirectoryPort, ServedSchema } from '../ports/input/schemaDirectoryPort'
import { AuthenticatorPort, ClockPort, QueueOutcome } from '../ports/output/supportPorts'
import { Listeners } from './listeners'

export interface InlineSchema {
	path: string
	gateway: DataGatewayPort
	mcp: McpServerPort
	transports: TransportName[]
	authenticators: Partial<Record<TransportName, AuthenticatorPort>>
	features?: { scripts: boolean }
	/** Where its queue reports the end of background executions */
	queueOutcomes?: Listeners<QueueOutcome>
}

/**
 * Schemas in the same thread as the transports (no workers): tests, and transports wired straight to the facade.
 * Every schema is ready; there is nobody to restart.
 */
export class InlineSchemaDirectory implements SchemaDirectoryPort {
	private readonly served: ServedSchema[]
	private readonly started: string

	constructor (schemas: InlineSchema[], private readonly clock: ClockPort, private readonly gatewayVersion: string) {
		this.started = clock.now().toISOString()
		this.served = schemas.map(s => ({
			path: s.path,
			gateway: s.gateway,
			mcp: s.mcp,
			features: s.features ?? { scripts: false },
			onQueueOutcome: listener => s.queueOutcomes?.subscribe(listener) ?? (() => undefined),
			exposedOn: transport => s.transports.includes(transport),
			authenticator: transport => {
				const authenticator = s.authenticators[transport]
				if (!authenticator) throw new Error(`schema "${s.path}" has no authenticator for ${transport}`)
				return authenticator
			}
		}))
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
