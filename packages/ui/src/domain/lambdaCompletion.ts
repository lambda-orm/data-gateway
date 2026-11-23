import { DomainInfo, EntityInfo, PropertyInfo, RelationInfo, typeText } from './diagram'

/**
 * What a suggestion is, for its icon: a property by its type, a relation (one entity or a list of them), an entity,
 * a parameter of a lambda, a clause (map, filter…), or a function by the type it works on.
 */
export type LambdaKind =
	| 'string' | 'number' | 'boolean' | 'date' | 'json' | 'uuid' | 'enum' | 'any'
	| 'relation' | 'relations' | 'entity' | 'parameter' | 'clause'
	| 'fn-string' | 'fn-number' | 'fn-date' | 'fn-boolean' | 'fn-list' | 'fn-any'

export interface LambdaSuggestion {
	label: string
	kind: LambdaKind
	insertText: string
	/** insertText is a snippet ($1 where the cursor goes) */
	snippet?: boolean
	detail?: string
	documentation?: string
	/** sorted first: what fits best where the cursor is */
	sortText?: string
}

/** A function of the λORM expressions: what its first parameter is says where it is offered */
export interface LambdaFunction {
	name: string
	params: { name: string, type: string }[]
	returnType: string
	description?: string
}

const STRING_TYPES = ['string', 'text', 'char', 'varchar']
const NUMBER_TYPES = ['integer', 'decimal', 'number', 'int', 'float', 'double', 'bigint', 'smallint']
const DATE_TYPES = ['date', 'dateTime', 'datetime', 'time', 'timestamp']
const JSON_TYPES = ['json', 'obj', 'object', 'list', 'array']

/** The kind of a property of λORM (its type, and whether it is of an enum) */
export const kindOfProperty = (property: Pick<PropertyInfo, 'type' | 'enum'>): LambdaKind => {
	if (property.enum) return 'enum'
	const type = (property.type ?? 'string').trim()
	if (STRING_TYPES.includes(type)) return 'string'
	if (NUMBER_TYPES.includes(type)) return 'number'
	if (type === 'boolean') return 'boolean'
	if (DATE_TYPES.includes(type)) return 'date'
	if (JSON_TYPES.includes(type)) return 'json'
	if (type === 'uuid') return 'uuid'
	return 'any'
}

/** The kind of a TypeScript type of a declaration (string, number, Date, any[]…) */
const kindOfTs = (type: string): 'string' | 'number' | 'date' | 'boolean' | 'list' | 'any' => {
	const t = type.trim()
	if (t === 'string') return 'string'
	if (t === 'number') return 'number'
	if (t === 'Date') return 'date'
	if (t === 'boolean') return 'boolean'
	if (t.endsWith('[]')) return 'list'
	return 'any'
}

/** The functions declared for the editor (QUERYABLE_DECLARATIONS): `declare function upper(value: string): string` */
export const functionsOf = (declarations: string): LambdaFunction[] => {
	const found = new Map<string, LambdaFunction>()
	const pattern = /(?:\/\*\*([\s\S]*?)\*\/\s*)?declare function ([A-Za-z_$][\w$]*)\(([^)]*)\):\s*([^;\n]+);/g
	for (const m of declarations.matchAll(pattern)) {
		const [, doc, name, params, returnType] = m
		// a name declared twice (includes of a list and of a text): the first stays, the other is a variant of it
		if (found.has(name)) continue
		const description = doc?.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim() || undefined
		found.set(name, {
			name,
			params: params.split(',').map(p => p.trim()).filter(Boolean).map(p => {
				const [n, t] = p.replace(/^\.\.\./, '').split(':').map(s => s.trim())
				return { name: n.replace('?', ''), type: t ?? 'any' }
			}),
			returnType: returnType.trim(),
			description
		})
	}
	return [...found.values()]
}

