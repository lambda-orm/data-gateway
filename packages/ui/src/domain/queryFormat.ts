import { DomainInfo, EntityInfo } from './diagram'

const PARAMS = ['p', 'q', 'r', 's', 't', 'u', 'v', 'w']

/**
 * The query that reads what a diagram shows: its root (the entity chosen, or the one with most relations among those
 * of the diagram) with the others included through their relations, nested as they are reached (each entity once).
 */
export const diagramQuery = (domain: DomainInfo, entities: string[], root?: string): string => {
	const shown = new Set(entities)
	const byName = new Map(domain.entities.map(e => [e.name, e]))
	const related = (e: EntityInfo) => (e.relations ?? []).filter(r => shown.has(r.entity) && r.entity !== e.name)
	const start = root && shown.has(root) && byName.has(root)
		? root
		: [...entities].filter(n => byName.has(n)).sort((a, b) => related(byName.get(b)!).length - related(byName.get(a)!).length || a.localeCompare(b))[0]
	if (!start) return ''
	const reached = new Set([start])
	// breadth first: an entity is included where it is reached first (the shortest path from the root)
	const children = new Map<string, { relation: string, entity: string }[]>()
	let level = [start]
	while (level.length) {
		const next: string[] = []
		for (const name of level) {
			const list: { relation: string, entity: string }[] = []
			for (const r of related(byName.get(name)!)) {
				if (reached.has(r.entity)) continue
				reached.add(r.entity)
				list.push({ relation: r.name, entity: r.entity })
				next.push(r.entity)
			}
			children.set(name, list)
		}
		level = next
	}
	const includes = (name: string, depth: number): string => {
		const list = children.get(name) ?? []
		if (!list.length) return ''
		const param = PARAMS[depth] ?? `p${depth}`
		const items = list.map(c => `${param}.${c.relation}${includes(c.entity, depth + 1)}`)
		return `.include(${param} => ${items.length === 1 ? items[0] : `[${items.join(', ')}]`})`
	}
	return formatQuery(`${start}${includes(start, 0)}`)
}

/** The clauses that go each on its line */
const CLAUSES = new Set(['filter', 'include', 'map', 'first', 'last', 'distinct', 'having', 'sort', 'page', 'insert', 'update', 'upsert', 'merge', 'delete', 'bulkInsert', 'bulkMerge', 'bulkDelete', 'updateAll', 'deleteAll'])

type Token = { text: string, kind: 'string' | 'open' | 'close' | 'comma' | 'dot' | 'arrow' | 'word' | 'other' }

const tokens = (text: string): Token[] => {
	const out: Token[] = []
	let i = 0
	while (i < text.length) {
		const c = text[i]
		if (/\s/.test(c)) { i++; continue }
		if (c === '"' || c === "'" || c === '`') {
			let j = i + 1
			while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1
			out.push({ text: text.slice(i, j + 1), kind: 'string' }); i = j + 1; continue
		}
		if ('([{'.includes(c)) { out.push({ text: c, kind: 'open' }); i++; continue }
		if (')]}'.includes(c)) { out.push({ text: c, kind: 'close' }); i++; continue }
		if (c === ',') { out.push({ text: c, kind: 'comma' }); i++; continue }
		if (text.startsWith('=>', i)) { out.push({ text: '=>', kind: 'arrow' }); i += 2; continue }
		if (c === '.' && !/\d/.test(text[i + 1] ?? '')) { out.push({ text: c, kind: 'dot' }); i++; continue }
		const word = /^(\d+(\.\d+)?|[\w$]+)/.exec(text.slice(i))
		if (word && /[\w$]/.test(c)) { out.push({ text: word[0], kind: 'word' }); i += word[0].length; continue }
		const op = /^(===|!==|==|!=|<=|>=|&&|\|\||\*\*|[-+*/%<>!=&|^~?:;])/.exec(text.slice(i))
		out.push({ text: op ? op[0] : c, kind: 'other' }); i += op ? op[0].length : 1
	}
	return out
}

