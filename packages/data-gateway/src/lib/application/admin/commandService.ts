import { Permission } from '../../domain/auth/permission'
import { Principal } from '../../domain/auth/principal'
import { badRequest, forbidden, GatewayError, notFound, unavailable } from '../../domain/errors/gatewayError'
import { CommandOperation } from '../../domain/runtime/channelProtocol'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { ServedSchema } from '../ports/input/schemaDirectoryPort'
import { VersionConflict, WorkspaceStorePort, YamlPort } from '../ports/output/adminPorts'
import { lineDiff } from '../../domain/admin/lineDiff'
import { ClockPort, LoggerPort } from '../ports/output/supportPorts'
import { SCHEMA_FILE } from './adminService'

/** The commands of the CLI the gateway runs (docs/DATA_GATEWAY_ADMIN_PLAN.md §4); build comes later */
export type CommandName = 'version' | 'fetch' | 'export' | 'push' | 'drop' | 'import' | 'pull' | 'introspect' | 'incorporate'

/** The ones that change the databases or the schema: they run only the preview they were shown */
const PREVIEWED: CommandName[] = ['push', 'drop', 'import', 'pull', 'introspect', 'incorporate']

/** The ones that change the lambdaORM.yaml: their preview is its diff */
const CHANGE_THE_SCHEMA: CommandName[] = ['pull', 'introspect', 'incorporate']

const PERMISSION: Record<CommandName, Permission> = {
	version: 'read',
	fetch: 'read',
	export: 'read',
	push: 'ddl',
	drop: 'ddl',
	import: 'stageImport',
	pull: 'schemaWrite',
	introspect: 'schemaWrite',
	incorporate: 'schemaWrite'
}

/** What else a command needs: incorporate changes the schema, pushes it and imports */
const ALSO: Partial<Record<CommandName, Permission[]>> = { incorporate: ['ddl', 'stageImport'] }

export interface Job {
	id: string
	schema: string
	command: CommandName
	stage?: string
	status: 'running' | 'done' | 'failed'
	credential: string
	startedAt: string
	finishedAt?: string
	/** what it answered (the rows of an export, the sentences run…); only in GET of one job */
	result?: unknown
	error?: { name: string, message: string, status?: number }
	/** an export saved in the workspace: where */
	file?: string
}

interface Preview {
	id: string
	schema: string
	command: CommandName
	stage: string
	/** the lambdaORM.yaml it was made with: another one, and it must be seen again */
	schemaVersion: string
	data?: unknown
	/** the lambdaORM.yaml it will write (pull, introspect, incorporate) */
	text?: string
	expires: number
}

export interface CommandOptions {
	anonymousAdmin: boolean
	/** how long a command may take (they create tables, export whole databases) */
	timeoutMs: number
	/** how long a preview can be confirmed */
	previewTtlMs: number
	/** jobs kept in memory per gateway (the newest) */
	keepJobs: number
	/**
	 * Waits until the schema serves the lambdaORM.yaml just written (the monitor of the workspaces reloads it): incorporate
	 * pushes and imports on the new schema. Rejects when the new version doesn't start, or when nothing reloads it.
	 */
	reloaded: (path: string, since: string | undefined) => Promise<void>
	/** when the version served now started (to see it change) */
	since: (path: string) => string | undefined
}

const isCommand = (value: string): value is CommandName => ['version', 'fetch', 'export', 'push', 'drop', 'import', 'pull', 'introspect', 'incorporate'].includes(value)

/** The rows of each entity in an export (what an import is going to write) */
export const rowsPerEntity = (data: unknown): Record<string, number> => {
	const entities = (data as any)?.entities
	if (!Array.isArray(entities)) return {}
	return Object.fromEntries(entities.map((e: any) => [e?.entity ?? e?.name ?? '?', Array.isArray(e?.rows) ? e.rows.length : 0]))
}

