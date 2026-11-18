/** What a person keeps in a schema: folders to organise, queries (and diagrams) with a name and a description */
export type SavedKind = 'folder' | 'query' | 'diagram'

interface SavedBase {
	id: string
	kind: SavedKind
	/** Path of the schema it belongs to ('' is the schema at the root) */
	schema: string
	/** The folder it is in; undefined at the top of the schema */
	parentId?: string
	name: string
	description?: string
	createdAt: string
	updatedAt: string
}

export interface SavedFolder extends SavedBase { kind: 'folder' }

export interface SavedQueryContent {
	mode: 'query' | 'script'
	query: string
	script: string
	/** JSON texts, as the editors have them */
	data: string
	options: string
}

export interface SavedQuery extends SavedBase, SavedQueryContent { kind: 'query' }

export interface SavedDiagram extends SavedBase {
	kind: 'diagram'
	entities: string[]
	/** Where each box was left; without them, the layout places them */
	positions?: Record<string, { x: number, y: number }>
	/** Where each line moved by hand has its vertical stretch (x), by the id of the line */
	bends?: Record<string, number>
	compact?: boolean
	/** The names of the relations on their lines */
	relationNames?: boolean
}

export type SavedItem = SavedFolder | SavedQuery | SavedDiagram

export const newId = (): string => {
	const crypto = (globalThis as any).crypto
	// randomUUID needs a secure context (https, localhost); a gateway served over plain http has none
	if (crypto?.randomUUID) return crypto.randomUUID()
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

/** The items directly in a folder (or at the top of a schema): folders first, then by name */
export const childrenOf = (items: SavedItem[], schema: string, parentId: string | undefined): SavedItem[] =>
	items.filter(i => i.schema === schema && i.parentId === parentId)
		.sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))

/** The ids of an item and everything under it */
export const subtreeOf = (items: SavedItem[], id: string): string[] => {
	const ids = [id]
	for (let i = 0; i < ids.length; i++) for (const item of items) if (item.parentId === ids[i]) ids.push(item.id)
	return ids
}

/** The folders of a schema with their path ("Reports / 2026"), to choose one */
export const folderPaths = (items: SavedItem[], schema: string): { id: string, path: string }[] => {
	const byId = new Map(items.map(i => [i.id, i]))
	const pathOf = (item: SavedItem): string => {
		const parent = item.parentId ? byId.get(item.parentId) : undefined
		return parent ? `${pathOf(parent)} / ${item.name}` : item.name
	}
	return items.filter(i => i.schema === schema && i.kind === 'folder').map(f => ({ id: f.id, path: pathOf(f) })).sort((a, b) => a.path.localeCompare(b.path))
}

/** Whether an item can go into a folder (or the top of its schema): the same schema, never into itself or under itself */
export const canMove = (items: SavedItem[], id: string, parentId: string | undefined): boolean => {
	const item = items.find(i => i.id === id)
	if (!item) return false
	if (parentId === undefined) return true
	const parent = items.find(i => i.id === parentId)
	if (!parent || parent.kind !== 'folder' || parent.schema !== item.schema) return false
	return !subtreeOf(items, id).includes(parentId)
}

export type NameProblem = 'required' | 'taken'

/** A name is required, and two of the same kind in the same folder don't share it */
export const nameProblem = (items: SavedItem[], candidate: { id?: string, kind: SavedKind, schema: string, parentId?: string, name: string }): NameProblem | undefined => {
	const name = candidate.name.trim()
	if (!name) return 'required'
	const taken = items.some(i => i.id !== candidate.id && i.kind === candidate.kind && i.schema === candidate.schema && i.parentId === candidate.parentId &&
		i.name.trim().localeCompare(name, undefined, { sensitivity: 'base' }) === 0)
	return taken ? 'taken' : undefined
}

export const EXPORT_FORMAT = 'lambdaorm-workspace'

export interface WorkspaceExport {
	format: typeof EXPORT_FORMAT
	version: 1
	exportedAt: string
	items: SavedItem[]
}

const isString = (value: unknown): value is string => typeof value === 'string'

/** The items of an export file, checked; undefined when the file isn't one */
export const parseExport = (text: string): SavedItem[] | undefined => {
	let file: any
	try { file = JSON.parse(text) } catch { return undefined }
	if (!file || file.format !== EXPORT_FORMAT || !Array.isArray(file.items)) return undefined
	const items: SavedItem[] = []
	for (const raw of file.items) {
		if (!raw || !isString(raw.id) || !isString(raw.schema) || !isString(raw.name) || !['folder', 'query', 'diagram'].includes(raw.kind)) return undefined
		if (raw.parentId !== undefined && !isString(raw.parentId)) return undefined
		const base = {
			id: raw.id,
			schema: raw.schema,
			parentId: raw.parentId,
			name: raw.name,
			description: isString(raw.description) ? raw.description : undefined,
			createdAt: isString(raw.createdAt) ? raw.createdAt : new Date().toISOString(),
			updatedAt: isString(raw.updatedAt) ? raw.updatedAt : new Date().toISOString()
		}
		if (raw.kind === 'folder') items.push({ ...base, kind: 'folder' })
		else if (raw.kind === 'query') {
			items.push({
				...base,
				kind: 'query',
				mode: raw.mode === 'script' ? 'script' : 'query',
				query: isString(raw.query) ? raw.query : '',
				script: isString(raw.script) ? raw.script : '',
				data: isString(raw.data) ? raw.data : '{}',
				options: isString(raw.options) ? raw.options : '{}'
			})
		} else {
			if (!Array.isArray(raw.entities) || !raw.entities.every(isString)) return undefined
			items.push({ ...base, kind: 'diagram', entities: raw.entities, positions: raw.positions && typeof raw.positions === 'object' ? raw.positions : undefined, bends: raw.bends && typeof raw.bends === 'object' ? raw.bends : undefined, compact: raw.compact === true, relationNames: raw.relationNames === true })
		}
	}
	// an item whose folder isn't in the file goes to the top of its schema
	const ids = new Set(items.map(i => i.id))
	return items.map(i => i.parentId && !ids.has(i.parentId) ? { ...i, parentId: undefined } : i)
}

export const toExport = (items: SavedItem[], now = new Date()): WorkspaceExport => ({ format: EXPORT_FORMAT, version: 1, exportedAt: now.toISOString(), items })
