import { HeartbeatPolicy, RestartPolicy, SchemaState, SchemaStatus } from '../../domain/runtime/policies'
import { McpServerInfo } from '../ports/input/mcpServerPort'
import { EdgeHandle, EdgeRuntimePort, SchemaRuntimePort, SchemaWorkerSpec, WorkerHandle } from '../ports/output/runtimePorts'
import { ClockPort, LoggerPort } from '../ports/output/supportPorts'
import { WorkspaceChange } from '../../domain/runtime/workspaces'

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
	/** A reload: the worker of the new version, starting while the current one keeps serving */
	candidate?: { handle: WorkerHandle, spec: SchemaWorkerSpec, lastPong: number }
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
 *
 * A schema can be added, removed and reloaded while the others serve (orm.watch). A reload of a ready schema is
 * blue-green: the new version starts next to the current one, which keeps serving until the new one is ready; if the
 * new one doesn't start, the current one stays, with the reason as its `pending`.
 */
export class Supervisor {
	private readonly schemas = new Map<string, SupervisedSchema>()
	private readonly edge: Supervised & { handle?: EdgeHandle } = { lastPong: 0, attempt: 0 }
	private heartbeatTimer: ReturnType<typeof setInterval> | undefined
	private stopping = false
	/** Stopped first on shutdown (the monitor of the workspaces) */
	private readonly attached: { stop (): Promise<void> }[] = []

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

	public paths (): string[] {
		return [...this.schemas.keys()]
	}

	/** A schema that appeared (a new workspace); one that is already there is reloaded */
	public add (spec: SchemaWorkerSpec): void {
		const path = spec.descriptor.path
		if (this.schemas.has(path)) return this.reload(spec)
		if (this.stopping) return
		const schema: SupervisedSchema = { spec, lastPong: 0, attempt: 0, state: { path, status: 'starting', since: this.now(), restarts: 0 } }
		this.schemas.set(path, schema)
		this.logger.info(`[data-gateway] schema "${path || '/'}" added`)
		this.edge.handle?.add(spec)
		this.setState(schema, 'starting')
		this.startSchema(schema)
	}

	/** A schema whose workspace went: its worker finishes what it has in flight and ends */
	public async remove (path: string): Promise<void> {
		const schema = this.schemas.get(path)
		if (!schema) return
		this.schemas.delete(path)
		if (schema.restartTimer) clearTimeout(schema.restartTimer)
		this.edge.handle?.remove(path)
		this.logger.info(`[data-gateway] schema "${path || '/'}" removed`)
		const handles = [schema.handle, schema.candidate?.handle].filter((h): h is WorkerHandle => h !== undefined)
		schema.handle = undefined
		schema.candidate = undefined
		await Promise.all(handles.map(h => h.stop(this.options.graceMs).catch(error => this.logger.error(error))))
	}

	/**
	 * A new version of a schema (its lambdaORM.yaml or .env changed). Ready: blue-green, the current worker serves until
	 * the new one is ready. Not ready: the new version is started at once (there is nothing to keep).
	 */
	public reload (spec: SchemaWorkerSpec): void {
		const schema = this.schemas.get(spec.descriptor.path)
		if (!schema || this.stopping) return
		if (schema.candidate) {
			const previous = schema.candidate.handle
			schema.candidate = undefined
			previous.stop(this.options.graceMs).catch(error => this.logger.error(error))
		}
		if (schema.state.status !== 'ready' || !schema.handle) {
			if (schema.restartTimer) clearTimeout(schema.restartTimer)
			schema.restartTimer = undefined
			const previous = schema.handle
			schema.handle = undefined
			previous?.stop(this.options.graceMs).catch(error => this.logger.error(error))
			schema.spec = spec
			schema.attempt = 0
			this.setState(schema, 'starting')
			this.startSchema(schema)
			return
		}
		this.logger.info(`[data-gateway] schema "${schema.state.path || '/'}" reloading: the current version serves until the new one is ready`)
		const candidate: SupervisedSchema['candidate'] = { spec, lastPong: this.clock.now().getTime(), handle: undefined as unknown as WorkerHandle }
		const keepCurrent = (reason: string) => {
			if (schema.candidate !== candidate) return
			schema.candidate = undefined
			this.setState(schema, 'ready', undefined, `the new version did not start: ${reason}; serving the last one that did`)
		}
		// once it is the worker served, its events are the ones of any worker of the schema (its pongs keep it alive, its
		// exit restarts the schema); until then, they only decide whether it replaces the current one
		const served = () => schema.handle === candidate.handle && this.schemas.get(schema.state.path) === schema
		candidate.handle = this.schemaRuntime.start(spec, {
			ready: info => {
				if (schema.candidate !== candidate) return
				const previous = schema.handle
				schema.candidate = undefined
				schema.handle = candidate.handle
				schema.spec = spec
				schema.info = info
				schema.lastPong = candidate.lastPong
				schema.attempt = 0
				if (this.edge.handle && info) this.edge.handle.connect(schema.state.path, candidate.handle, info)
				this.setState(schema, 'ready')
				// the edge sends the new requests to the new worker; the old one finishes the ones it has
				previous?.stop(this.options.graceMs).catch(error => this.logger.error(error))
			},
			failed: reason => {
				if (!served()) return keepCurrent(reason)
				schema.handle = undefined
				this.setState(schema, 'error', reason)
				this.scheduleSchema(schema)
			},
			exited: reason => {
				if (!served()) return keepCurrent(reason)
				if (this.stopping) return
				schema.handle = undefined
				this.setState(schema, 'restarting', reason)
				this.scheduleSchema(schema)
			},
			pong: () => {
				const now = this.clock.now().getTime()
				if (served()) schema.lastPong = now
				else candidate.lastPong = now
			}
		})
		schema.candidate = candidate
	}

