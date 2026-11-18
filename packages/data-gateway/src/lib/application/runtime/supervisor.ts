import { HeartbeatPolicy, RestartPolicy, SchemaState, SchemaStatus } from '../../domain/runtime/policies'
import { McpServerInfo } from '../ports/input/mcpServerPort'
import { EdgeHandle, EdgeRuntimePort, SchemaRuntimePort, SchemaWorkerSpec, WorkerHandle } from '../ports/output/runtimePorts'
import { ClockPort, LoggerPort } from '../ports/output/supportPorts'

interface Supervised {
	handle?: WorkerHandle
	lastPong: number
	attempt: number
	restartTimer?: ReturnType<typeof setTimeout>
}

interface SupervisedSchema extends Supervised {
	spec: SchemaWorkerSpec
	state: SchemaState
	info?: McpServerInfo
}

export interface SupervisorOptions {
	restart: RestartPolicy
	heartbeat: HeartbeatPolicy
	/** How long the edge and the workers get to finish on shutdown */
	graceMs: number
}

/**
 * Starts a worker per schema and the edge, connects them, broadcasts the state of each schema to the edge, pings them
 * (heartbeat) and restarts the one that doesn't start, falls or hangs, with a growing wait. It never stops the
 * process because of a schema, and is not in the path of the data (the edge talks to each schema directly).
 */
export class Supervisor {
	private readonly schemas = new Map<string, SupervisedSchema>()
	private readonly edge: Supervised = { lastPong: 0, attempt: 0 }
	private heartbeatTimer: ReturnType<typeof setInterval> | undefined
	private stopping = false

	constructor (
		specs: SchemaWorkerSpec[],
		private readonly schemaRuntime: SchemaRuntimePort,
		private readonly edgeRuntime: EdgeRuntimePort,
		private readonly options: SupervisorOptions,
		private readonly clock: ClockPort,
		private readonly logger: LoggerPort
	) {
		for (const spec of specs) {
			const path = spec.descriptor.path
			this.schemas.set(path, { spec, lastPong: 0, attempt: 0, state: { path, status: 'starting', since: this.now(), restarts: 0 } })
		}
	}

	public start (): void {
		for (const schema of this.schemas.values()) this.startSchema(schema)
		this.startEdge()
		this.heartbeatTimer = setInterval(() => this.beat(), this.options.heartbeat.intervalMs)
	}

	public states (): SchemaState[] {
		return [...this.schemas.values()].map(s => ({ ...s.state }))
	}

	/** The edge first (it stops taking requests and finishes the ones in flight), then the schemas */
	public async stop (): Promise<void> {
		this.stopping = true
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
		for (const s of [this.edge, ...this.schemas.values()]) if (s.restartTimer) clearTimeout(s.restartTimer)
		await this.edge.handle?.stop(this.options.graceMs).catch(error => this.logger.error(error))
		await Promise.all([...this.schemas.values()].map(async schema => {
			await schema.handle?.stop(this.options.graceMs).catch(error => this.logger.error(error))
			this.setState(schema, 'stopped')
		}))
	}

	private now (): string {
		return this.clock.now().toISOString()
	}

	private setState (schema: SupervisedSchema, status: SchemaStatus, reason?: string): void {
		const restarts = schema.state.restarts + (status === 'restarting' ? 1 : 0)
		schema.state = { path: schema.state.path, status, reason, since: this.now(), restarts }
		if (reason) this.logger.warn(`[data-gateway] schema "${schema.state.path || '/'}" ${status}: ${reason}`)
		else this.logger.info(`[data-gateway] schema "${schema.state.path || '/'}" ${status}`)
		if (this.edge.handle) (this.edge.handle as EdgeHandle).state(schema.state)
	}

	// ─── schemas ─────────────────────────────────────────────────────────────

	private startSchema (schema: SupervisedSchema): void {
		if (this.stopping) return
		schema.lastPong = this.clock.now().getTime()
		const handle: WorkerHandle = this.schemaRuntime.start(schema.spec, {
			ready: info => {
				if (schema.handle !== handle) return
				schema.attempt = 0
				schema.info = info
				this.setState(schema, 'ready')
				if (this.edge.handle && info) (this.edge.handle as EdgeHandle).connect(schema.state.path, handle, info)
			},
			failed: reason => {
				if (schema.handle !== handle) return
				schema.handle = undefined
				this.setState(schema, 'error', reason)
				this.scheduleSchema(schema)
			},
			exited: reason => {
				if (schema.handle !== handle || this.stopping) return
				schema.handle = undefined
				this.setState(schema, 'restarting', reason)
				this.scheduleSchema(schema)
			},
			pong: () => { schema.lastPong = this.clock.now().getTime() }
		})
		schema.handle = handle
	}

	private scheduleSchema (schema: SupervisedSchema): void {
		if (this.stopping) return
		const delay = this.options.restart.delay(schema.attempt++)
		schema.restartTimer = setTimeout(() => {
			schema.restartTimer = undefined
			if (schema.state.status !== 'error') this.setState(schema, 'starting')
			this.startSchema(schema)
		}, delay)
	}

	// ─── edge ────────────────────────────────────────────────────────────────

	private startEdge (): void {
		if (this.stopping) return
		this.edge.lastPong = this.clock.now().getTime()
		const handle = this.edgeRuntime.start({
			ready: () => {
				if (this.edge.handle !== handle) return
				this.edge.attempt = 0
				this.logger.info('[data-gateway] edge ready')
			},
			failed: reason => this.edgeDown(handle, `edge did not start: ${reason}`),
			exited: reason => this.edgeDown(handle, `edge exited: ${reason}`),
			pong: () => { this.edge.lastPong = this.clock.now().getTime() }
		})
		this.edge.handle = handle
		// a new edge learns every state and gets a channel to every ready schema
		for (const schema of this.schemas.values()) {
			handle.state(schema.state)
			if (schema.state.status === 'ready' && schema.handle && schema.info) handle.connect(schema.state.path, schema.handle, schema.info)
		}
	}

	private edgeDown (handle: EdgeHandle, reason: string): void {
		if (this.edge.handle !== handle || this.stopping) return
		this.edge.handle = undefined
		this.logger.error(`[data-gateway] ${reason}: restarting it (the schemas keep running)`)
		const delay = this.options.restart.delay(this.edge.attempt++)
		this.edge.restartTimer = setTimeout(() => {
			this.edge.restartTimer = undefined
			this.startEdge()
		}, delay)
	}

	// ─── heartbeat ───────────────────────────────────────────────────────────

	private beat (): void {
		const now = this.clock.now().getTime()
		const check = (supervised: Supervised, name: string) => {
			const handle = supervised.handle
			if (!handle) return
			if (this.options.heartbeat.isHung(supervised.lastPong, now)) {
				this.logger.error(`[data-gateway] ${name} did not answer the heartbeat in ${this.options.heartbeat.timeoutMs} ms: terminating it`)
				handle.terminate().catch(error => this.logger.error(error))
				return
			}
			handle.ping()
		}
		check(this.edge, 'edge')
		for (const schema of this.schemas.values()) check(schema, `schema "${schema.state.path || '/'}"`)
	}
}
