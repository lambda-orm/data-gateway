import { Permission } from '../../domain/auth/permission'
import { Principal } from '../../domain/auth/principal'
import {
	FOLDER_FILE, WORKBENCH, WorkbenchItem, workbenchContent, workbenchFolderOf, workbenchItemOf, workbenchKindOf, workbenchPlaces
} from '../../domain/admin/workbench'
import { badRequest, forbidden, GatewayError, notFound } from '../../domain/errors/gatewayError'
import { SchemaState } from '../../domain/runtime/policies'
import { normalizeSchemaPath, schemaPathIssues, schemaPathsIssues } from '../../domain/runtime/schemaPath'
import { SchemaIssue, SchemaValidatorPort, VersionConflict, WorkspaceStorePort, YamlPort } from '../ports/output/adminPorts'
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
		private readonly logger: LoggerPort
	) {}

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
			workbenchWrite: has('workbenchWrite')
		}
	}

	private audit (principal: Principal, action: string, target: string): void {
		this.logger.info(`[data-gateway] admin: "${principal.name}" ${action} ${target}`)
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
	public async create (principal: Principal, request: { path?: unknown, template?: unknown, copyOf?: unknown }): Promise<{ path: string, version: string }> {
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
		const version = await this.store.withLock(workspace, async () => {
			try {
				return await this.store.write(workspace, SCHEMA_FILE, text, ifMatch)
			} catch (error) {
				if (error instanceof VersionConflict) {
					const current = await this.store.read(workspace, SCHEMA_FILE)
					throw preconditionFailed(`${SCHEMA_FILE} of "${path}" changed since it was read`, { version: current?.version, text: current?.text })
				}
				throw error
			}
		})
		this.audit(principal, 'wrote', `${path}/${SCHEMA_FILE}`)
		return { version, issues }
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
			if (!item || typeof item.id !== 'string' || typeof item.schema !== 'string' || typeof item.name !== 'string' || !['folder', 'query', 'diagram'].includes(item.kind)) {
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
