import { DomainInfo, EntityInfo, RelationInfo } from './diagram'

/**
 * The query wizard: an entity to start from, the tables added through its relations, the fields chosen of each, a
 * general filter, the order and the page; and the query of λORM that reads them. Every relation (to one or to many) is
 * an include of its own, with the fields chosen of its table in its map (and its own includes); the map of the root has
 * only its fields. An empty filter, order or page is not applied.
 */
export interface WizardTable {
	entity: string
	/** the table it is reached from, and the relation of that table */
	from: string
	relation: string
}

export interface WizardSort {
	/** a field of the root (in its map), or of the entity when nothing is chosen */
	column: string
	desc: boolean
}

export interface WizardState {
	/** the entity the query starts from */
	root: string
	tables: WizardTable[]
	/** the fields chosen of each table (none: every field of that table) */
	fields: Record<string, string[]>
	/** the body of the filter, on the variable p of the root: p.price > 10 && p.category.name == name */
	filter: string
	sort: WizardSort[]
	page: { number: string, size: string }
	/** where the boxes of the diagram were left */
	positions?: Record<string, { x: number, y: number }>
}

export const emptyWizard = (root: string): WizardState => ({ root, tables: [], fields: {}, filter: '', sort: [], page: { number: '', size: '' } })

const entityOf = (domain: DomainInfo, name: string): EntityInfo | undefined => domain.entities.find(e => e.name === name)
/** a relation to many: λORM names it manyToOne (the other entity has many rows for this one) */
export const toMany = (relation: Pick<RelationInfo, 'type'>): boolean => relation.type === 'manyToOne'

/** The tables of the wizard as a tree from the root: each one with its relation */
const childrenOf = (state: WizardState, entity: string): WizardTable[] => state.tables.filter(t => t.from === entity)

const relationOf = (domain: DomainInfo, table: WizardTable): RelationInfo | undefined =>
	entityOf(domain, table.from)?.relations?.find(r => r.name === table.relation)

/**
 * How a table could join the wizard: through a relation to it of the table whose + was used, else of the first table
 * of the wizard that has one (each relation is an include of its own: to one or to many, from any table).
 */
export const joinOf = (domain: DomainInfo, state: WizardState, entity: string, prefer?: string): WizardTable | undefined => {
	if (entity === state.root || state.tables.some(t => t.entity === entity)) return undefined
	const all = [state.root, ...state.tables.map(t => t.entity)]
	const present = prefer && all.includes(prefer) ? [prefer, ...all.filter(e => e !== prefer)] : all
	for (const from of present) {
		const relation = entityOf(domain, from)?.relations?.find(r => r.entity === entity)
		if (relation) return { entity, from, relation: relation.name }
	}
	return undefined
}

/** A table and every table reached from it, taken out of the wizard (and their fields) */
export const withoutTable = (state: WizardState, entity: string): WizardState => {
	if (entity === state.root) return state
	const gone = new Set<string>([entity])
	let grew = true
	while (grew) {
		grew = false
		for (const t of state.tables) if (gone.has(t.from) && !gone.has(t.entity)) { gone.add(t.entity); grew = true }
	}
	const fields = Object.fromEntries(Object.entries(state.fields).filter(([name]) => !gone.has(name)))
	// the order is by fields of the root: it stays
	return { ...state, tables: state.tables.filter(t => !gone.has(t.entity)), fields }
}

/** A column of the result: a field of the root, in its map */
export interface WizardColumn { alias: string, path: string, entity: string, field: string }

/** The columns of the result: the fields chosen of the root (none chosen: all of them); the ones the order can use */
export const columnsOf = (state: WizardState, domain?: DomainInfo): WizardColumn[] => {
	const chosen = state.fields[state.root] ?? []
	const names = chosen.length || !domain ? chosen : (entityOf(domain, state.root)?.properties ?? []).map(p => p.name)
	return names.map(field => ({ alias: field, path: field, entity: state.root, field }))
}

const VARIABLES = ['p', 'q', 'r', 's', 't', 'u', 'v', 'w']

/** The map of a table: ({ field: v.field, … }), or nothing when no field is chosen */
const mapOf = (fields: string[], v: string): string | undefined =>
	fields.length ? `({ ${fields.map(f => `${f}: ${v}.${f}`).join(', ')} })` : undefined

const variableOf = (depth: number) => VARIABLES[depth] ?? `x${depth}`

/** The includes of a table: one for each relation of the wizard from it, with its map and its own includes */
const includesOf = (domain: DomainInfo, state: WizardState, entity: string, depth: number): string[] =>
	childrenOf(state, entity).filter(child => relationOf(domain, child)).map(child => {
		const inner = variableOf(depth + 1)
		const nested = includesOf(domain, state, child.entity, depth + 1)
		const map = mapOf(state.fields[child.entity] ?? [], inner)
		let text = `${variableOf(depth)}.${child.relation}`
		if (nested.length) text += `.include(${inner} => ${nested.length > 1 ? `[${nested.join(', ')}]` : nested[0]})`
		if (map) text += `.map(${inner} => ${map})`
		return text
	})

/** A whole number greater than 0 */
const count = (text: string): number | undefined => /^[1-9]\d*$/.test(text.trim()) ? Number(text.trim()) : undefined

/** The query of λORM of the wizard */
export const queryOf = (state: WizardState, domain: DomainInfo): string => {
	const lines = [state.root]
	const filter = state.filter.trim()
	if (filter) lines.push(`.filter(p => ${filter})`)
	const includes = includesOf(domain, state, state.root, 0)
	if (includes.length) lines.push(`.include(p => ${includes.length > 1 ? `[${includes.join(', ')}]` : includes[0]})`)
	const map = mapOf(state.fields[state.root] ?? [], 'p')
	if (map) lines.push(`.map(p => ${map})`)
	const valid = new Set(columnsOf(state, domain).map(c => c.alias))
	const sort = state.sort.filter(s => valid.has(s.column))
	if (sort.length) {
		const items = sort.map(s => s.desc ? `desc(p.${s.column})` : `p.${s.column}`)
		lines.push(`.sort(p => ${items.length > 1 ? `[${items.join(', ')}]` : items[0]})`)
	}
	const size = count(state.page.size)
	if (size) lines.push(`.page(${count(state.page.number) ?? 1}, ${size})`)
	return lines.join('\n\t')
}

/** The wizard as kept with a query (its tab, the saved query): what can be read back of it */
export const wizardOf = (raw: unknown): WizardState | undefined => {
	if (!raw || typeof raw !== 'object') return undefined
	const o = raw as Record<string, any>
	if (typeof o.root !== 'string' || !o.root) return undefined
	return {
		root: o.root,
		tables: Array.isArray(o.tables) ? o.tables.filter((t: any) => t && typeof t.entity === 'string' && typeof t.from === 'string' && typeof t.relation === 'string') : [],
		fields: o.fields && typeof o.fields === 'object' ? Object.fromEntries(Object.entries(o.fields).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).filter((f): f is string => typeof f === 'string')])) : {},
		filter: typeof o.filter === 'string' ? o.filter : '',
		sort: Array.isArray(o.sort) ? o.sort.filter((s: any) => s && typeof s.column === 'string').map((s: any) => ({ column: s.column, desc: !!s.desc })) : [],
		page: { number: typeof o.page?.number === 'string' ? o.page.number : '', size: typeof o.page?.size === 'string' ? o.page.size : '' },
		...(o.positions && typeof o.positions === 'object' ? { positions: o.positions } : {})
	}
}
