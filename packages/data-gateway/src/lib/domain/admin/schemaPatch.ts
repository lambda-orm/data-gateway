/**
 * One change of one element of a schema (docs/DATA_GATEWAY_ADMIN_PLAN.md §2.3), what a form of the UI sends instead of
 * the whole file, so that two people who change different elements don't collide.
 *
 * `at` names the element by names, not positions: ['domain', 'entities', 'Products', 'properties', 'price'] is the
 * property price of the entity Products. A segment after a list is the name of an item of it.
 */
export interface SchemaPatch {
	op: 'set' | 'add' | 'remove' | 'rename'
	at: string[]
	/** set: the element as it will be; add: the new item (with its name) */
	value?: unknown
	/** rename: the new name */
	to?: string
	/** the element as the form read it (set, remove, rename): another value now, and nothing is changed */
	expected?: unknown
}

export class PatchError extends Error {
	constructor (public readonly kind: 'invalid' | 'notFound' | 'conflict', message: string, public readonly current?: unknown) {
		super(message)
		this.name = 'PatchError'
	}
}

type Json = any

const isObject = (value: unknown): value is Record<string, Json> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Two values of the schema the same (as JSON: the order of the keys doesn't matter) */
export const sameValue = (a: unknown, b: unknown): boolean => {
	if (a === b) return true
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
	if (isObject(a) && isObject(b)) {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(k => a[k] !== undefined || b[k] !== undefined))
		return [...keys].every(k => sameValue(a[k], b[k]))
	}
	return false
}

interface Located {
	/** the list or object that holds it */
	parent: Json
	/** its key in an object, or its index in a list */
	key: string | number
	value: Json
}

/** The element at a path of names; undefined when some step is not there */
export const elementAt = (schema: Json, at: string[]): Located | undefined => {
	let parent: Json
	let key: string | number | undefined
	let current: Json = schema
	for (const segment of at) {
		if (Array.isArray(current)) {
			const index = current.findIndex((item: Json) => isObject(item) && item.name === segment)
			if (index === -1) return undefined
			parent = current
			key = index
			current = current[index]
		} else if (isObject(current)) {
			if (!(segment in current)) return undefined
			parent = current
			key = segment
			current = current[segment]
		} else {
			return undefined
		}
	}
	if (key === undefined) return undefined
	return { parent, key, value: current }
}

const where = (at: string[]) => at.join('/')

const entities = (schema: Json): Json[] => Array.isArray(schema?.domain?.entities) ? schema.domain.entities : []
const fieldsOf = (value: unknown): string[] => Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
const renameIn = (value: Json, from: string, to: string): Json => Array.isArray(value) ? value.map(v => v === from ? to : v) : value === from ? to : value

