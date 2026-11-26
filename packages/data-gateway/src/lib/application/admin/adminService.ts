import { Permission } from '../../domain/auth/permission'
import { Principal } from '../../domain/auth/principal'
import {
	FOLDER_FILE, WORKBENCH, WorkbenchItem, workbenchContent, workbenchFolderOf, workbenchItemOf, workbenchKindOf, workbenchPlaces
} from '../../domain/admin/workbench'
import { badRequest, forbidden, GatewayError, notFound } from '../../domain/errors/gatewayError'
import { SchemaState } from '../../domain/runtime/policies'
import { normalizeSchemaPath, schemaPathIssues, schemaPathsIssues } from '../../domain/runtime/schemaPath'
import { applyPatch, elementAt, PatchError, referencesOf, SchemaPatch } from '../../domain/admin/schemaPatch'
import { jsonDiff } from '../../domain/admin/jsonPatch'
import { SchemaChange, ulid } from '@lambdaorm/base'
import { lineDiff } from '../../domain/admin/lineDiff'
import { dotEnvNames, editDotEnv, schemaVariables, VARIABLE_NAME } from '../../domain/admin/dotEnv'
import { EXPRESSION_CONTEXTS, ExpressionVariable } from '../../domain/admin/expressions'
import { StageRouting, stageRoutingOf } from '../../domain/admin/stageRouting'
import { CodeGeneratorPort, ExpressionLanguage, ExpressionLanguagePort, SchemaHistoryFilter, SchemaHistoryPort, SchemaIssue, SessionStatePort, SchemaValidatorPort, VersionConflict, WorkspaceStorePort, YamlPort } from '../ports/output/adminPorts'
import { ClockPort, LoggerPort } from '../ports/output/supportPorts'

export const SCHEMA_FILE = 'lambdaORM.yaml'

/** A schema the gateway serves now, with the folder of its workspace */
export interface AdministeredSchema {
	path: string
	workspace: string
}

export interface AdminOptions {
	/** orm.workspacePath: where new workspaces are created (none: they can't be) */
	root?: string
	/** authentication none and admin.allowAnonymous: the anonymous caller administers */
	anonymousAdmin: boolean
	maxFileBytes: number
}

export interface WorkspaceSummary extends SchemaState {
	/** the version of its lambdaORM.yaml */
	version?: string
}

/** What a new workspace starts with */
export type WorkspaceTemplate = 'empty'

/** the state of the UI of a credential: its tabs with their drafts */
const SESSION_MAX_BYTES = 2 * 1024 * 1024

const EMPTY_SCHEMA = `# A schema of λORM: https://lambda-orm.github.io/wiki/schema/SchemaDefinition/
domain:
  entities: []
  enums: []
infrastructure:
  mappings:
    - name: default
  sources: []
  stages:
    - name: default
      sources: []
`

export const preconditionFailed = (message: string, details: unknown): GatewayError =>
	Object.assign(new GatewayError(412, 'PreconditionFailedError', message), { details })

export const invalidSchema = (issues: SchemaIssue[]): GatewayError =>
	Object.assign(new GatewayError(422, 'SchemaValidationError', `the schema is not valid: ${issues.filter(i => i.severity === 'error').map(i => i.line ? `line ${i.line}: ${i.message}` : i.message).join('; ')}`), { details: { issues } })

/**
 * The administration of the workspaces (docs/DATA_GATEWAY_ADMIN_PLAN.md §2.2, phase 2): the workspaces, the
 * lambdaORM.yaml of each with its version, its validation, and what is saved in them (workbench/). It only writes files:
 * the monitor of the workspaces (orm.watch) sees them and adds, reloads or removes the schema.
 *
 * Concurrency: every read answers the version of what it read and every write says which version it changes; another
 * version is a 412 with what there is now. Writes to one workspace go one at a time (a lock in the volume).
 */
