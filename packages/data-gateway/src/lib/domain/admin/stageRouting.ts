/**
 * Where the entities of a stage go: for each source of the stage, in its order, its condition and the entities it
 * takes. As λORM routes a sentence (its RouteService): the first source whose condition is true takes it, and a source
 * without condition takes whatever reaches it. An entity lives (its table, what push creates) in the source that takes
 * it as λORM's DDL asks (an undefined action of dml); its reads (select) and writes (insert) may go to others.
 */
export interface RoutingContext {
	entity: string
	action: string
	category: string
	type: string
	read: boolean
	write: boolean
	ddl: boolean
	dml: boolean
}

/** The sentences a stage routes: where an entity lives (its table), and its reads and writes */
const contextOf = (entity: string, kind: 'lives' | 'read' | 'write'): RoutingContext => {
	switch (kind) {
		case 'read': return { entity, action: 'select', category: 'select', type: 'dql', read: true, write: false, ddl: false, dml: true }
		case 'write': return { entity, action: 'insert', category: 'insert', type: 'dml', read: false, write: true, ddl: false, dml: true }
		default: return { entity, action: 'undefined', category: 'undefined', type: 'dml', read: false, write: true, ddl: false, dml: true }
	}
}

export interface RoutedEntity {
	entity: string
	/** its name in the database of its source, by the mapping of that source (the entity's name when it has none) */
	table: string
	/** a view of the domain */
	view?: boolean
	/** the sources its reads and writes go to, when it is not the one it lives in */
	read?: string
	write?: string
}

export interface RoutedSource {
	name: string
	dialect?: string
	mapping?: string
	/** its condition in the stage; none: it takes what reaches it */
	condition?: string
	/** the condition doesn't evaluate: what the expression says (it is taken as false) */
	error?: string
	/** the entities that live in it */
	entities: RoutedEntity[]
}

export interface StageRouting {
	stage: string
	sources: RoutedSource[]
	/** the entities no source takes (every condition false and no source without condition) */
	unrouted: string[]
}

type Json = any
type Evaluate = (expression: string, data: RoutingContext) => unknown

const listOf = (value: unknown): Json[] => Array.isArray(value) ? value : []

/** The table of an entity in a mapping (its `mapping`), looked for in that mapping and those it extends */
const tableOf = (mappings: Json[], mapping: string | undefined, entity: string): string => {
	const seen = new Set<string>()
	let current = mappings.find(m => m?.name === mapping)
	while (current && !seen.has(current.name)) {
		seen.add(current.name)
		const found = listOf(current.entities).find(e => e?.name === entity)
		if (typeof found?.mapping === 'string' && found.mapping) return found.mapping
		current = mappings.find(m => m?.name === current.extends)
	}
	return entity
}

/**
 * The routing of a stage of a schema (its lambdaORM.yaml as an object): undefined when the stage is not in it. Abstract
 * entities have no table: they are left out.
 */
export const stageRoutingOf = (schema: Json, stage: string, evaluate: Evaluate): StageRouting | undefined => {
	const infrastructure = schema?.infrastructure ?? {}
	const found = listOf(infrastructure.stages).find(s => s?.name === stage)
	if (!found) return undefined
	const declared = listOf(infrastructure.sources)
	const mappings = listOf(infrastructure.mappings)
	const entities = listOf(schema?.domain?.entities).filter(e => typeof e?.name === 'string' && !e.abstract)
	const sources: RoutedSource[] = listOf(found.sources).filter(s => typeof s?.name === 'string').map(s => {
		const source = declared.find(d => d?.name === s.name)
		return {
			name: s.name,
			...(typeof source?.dialect === 'string' ? { dialect: source.dialect } : {}),
			...(typeof source?.mapping === 'string' ? { mapping: source.mapping } : {}),
			...(typeof s.condition === 'string' && s.condition.trim() ? { condition: s.condition } : {}),
			entities: []
		}
	})
	// a condition that doesn't evaluate is false, and said once
	const takes = (source: RoutedSource, context: RoutingContext): boolean => {
		if (!source.condition) return true
		try { return !!evaluate(source.condition, context) } catch (error: any) {
			source.error ??= String(error?.message ?? error)
			return false
		}
	}
	const route = (context: RoutingContext): RoutedSource | undefined => sources.find(source => takes(source, context))
	const unrouted: string[] = []
	for (const entity of entities) {
		const lives = route(contextOf(entity.name, 'lives'))
		if (!lives) { unrouted.push(entity.name); continue }
		const read = route(contextOf(entity.name, 'read'))
		const write = route(contextOf(entity.name, 'write'))
		lives.entities.push({
			entity: entity.name,
			table: tableOf(mappings, lives.mapping, entity.name),
			...(entity.view ? { view: true } : {}),
			...(read && read !== lives ? { read: read.name } : {}),
			...(write && write !== lives ? { write: write.name } : {})
		})
	}
	return { stage, sources, unrouted }
}