/**
 * A query of λORM written to be read: each clause of a chain on its line (.filter, .include, .map…), indented by its
 * nesting, and the lists of an include or a map one item per line when they don't fit in one. The text of the strings
 * is kept; applied twice it gives the same.
 */
export const formatQuery = (text: string, width = 80, indent = '\t'): string => {
	const all = tokens(text)
	if (!all.length) return text.trim()
	// the text of tokens from i to its closing bracket, on one line
	const flat = (from: number, to: number): string => {
		let s = ''
		for (let k = from; k <= to; k++) {
			const t = all[k]
			const prev = all[k - 1]
			const glue = !prev || t.kind === 'close' || t.kind === 'comma' || t.kind === 'dot' || prev.kind === 'dot' || prev.kind === 'open' || (t.kind === 'open' && t.text === '(' && prev.kind === 'word')
			s += (glue ? '' : ' ') + t.text
		}
		return s.replace(/,(?=\S)/g, ', ')
	}
	const closing = (from: number): number => {
		let depth = 0
		for (let k = from; k < all.length; k++) {
			if (all[k].kind === 'open') depth++
			else if (all[k].kind === 'close' && --depth === 0) return k
		}
		return all.length - 1
	}
	// writes tokens [from, to] at a level of indentation; the clauses of a chain on their lines
	const write = (from: number, to: number, level: number): string => {
		let out = ''
		let k = from
		// the chain of the query (level 0): each clause on its line, and what is inside them one level deeper
		let pad = indent.repeat(level)
		while (k <= to) {
			const t = all[k]
			const prev = all[k - 1]
			if (level === 0 && t.kind === 'dot' && all[k + 1]?.kind === 'word' && CLAUSES.has(all[k + 1].text) && all[k + 2]?.text === '(' && k > from) {
				out += `\n${indent}.`
				pad = indent
				k++
				continue
			}
			if (t.kind === 'open') {
				const end = closing(k)
				const inline = flat(k, end)
				const lineSoFar = out.slice(out.lastIndexOf('\n') + 1)
				// a list (or the arguments) that doesn't fit, or holds clauses: one item per line
				const items = splitItems(k + 1, end - 1)
				if (lineSoFar.replace(/\t/g, '    ').length + inline.length <= width) {
					out += (prev && prev.kind !== 'open' && prev.kind !== 'dot' && !(t.text === '(' && prev.kind === 'word') && !out.endsWith(' ') && !out.endsWith('\n') && !out.endsWith('\t') ? ' ' : '') + inline
					k = end + 1
					continue
				}
				const glue = t.text === '(' && prev?.kind === 'word'
				out += (glue || out.endsWith('\t') || out.endsWith('\n') || out === '' ? '' : ' ') + t.text
				if (t.text === '[' || items.length > 1) {
					out += items.map(([a, b]) => `\n${pad}${indent}${write(a, b, Math.max(1, level + 1)).trim()}`).join(',') + `\n${pad}${all[end].text}`
				} else if (items.length === 1) {
					out += write(items[0][0], items[0][1], Math.max(1, level)).trim() + all[end].text
				} else out += all[end].text
				k = end + 1
				continue
			}
			const glue = !prev || k === from || t.kind === 'close' || t.kind === 'comma' || t.kind === 'dot' || prev.kind === 'dot' || prev.kind === 'open'
			out += (glue || out.endsWith('\n') || out.endsWith('\t') ? '' : ' ') + t.text
			k++
		}
		return out
	}
	// the items between two brackets, split by the commas of their level
	const splitItems = (from: number, to: number): [number, number][] => {
		const out: [number, number][] = []
		let depth = 0
		let start = from
		for (let k = from; k <= to; k++) {
			if (all[k].kind === 'open') depth++
			else if (all[k].kind === 'close') depth--
			else if (all[k].kind === 'comma' && depth === 0) { if (k > start) out.push([start, k - 1]); start = k + 1 }
		}
		if (to >= start) out.push([start, to])
		return out
	}
	return write(0, all.length - 1, 0).trim()
}