	/** Something changed in a workspace: the edge tells the clients that asked (WebSocket workspace.changed) */
	public workspaceChanged (change: WorkspaceChange): void {
		this.edge.handle?.workspace(change)
	}

	public attach (stoppable: { stop (): Promise<void> }): void {
		this.attached.push(stoppable)
	}

	/** The edge first (it stops taking requests and finishes the ones in flight), then the schemas */
	public async stop (): Promise<void> {
		this.stopping = true
		await Promise.all(this.attached.map(s => s.stop().catch(error => this.logger.error(error))))
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
		for (const s of [this.edge, ...this.schemas.values()]) if (s.restartTimer) clearTimeout(s.restartTimer)
		await Promise.all([...this.schemas.values()].map(s => s.candidate?.handle.stop(this.options.graceMs).catch(error => this.logger.error(error))))
		await this.edge.handle?.stop(this.options.graceMs).catch(error => this.logger.error(error))
		await Promise.all([...this.schemas.values()].map(async schema => {
			await schema.handle?.stop(this.options.graceMs).catch(error => this.logger.error(error))
			this.setState(schema, 'stopped')
		}))
	}

	private now (): string {
		return this.clock.now().toISOString()
	}

	private setState (schema: SupervisedSchema, status: SchemaStatus, reason?: string, pending?: string): void {
		const restarts = schema.state.restarts + (status === 'restarting' ? 1 : 0)
		// a version that didn't start leaves the one serving as it is: since says when the version served now started
		const since = pending !== undefined && status === schema.state.status ? schema.state.since : this.now()
		schema.state = { path: schema.state.path, status, reason, since, restarts, ...(pending ? { pending } : {}) }
		if (pending) this.logger.warn(`[data-gateway] schema "${schema.state.path || '/'}" ${status}: ${pending}`)
		else if (reason) this.logger.warn(`[data-gateway] schema "${schema.state.path || '/'}" ${status}: ${reason}`)
		else this.logger.info(`[data-gateway] schema "${schema.state.path || '/'}" ${status}`)
		if (this.edge.handle && this.schemas.get(schema.state.path) === schema) this.edge.handle.state(schema.state)
	}

	// ─── schemas ─────────────────────────────────────────────────────────────

	private startSchema (schema: SupervisedSchema): void {
		if (this.stopping || this.schemas.get(schema.state.path) !== schema) return
		schema.lastPong = this.clock.now().getTime()
		const handle: WorkerHandle = this.schemaRuntime.start(schema.spec, {
			ready: info => {
				if (schema.handle !== handle) return
				schema.attempt = 0
				schema.info = info
				this.setState(schema, 'ready')
				if (this.edge.handle && info) this.edge.handle.connect(schema.state.path, handle, info)
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
			if (this.schemas.get(schema.state.path) !== schema) return
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
		}, [...this.schemas.values()].map(s => s.spec))
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
		for (const schema of this.schemas.values()) {
			check(schema, `schema "${schema.state.path || '/'}"`)
			if (schema.candidate) check(schema.candidate as unknown as Supervised, `the new version of schema "${schema.state.path || '/'}"`)
		}
	}
}
