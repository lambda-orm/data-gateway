/**
 * What is saved in a workspace (docs/DATA_GATEWAY_ADMIN_PLAN.md §3.5): folders, queries, scripts and diagrams under
 * workbench/, one file per item and real folders, so that they can be versioned with git next to the schema and two
 * people that save different things don't collide.
 *
 *   workbench/reports/                  a folder (.folder.yaml: its id and description)
 *   workbench/reports/sales.query.yaml  a query
 *   workbench/reports/close.script.yaml a script (a saved query in script mode)
 *   workbench/model.diagram.yaml        a diagram
 *
 * The items are those of @lambdaorm/ui (SavedItem): an id, the schema, the folder (parentId), a name and a description.
 */
export type WorkbenchKind = 'folder' | 'query' | 'diagram'

export interface WorkbenchItem {
	id: string
	kind: WorkbenchKind
	/** the route of the schema whose workspace holds it */
	schema: string
	parentId?: string
	name: string
	description?: string
	createdAt?: string
	updatedAt?: string
	/** a hash of its file: what a write sends back to say which version it changes */
	version?: string
	/** query */
	mode?: 'query' | 'script'
	query?: string
	script?: string
	data?: string
	options?: string
	/** diagram */
	entities?: string[]
	positions?: Record<string, { x: number, y: number }>
	bends?: Record<string, number>
	compact?: boolean
	/** what each box shows: all its properties, the keys (PK and FK), the primary key, or its name */
	detail?: 'all' | 'keys' | 'pk' | 'name'
	relationNames?: boolean
}

export const WORKBENCH = 'workbench'
export const FOLDER_FILE = '.folder.yaml'

const SUFFIXES: { suffix: string, kind: WorkbenchKind, mode?: 'query' | 'script' }[] = [
	{ suffix: '.query.yaml', kind: 'query', mode: 'query' },
	{ suffix: '.script.yaml', kind: 'query', mode: 'script' },
	{ suffix: '.diagram.yaml', kind: 'diagram' }
]

