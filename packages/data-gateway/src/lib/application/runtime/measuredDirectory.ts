import { CONTEXT_FREE_OPERATIONS, GATEWAY_OPERATIONS, MCP_OPERATIONS } from '../../domain/runtime/channelProtocol'
import { SchemaState } from '../../domain/runtime/policies'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { GatewayHealth, SchemaDirectoryPort, ServedSchema } from '../ports/input/schemaDirectoryPort'
import { MetricsPort } from '../ports/output/supportPorts'

const statusOf = (error: any): number => Number.isInteger(error?.status) ? error.status : 500

const PERMISSION = /does not have the "([a-zA-Z]+)" permission/

/**
 * The schemas with every operation measured, whatever the transport: requests and their duration by transport /
 * schema / method / status / credential, forbidden (with the missing permission) and throttled (429). The transports
 * see the same ports; only the composition root knows they are measured.
 */
export class MeasuredSchemaDirectory implements SchemaDirectoryPort {
	private readonly served: ServedSchema[]

	constructor (private readonly directory: SchemaDirectoryPort, private readonly metrics: MetricsPort, private readonly now: () => number = () => performance.now()) {
		this.served = directory.schemas().map(schema => this.measure(schema))
		metrics.gauge('data_gateway_schema_status', 'State of each schema (1 for its current status)', ['schema', 'status'],
			() => directory.states().map(s => ({ labels: { schema: s.path || '/', status: s.status }, value: 1 })))
		metrics.gauge('data_gateway_schema_restarts', 'Restarts of the worker of each schema', ['schema'],
			() => directory.states().map(s => ({ labels: { schema: s.path || '/' }, value: s.restarts })))
	}

	public schemas (): ServedSchema[] { return this.served }
	public states (): SchemaState[] { return this.directory.states() }
	public health (): Promise<GatewayHealth> { return this.directory.health() }
	public version () { return this.directory.version() }
	public onStateChange (listener: (state: SchemaState) => void) { return this.directory.onStateChange(listener) }

	private measure (schema: ServedSchema): ServedSchema {
		const wrap = (target: any, operations: readonly string[], prefix: string) => {
			if (target === undefined || target === null) return target
			const measured: Record<string, unknown> = Object.create(target)
			for (const op of operations) {
				const original = target[op]
				if (typeof original !== 'function') continue
				const withContext = !CONTEXT_FREE_OPERATIONS.includes(op) || prefix === 'mcp.'
				measured[op] = async (...args: unknown[]) => {
					const ctx = withContext ? args[0] as RequestContext | undefined : undefined
					const started = this.now()
					const record = (status: number) => this.metrics.operation({
						transport: ctx?.transport ?? '-',
						schema: schema.path || '/',
						method: prefix + op,
						status,
						credential: ctx?.principal?.name ?? '-',
						seconds: (this.now() - started) / 1000
					})
					try {
						const result = await original.apply(target, args)
						// a tool call that failed for the model is still a 200 of the transport
						record(200)
						return result
					} catch (error: any) {
						const status = statusOf(error)
						record(status)
						if (status === 403 && ctx) this.metrics.forbidden(ctx.principal.name, PERMISSION.exec(error?.message ?? '')?.[1] ?? '-')
						if (status === 429) this.metrics.throttled(schema.path || '/', ctx?.transport ?? '-')
						throw error
					}
				}
			}
			return measured
		}
		return {
			...schema,
			exposedOn: transport => schema.exposedOn(transport),
			authenticator: transport => schema.authenticator(transport),
			onQueueOutcome: listener => schema.onQueueOutcome(listener),
			gateway: wrap(schema.gateway, GATEWAY_OPERATIONS, '') as any,
			mcp: wrap(schema.mcp, MCP_OPERATIONS, 'mcp.') as any
		}
	}
}
