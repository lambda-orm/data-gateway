import path from 'path'
import fs from 'fs'
import os from 'os'
import { ChildProcess, fork } from 'child_process'
import { MessageChannel, Worker } from 'worker_threads'
import { McpServerInfo } from '../../../application/ports/input/mcpServerPort'
import {
	EdgeHandle, EdgeRuntimePort, SchemaRuntimePort, SchemaWorkerSpec, WorkerEvents, WorkerHandle
} from '../../../application/ports/output/runtimePorts'
import { LoggerPort } from '../../../application/ports/output/supportPorts'
import { DataGatewayConfig } from '../../../domain/config/dataGatewayConfig'
import { SchemaState } from '../../../domain/runtime/policies'
import { SchemaDescriptor, SchemaSettings } from '../../../domain/runtime/schemas'
import { WorkspaceChange } from '../../../domain/runtime/workspaces'

/** Where the composition roots are: next to this build (.js) or to the sources (.ts, through tsx) */
const BUILD_DIR = path.join(__dirname, '../../build')
const extension = fs.existsSync(path.join(BUILD_DIR, 'schemaWorkerMain.js')) ? '.js' : '.ts'
export const BOOTSTRAP = path.join(BUILD_DIR, 'workerBootstrap.js')
export const SCHEMA_ENTRY = path.join(BUILD_DIR, `schemaWorkerMain${extension}`)
export const EDGE_ENTRY = path.join(BUILD_DIR, `edgeWorkerMain${extension}`)

type ControlEvent = { type: 'pong' } | { type: 'ready', info?: McpServerInfo, socketPath?: string } | { type: 'failed', reason: string }

/** Turns the control messages and the end of a worker into WorkerEvents, once: failed or exited, not both */
class Lifecycle {
	private ended = false
	public stopping = false
	public socketPath: string | undefined

	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly events: WorkerEvents) {}

	public message (event: ControlEvent): void {
		if (event.type === 'pong') this.events.pong()
		else if (event.type === 'ready') {
			this.socketPath = event.socketPath
			this.events.ready(event.info)
		} else if (event.type === 'failed' && !this.ended) {
			this.ended = true
			this.events.failed(event.reason)
		}
	}

	public exit (reason: string): void {
		if (this.ended) return
		this.ended = true
		if (!this.stopping) this.events.exited(reason)
	}
}

abstract class BaseHandle implements WorkerHandle {
	protected readonly lifecycle: Lifecycle
	protected exitPromise: Promise<void>
	private resolveExit!: () => void

	constructor (public readonly kind: 'schema' | 'edge', events: WorkerEvents) {
		this.lifecycle = new Lifecycle(events)
		this.exitPromise = new Promise(resolve => { this.resolveExit = resolve })
	}

	protected exited (reason: string): void {
		this.lifecycle.exit(reason)
		this.resolveExit()
	}

	protected abstract post (message: unknown, transfer?: any[]): void
	public abstract terminate (): Promise<void>

	public ping (): void {
		try { this.post({ type: 'ping' }) } catch { /* ended */ }
	}

	public async stop (graceMs: number): Promise<void> {
		this.lifecycle.stopping = true
		try { this.post({ type: 'stop' }) } catch { /* ended */ }
		let timer: ReturnType<typeof setTimeout> | undefined
		const grace = new Promise<'late'>(resolve => { timer = setTimeout(() => resolve('late'), graceMs) })
		if (await Promise.race([this.exitPromise.then(() => 'ok' as const), grace]) === 'late') await this.terminate()
		if (timer) clearTimeout(timer)
	}
}

/** A worker thread: its own event loop, heap (resourceLimits) and process.env */
class ThreadHandle extends BaseHandle {
	private readonly worker: Worker

	constructor (kind: 'schema' | 'edge', entry: string, data: Record<string, unknown>, events: WorkerEvents, options: { env?: Record<string, string>, maxMemoryMb?: number }) {
		super(kind, events)
		this.worker = new Worker(BOOTSTRAP, {
			workerData: { ...data, entry },
			env: options.env ?? process.env,
			resourceLimits: options.maxMemoryMb ? { maxOldGenerationSizeMb: options.maxMemoryMb } : undefined,
			stdout: false,
			stderr: false
		})
		let lastError = ''
		this.worker.on('message', (event: ControlEvent) => this.lifecycle.message(event))
		this.worker.on('error', error => { lastError = (error as any)?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? `out of memory (maxMemoryMb ${options.maxMemoryMb})` : error.message })
		this.worker.on('exit', code => this.exited(lastError || `exit code ${code}`))
	}

	protected post (message: unknown, transfer?: any[]): void {
		this.worker.postMessage(message, transfer)
	}

	public async terminate (): Promise<void> {
		await this.worker.terminate()
	}

	/** A new channel with the edge: one port stays here for the edge, the other goes to this worker */
	public createPort () {
		const { port1, port2 } = new MessageChannel()
		this.post({ type: 'attach', port: port1 }, [port1])
		return port2
	}
}

/** A child process: also its own threadpool, native memory and crashes */
class ProcessHandle extends BaseHandle {
	private readonly child: ChildProcess

