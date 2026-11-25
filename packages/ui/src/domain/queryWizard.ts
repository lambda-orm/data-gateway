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

const NUMBERS = ['integer', 'decimal', 'number', 'float', 'double']

/**
 * An example of a filter on p for an entity, with its own fields: a number of it compared with a constant, and a text
 * of the entity of one of its relations (or of its own) compared with a value of the data (Products: p.price > 10 &&
 * p.category.name == name). Undefined when it has no properties.
 */
export const filterExample = (domain: DomainInfo, name: string): string | undefined => {
	const entity = entityOf(domain, name)
	const properties = entity?.properties ?? []
	if (!entity || properties.length === 0) return undefined
	// not a key nor the field of a relation: id, customerId
	const plainOf = (e: EntityInfo | undefined) => (e?.properties ?? []).filter(p => !(e?.primaryKey ?? []).includes(p.name) && !p.autoIncrement && p.name !== 'id' && !p.name.endsWith('Id'))
	const plain = plainOf(entity)
	const number = plain.find(p => NUMBERS.includes(p.type ?? ''))
	const isText = (p: { type?: string, enum?: string }) => (p.type ?? 'string') === 'string' && !p.enum
	let text: string | undefined
	for (const relation of entity.relations ?? []) {
		if (toMany(relation)) continue
		const other = plainOf(entityOf(domain, relation.entity)).find(isText)
		if (other) { text = `p.${relation.name}.${other.name} == ${other.name}`; break }
	}
	const own = plain.find(isText)
	text ??= own ? `p.${own.name} == ${own.name}` : undefined
	const parts = [number ? `p.${number.name} > 10` : undefined, text].filter(Boolean)
	return parts.length ? parts.join(' && ') : `p.${properties[0].name} == ${properties[0].name}`
}

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

/** The wizard read from the text of a query: what it could represent, and the parts it couldn't (left out) */
export interface WizardReading {
	state: WizardState
	/** the parts of the query the wizard can't show (a computed field, a filter of an include, a groupBy…) */
	unread: string[]
}

/** A call of the chain of a query: .name(args) */
interface Call { name: string, args: string }

/** Where the bracket opened at index closes (strings skipped); -1 when it doesn't */
const closing = (text: string, index: number): number => {
	let depth = 0
	for (let i = index; i < text.length; i++) {
		const c = text[i]
		if (c === '"' || c === '\'' || c === '`') {
			for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++
			continue
		}
		if (c === '(' || c === '[' || c === '{') depth++
		else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i }
	}
	return -1
}

/** The head of a chain (a name, or v.name for a relation) and its calls; undefined when the text is not a chain */
const chainOf = (text: string): { head: string, calls: Call[] } | undefined => {
	const m = /^\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*(?![\w$]|\s*\())?)/.exec(text)
	if (!m) return undefined
	let rest = text.slice(m[0].length)
	const head = m[1].replace(/\s+/g, '')
	const calls: Call[] = []
	while (rest.trim()) {
		const c = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(rest)
		if (!c) return undefined
		const open = c[0].length - 1
		const close = closing(rest, open)
		if (close < 0) return undefined
		calls.push({ name: c[1], args: rest.slice(open + 1, close).trim() })
		rest = rest.slice(close + 1)
	}
	return { head, calls }
}

/** The items of a list at its top level: a, b(c, d), [e, f] → three */
const itemsOf = (text: string): string[] => {
	const items: string[] = []
	let start = 0
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (c === '"' || c === '\'' || c === '`' || c === '(' || c === '[' || c === '{') {
			const end = c === '(' || c === '[' || c === '{' ? closing(text, i) : (() => { let j = i + 1; for (; j < text.length && text[j] !== c; j++) if (text[j] === '\\') j++; return j })()
			if (end < 0) return [text.trim()]
			i = end
		} else if (c === ',') { items.push(text.slice(start, i).trim()); start = i + 1 }
	}
	const last = text.slice(start).trim()
	if (last) items.push(last)
	return items
}

/** A lambda: v => body, or (v) => body */
const lambdaOf = (text: string): { v: string, body: string } | undefined => {
	const m = /^\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*([\s\S]*)$/.exec(text)
	return m ? { v: m[1], body: m[2].trim() } : undefined
}

/** The body of a lambda as a list: [a, b] → a, b; a → a */
const listOf = (body: string): string[] => {
	const t = body.trim()
	return t.startsWith('[') && closing(t, 0) === t.length - 1 ? itemsOf(t.slice(1, -1)) : [t]
}

/**
 * The fields of a map: ({ name: v.name, … }), and its entries that are not a field of its own name (computed, renamed,
 * of a relation); undefined when it is not an object
 */