/** What a name can't be, as the name of a file of every system: empty, a path, `.` / `..`, hidden, too long */
export const workbenchNameIssue = (name: string): string | undefined => {
	const trimmed = name.trim()
	if (!trimmed) return 'a name is required'
	if (trimmed !== name) return `"${name}" starts or ends with spaces`
	if (/[/\\:*?"<>|]/.test(name) || [...name].some(c => c.charCodeAt(0) < 32)) return `"${name}" has a character a file name can't have (/ \\ : * ? " < > |)`
	if (name === '.' || name === '..' || name.startsWith('.')) return `"${name}" can't start with a dot`
	if (name.length > 120) return `"${name.slice(0, 20)}…" is longer than 120 characters`
	return undefined
}

/** The name of the file of an item in its folder */
export const workbenchFileName = (item: Pick<WorkbenchItem, 'kind' | 'name' | 'mode'>): string => {
	if (item.kind === 'folder') return item.name
	if (item.kind === 'diagram') return `${item.name}.diagram.yaml`
	return `${item.name}.${item.mode === 'script' ? 'script' : 'query'}.yaml`
}

/** The kind of a file of workbench/ by its name; undefined for a file that is not an item */
export const workbenchKindOf = (fileName: string): { kind: WorkbenchKind, mode?: 'query' | 'script', name: string } | undefined => {
	for (const { suffix, kind, mode } of SUFFIXES) {
		if (fileName.endsWith(suffix) && fileName.length > suffix.length) return { kind, mode, name: fileName.slice(0, -suffix.length) }
	}
	return undefined
}

/** What the file of an item holds: everything but what its place says (schema, folder, name, kind) */
export const workbenchContent = (item: WorkbenchItem): Record<string, unknown> => {
	const content: Record<string, unknown> = { id: item.id }
	if (item.description) content.description = item.description
	if (item.kind === 'query') {
		content.mode = item.mode ?? 'query'
		content.query = item.query ?? ''
		content.script = item.script ?? ''
		content.data = item.data ?? '{}'
		content.options = item.options ?? '{}'
	}
	if (item.kind === 'diagram') {
		content.entities = item.entities ?? []
		for (const key of ['positions', 'bends', 'compact', 'detail', 'relationNames'] as const) {
			if (item[key] !== undefined) content[key] = item[key]
		}
	}
	if (item.createdAt) content.createdAt = item.createdAt
	if (item.updatedAt) content.updatedAt = item.updatedAt
	return content
}

const text = (value: unknown, fallback: string): string => typeof value === 'string' ? value : value === undefined || value === null ? fallback : JSON.stringify(value)

/**
 * An item from its file. A file written by hand may lack the id (it is its place: `file:workbench/a.query.yaml`, until
 * it is moved) or have data and options as YAML instead of JSON text.
 */
export const workbenchItemOf = (
	schema: string, file: string, content: unknown, parentId: string | undefined, version: string, modified: string
): WorkbenchItem | undefined => {
	const fileName = file.split('/').pop()!
	const kind = workbenchKindOf(fileName)
	if (!kind) return undefined
	const c = (content && typeof content === 'object' && !Array.isArray(content) ? content : {}) as Record<string, any>
	const item: WorkbenchItem = {
		id: typeof c.id === 'string' && c.id ? c.id : `file:${file}`,
		kind: kind.kind,
		schema,
		parentId,
		name: kind.name,
		description: typeof c.description === 'string' ? c.description : undefined,
		createdAt: typeof c.createdAt === 'string' ? c.createdAt : modified,
		updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : modified,
		version
	}
	if (kind.kind === 'query') {
		item.mode = kind.mode
		item.query = text(c.query, '')
		item.script = text(c.script, '')
		item.data = text(c.data, '{}')
		item.options = text(c.options, '{}')
	} else {
		item.entities = Array.isArray(c.entities) ? c.entities.filter((e: unknown) => typeof e === 'string') : []
		for (const key of ['positions', 'bends', 'compact', 'detail', 'relationNames'] as const) {
			if (c[key] !== undefined) (item as any)[key] = c[key]
		}
	}
	return item
}

/** A folder from its directory (and its .folder.yaml, if it has one) */
export const workbenchFolderOf = (
	schema: string, dir: string, content: unknown, parentId: string | undefined, version: string, modified: string
): WorkbenchItem => {
	const c = (content && typeof content === 'object' && !Array.isArray(content) ? content : {}) as Record<string, any>
	return {
		id: typeof c.id === 'string' && c.id ? c.id : `file:${dir}`,
		kind: 'folder',
		schema,
		parentId,
		name: dir.split('/').pop()!,
		description: typeof c.description === 'string' ? c.description : undefined,
		createdAt: typeof c.createdAt === 'string' ? c.createdAt : modified,
		updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : modified,
		version
	}
}

/**
 * Where each item goes: its folders' names from the top of workbench/. Problems: a folder that doesn't exist (or is in
 * another schema), a cycle, an invalid name, two items of the same kind and name in a folder.
 */
export const workbenchPlaces = (items: WorkbenchItem[]): { places: Map<string, string>, issues: string[] } => {
	const byId = new Map(items.map(i => [i.id, i]))
	const places = new Map<string, string>()
	const issues: string[] = []
	const placeOf = (item: WorkbenchItem, seen: Set<string>): string | undefined => {
		if (places.has(item.id)) return places.get(item.id)
		const issue = workbenchNameIssue(item.name)
		if (issue) { issues.push(issue); return undefined }
		let base = WORKBENCH
		if (item.parentId !== undefined) {
			const parent = byId.get(item.parentId)
			if (!parent || parent.kind !== 'folder' || parent.schema !== item.schema) { issues.push(`"${item.name}" is in a folder that doesn't exist (${item.parentId})`); return undefined }
			if (seen.has(parent.id)) { issues.push(`"${item.name}" is inside itself`); return undefined }
			const parentPlace = placeOf(parent, new Set([...seen, item.id]))
			if (parentPlace === undefined) return undefined
			base = parentPlace
		}
		const place = `${base}/${workbenchFileName(item)}`
		places.set(item.id, place)
		return place
	}
	for (const item of items) placeOf(item, new Set([item.id]))
	const taken = new Map<string, string>()
	for (const item of items) {
		const place = places.get(item.id)
		if (!place) continue
		const key = `${item.schema}\0${place.toLowerCase()}`
		const other = taken.get(key)
		if (other !== undefined) issues.push(`"${item.name}" and another ${item.kind} have the same name in the same folder`)
		else taken.set(key, item.id)
	}
	return { places, issues }
}
