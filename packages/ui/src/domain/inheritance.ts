/**
 * What an entity inherits from the entities it extends (`extends`, a chain: LocatedCatalog → Located → Audited), as
 * λORM resolves it: the base is resolved first, the entity's own properties and relations win by name (an own one with
 * the name of an inherited one redefines it, taking from it what it doesn't say) and the inherited ones go after.
 * Only properties and relations: λORM doesn't inherit indexes nor constraints. Read from the lambdaORM.yaml (the
 * completed domain no longer says `extends`); a cycle or a base that doesn't exist ends the chain.
 */
type Json = any

/** A property or relation of an entity and where it comes from */
export interface InheritedItem {
	row: Json
	/** the entity that declares it */
	from: string
	/** an own one that redefines one of a base: that base */
	redefines?: string
}

export interface Inheritance {
	/** the entities it extends, the nearest first */
	bases: string[]
	properties: InheritedItem[]
	relations: InheritedItem[]
}

const NONE: Inheritance = { bases: [], properties: [], relations: [] }

const listOf = (value: unknown): Json[] => Array.isArray(value) ? value.filter(r => r && typeof r === 'object' && typeof r.name === 'string') : []

/** The inheritance of `name` among `entities` (as written in the lambdaORM.yaml) */
export const inheritanceOf = (entities: Json[] | undefined, name: string | undefined): Inheritance => {
	const all = listOf(entities)
	const resolve = (entityName: string, seen: Set<string>): Inheritance => {
		const entity = all.find(e => e.name === entityName)
		if (!entity || seen.has(entityName)) return NONE
		seen.add(entityName)
		const base = typeof entity.extends === 'string' && entity.extends && all.some(e => e.name === entity.extends) && !seen.has(entity.extends)
			? resolve(entity.extends, seen)
			: undefined
		const merge = (key: 'properties' | 'relations'): InheritedItem[] => {
			const inherited = base?.[key] ?? []
			const own = listOf(entity[key]).map(row => {
				const of = inherited.find(i => i.row.name === row.name)
				return of ? { row: { ...of.row, ...row }, from: entityName, redefines: of.from } : { row, from: entityName }
			})
			return [...own, ...inherited.filter(i => !own.some(o => o.row.name === i.row.name))]
		}
		return { bases: base ? [entity.extends, ...base.bases] : [], properties: merge('properties'), relations: merge('relations') }
	}
	return name ? resolve(name, new Set()) : NONE
}

/** The inherited ones (not its own), by the base that declares them, in the order of the chain */
export const inheritedByBase = (inheritance: Inheritance, key: 'properties' | 'relations'): [string, Json[]][] =>
	inheritance.bases
		.map(base => [base, inheritance[key].filter(i => i.from === base).map(i => i.row)] as [string, Json[]])
		.filter(([, rows]) => rows.length > 0)

/** The entities of a lambdaORM.yaml: those of domain.abstracts (once λORM has it, L52) as abstract, and domain.entities */
export const sourceEntitiesOf = (doc: any): Json[] => [
	...listOf(doc?.domain?.abstracts).map(e => ({ ...e, abstract: true })),
	...listOf(doc?.domain?.entities)
]

/**
 * An abstract entity as the view of an entity shows it (the completed domain has none): with what it inherits, and
 * the defaults λORM gives what doesn't say them (a property is a string, a relation one to many). Undefined if it isn't
 * an abstract one of `entities` (as sourceEntitiesOf gives them).
 */
export const abstractEntityOf = (entities: Json[] | undefined, name: string): Json | undefined => {
	const entity = listOf(entities).find(e => e.name === name && e.abstract === true)
	if (!entity) return undefined
	const inheritance = inheritanceOf(entities, name)
	return {
		...entity,
		properties: inheritance.properties.map(i => ({ ...i.row, type: i.row.type ?? 'string' })),
		relations: inheritance.relations.map(i => ({ ...i.row, type: i.row.type ?? 'oneToMany' }))
	}
}
