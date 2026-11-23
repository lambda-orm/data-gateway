import { DomainInfo, EntityInfo, RelationInfo } from './diagram'

/**
 * The query wizard: an entity to start from, the tables added through its relations, the fields chosen of each, a
 * general filter, the order and the page; and the query of λORM that reads them. A relation to one (oneToMany,
 * oneToOne in λORM) becomes columns of the same row (customerName: p.customer.name); a relation to many (manyToOne)
 * becomes a list per row, through include. An empty filter, order or page is not applied.
 */
export interface WizardTable {
	entity: string
	/** the table it is reached from, and the relation of that table */
	from: string
	relation: string
}

export interface WizardSort {
	/** a column of the result (an alias of the map), or a field of the entity when nothing is chosen */
	column: string
	desc: boolean
}

export interface WizardState {
	/** the entity the query starts from */
	root: string
	tables: WizardTable[]
	/** the fields chosen of each table (none: every field of the root; of a relation to many, all of it) */
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
 * How a table could join the wizard: the first table of the wizard with a relation to it. A relation to many only
 * from the root or from another table reached by a relation to many (an include of its own); a relation to one from any.
 */
export const joinOf = (domain: DomainInfo, state: WizardState, entity: string, prefer?: string): WizardTable | undefined => {
	if (entity === state.root || state.tables.some(t => t.entity === entity)) return undefined
	// the table whose + was used first, then the others in their order
	const all = [state.root, ...state.tables.map(t => t.entity)]
	const present = prefer && all.includes(prefer) ? [prefer, ...all.filter(e => e !== prefer)] : all
	const manyScope = (name: string): boolean => {
		if (name === state.root) return true
		const table = state.tables.find(t => t.entity === name)
		const relation = table && relationOf(domain, table)
		return !!relation && toMany(relation)
	}
	for (const from of present) {
		for (const relation of entityOf(domain, from)?.relations ?? []) {
			if (relation.entity !== entity) continue
			if (toMany(relation) && !manyScope(from)) continue
			return { entity, from, relation: relation.name }
		}
	}
	return undefined
}

/** A table and every table reached from it, taken out of the wizard (and their fields and order) */
export const withoutTable = (state: WizardState, entity: string): WizardState => {
	if (entity === state.root) return state
	const gone = new Set<string>([entity])
	let grew = true
	while (grew) {
		grew = false
		for (const t of state.tables) if (gone.has(t.from) && !gone.has(t.entity)) { gone.add(t.entity); grew = true }
	}
	const fields = Object.fromEntries(Object.entries(state.fields).filter(([name]) => !gone.has(name)))
	const next = { ...state, tables: state.tables.filter(t => !gone.has(t.entity)), fields }
	const columns = new Set(columnsOf(next).map(c => c.alias))
	return { ...next, sort: next.sort.filter(s => columns.has(s.column)) }
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** A column of the result: its alias and the path from the variable of its scope */
export interface WizardColumn { alias: string, path: string, entity: string, field: string }

/**
 * The columns of a scope (the root, or a table of a relation to many): its own fields and those of the tables reached
 * from it by relations to one, flattened (customer.name → customerName).
 */
const scopeColumns = (domain: DomainInfo, state: WizardState, scope: string): WizardColumn[] => {
	const columns: WizardColumn[] = []
	const walk = (entity: string, path: string[]) => {
		for (const field of state.fields[entity] ?? []) {
			columns.push({ alias: path.length ? path.map((p, i) => i ? capital(p) : p).join('') + capital(field) : field, path: [...path, field].join('.'), entity, field })
		}
		for (const child of childrenOf(state, entity)) {
			const relation = relationOf(domain, child)
			if (relation && !toMany(relation)) walk(child.entity, [...path, child.relation])
		}
	}
	walk(scope, [])
	return columns
}

/** The columns of the result: the ones the order can use (with no field chosen, the fields of the root) */
export const columnsOf = (state: WizardState, domain?: DomainInfo): WizardColumn[] => {
	if (!domain) {
		// without the domain (taking a table out): the fields chosen of the root and of every table, as aliases
		return Object.entries(state.fields).flatMap(([entity, fields]) => fields.map(field => ({ alias: field, path: field, entity, field })))
	}
	const columns = scopeColumns(domain, state, state.root)
	if (columns.length) return columns
	return (entityOf(domain, state.root)?.properties ?? []).map(p => ({ alias: p.name, path: p.name, entity: state.root, field: p.name }))
}

const VARIABLES = ['p', 'q', 'r', 's', 't', 'u', 'v', 'w']

/** The map of a scope: ({ alias: v.path, … }), or nothing when no field is chosen */
const mapOf = (columns: WizardColumn[], v: string): string | undefined =>
	columns.length ? `({ ${columns.map(c => `${c.alias}: ${v}.${c.path}`).join(', ')} })` : undefined

/** The includes of a scope: its tables reached by relations to many (from it or from its tables of relations to one) */
const includesOf = (domain: DomainInfo, state: WizardState, scope: string, depth: number): string[] => {
	const v = VARIABLES[depth] ?? `x${depth}`
	const includes: string[] = []
	const walk = (entity: string, path: string[]) => {
		for (const child of childrenOf(state, entity)) {
			const relation = relationOf(domain, child)
			if (!relation) continue
			if (toMany(relation)) {
				const inner = VARIABLES[depth + 1] ?? `x${depth + 1}`
				const nested = includesOf(domain, state, child.entity, depth + 1)
				const map = mapOf(scopeColumns(domain, state, child.entity), inner)
				let text = `${v}.${[...path, child.relation].join('.')}`
				if (nested.length) text += `.include(${inner} => ${nested.length > 1 ? `[${nested.join(', ')}]` : nested[0]})`
				if (map) text += `.map(${inner} => ${map})`
				includes.push(text)
			} else {
				walk(child.entity, [...path, child.relation])
			}
		}
	}
	walk(scope, [])
	return includes
}

/** A whole number greater than 0 */
const count = (text: string): number | undefined => /^[1-9]\d*$/.test(text.trim()) ? Number(text.trim()) : undefined

/** The query of λORM of the wizard */
export const queryOf = (state: WizardState, domain: DomainInfo): string => {
	const lines = [state.root]
	const filter = state.filter.trim()
	if (filter) lines.push(`.filter(p => ${filter})`)
	const includes = includesOf(domain, state, state.root, 0)
	if (includes.length) lines.push(`.include(p => ${includes.length > 1 ? `[${includes.join(', ')}]` : includes[0]})`)
	const columns = scopeColumns(domain, state, state.root)
	const map = mapOf(columns, 'p')
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