/** Who uses an element: what a remove leaves pointing to nothing, and what a rename changes */
export const referencesOf = (schema: Json, at: string[]): string[] => {
	const found: string[] = []
	const [section, collection, name, sub, subName] = at
	if (section === 'domain' && collection === 'entities' && at.length === 3) {
		for (const e of entities(schema)) {
			if (e.extends === name) found.push(`domain/entities/${e.name}/extends`)
			for (const r of e.relations ?? []) if (r.entity === name && e.name !== name) found.push(`domain/entities/${e.name}/relations/${r.name}`)
		}
		for (const m of schema?.infrastructure?.mappings ?? []) for (const e of m.entities ?? []) if (e.name === name) found.push(`infrastructure/mappings/${m.name}/entities/${name}`)
		for (const v of schema?.infrastructure?.views ?? []) for (const e of v.entities ?? []) if (e.name === name) found.push(`infrastructure/views/${v.name}/entities/${name}`)
	}
	if (section === 'domain' && collection === 'entities' && sub === 'properties' && at.length === 5) {
		const owner = entities(schema).find(e => e.name === name)
		if (owner) {
			if (fieldsOf(owner.primaryKey).includes(subName)) found.push(`domain/entities/${name}/primaryKey`)
			if (fieldsOf(owner.uniqueKey).includes(subName)) found.push(`domain/entities/${name}/uniqueKey`)
			for (const i of owner.indexes ?? []) if (fieldsOf(i.fields).includes(subName)) found.push(`domain/entities/${name}/indexes/${i.name}`)
			for (const r of owner.relations ?? []) if (fieldsOf(r.from).includes(subName)) found.push(`domain/entities/${name}/relations/${r.name}`)
		}
		for (const e of entities(schema)) for (const r of e.relations ?? []) if (r.entity === name && fieldsOf(r.to).includes(subName)) found.push(`domain/entities/${e.name}/relations/${r.name}`)
		for (const m of schema?.infrastructure?.mappings ?? []) for (const e of m.entities ?? []) if (e.name === name && (e.properties ?? []).some((p: Json) => p.name === subName)) found.push(`infrastructure/mappings/${m.name}/entities/${name}/properties/${subName}`)
	}
	if (section === 'domain' && collection === 'enums' && at.length === 3) {
		for (const e of entities(schema)) for (const p of e.properties ?? []) if (p.enum === name) found.push(`domain/entities/${e.name}/properties/${p.name}`)
	}
	if (section === 'infrastructure' && collection === 'sources' && at.length === 3) {
		for (const s of schema?.infrastructure?.stages ?? []) if ((s.sources ?? []).some((x: Json) => x.name === name)) found.push(`infrastructure/stages/${s.name}`)
	}
	if (section === 'infrastructure' && collection === 'mappings' && at.length === 3) {
		for (const s of schema?.infrastructure?.sources ?? []) if (s.mapping === name) found.push(`infrastructure/sources/${s.name}`)
		for (const m of schema?.infrastructure?.mappings ?? []) if (m.extends === name) found.push(`infrastructure/mappings/${m.name}`)
	}
	return [...new Set(found)]
}

/** A rename and what points to the element, renamed too */
const rename = (schema: Json, at: string[], to: string): void => {
	const [section, collection, name, sub, subName] = at
	if (section === 'domain' && collection === 'entities' && at.length === 3) {
		for (const e of entities(schema)) {
			if (e.extends === name) e.extends = to
			for (const r of e.relations ?? []) if (r.entity === name) r.entity = to
		}
		for (const m of schema?.infrastructure?.mappings ?? []) for (const e of m.entities ?? []) if (e.name === name) e.name = to
		for (const v of schema?.infrastructure?.views ?? []) for (const e of v.entities ?? []) if (e.name === name) e.name = to
	}
	if (section === 'domain' && collection === 'entities' && sub === 'properties' && at.length === 5) {
		const owner = entities(schema).find(e => e.name === name)
		if (owner) {
			if (owner.primaryKey !== undefined) owner.primaryKey = renameIn(owner.primaryKey, subName, to)
			if (owner.uniqueKey !== undefined) owner.uniqueKey = renameIn(owner.uniqueKey, subName, to)
			for (const i of owner.indexes ?? []) i.fields = renameIn(i.fields, subName, to)
			for (const r of owner.relations ?? []) r.from = renameIn(r.from, subName, to)
		}
		for (const e of entities(schema)) for (const r of e.relations ?? []) if (r.entity === name) r.to = renameIn(r.to, subName, to)
		for (const m of schema?.infrastructure?.mappings ?? []) for (const e of m.entities ?? []) if (e.name === name) for (const p of e.properties ?? []) if (p.name === subName) p.name = to
	}
	if (section === 'domain' && collection === 'entities' && sub === 'relations' && at.length === 5) {
		// the relation of the other side names this one as its target
		const owner = entities(schema).find(e => e.name === name)
		const relation = (owner?.relations ?? []).find((r: Json) => r.name === subName)
		const other = relation ? entities(schema).find(e => e.name === relation.entity) : undefined
		for (const r of other?.relations ?? []) if (r.entity === name && r.target === subName) r.target = to
	}
	if (section === 'domain' && collection === 'enums' && at.length === 3) {
		for (const e of entities(schema)) for (const p of e.properties ?? []) if (p.enum === name) p.enum = to
	}
	if (section === 'infrastructure' && collection === 'sources' && at.length === 3) {
		for (const s of schema?.infrastructure?.stages ?? []) for (const x of s.sources ?? []) if (x.name === name) x.name = to
	}
	if (section === 'infrastructure' && collection === 'mappings' && at.length === 3) {
		for (const s of schema?.infrastructure?.sources ?? []) if (s.mapping === name) s.mapping = to
		for (const m of schema?.infrastructure?.mappings ?? []) if (m.extends === name) m.extends = to
	}
}