/**
 * The commands of a workspace as jobs (docs/DATA_GATEWAY_ADMIN_PLAN.md §4, phase 3a). They run in the worker of the
 * schema, with its λORM and its connections. One at a time per schema (another one answers 409 with the running job).
 * The ones that change the databases first show what they would do (preview: the sentences by source, the rows of
 * each entity); running them needs that previewId, still valid for the same lambdaORM.yaml.
 */
export class CommandService {
	private readonly jobs: Job[] = []
	private readonly previews = new Map<string, Preview>()
	private sequence = 0

	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly options: CommandOptions,
		private readonly schemas: () => ServedSchema[],
		private readonly store: WorkspaceStorePort,
		private readonly yaml: YamlPort,
		private readonly clock: ClockPort,
		private readonly logger: LoggerPort
	) {}

	private requireCommand (principal: Principal, command: CommandName): void {
		this.require(principal, PERMISSION[command])
		for (const permission of ALSO[command] ?? []) this.require(principal, permission)
	}

	private require (principal: Principal, permission: Permission): void {
		if (principal.permissions.has(permission)) return
		if (this.options.anonymousAdmin && principal.name === 'anonymous') return
		throw forbidden(principal.name, permission)
	}

	private has (principal: Principal, permission: Permission): boolean {
		return principal.permissions.has(permission) || (this.options.anonymousAdmin && principal.name === 'anonymous')
	}

	private served (path: string): ServedSchema & { workspace: string } {
		const schema = this.schemas().find(s => s.path === path)
		if (!schema || !schema.workspace) throw notFound(`no schema "${path || '/'}" (the schemas are at /schemas)`)
		return schema as ServedSchema & { workspace: string }
	}

	/** The worker runs it as this principal (it authorizes again); the administration of anonymous gets the permission */
	private context (principal: Principal, permission: Permission): RequestContext {
		const permissions = new Set(principal.permissions)
		if (this.has(principal, permission)) permissions.add(permission)
		return { principal: { name: principal.name, permissions }, transport: 'admin' }
	}

	private async call (path: string, principal: Principal, permission: Permission, op: CommandOperation, args: unknown[]): Promise<unknown> {
		const schema = this.served(path)
		if (!schema.commands) throw unavailable('CommandsUnavailableError', `schema "${path || '/'}" can't run commands here`)
		return schema.commands(this.context(principal, permission), op, args, this.options.timeoutMs)
	}

	private async schemaVersion (path: string): Promise<string> {
		return (await this.store.read(this.served(path).workspace, SCHEMA_FILE))?.version ?? ''
	}

	private running (path: string): Job | undefined {
		return this.jobs.find(j => j.schema === path && j.status === 'running')
	}

	/** What the panel of commands needs: the stages, what this credential may run and the job running */
	public async summary (principal: Principal, path: string): Promise<{ stages: string[], can: Record<CommandName, boolean>, running?: Job }> {
		this.require(principal, 'read')
		const stages = await this.call(path, principal, 'read', 'stages', []) as string[]
		const can = Object.fromEntries((Object.keys(PERMISSION) as CommandName[]).map(c => [c, [PERMISSION[c], ...(ALSO[c] ?? [])].every(p => this.has(principal, p))])) as Record<CommandName, boolean>
		const running = this.running(path)
		return { stages, can, ...(running ? { running: this.withoutResult(running) } : {}) }
	}

	/** What a command that changes the databases would do, and the id to run exactly that */
	public async preview (principal: Principal, path: string, command: string, request: { stage?: unknown, data?: unknown, name?: unknown }): Promise<Record<string, unknown>> {
		if (!isCommand(command) || !PREVIEWED.includes(command)) throw badRequest('ValidationError', `${command} has no preview (${PREVIEWED.join(', ')})`)
		this.requireCommand(principal, command)
		const stages = await this.call(path, principal, 'read', 'stages', []) as string[]
		const stage = typeof request.stage === 'string' && request.stage ? request.stage : stages[0]
		if (!stages.includes(stage)) throw badRequest('ValidationError', `unknown stage "${String(request.stage)}" (${stages.join(', ')})`)
		let shown: Record<string, unknown>
		let text: string | undefined
		let data: unknown
		if (CHANGE_THE_SCHEMA.includes(command)) {
			const current = await this.store.read(this.served(path).workspace, SCHEMA_FILE)
			if (!current) throw notFound(`schema "${path}" has no ${SCHEMA_FILE}`)
			let schema: unknown
			if (command === 'pull') {
				schema = await this.call(path, principal, 'read', 'pullSchema', [stage])
			} else {
				if (!request.data || typeof request.data !== 'object') throw badRequest('ValidationError', 'data is what to read the entities from (an object or a list of them)')
				const read = await this.call(path, principal, 'read', 'introspectSchema', [request.data, request.name]) as { schema: unknown, data: unknown }
				schema = read.schema
				data = read.data
			}
			text = this.yaml.merge(current.text, schema)
			shown = { diff: lineDiff(current.text, text), ...(data !== undefined ? { rows: rowsPerEntity(data) } : {}) }
		} else if (command === 'push') shown = { sentences: await this.call(path, principal, 'read', 'pushSentences', [stage]) }
		else if (command === 'drop') shown = { sentences: await this.call(path, principal, 'read', 'dropSentences', [stage]) }
		else {
			if (!request.data || typeof request.data !== 'object') throw badRequest('ValidationError', 'data is an export of a stage ({ entities: [{ entity, rows }] })')
			shown = { rows: rowsPerEntity(request.data) }
		}
		this.forgetOldPreviews()
		const preview: Preview = {
			id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
			schema: path,
			command,
			stage,
			schemaVersion: await this.schemaVersion(path),
			data: command === 'import' ? request.data : data,
			text,
			expires: this.clock.now().getTime() + this.options.previewTtlMs
		}
		this.previews.set(preview.id, preview)
		return { previewId: preview.id, command, stage, expiresAt: new Date(preview.expires).toISOString(), ...shown }
	}

	private forgetOldPreviews (): void {
		const now = this.clock.now().getTime()
		for (const [id, p] of this.previews) if (p.expires < now) this.previews.delete(id)
	}

	/**
	 * Starts a command: version answers at once; the others are a job (its id, to ask for it). A command that changes
	 * the databases runs the preview it names, if the schema didn't change since.
	 */
	public async run (principal: Principal, path: string, command: string, request: { stage?: unknown, previewId?: unknown, force?: unknown, save?: unknown }): Promise<Job | Record<string, unknown>> {
		if (!isCommand(command)) throw notFound(`no command "${command}" (version, fetch, export, push, drop, import, pull, introspect, incorporate)`)
		this.requireCommand(principal, command)
		const schema = this.served(path)
		if (command === 'version') return { ...await schema.gateway.version() as object, schema: path }
		const running = this.running(path)
		if (running) throw Object.assign(new GatewayError(409, 'BusyError', `schema "${path || '/'}" is running ${running.command} (${running.id}): one command at a time`), { details: { running: this.withoutResult(running) } })
		let stage = typeof request.stage === 'string' && request.stage ? request.stage : undefined
		let data: unknown
		let text: string | undefined
		let expected: string | undefined
		if (PREVIEWED.includes(command)) {
			const preview = typeof request.previewId === 'string' ? this.previews.get(request.previewId) : undefined
			if (!preview || preview.schema !== path || preview.command !== command || preview.expires < this.clock.now().getTime()) {
				throw new GatewayError(409, 'PreviewRequiredError', `${command} runs what its preview showed: ask for it first (POST …/commands/${command}/preview)`)
			}
			if (preview.schemaVersion !== await this.schemaVersion(path)) {
				this.previews.delete(preview.id)
				throw new GatewayError(409, 'PreviewRequiredError', `${SCHEMA_FILE} changed since the preview: see it again`)
			}
			this.previews.delete(preview.id)
			stage = preview.stage
			data = preview.data
			text = preview.text
			expected = preview.schemaVersion
		}
		const save = request.save === true
		if (save && command === 'export') this.require(principal, 'workbenchWrite')
		const job: Job = {
			id: `${this.clock.now().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${++this.sequence}`,
			schema: path,
			command,
			stage,
			status: 'running',
			credential: principal.name,
			startedAt: this.clock.now().toISOString()
		}
		this.jobs.unshift(job)
		this.jobs.splice(this.options.keepJobs)
		this.logger.info(`[data-gateway] admin: "${principal.name}" runs ${command}${stage ? ` ${stage}` : ''} on ${path || '/'} (${job.id})`)
		const force = request.force === true
		const work = CHANGE_THE_SCHEMA.includes(command)
			? this.changeTheSchema(principal, schema, command, stage!, text!, expected!, data)
			: this.call(path, principal, PERMISSION[command], command as CommandOperation, command === 'import' ? [stage, data] : [stage, force])
		work
			.then(async result => {
				job.result = result
				if (save && command === 'export') {
					job.file = `data/${job.stage ?? 'default'}-${job.startedAt.replace(/[:.]/g, '-')}.json`
					await this.store.write(schema.workspace, job.file, JSON.stringify(result, null, 2))
				}
				job.status = 'done'
			}, (error: any) => {
				job.status = 'failed'
				job.error = { name: error?.name ?? 'Error', message: error?.message ?? String(error), ...(Number.isInteger(error?.status) ? { status: error.status } : {}) }
			})
			.finally(() => {
				job.finishedAt = this.clock.now().toISOString()
				this.logger.info(`[data-gateway] admin: ${command} on ${path || '/'} ${job.status}${job.error ? `: ${job.error.message}` : ''} (${job.id})`)
				// the record of what was run, next to the state of λORM (without the result: it may be data)
				this.store.write(schema.workspace, `orm_state/jobs/${job.id}.json`, JSON.stringify(this.withoutResult(job), null, 2)).catch(() => undefined)
			})
		return this.withoutResult(job)
	}

	/**
	 * pull, introspect, incorporate: the lambdaORM.yaml written (only what changed, keeping its comments), if it is still
	 * the one of the preview. pull first updates the state of the stage, as λORM does; incorporate then waits for the
	 * new schema, pushes it and imports the data.
	 */
	private async changeTheSchema (principal: Principal, schema: ServedSchema & { workspace: string }, command: CommandName, stage: string, text: string, expected: string, data: unknown): Promise<unknown> {
		const path = schema.path
		let written = text
		if (command === 'pull') {
			const pulled = await this.call(path, principal, 'schemaWrite', 'pull', [stage])
			const current = await this.store.read(schema.workspace, SCHEMA_FILE)
			written = this.yaml.merge(current?.text ?? text, pulled)
		}
		const before = this.options.since(path)
		const current = await this.store.read(schema.workspace, SCHEMA_FILE)
		const diff = lineDiff(current?.text ?? '', written)
		await this.store.withLock(schema.workspace, () => this.store.write(schema.workspace, SCHEMA_FILE, written, expected)).catch(error => {
			if (error instanceof VersionConflict) throw new GatewayError(409, 'PreviewRequiredError', `${SCHEMA_FILE} changed since the preview: see it again`)
			throw error
		})
		const summary = { file: SCHEMA_FILE, added: diff.added, removed: diff.removed }
		if (command !== 'incorporate') return summary
		await this.options.reloaded(path, before)
		const pushed = await this.call(path, principal, 'ddl', 'push', [stage, false])
		await this.call(path, principal, 'stageImport', 'import', [stage, data])
		return { ...summary, pushed, imported: rowsPerEntity(data) }
	}

	private withoutResult (job: Job): Job {
		const rest = { ...job }
		delete rest.result
		return rest
	}

	public jobsOf (principal: Principal, path: string): Job[] {
		this.require(principal, 'read')
		this.served(path)
		return this.jobs.filter(j => j.schema === path).map(j => this.withoutResult(j))
	}

	public job (principal: Principal, path: string, id: string): Job {
		this.require(principal, 'read')
		const job = this.jobs.find(j => j.schema === path && j.id === id)
		if (!job) throw notFound(`no job "${id}" of "${path || '/'}" (the gateway keeps the last ${this.options.keepJobs})`)
		return { ...job }
	}
}
