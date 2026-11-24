import { SchemaDescriptor, SchemaSettings } from '../../domain/runtime/schemas'
import { changeKindOf, ignoredWorkspaceFile, WorkspaceChange, WorkspaceChangeKind } from '../../domain/runtime/workspaces'
import { SchemaWorkerSpec } from '../ports/output/runtimePorts'
import { ClockPort, LoggerPort } from '../ports/output/supportPorts'
import { WorkspaceFilesPort, WorkspaceWatcherPort } from '../ports/output/workspacePorts'

/** What the monitor changes: the supervisor */
export interface MonitoredRuntime {
	add (spec: SchemaWorkerSpec): void
	remove (path: string): Promise<void> | void
	reload (spec: SchemaWorkerSpec): void
	workspaceChanged (change: WorkspaceChange): void
}

export interface WorkspaceMonitorOptions {
	/** The folders to watch: orm.workspacePath and the workspaces declared outside it */
	roots: string[]
	/** The schemas now (discovered + declared); throws when the configuration can't be applied */
	resolve (): { descriptor: SchemaDescriptor, settings: SchemaSettings }[]
	/** The spec a worker starts with (its env read again from its .env) */
	spec (schema: { descriptor: SchemaDescriptor, settings: SchemaSettings }): SchemaWorkerSpec
	intervalMs: number
	debounceMs: number
}

interface Known {
	workspace: string
	fingerprint: { schema: string, env: string }
}

/**
 * Watches the workspaces while the gateway runs (orm.watch): a folder with a lambdaORM.yaml that appears is a schema
 * added, one that goes is removed, a lambdaORM.yaml or .env that changes reloads its schema; any other file of a
 * workspace (workbench/, data/, src/) is only notified. The file events are gathered for debounceMs; a scan every
 * intervalMs catches what the events miss. What changed is decided by the content (a hash), not by the event.
 */
export class WorkspaceMonitor {
	private readonly known = new Map<string, Known>()
	private pending = new Set<string>()
	private timer: ReturnType<typeof setTimeout> | undefined
	private interval: ReturnType<typeof setInterval> | undefined
	private unwatch: (() => void) | undefined
	private applying: Promise<void> = Promise.resolve()
	private stopped = false

	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly options: WorkspaceMonitorOptions,
		private readonly runtime: MonitoredRuntime,
		private readonly watcher: WorkspaceWatcherPort,
		private readonly files: WorkspaceFilesPort,
		private readonly clock: ClockPort,
		private readonly logger: LoggerPort
	) {}

	/** The schemas the gateway started with, so that only what changes after is applied */
	public start (started: { descriptor: SchemaDescriptor }[]): void {
		for (const { descriptor } of started) {
			this.known.set(descriptor.path, { workspace: this.files.absolute(descriptor.workspace), fingerprint: this.files.fingerprint(descriptor.workspace) })
		}
		this.unwatch = this.watcher.watch(this.options.roots, file => this.touched(file))
		if (this.options.intervalMs > 0) this.interval = setInterval(() => this.schedule(0), this.options.intervalMs)
	}

	public stop (): Promise<void> {
		this.stopped = true
		if (this.timer) clearTimeout(this.timer)
		if (this.interval) clearInterval(this.interval)
		this.unwatch?.()
		return this.applying
	}

	/** Applies what changed now (tests; the scan) */
	public check (): Promise<void> {
		this.schedule(0)
		return this.applying
	}

	private touched (file: string): void {
		this.pending.add(file)
		this.schedule(this.options.debounceMs)
	}

	private schedule (delayMs: number): void {
		if (this.stopped) return
		if (this.timer) clearTimeout(this.timer)
		const run = () => {
			this.timer = undefined
			this.applying = this.applying.then(() => this.apply()).catch(error => this.logger.error(error))
		}
		if (delayMs === 0) run()
		else this.timer = setTimeout(run, delayMs)
	}

	private change (path: string, kind: WorkspaceChangeKind, files?: string[], version?: string): void {
		this.runtime.workspaceChanged({ path, kind, ...(files?.length ? { files } : {}), at: this.clock.now().toISOString(), ...(version ? { version } : {}) })
	}

	private async apply (): Promise<void> {
		if (this.stopped) return
		const touched = [...this.pending]
		this.pending = new Set()
		let schemas: { descriptor: SchemaDescriptor, settings: SchemaSettings }[]
		try {
			schemas = this.options.resolve()
		} catch (error: any) {
			// a configuration that can't be applied (two workspaces at the same route): nothing changes until it can
			this.logger.error(`[data-gateway] the workspaces changed, but they can't be served as they are: ${error?.message ?? error}`)
			return
		}
		const now = new Map(schemas.map(s => [s.descriptor.path, s]))
		for (const [path] of this.known) {
			if (now.has(path)) continue
			this.known.delete(path)
			await this.runtime.remove(path)
			this.change(path, 'removed')
		}
		for (const [path, schema] of now) {
			const fingerprint = this.files.fingerprint(schema.descriptor.workspace)
			const known = this.known.get(path)
			const workspace = this.files.absolute(schema.descriptor.workspace)
			if (!known) {
				this.known.set(path, { workspace, fingerprint })
				this.runtime.add(this.options.spec(schema))
				this.change(path, 'added')
				continue
			}
			const schemaChanged = known.fingerprint.schema !== fingerprint.schema || known.workspace !== workspace
			const envChanged = known.fingerprint.env !== fingerprint.env
			if (!schemaChanged && !envChanged) continue
			this.known.set(path, { workspace, fingerprint })
			this.runtime.reload(this.options.spec(schema))
			// with its hash: the edge tells a change of its administration (already announced) from one from outside
			if (schemaChanged) this.change(path, 'schema', ['lambdaORM.yaml'], fingerprint.schema)
			// the names of the variables only: their values are secrets
			if (envChanged) this.change(path, 'env', ['.env'])
		}
		// the other files of a workspace: only notified, grouped by workspace
		const byPath = new Map<string, Set<string>>()
		for (const file of touched) {
			const owner = this.owner(file)
			if (!owner) continue
			const relative = this.files.relative(owner.workspace, file)
			if (!relative || ignoredWorkspaceFile(relative) || changeKindOf(relative) !== 'files') continue
			if (!byPath.has(owner.path)) byPath.set(owner.path, new Set())
			byPath.get(owner.path)!.add(relative)
		}
		for (const [path, files] of byPath) this.change(path, 'files', [...files].sort())
	}

	/** The schema whose workspace holds a file (the deepest one) */
	private owner (file: string): { path: string, workspace: string } | undefined {
		let found: { path: string, workspace: string } | undefined
		for (const [p, known] of this.known) {
			const inside = this.files.relative(known.workspace, file) !== undefined
			if (inside && (!found || known.workspace.length > found.workspace.length)) found = { path: p, workspace: known.workspace }
		}
		return found
	}
}