const fieldsOf = (body: string, v: string, entity: EntityInfo | undefined): { fields: string[], other: string[] } | undefined => {
	let t = body.trim()
	if (t.startsWith('(') && closing(t, 0) === t.length - 1) t = t.slice(1, -1).trim()
	if (!t.startsWith('{') || closing(t, 0) !== t.length - 1) return undefined
	const names = new Set((entity?.properties ?? []).map(p => p.name))
	const fields: string[] = []
	const other: string[] = []
	for (const item of itemsOf(t.slice(1, -1))) {
		const m = new RegExp(`^([A-Za-z_$][\\w$]*)\\s*:\\s*${v}\\s*\\.\\s*([A-Za-z_$][\\w$]*)$`).exec(item)
		if (m && m[1] === m[2] && names.has(m[2]) && !fields.includes(m[2])) fields.push(m[2])
		else other.push(item.replace(/\s+/g, ' '))
	}
	return { fields, other }
}

/** The variable of a lambda renamed to p (not after a dot: a property with that name stays) */
const renamed = (body: string, v: string): string => v === 'p' ? body : body.replace(new RegExp(`(?<![\\w$.])${v}(?![\\w$])`, 'g'), 'p')

/**
 * The wizard of a query written by hand, as far as it can show it: the entity it starts from, a filter, the includes of
 * its relations (each with the fields of its map and its own includes), the fields of the map of the root, the order by
 * them and the page. What it can't show (a computed or renamed field, a filter of an include, groupBy…) goes in unread.
 * Undefined when the query doesn't start from an entity of the domain.
 */
export const wizardFromQuery = (query: string, domain: DomainInfo): WizardReading | undefined => {
	const chain = chainOf(query.trim())
	if (!chain || !entityOf(domain, chain.head)) return undefined
	const state = emptyWizard(chain.head)
	const unread: string[] = []
	const short = (text: string) => text.replace(/\s+/g, ' ').trim()
	// the fields of a map; all of them is the same as no map (every field ticked)
	const keep = (entity: string, fields: string[]) => {
		const all = entityOf(domain, entity)?.properties ?? []
		if (all.length && all.every(p => fields.includes(p.name))) return
		state.fields[entity] = fields
	}

	/** the includes of a table: each one a relation of it, with its map and its own includes */
	const include = (entity: string, args: string) => {
		const lambda = lambdaOf(args)
		if (!lambda) { unread.push(`.include(${short(args)})`); return }
		for (const item of listOf(lambda.body)) {
			const rel = chainOf(item)
			const [v, name] = rel?.head.split('.') ?? []
			const relation = v === lambda.v && name ? entityOf(domain, entity)?.relations?.find(r => r.name === name) : undefined
			if (!rel || !relation || relation.entity === state.root || state.tables.some(t => t.entity === relation.entity)) { unread.push(short(item)); continue }
			state.tables.push({ entity: relation.entity, from: entity, relation: relation.name })
			for (const call of rel.calls) {
				if (call.name === 'include') include(relation.entity, call.args)
				else if (call.name === 'map') {
					const inner = lambdaOf(call.args)
					const map = inner && fieldsOf(inner.body, inner.v, entityOf(domain, relation.entity))
					if (map?.fields.length) keep(relation.entity, map.fields)
					if (!map) unread.push(`${v}.${name}.map(${short(call.args)})`)
					else unread.push(...map.other.map(o => `${v}.${name}.map(${inner!.v} => ({ ${o} }))`))
				} else unread.push(`${v}.${name}.${call.name}(${short(call.args)})`)
			}
		}
	}

	const sorts: Call[] = []
	for (const call of chain.calls) {
		const lambda = lambdaOf(call.args)
		if (call.name === 'filter' && lambda && !state.filter) state.filter = renamed(lambda.body, lambda.v)
		else if (call.name === 'include') include(state.root, call.args)
		else if (call.name === 'map' && lambda && !state.fields[state.root]) {
			const map = fieldsOf(lambda.body, lambda.v, entityOf(domain, state.root))
			if (map?.fields.length) keep(state.root, map.fields)
			if (!map) unread.push(`.map(${short(call.args)})`)
			else unread.push(...map.other.map(o => `.map(${lambda.v} => ({ ${o} }))`))
		} else if (call.name === 'sort' && lambda) sorts.push(call)
		else if (call.name === 'page' && /^\s*\d+\s*,\s*\d+\s*$/.test(call.args)) {
			const [number, size] = call.args.split(',').map(s => s.trim())
			state.page = { number, size }
		} else unread.push(`.${call.name}(${short(call.args)})`)
	}
	// the order, by the columns of the result (known once the map is read)
	const valid = new Set(columnsOf(state, domain).map(c => c.alias))
	for (const call of sorts) {
		const { v, body } = lambdaOf(call.args)!
		for (const item of listOf(body)) {
			const m = new RegExp(`^(?:(asc|desc)\\s*\\(\\s*${v}\\.([\\w$]+)\\s*\\)|${v}\\.([\\w$]+)(?:\\s*\\.\\s*(asc|desc)\\s*\\(\\s*\\))?)$`).exec(item.trim())
			const column = m?.[2] ?? m?.[3]
			if (column && valid.has(column) && !state.sort.some(s => s.column === column)) state.sort.push({ column, desc: (m?.[1] ?? m?.[4]) === 'desc' })
			else unread.push(`.sort(${v} => ${short(item)})`)
		}
	}
	return { state, unread }
}
