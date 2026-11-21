import { DomainInfo } from './diagram'

type EntityInfo = DomainInfo['entities'][number]

/** An entity the filter keeps: whole when its name matches, else only the properties and relations that match */
export interface FilteredEntity {
	entity: EntityInfo
	/** its name contains the text */
	byName: boolean
	properties: string[]
	relations: string[]
}

/**
 * The entities of a large domain (Ilusor's Cloud: 192) narrowed by part of a name, case-insensitive: an entity whose
 * name contains it, or the properties and relations that do. `Areas.type` looks only in the entities named like Areas.
 * Sorted by name; an empty text keeps them all.
 */
export const filterEntities = (entities: EntityInfo[], text: string): FilteredEntity[] => {
	const sorted = [...entities].sort((a, b) => a.name.localeCompare(b.name))
	const raw = text.trim().toLowerCase()
	if (raw === '') return sorted.map(entity => ({ entity, byName: false, properties: [], relations: [] }))
	const dot = raw.indexOf('.')
	const [inEntity, term] = dot === -1 ? [undefined, raw] : [raw.slice(0, dot), raw.slice(dot + 1)]
	return sorted.flatMap(entity => {
		const name = entity.name.toLowerCase()
		if (inEntity !== undefined && !name.includes(inEntity)) return []
		const byName = inEntity === undefined && name.includes(term)
		const properties = term === '' ? [] : (entity.properties ?? []).map(p => p.name).filter(p => p.toLowerCase().includes(term))
		const relations = term === '' ? [] : (entity.relations ?? []).map(r => r.name).filter(r => r.toLowerCase().includes(term))
		if (byName || properties.length || relations.length || (inEntity !== undefined && term === '')) return [{ entity, byName, properties, relations }]
		return []
	})
}