	constructor (entry: string, data: Record<string, unknown>, events: WorkerEvents, options: { env: Record<string, string>, maxMemoryMb?: number }) {
		super('schema', events)
		this.child = fork(BOOTSTRAP, [entry, JSON.stringify({ ...data, entry })], {
			env: options.env,
			execArgv: options.maxMemoryMb ? [`--max-old-space-size=${options.maxMemoryMb}`] : [],
			stdio: ['ignore', 'inherit', 'inherit', 'ipc']
		})
		this.child.on('message', (event: ControlEvent) => this.lifecycle.message(event))
		this.child.on('exit', (code, signal) => this.exited(signal ? `killed by ${signal}` : `exit code ${code}`))
		this.child.on('error', error => this.exited(error.message))
	}

	public get socketPath (): string | undefined {
		return this.lifecycle.socketPath
	}

	protected post (message: unknown): void {
		if (this.child.connected) this.child.send(message as any)
	}

	public async terminate (): Promise<void> {
		this.child.kill('SIGKILL')
		await this.exitPromise
	}
}

export interface WorkerRuntimeSettings {
	config: DataGatewayConfig
	version: string
	/** Where process-mode schemas open their channel socket */
	socketDir?: string
	logger: LoggerPort
}

/** Schema workers in threads or processes, by settings.runtime.mode */
export class SchemaWorkerRuntime implements SchemaRuntimePort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly settings: WorkerRuntimeSettings) {}

	public start (spec: SchemaWorkerSpec, events: WorkerEvents): WorkerHandle {
		const { config, version } = this.settings
		// the env of the descriptor travels apart (it is the worker's process.env), never in its data
		const descriptor = { ...spec.descriptor, overrides: { ...spec.descriptor.overrides, env: undefined } }
		const data = {
			descriptor,
			settings: spec.settings,
			logger: config.logger,
			audit: config.audit,
			mcp: { name: config.mcp.name, pageSize: config.mcp.pageSize },
			version,
			socketDir: this.settings.socketDir ?? os.tmpdir(),
			metricsEnabled: config.metrics.enabled
		}
		const maxMemoryMb = spec.settings.runtime.maxMemoryMb
		return spec.settings.runtime.mode === 'process'
			? new ProcessHandle(SCHEMA_ENTRY, data, events, { env: spec.env, maxMemoryMb })
			: new ThreadHandle('schema', SCHEMA_ENTRY, data, events, { env: spec.env, maxMemoryMb })
	}
}

class EdgeThreadHandle extends ThreadHandle implements EdgeHandle {
	public connect (path: string, worker: WorkerHandle, info: McpServerInfo): void {
		if (worker instanceof ThreadHandle) {
			const port = worker.createPort()
			this.post({ type: 'connect', path, port, info }, [port])
		} else if (worker instanceof ProcessHandle && worker.socketPath) {
			this.post({ type: 'connect', path, socketPath: worker.socketPath, info })
		}
	}

	public state (state: SchemaState): void {
		try { this.post({ type: 'state', state }) } catch { /* ended */ }
	}

	public add (spec: SchemaWorkerSpec): void {
		try { this.post({ type: 'add', schema: withoutEnv(spec) }) } catch { /* ended */ }
	}

	public remove (path: string): void {
		try { this.post({ type: 'remove', path }) } catch { /* ended */ }
	}

	public workspace (change: WorkspaceChange): void {
		try { this.post({ type: 'workspace', change }) } catch { /* ended */ }
	}
}

/** What the edge knows of a schema: not its variables (it doesn't need them; they may be secrets) */
const withoutEnv = (s: { descriptor: SchemaDescriptor, settings: SchemaSettings }) =>
	({ descriptor: { ...s.descriptor, overrides: { ...s.descriptor.overrides, env: undefined } }, settings: s.settings })

/** The edge in a worker thread (runtime.transports: shared) */
export class EdgeWorkerRuntime implements EdgeRuntimePort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly settings: WorkerRuntimeSettings) {}

	public start (events: WorkerEvents, specs: SchemaWorkerSpec[]): EdgeHandle {
		const schemas = specs.map(withoutEnv)
		// the edge has the gateway's variables only if they are passthrough: it doesn't need them, the config is resolved
		const config = { ...this.settings.config, orm: { ...this.settings.config.orm, schemas: this.settings.config.orm.schemas.map(s => ({ ...s, env: undefined })) } }
		return new EdgeThreadHandle('edge', EDGE_ENTRY, { config, schemas, version: this.settings.version }, events, {
			env: baseEnv(this.settings.config),
			maxMemoryMb: this.settings.config.runtime.maxMemoryMb
		})
	}
}

/** The edge's environment: system variables, no secrets */
const baseEnv = (config: DataGatewayConfig): Record<string, string> => {
	const env: Record<string, string> = {}
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue
		if (!config.runtime.env.isolate || /^(PATH|HOME|TZ|LANG|LC_[A-Z]+|TMPDIR|NODE_[A-Z0-9_]+)$/.test(key)) env[key] = value
	}
	return env
}