/**
 * The schema with one change. The schema given is not changed: a copy is. Problems: an element that is not there,
 * one that changed since the form read it (conflict, with what there is now), a name taken.
 */
export const applyPatch = (schema: Json, patch: SchemaPatch): { schema: Json, references: string[] } => {
	if (!patch || !['set', 'add', 'remove', 'rename'].includes(patch.op)) throw new PatchError('invalid', 'op is set, add, remove or rename')
	if (!Array.isArray(patch.at) || patch.at.length === 0 || patch.at.some(s => typeof s !== 'string' || !s)) throw new PatchError('invalid', 'at is the path of names of the element (["domain", "entities", "Products"])')
	const copy = JSON.parse(JSON.stringify(schema ?? {}))
	if (patch.op === 'add') {
		const value = patch.value as Json
		if (!isObject(value) || typeof value.name !== 'string' || !value.name.trim()) throw new PatchError('invalid', 'the new item has a name')
		const at = elementAt(copy, patch.at)
		let list = at?.value
		// `enums:` with nothing: the list, empty
		if (at && list === null) list = at.parent[at.key] = []
		if (list === undefined) {
			// the list doesn't exist yet: created in its owner (domain.enums, an entity's indexes…)
			const owner = patch.at.length === 1 ? { value: copy } : elementAt(copy, patch.at.slice(0, -1))
			if (!owner || !isObject(owner.value)) throw new PatchError('notFound', `${where(patch.at.slice(0, -1))} is not in the schema`)
			list = owner.value[patch.at[patch.at.length - 1]] = []
		}
		if (!Array.isArray(list)) throw new PatchError('invalid', `${where(patch.at)} is not a list`)
		if (list.some((item: Json) => item?.name === value.name)) throw new PatchError('invalid', `${where(patch.at)} already has "${value.name}"`)
		list.push(value)
		return { schema: copy, references: [] }
	}
	let found = elementAt(copy, patch.at)
	// set of a section the file doesn't have yet (application:): created in its owner
	if (!found && patch.op === 'set') {
		const owner = patch.at.length === 1 ? { value: copy } : elementAt(copy, patch.at.slice(0, -1))
		if (owner && isObject(owner.value)) found = { parent: owner.value, key: patch.at[patch.at.length - 1], value: undefined }
	}
	if (!found) throw new PatchError('notFound', `${where(patch.at)} is not in the schema`)
	if (patch.expected !== undefined && !sameValue(found.value, patch.expected)) {
		throw new PatchError('conflict', `${where(patch.at)} changed since it was read`, found.value)
	}
	const named = Array.isArray(found.parent)
	if (patch.op === 'set') {
		if (named && (!isObject(patch.value) || (patch.value as Json).name !== patch.at[patch.at.length - 1])) {
			throw new PatchError('invalid', 'set keeps the name of the element: to change it, rename')
		}
		found.parent[found.key] = patch.value
		return { schema: copy, references: [] }
	}
	if (patch.op === 'remove') {
		const references = referencesOf(copy, patch.at)
		if (named) found.parent.splice(found.key as number, 1)
		else delete found.parent[found.key]
		return { schema: copy, references }
	}
	// rename
	if (!named) throw new PatchError('invalid', 'only a named element (an entity, a property, a source…) is renamed')
	const to = patch.to
	if (typeof to !== 'string' || !to.trim()) throw new PatchError('invalid', 'to is the new name')
	if (found.parent.some((item: Json) => item?.name === to)) throw new PatchError('invalid', `"${to}" is taken`)
	const references = referencesOf(copy, patch.at)
	rename(copy, patch.at, to)
	found.value.name = to
	return { schema: copy, references }
}