/** The clauses of a query and what each one is for (Queryable) */
const CLAUSES: [string, string, string][] = [
	['filter', 'filter(p => $1)', 'the rows that meet a condition'],
	['include', 'include(p => $1)', 'the rows of its relations, inside each row'],
	['map', 'map(p => $1)', 'what each row gives: properties, expressions, aggregates'],
	['first', 'first(p => $1)', 'the first row'],
	['last', 'last(p => $1)', 'the last row'],
	['distinct', 'distinct(p => $1)', 'the rows without repeated'],
	['having', 'having(p => $1)', 'the groups that meet a condition (after map with aggregates)'],
	['sort', 'sort(p => $1)', 'the order of the rows (desc(p.x) for descending)'],
	['page', 'page(${1:1}, ${2:10})', 'one page of the rows: page and rows per page'],
	['insert', 'insert()', 'insert the data given'],
	['update', 'update(p => $1)', 'update the rows (with a filter)'],
	['upsert', 'upsert()', 'insert or update the data given'],
	['merge', 'merge()', 'insert, update or delete to match the data given'],
	['delete', 'delete()', 'delete the rows (with a filter)'],
	['bulkInsert', 'bulkInsert()', 'insert a list of rows'],
	['bulkMerge', 'bulkMerge()', 'merge a list of rows'],
	['bulkDelete', 'bulkDelete()', 'delete a list of rows'],
	['updateAll', 'updateAll(p => $1)', 'update every row'],
	['deleteAll', 'deleteAll()', 'delete every row']
]
/** What a relation inside a lambda takes (p.prices.filter(…)) */
const RELATION_CLAUSES = ['map', 'filter', 'include', 'first', 'last', 'distinct', 'sort']

/**
 * The chain of names before a position: `p.prices.filter(x => …).map` → ['p', 'prices'] — the calls (and the name of
 * their method) are skipped, what is left is the root and the properties walked from it.
 */
export const chainBefore = (text: string, end: number): string[] => {
	const names: string[] = []
	let j = end
	const skipSpaces = () => { while (j > 0 && /\s/.test(text[j - 1])) j-- }
	for (;;) {
		skipSpaces()
		if (text[j - 1] === ')') {
			// a call: back to its "(", then the name of its method and the dot before it
			let depth = 0
			while (j > 0) {
				j--
				if (text[j] === ')') depth++
				else if (text[j] === '(') { depth--; if (depth === 0) break }
			}
			skipSpaces()
			while (j > 0 && /[\w$]/.test(text[j - 1])) j--
			skipSpaces()
			if (text[j - 1] === '.') { j--; continue }
			return names.reverse()
		}
		let start = j
		while (start > 0 && /[\w$]/.test(text[start - 1])) start--
		if (start === j) return names.reverse()
		names.push(text.slice(start, j))
		j = start
		skipSpaces()
		if (text[j - 1] === '.') { j--; continue }
		return names.reverse()
	}
}

type Resolved = { entity: EntityInfo, many: boolean } | { property: PropertyInfo } | undefined

/** The parameters of the lambdas before the cursor and what each one is: `Products.map(p =>` → p: Products */
const bindingsOf = (text: string): { name: string, chain: string[] }[] => {
	const out: { name: string, chain: string[] }[] = []
	const pattern = /\.\s*([A-Za-z_$][\w$]*)\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g
	for (const m of text.matchAll(pattern)) out.push({ name: m[2], chain: chainBefore(text, m.index!) })
	return out
}

/** What a chain of names is: an entity (or a list of it, a relation), or one of its properties */
const resolve = (chain: string[], domain: DomainInfo, bindings: { name: string, chain: string[] }[], depth = 0): Resolved => {
	if (chain.length === 0 || depth > 8) return undefined
	const entities = new Map(domain.entities.map(e => [e.name, e]))
	let current: Resolved
	const [root, ...rest] = chain
	if (entities.has(root)) current = { entity: entities.get(root)!, many: true }
	else {
		// the nearest binding of that parameter
		const binding = [...bindings].reverse().find(b => b.name === root)
		if (!binding) return undefined
		const of = resolve(binding.chain, domain, bindings.filter(b => b !== binding), depth + 1)
		if (!of || !('entity' in of)) return undefined
		current = { entity: of.entity, many: false }
	}
	for (const name of rest) {
		if (!current || !('entity' in current)) return undefined
		const owner: EntityInfo = current.entity
		const relation: RelationInfo | undefined = (owner.relations ?? []).find(r => r.name === name)
		if (relation) {
			const target = entities.get(relation.entity)
			if (!target) return undefined
			current = { entity: target, many: relation.type === 'manyToOne' }
			continue
		}
		const property: PropertyInfo | undefined = (owner.properties ?? []).find(p => p.name === name)
		if (!property) return undefined
		current = { property }
	}
	return current
}

const fnKind = (fn: LambdaFunction): LambdaKind => {
	const first = fn.params[0]
	return `fn-${first ? kindOfTs(first.type) : 'any'}` as LambdaKind
}
const signature = (fn: LambdaFunction, skipFirst = false) =>
	`${fn.name}(${fn.params.slice(skipFirst ? 1 : 0).map(p => `${p.name}: ${p.type}`).join(', ')}): ${fn.returnType}`
const call = (fn: LambdaFunction, skipFirst = false) => {
	const params = fn.params.slice(skipFirst ? 1 : 0)
	return params.length ? `${fn.name}(${params.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ')})` : `${fn.name}()`
}