export class AdminService {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly options: AdminOptions,
		private readonly schemas: () => AdministeredSchema[],
		private readonly states: () => SchemaState[],
		private readonly store: WorkspaceStorePort,
		private readonly validator: SchemaValidatorPort,
		private readonly yaml: YamlPort,
		private readonly clock: ClockPort,
		private readonly logger: LoggerPort,
		/** the code of a domain for a language (build) */
		private readonly code: CodeGeneratorPort = { files: () => [] },
		/** the expressions of a schema (3xpr): the condition of a source of a stage */
		private readonly expressions?: ExpressionLanguagePort,
		/** where the UI of each credential was (its tabs, drafts, what is unfolded) */
		private readonly sessions?: SessionStatePort,
		/** the history of the changes of each schema (schema.change), and their announcement to the IDEs */
		private readonly history?: SchemaHistoryPort
	) {}

	/** The state of the UI of the credential that asks: only its own, whatever its permissions */
	public async session (principal: Principal): Promise<{ state: unknown, updatedAt: string } | { state: null }> {
		if (!this.sessions) throw notFound('the state of the UI is not kept (it needs orm.workspacePath)')
		return (await this.sessions.read(principal.name)) ?? { state: null }
	}

	public async saveSession (principal: Principal, body: any): Promise<{ updatedAt: string }> {
		if (!this.sessions) throw notFound('the state of the UI is not kept (it needs orm.workspacePath)')
		const state = body?.state
		if (state === null) {
			await this.sessions.remove(principal.name)
			return { updatedAt: this.clock.now().toISOString() }
		}
		if (!state || typeof state !== 'object' || Array.isArray(state)) throw badRequest('ValidationError', 'state is an object (what the UI keeps), or null to forget it')
		if (JSON.stringify(state).length > SESSION_MAX_BYTES) throw new GatewayError(413, 'PayloadTooLarge', `the state of the UI is at most ${SESSION_MAX_BYTES} bytes`)
		const at = this.clock.now().toISOString()
		await this.sessions.write(principal.name, state, at)
		return { updatedAt: at }
	}

	/** The language of the expressions and the variables of each kind of expression (stageSource) */
	public expressionLanguage (principal: Principal): ExpressionLanguage & { contexts: Record<string, ExpressionVariable[]> } {
		this.require(principal, 'schemaRead')
		if (!this.expressions) throw notFound('the expressions are not available')
		return { ...this.expressions.language(), contexts: EXPRESSION_CONTEXTS }
	}

	/** Whether an expression is right: it parses, and uses only the variables of its context */
	public checkExpression (principal: Principal, body: any): { valid: boolean, error?: string, variables: string[], unknown: string[] } {
		this.require(principal, 'schemaRead')
		if (!this.expressions) throw notFound('the expressions are not available')
		if (typeof body?.expression !== 'string') throw badRequest('ValidationError', 'expression is required')
		const context = body.context ?? 'stageSource'
		const variables = EXPRESSION_CONTEXTS[context]
		if (!variables) throw badRequest('ValidationError', `context is one of ${Object.keys(EXPRESSION_CONTEXTS).join(', ')}`)
		if (!body.expression.trim()) return { valid: true, variables: [], unknown: [] }
		const checked = this.expressions.check(body.expression)
		const known = new Set(variables.map(v => v.name))
		const unknown = checked.variables.filter(v => !known.has(v))
		return { valid: !checked.error && unknown.length === 0, ...checked, unknown }
	}

	/**
	 * Where the entities of a stage go: each source of the stage, in order, with its condition and the entities that
	 * live in it (their table by its mapping), evaluated as λORM routes a sentence (the stage diagram of the UI)
	 */
	public async stageRouting (principal: Principal, path: string, stage: string): Promise<StageRouting> {
		this.require(principal, 'schemaRead')
		if (!this.expressions) throw notFound('the expressions are not available')
		const file = await this.store.read(this.workspaceOf(path), SCHEMA_FILE)
		if (!file) throw notFound(`schema "${path}" has no ${SCHEMA_FILE}`)
		const expressions = this.expressions
		const routing = stageRoutingOf(this.yaml.parse(file.text), stage, (expression, data) => expressions.evaluate(expression, { ...data }))
		if (!routing) throw notFound(`schema "${path}" has no stage "${stage}"`)
		return routing
	}

	// ─── permissions ─────────────────────────────────────────────────────────

	private require (principal: Principal, permission: Permission): void {
		if (principal.permissions.has(permission)) return
		if (this.options.anonymousAdmin && principal.name === 'anonymous') return
		throw forbidden(principal.name, permission)
	}

	/** What the credential may do here: the UI shows the actions with it */
	public can (principal: Principal): Record<string, boolean> {
		const has = (permission: Permission) => principal.permissions.has(permission) || (this.options.anonymousAdmin && principal.name === 'anonymous')
		return {
			schemaRead: has('schemaRead'),
			schemaWrite: has('schemaWrite'),
			schemaAdmin: has('schemaAdmin') && this.options.root !== undefined,
			workbenchRead: has('read') || has('workbenchWrite'),
			workbenchWrite: has('workbenchWrite'),
			build: has('build')
		}
	}

	private audit (principal: Principal, action: string, target: string): void {
		this.logger.info(`[data-gateway] admin: "${principal.name}" ${action} ${target}`)
	}

	/**
	 * A schema.change of the administration in the history of the schema: who (the actor of the session: credential,
	 * session, IDE, IP), what and when. A history that can't be written doesn't undo the change: it is logged.
	 */
	private async changed (principal: Principal, path: string, workspace: string, change: Pick<SchemaChange, 'kind'> & Partial<SchemaChange>): Promise<void> {
		if (!this.history) return
		const event: SchemaChange = {
			id: ulid(),
			time: this.clock.now().toISOString(),
			schema: path,
			version: {},
			actor: principal.actor ?? { credential: principal.name },
			result: 'ok',
			...change
		}
		for (const key of Object.keys(event) as (keyof SchemaChange)[]) if (event[key] === undefined) delete event[key]
		try {
			await this.history.record(path, workspace, event)
		} catch (error: any) {
			this.logger.warn(`[data-gateway] the history of "${path || '/'}" was not written: ${error?.message ?? error}`)
		}
	}

	/**
	 * The history of a schema (docs/OBSERVABILITY.md §5.3), the newest first: what the IDEs, the CLI and the gateway
	 * changed in it, with who and the diff.
	 */
	public async changes (principal: Principal, path: string, query: { since?: unknown, target?: unknown, kind?: unknown, limit?: unknown, cursor?: unknown }): Promise<{ items: SchemaChange[], nextCursor?: string }> {
		this.require(principal, 'schemaRead')
		if (!this.history) return { items: [] }
		const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
		const limit = query.limit === undefined ? 50 : Number(query.limit)
		if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw badRequest('ValidationError', 'limit is from 1 to 500')
		const since = text(query.since)
		if (since && Number.isNaN(Date.parse(since))) throw badRequest('ValidationError', 'since is an ISO time')
		const filter: SchemaHistoryFilter = { since, target: text(query.target), kind: text(query.kind), limit, cursor: text(query.cursor) }
		return this.history.read(this.workspaceOf(path), filter)
	}

	/**
	 * Who changed an element last (for the 412 of a form: "<credential> changed it at <time>"): the newest change of the
	 * history on it, on what holds it or inside it, or a write of the whole file
	 */
	private async changedBy (workspace: string, target?: string): Promise<{ credential?: string, client?: string, time: string, kind: string, target?: string } | undefined> {
		if (!this.history) return undefined
		try {
			const { items } = await this.history.read(workspace, { limit: 100 })
			const touches = (other?: string) => !target || !other || other.startsWith(target) || target.startsWith(other)
			const last = items.find(p => p.kind === 'schema.write' || p.kind === 'schema.file' || (p.kind === 'schema.patch' && touches(p.target)))
			return last ? { credential: last.actor?.credential, client: last.actor?.client, time: last.time, kind: last.kind, target: last.target } : undefined
		} catch {
			return undefined
		}
	}

	/** the JSON Patch between two texts of the lambdaORM.yaml; none if one doesn't parse */
	private diffOf (before: string, after: string) {
		try {
			return jsonDiff(this.yaml.parse(before), this.yaml.parse(after))
		} catch {
			return undefined
		}
	}

	private workspaceOf (path: string): string {
		const schema = this.schemas().find(s => s.path === path)
		if (!schema) throw notFound(`no schema "${path || '/'}" (the schemas are at /schemas)`)
		return schema.workspace
	}

	// ─── workspaces ──────────────────────────────────────────────────────────

	public async workspaces (principal: Principal): Promise<WorkspaceSummary[]> {
		this.require(principal, 'schemaRead')
		const states = new Map(this.states().map(s => [s.path, s]))
		return Promise.all(this.schemas().map(async s => {
			const file = await this.store.read(s.workspace, SCHEMA_FILE).catch(() => undefined)
			const state = states.get(s.path) ?? { path: s.path, status: 'starting' as const, since: this.clock.now().toISOString(), restarts: 0 }
			return { ...state, version: file?.version }
		}))
	}

	/** A new workspace under orm.workspacePath; the monitor starts its schema */
	public async create (principal: Principal, request: { path?: unknown, template?: unknown, copyOf?: unknown, name?: unknown, description?: unknown }): Promise<{ path: string, version: string }> {
		this.require(principal, 'schemaAdmin')
		if (this.options.root === undefined) throw new GatewayError(409, 'ConflictError', 'new workspaces need orm.workspacePath')
		if (typeof request.path !== 'string') throw badRequest('ValidationError', 'path is required (the route of the new schema, like iot/v1)')
		const path = normalizeSchemaPath(request.path)
		const issues = [...schemaPathIssues(path), ...(path === '' ? ['a new schema needs a route (the root is for a gateway with one schema)'] : [])]
		const existing = this.schemas().map(s => s.path)
		issues.push(...schemaPathsIssues([...existing, path]).filter(i => !schemaPathsIssues(existing).includes(i)))
		if (issues.length) throw badRequest('ValidationError', issues.join('; '))
		let text = EMPTY_SCHEMA
		if (request.copyOf !== undefined) {
			if (typeof request.copyOf !== 'string') throw badRequest('ValidationError', 'copyOf is the route of a schema')
			const source = await this.store.read(this.workspaceOf(normalizeSchemaPath(request.copyOf)), SCHEMA_FILE)
			if (!source) throw notFound(`schema "${request.copyOf}" has no ${SCHEMA_FILE}`)
			text = source.text
		} else if (request.template !== undefined && request.template !== 'empty') {
			throw badRequest('ValidationError', `unknown template "${String(request.template)}" (empty)`)
		}
		// what the schema is, for people: on top of a new file, or over those of the copied one
		const about = Object.fromEntries((['name', 'description'] as const)
			.filter(k => typeof request[k] === 'string' && (request[k] as string).trim())
			.map(k => [k, (request[k] as string).trim()]))
		if (Object.keys(about).length) {
			const parsed = (this.yaml.parse(text) ?? {}) as Record<string, unknown>
			if (Object.keys(about).some(k => k in parsed)) {
				text = this.yaml.merge(text, { ...parsed, ...about })
			} else {
				const lines = text.split('\n')
				let top = 0
				while (top < lines.length && lines[top].startsWith('#')) top++
				text = [...lines.slice(0, top), this.yaml.stringify(about).trimEnd(), ...lines.slice(top)].join('\n')
			}
		}
		const dir = this.store.folderOf(this.options.root, path)
		try {
			await this.store.create(dir, { [SCHEMA_FILE]: text, [`${WORKBENCH}/${FOLDER_FILE}`]: '' })
		} catch (error: any) {
			if (error?.code === 'EEXIST') throw new GatewayError(409, 'ConflictError', `the folder of "${path}" already exists`)
			throw error
		}
		this.audit(principal, 'created', path)
		const file = await this.store.read(dir, SCHEMA_FILE)
		return { path, version: file!.version }
	}

	/** Moves the workspace to .trash (nothing is deleted); confirm repeats its route */
	public async remove (principal: Principal, path: string, confirm: unknown): Promise<{ path: string, trash: string }> {
		this.require(principal, 'schemaAdmin')
		const workspace = this.workspaceOf(path)
		if (confirm !== path) throw badRequest('ValidationError', `to remove "${path}", confirm with its route (?confirm=${encodeURIComponent(path)})`)
		if (this.options.root === undefined) throw new GatewayError(409, 'ConflictError', 'only the workspaces under orm.workspacePath can be removed from here')
		const trash = await this.store.withLock(workspace, () => this.store.trash(this.options.root!, workspace))
		this.audit(principal, 'removed', `${path} (to ${trash})`)
		return { path, trash }
	}

	// ─── the schema ──────────────────────────────────────────────────────────

	public async readSchema (principal: Principal, path: string): Promise<{ text: string, version: string }> {
		this.require(principal, 'schemaRead')
		const file = await this.store.read(this.workspaceOf(path), SCHEMA_FILE)
		if (!file) throw notFound(`schema "${path}" has no ${SCHEMA_FILE}`)
		return { text: file.text, version: file.version }
	}

	public async validate (principal: Principal, text: unknown): Promise<{ valid: boolean, issues: SchemaIssue[] }> {
		this.require(principal, 'schemaRead')
		if (typeof text !== 'string') throw badRequest('ValidationError', 'text is required (the lambdaORM.yaml)')
		const issues = await this.validator.validate(text)
		return { valid: !issues.some(i => i.severity === 'error'), issues }
	}

	/**
	 * Replaces the lambdaORM.yaml if it is still the version read (ifMatch) and the new one is valid; the schema is
	 * reloaded by the monitor (blue-green). 412 with the current text when another changed it.
	 */
	public async writeSchema (principal: Principal, path: string, text: unknown, ifMatch: string | undefined): Promise<{ version: string, issues: SchemaIssue[] }> {
		this.require(principal, 'schemaWrite')
		if (typeof text !== 'string') throw badRequest('ValidationError', 'text is required (the lambdaORM.yaml)')
		if (!ifMatch) throw new GatewayError(428, 'PreconditionRequiredError', 'say which version it changes: If-Match with the version read')
		if (Buffer.byteLength(text) > this.options.maxFileBytes) throw new GatewayError(413, 'PayloadTooLargeError', `the file is larger than admin.maxFileBytes (${this.options.maxFileBytes})`)
		const workspace = this.workspaceOf(path)
		const issues = await this.validator.validate(text)
		if (issues.some(i => i.severity === 'error')) throw invalidSchema(issues)
		let before: string | undefined
		const version = await this.store.withLock(workspace, async () => {
			try {
				before = (await this.store.read(workspace, SCHEMA_FILE))?.text
				return await this.store.write(workspace, SCHEMA_FILE, text, ifMatch)
			} catch (error) {
				if (error instanceof VersionConflict) {
					const current = await this.store.read(workspace, SCHEMA_FILE)
					throw preconditionFailed(`${SCHEMA_FILE} of "${path}" changed since it was read`, { version: current?.version, text: current?.text, changedBy: await this.changedBy(workspace) })
				}
				throw error
			}
		})
		this.audit(principal, 'wrote', `${path}/${SCHEMA_FILE}`)
		await this.changed(principal, path, workspace, {
			kind: 'schema.write',
			diff: before === undefined ? undefined : this.diffOf(before, text),
			version: { before: ifMatch.slice(0, 16), after: version.slice(0, 16) }
		})
		return { version, issues }
	}

	/**
	 * One change of one element (a form): applied on the lambdaORM.yaml as it is now, if that element is still as the
	 * form read it (another element changed meanwhile doesn't matter), written keeping the comments and the rest of the
	 * file, and only if the schema stays valid.
	 */
	public async patchSchema (principal: Principal, path: string, patch: SchemaPatch): Promise<{ version: string, references: string[], added: number, removed: number, issues: SchemaIssue[] }> {
		this.require(principal, 'schemaWrite')
		const workspace = this.workspaceOf(path)
		return this.store.withLock(workspace, async () => {
			const file = await this.store.read(workspace, SCHEMA_FILE)
			if (!file) throw notFound(`schema "${path}" has no ${SCHEMA_FILE}`)
			let changed: { schema: unknown, references: string[] }
			const before = this.yaml.parse(file.text)
			try {
				changed = applyPatch(structuredClone(before), patch)
			} catch (error) {
				if (!(error instanceof PatchError)) throw error
				if (error.kind === 'conflict') throw preconditionFailed(error.message, { current: error.current, version: file.version, changedBy: await this.changedBy(workspace, patch.at.join('/')) })
				throw error.kind === 'notFound' ? notFound(error.message) : badRequest('ValidationError', error.message)
			}
			const text = this.yaml.merge(file.text, changed.schema)
			const issues = await this.validator.validate(text)
			if (issues.some(i => i.severity === 'error')) throw invalidSchema(issues)
			const version = await this.store.write(workspace, SCHEMA_FILE, text, file.version)
			const diff = lineDiff(file.text, text)
			this.audit(principal, `${patch.op} ${patch.at.join('/')}${patch.to ? ` to ${patch.to}` : ''} in`, `${path}/${SCHEMA_FILE}`)
			// the element before and after, as written (variables unsolved), and the diff of the schema
			const renamed = patch.op === 'rename' && patch.to ? [...patch.at.slice(0, -1), patch.to] : patch.at
			await this.changed(principal, path, workspace, {
				kind: 'schema.patch',
				target: patch.at.join('/'),
				op: patch.op,
				before: patch.op === 'add' ? undefined : elementAt(before as any, patch.at)?.value,
				after: patch.op === 'remove' ? undefined : elementAt(changed.schema as any, renamed)?.value,
				diff: jsonDiff(before, changed.schema),
				version: { before: file.version.slice(0, 16), after: version.slice(0, 16) }
			})
			return { version, references: changed.references, added: diff.added, removed: diff.removed, issues }
		})
	}

	/** Who uses an element: what to warn about before removing it */
	public async references (principal: Principal, path: string, at: unknown): Promise<{ references: string[] }> {
		this.require(principal, 'schemaRead')
		if (!Array.isArray(at) || at.some(s => typeof s !== 'string')) throw badRequest('ValidationError', 'at is the path of names of the element')
		const file = await this.store.read(this.workspaceOf(path), SCHEMA_FILE)
		if (!file) throw notFound(`schema "${path}" has no ${SCHEMA_FILE}`)
		return { references: referencesOf(this.yaml.parse(file.text), at as string[]) }
	}

	// ─── build ───────────────────────────────────────────────────────────────

	/**
	 * The code of the domain for a language (as `lambdaorm build`): model.ts and a repository per entity, under the src
	 * and domain paths of the schema (infrastructure.paths, src/domain by default). With write, in the workspace: the
	 * model rewritten, a repository only when it is not there (it is the user's once written). Packages are not
	 * installed: that is for the project that uses the code.
	 */
	public async build (principal: Principal, path: string, request: { language?: unknown, write?: unknown, model?: unknown, repositories?: unknown }, domain: unknown): Promise<{ language: string, files: { path: string, content: string, written?: 'created' | 'updated' | 'kept' }[] }> {
		this.require(principal, 'build')
		const language = request.language ?? 'node'
		if (language !== 'node' && language !== 'client-node') throw badRequest('ValidationError', 'language is node or client-node')
		const workspace = this.workspaceOf(path)
		const file = await this.store.read(workspace, SCHEMA_FILE)
		let paths: any = {}
		try { paths = (this.yaml.parse(file?.text ?? '') as any)?.infrastructure?.paths ?? {} } catch { /* the defaults */ }
		// each language in a folder of its own under src/: node, client-node, and the ones to come
		const base = `${paths.src || 'src'}/${language}/${paths.domain || 'domain'}`.replace(/\/+/g, '/')
		const generated = this.code.files(language, domain, { model: request.model !== false, repositories: request.repositories !== false })
		const files: { path: string, content: string, written?: 'created' | 'updated' | 'kept' }[] = generated.map(g => ({ path: `${base}/${g.file}`, content: g.content }))
		if (request.write === true) {
			await this.store.withLock(workspace, async () => {
				for (const f of files) {
					const existing = await this.store.read(workspace, f.path)
					if (existing && !f.path.endsWith('/model.ts')) { f.written = 'kept'; continue }
					await this.store.write(workspace, f.path, f.content)
					f.written = existing ? 'updated' : 'created'
				}
			})
			this.audit(principal, `built ${language} code (${files.filter(f => f.written !== 'kept').length} files) in`, `${path}/${base}`)
			await this.changed(principal, path, workspace, { kind: 'code.build', target: base })
		}
		return { language: language as string, files }
	}

	// ─── files (data/, src/) ─────────────────────────────────────────────────

	/** The folders of a workspace whose files can be seen: its data and its code (infrastructure.paths, data and src by default) */
	private async fileRoots (workspace: string): Promise<{ data: string, src: string, model: string }> {
		const file = await this.store.read(workspace, SCHEMA_FILE)
		let paths: any = {}
		try { paths = (this.yaml.parse(file?.text ?? '') as any)?.infrastructure?.paths ?? {} } catch { /* the defaults */ }
		const clean = (p: unknown, fallback: string) => (typeof p === 'string' && p.trim() ? p.trim() : fallback).replace(/^\.?\/+|\/+$/g, '')
		const src = clean(paths.src, 'src')
		return { data: clean(paths.data, 'data'), src, model: `${src}/${clean(paths.domain, 'domain')}` }
	}

	/** A path a person may read: inside data/ or src/, never the .env, the state of λORM or a hidden file */
	private async readable (workspace: string, path: unknown): Promise<string> {
		if (typeof path !== 'string' || !path.trim()) throw badRequest('ValidationError', 'path is required (data/… or src/…)')
		const relative = path.replace(/\\/g, '/').replace(/^\/+/, '')
		const roots = await this.fileRoots(workspace)
		const parts = relative.split('/')
		if (parts.some(p => p === '..' || p.startsWith('.'))) throw badRequest('ValidationError', `"${path}" is not a file that can be read`)
		if (![roots.data, roots.src].some(root => relative === root || relative.startsWith(`${root}/`))) {
			throw new GatewayError(403, 'ForbiddenError', `only the files of ${roots.data}/ and ${roots.src}/ can be read here`)
		}
		return relative
	}

	/** The files under a folder of data/ or src/ (recursive), and where the data, code and model folders are */
	public async files (principal: Principal, path: string, dir: unknown): Promise<{ roots: { data: string, src: string, model: string }, files: { path: string, dir: boolean, modified: string }[] }> {
		this.require(principal, 'schemaRead')
		const workspace = this.workspaceOf(path)
		const roots = await this.fileRoots(workspace)
		const folder = await this.readable(workspace, dir ?? roots.data)
		return { roots, files: await this.store.list(workspace, folder) }
	}

	/** The text of a file of data/ or src/ (an export, a script, the code of build) */
	/**
	 * The files of a folder of data/ or src/, as they are in the workspace (the code of a language, with its repositories
	 * as edited): its name and its files, relative to the folder, to be zipped
	 */
	public async folderFiles (principal: Principal, path: string, dir: unknown): Promise<{ name: string, files: { path: string, content: string }[] }> {
		this.require(principal, 'schemaRead')
		const workspace = this.workspaceOf(path)
		const folder = await this.readable(workspace, dir)
		const listed = (await this.store.list(workspace, folder)).filter(f => !f.dir)
		const files: { path: string, content: string }[] = []
		for (const f of listed) {
			const file = await this.store.read(workspace, f.path)
			if (file) files.push({ path: f.path.slice(folder.length + 1), content: file.text })
		}
		return { name: folder.split('/').pop() || folder, files }
	}

	/**
	 * A folder of the source code taken out of the workspace (the code of a language under src/, with its repositories):
	 * nothing else can be removed so
	 */
	public async removeCode (principal: Principal, path: string, dir: unknown): Promise<{ removed: string }> {
		this.require(principal, 'build')
		const workspace = this.workspaceOf(path)
		const roots = await this.fileRoots(workspace)
		const folder = await this.readable(workspace, dir)
		if (!folder.startsWith(`${roots.src}/`)) throw new GatewayError(403, 'ForbiddenError', `only a folder of ${roots.src}/ can be removed here`)
		const listed = await this.store.list(workspace, folder)
		if (!listed.length) throw notFound(`"${folder}" is not in the workspace of "${path}"`)
		await this.store.withLock(workspace, () => this.store.remove(workspace, folder))
		this.audit(principal, `removed the code ${folder} of`, path)
		await this.changed(principal, path, workspace, { kind: 'code.remove', target: folder })
		return { removed: folder }
	}

	public async fileContent (principal: Principal, path: string, file: unknown): Promise<{ path: string, text: string, version: string, modified: string }> {
		this.require(principal, 'schemaRead')
		const workspace = this.workspaceOf(path)
		const relative = await this.readable(workspace, file)
		const read = await this.store.read(workspace, relative)
		if (!read) throw notFound(`${relative} is not a file of "${path || '/'}"`)
		if (Buffer.byteLength(read.text) > this.options.maxFileBytes) throw new GatewayError(413, 'PayloadTooLargeError', `${relative} is larger than admin.maxFileBytes: download it from the volume`)
		return { path: relative, ...read }
	}

	// ─── connections (.env) ──────────────────────────────────────────────────

	/**
	 * The variables of a workspace: the ones its lambdaORM.yaml names (${NAME}) and the ones its .env defines, each with
	 * whether the .env defines it and the sources that use it. Never a value: they are secrets. A variable may also come
	 * from orm.schemas[].env or the environment of the gateway (runtime.env.passthrough): `defined` is only the .env.
	 */
	public async variables (principal: Principal, path: string): Promise<{ variables: { name: string, defined: boolean, usedBy: string[], used: boolean }[] }> {
		this.require(principal, 'schemaRead')
		const workspace = this.workspaceOf(path)
		const [schemaFile, envFile] = await Promise.all([this.store.read(workspace, SCHEMA_FILE), this.store.read(workspace, '.env')])
		let schema: unknown
		try { schema = this.yaml.parse(schemaFile?.text ?? '') } catch { schema = undefined }
		const used = schemaVariables(schema, schemaFile?.text ?? '')
		const defined = new Set(dotEnvNames(envFile?.text ?? ''))
		const names = [...new Set([...used.keys(), ...defined])].sort()
		return { variables: names.map(name => ({ name, defined: defined.has(name), usedBy: used.get(name) ?? [], used: used.has(name) })) }
	}

	/** Sets and removes variables of the .env, keeping the rest of it; the monitor reloads the schema with them */
	public async setVariables (principal: Principal, path: string, request: { set?: unknown, remove?: unknown }): Promise<{ variables: { name: string, defined: boolean, usedBy: string[], used: boolean }[] }> {
		this.require(principal, 'schemaAdmin')
		const set = request.set ?? {}
		const remove = request.remove ?? []
		if (typeof set !== 'object' || Array.isArray(set) || Object.values(set).some(v => typeof v !== 'string')) throw badRequest('ValidationError', 'set is { NAME: "value" }')
		if (!Array.isArray(remove) || remove.some(v => typeof v !== 'string')) throw badRequest('ValidationError', 'remove is a list of names')
		const bad = [...Object.keys(set), ...remove].filter(n => !VARIABLE_NAME.test(n))
		if (bad.length) throw badRequest('ValidationError', `not names of variables: ${bad.join(', ')}`)
		const workspace = this.workspaceOf(path)
		await this.store.withLock(workspace, async () => {
			const current = await this.store.read(workspace, '.env')
			let text: string
			try {
				text = editDotEnv(current?.text ?? '', set as Record<string, string>, remove as string[])
			} catch (error: any) {
				throw badRequest('ValidationError', error?.message ?? String(error))
			}
			await this.store.write(workspace, '.env', text, current?.version ?? null)
		})
		// the names, never the values
		this.audit(principal, `set ${Object.keys(set).join(', ') || '-'} and removed ${remove.join(', ') || '-'} in`, `${path}/.env`)
		// the names, never the values
		await this.changed(principal, path, workspace, { kind: 'env.set', target: [...Object.keys(set), ...remove].join(',') })
		return this.variables(principal, path).catch(() => ({ variables: [] }))
	}

	// ─── workbench ───────────────────────────────────────────────────────────

	/** What is saved in every workspace (or in one), and a version of the whole to ask again only if it changed */
	public async workbench (principal: Principal, path?: string): Promise<{ version: string, items: WorkbenchItem[], problems?: WorkbenchProblem[] }> {
		if (!this.can(principal).workbenchRead) throw forbidden(principal.name, 'read')
		const schemas = path === undefined ? this.schemas() : [{ path, workspace: this.workspaceOf(path) }]
		const read = await Promise.all(schemas.map(s => this.read(s.path, s.workspace)))
		const items = read.flatMap(r => r.items)
		const problems = read.flatMap(r => r.problems)
		return { version: versionOfAll(items, problems), items, ...(problems.length ? { problems } : {}) }
	}

	private async itemsOf (schema: string, workspace: string): Promise<WorkbenchItem[]> {
		return (await this.read(schema, workspace)).items
	}

	/**
	 * The items of a workspace. A file that isn't valid YAML (written by hand) is not an item: it is a problem, so that
	 * nothing saved from the UI replaces what it holds.
	 */
	private async read (schema: string, workspace: string): Promise<{ items: WorkbenchItem[], problems: WorkbenchProblem[], files: Set<string> }> {
		const entries = await this.store.list(workspace, WORKBENCH)
		const folders = new Map<string, WorkbenchItem>()
		const items: WorkbenchItem[] = []
		const problems: WorkbenchProblem[] = []
		const files = new Set(entries.map(e => e.path.toLowerCase()))
		let current = ''
		const parse = (text: string): unknown => {
			try {
				return this.yaml.parse(text)
			} catch (error: any) {
				problems.push({ schema, file: current, message: String(error?.message ?? error).split('\n')[0] })
				return PARSE_FAILED
			}
		}
		// the folders first, from the top: a folder's id is in its .folder.yaml
		for (const entry of entries.filter(e => e.dir).sort((a, b) => a.path.length - b.path.length)) {
			const meta = await this.store.read(workspace, `${entry.path}/${FOLDER_FILE}`)
			const parent = folders.get(entry.path.slice(0, entry.path.lastIndexOf('/')))
			current = `${entry.path}/${FOLDER_FILE}`
			const content = meta ? parse(meta.text) : undefined
			const folder = workbenchFolderOf(schema, entry.path, content === PARSE_FAILED ? undefined : content, parent?.id, meta?.version ?? '', entry.modified)
			folders.set(entry.path, folder)
			items.push(folder)
		}
		for (const entry of entries.filter(e => !e.dir)) {
			const name = entry.path.split('/').pop()!
			if (!workbenchKindOf(name)) continue
			const file = await this.store.read(workspace, entry.path)
			if (!file) continue
			const parent = folders.get(entry.path.slice(0, entry.path.lastIndexOf('/')))
			current = entry.path
			const content = parse(file.text)
			if (content === PARSE_FAILED) continue
			const item = workbenchItemOf(schema, entry.path, content, parent?.id, file.version, file.modified)
			if (item) items.push(item)
		}
		return { items, problems, files }
	}

	/**
	 * Saves items (new, changed, moved or renamed). Each one that existed says the version it changes; another
	 * version is a 412 with the ids that changed. A folder moved takes what it holds.
	 */
	public async putItems (principal: Principal, request: { items?: unknown }): Promise<{ items: { id: string, version: string }[] }> {
		this.require(principal, 'workbenchWrite')
		if (!Array.isArray(request.items)) throw badRequest('ValidationError', 'items is a list')
		const incoming = request.items as WorkbenchItem[]
		const bySchema = new Map<string, WorkbenchItem[]>()
		for (const item of incoming) {
			if (!item || typeof item.id !== 'string' || typeof item.schema !== 'string' || typeof item.name !== 'string' || !['folder', 'query', 'diagram', 'panel'].includes(item.kind)) {
				throw badRequest('ValidationError', 'every item has an id, a kind (folder, query, diagram), a schema and a name')
			}
			if (!bySchema.has(item.schema)) bySchema.set(item.schema, [])
			bySchema.get(item.schema)!.push(item)
		}
		const saved: { id: string, version: string }[] = []
		for (const [schema, items] of bySchema) {
			const workspace = this.workspaceOf(schema)
			await this.store.withLock(workspace, async () => {
				const { items: current, files } = await this.read(schema, workspace)
				const currentById = new Map(current.map(i => [i.id, i]))
				const changed = items.filter(i => currentById.has(i.id) && i.version !== undefined && currentById.get(i.id)!.version !== i.version)
				if (changed.length) throw preconditionFailed(`${changed.map(i => `"${i.name}"`).join(', ')} changed since they were read`, { ids: changed.map(i => i.id) })
				const created = items.filter(i => !currentById.has(i.id) && i.version !== undefined && i.version !== '')
				if (created.length) throw preconditionFailed(`${created.map(i => `"${i.name}"`).join(', ')} no longer exist`, { ids: created.map(i => i.id) })
				// the places of everything as it will be: the ones that stay, and the ones saved
				const next = new Map(current.map(i => [i.id, i]))
				for (const item of items) next.set(item.id, item)
				const { places, issues } = workbenchPlaces([...next.values()])
				if (issues.length) throw badRequest('ValidationError', issues.join('; '))
				const oldPlaces = workbenchPlaces(current).places
				// a place taken by a file that is not this item (one that can't be read, or written by hand meanwhile)
				const owned = new Set([...oldPlaces.values()].map(p => p.toLowerCase()))
				const taken = items.filter(i => i.kind !== 'folder' && files.has(places.get(i.id)!.toLowerCase()) && !owned.has(places.get(i.id)!.toLowerCase()))
				if (taken.length) throw new GatewayError(409, 'ConflictError', `${taken.map(i => places.get(i.id)).join(', ')} already exists and is not that item (fix or rename the file)`)
				// the folders first (the shallowest first: a moved folder takes what is inside)
				const ordered = [...items].sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || (places.get(a.id)!.length - places.get(b.id)!.length))
				for (const item of ordered) {
					const place = places.get(item.id)!
					const old = oldPlaces.get(item.id)
					// where it is now: its old place, under the new place of a folder already moved
					const now = old === undefined ? undefined : this.relocated(old, oldPlaces, places, ordered, item.id)
					const text = this.yaml.stringify({ ...workbenchContent(item), updatedAt: item.updatedAt ?? this.clock.now().toISOString() })
					if (Buffer.byteLength(text) > this.options.maxFileBytes) throw new GatewayError(413, 'PayloadTooLargeError', `"${item.name}" is larger than admin.maxFileBytes`)
					if (now !== undefined && now !== place) await this.store.move(workspace, now, place)
					if (item.kind === 'folder') {
						await this.store.mkdir(workspace, place)
						saved.push({ id: item.id, version: await this.store.write(workspace, `${place}/${FOLDER_FILE}`, text) })
					} else {
						saved.push({ id: item.id, version: await this.store.write(workspace, place, text) })
					}
				}
			})
			this.audit(principal, 'saved', `${items.length} item(s) in ${schema || '/'}/${WORKBENCH}`)
		}
		return { items: saved }
	}

	/** The old place of an item, once the folders that were moved before it in this save are where they go */
	private relocated (old: string, oldPlaces: Map<string, string>, places: Map<string, string>, ordered: WorkbenchItem[], id: string): string {
		let now = old
		for (const folder of ordered) {
			if (folder.id === id) break
			if (folder.kind !== 'folder') continue
			const from = oldPlaces.get(folder.id)
			const to = places.get(folder.id)
			if (from && to && from !== to && now.startsWith(from + '/')) now = to + now.slice(from.length)
		}
		return now
	}

	/** Deletes items (a folder with what it holds) */
	public async removeItems (principal: Principal, request: { ids?: unknown }): Promise<{ removed: string[] }> {
		this.require(principal, 'workbenchWrite')
		if (!Array.isArray(request.ids) || request.ids.some(id => typeof id !== 'string')) throw badRequest('ValidationError', 'ids is a list of ids')
		const ids = new Set(request.ids as string[])
		const removed: string[] = []
		for (const schema of this.schemas()) {
			await this.store.withLock(schema.workspace, async () => {
				const current = await this.itemsOf(schema.path, schema.workspace)
				const { places } = workbenchPlaces(current)
				// the deepest first: a folder removed after what it held is not removed twice
				const targets = current.filter(i => ids.has(i.id)).sort((a, b) => places.get(b.id)!.length - places.get(a.id)!.length)
				for (const item of targets) {
					await this.store.remove(schema.workspace, places.get(item.id)!)
					removed.push(item.id)
				}
			})
		}
		return { removed }
	}
}

/** A file of workbench/ that is not an item: what is wrong with it */
export interface WorkbenchProblem {
	schema: string
	file: string
	message: string
}

const PARSE_FAILED = Symbol('parse failed')

/** One version for a set of items: it changes when any of them changes */
const versionOfAll = (items: WorkbenchItem[], problems: WorkbenchProblem[] = []): string => {
	let hash = 0
	const keys = [...items.map(i => `${i.schema}\0${i.id}\0${i.version}\0${i.parentId ?? ''}\0${i.name}`), ...problems.map(p => `!${p.schema}\0${p.file}\0${p.message}`)]
	for (const text of keys.sort()) {
		for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
	}
	return `${items.length}-${(hash >>> 0).toString(16)}`
}