/** The functions that work on a kind of property (their first parameter), as methods of it: p.name.upper() */
const fits = (fn: LambdaFunction, kind: LambdaKind): boolean => {
	const first = fn.params[0]
	if (!first) return false
	const t = kindOfTs(first.type)
	if (t === 'any') return true
	if (kind === 'string' || kind === 'uuid' || kind === 'enum') return t === 'string'
	if (kind === 'number') return t === 'number'
	if (kind === 'date') return t === 'date'
	if (kind === 'boolean') return t === 'boolean'
	return false
}

const entityMembers = (entity: EntityInfo): LambdaSuggestion[] => [
	...(entity.properties ?? []).map(p => ({
		label: p.name,
		kind: kindOfProperty(p),
		insertText: p.name,
		detail: `${typeText(p)}${(entity.primaryKey ?? []).includes(p.name) ? ' · PK' : ''}${p.required ? ' · required' : ''}`,
		sortText: `1${p.name}`
	})),
	...(entity.relations ?? []).map(r => ({
		label: r.name,
		kind: (r.type === 'manyToOne' ? 'relations' : 'relation') as LambdaKind,
		insertText: r.name,
		detail: `→ ${r.entity}${r.type === 'manyToOne' ? '[]' : ''} (${r.from} → ${r.to})`,
		sortText: `2${r.name}`
	}))
]

const clauses = (names?: string[]): LambdaSuggestion[] => CLAUSES
	.filter(([name]) => !names || names.includes(name))
	.map(([name, insert, documentation], i) => ({ label: name, kind: 'clause' as LambdaKind, insertText: insert, snippet: true, detail: 'clause', documentation, sortText: `0${String(i).padStart(2, '0')}` }))

/**
 * What to suggest where the cursor is (the text before it): after a dot, the clauses of a query, the properties and
 * relations of an entity, or the functions of the type of a property; else the entities, the parameters of the
 * lambdas and the functions. Each with what it is, for its icon.
 */
export const lambdaCompletions = (before: string, domain: DomainInfo | undefined, functions: LambdaFunction[]): LambdaSuggestion[] => {
	const word = /[\w$]*$/.exec(before)![0]
	const head = before.slice(0, before.length - word.length)
	const dot = /\.\s*$/.exec(head)
	const bindings = bindingsOf(before)
	if (dot) {
		const end = head.length - dot[0].length
		const afterCall = head.slice(0, end).trimEnd().endsWith(')')
		const chain = chainBefore(head, end)
		if (!domain) return afterCall ? clauses() : []
		const resolved = resolve(chain, domain, bindings)
		if (!resolved) return afterCall ? clauses() : []
		if ('property' in resolved) {
			const kind = kindOfProperty(resolved.property)
			return functions.filter(fn => fits(fn, kind)).map(fn => ({
				label: fn.name, kind: fnKind(fn), insertText: call(fn, true), snippet: fn.params.length > 1, detail: signature(fn, true), documentation: fn.description, sortText: `3${fn.name}`
			}))
		}
		// an entity of the query (Products.) or after a clause: the clauses; a row (p.): its properties and relations
		const isRoot = chain.length === 1 && domain.entities.some(e => e.name === chain[0])
		if (isRoot || afterCall) return clauses()
		return resolved.many
			? [...clauses(RELATION_CLAUSES), ...entityMembers(resolved.entity)]
			: entityMembers(resolved.entity)
	}
	const inLambda = bindings.length > 0
	const seen = new Set<string>()
	const parameters = [...bindings].reverse().filter(b => !seen.has(b.name) && seen.add(b.name)).map(b => {
		const of = domain ? resolve(b.chain, domain, bindings) : undefined
		return { label: b.name, kind: 'parameter' as LambdaKind, insertText: b.name, detail: of && 'entity' in of ? of.entity.name : 'parameter', sortText: `0${b.name}` }
	})
	const entities = (domain?.entities ?? []).filter(e => !e.abstract).map(e => ({
		label: e.name, kind: 'entity' as LambdaKind, insertText: e.name, detail: `entity · ${(e.properties ?? []).length} properties`, sortText: `${inLambda ? 4 : 1}${e.name}`
	}))
	const fns = functions.map(fn => ({
		label: fn.name, kind: fnKind(fn), insertText: call(fn), snippet: fn.params.length > 0, detail: signature(fn), documentation: fn.description, sortText: `${inLambda ? 2 : 3}${fn.name}`
	}))
	return [...parameters, ...entities, ...fns]
}
