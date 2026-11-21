import { DomainSchema, Entity, Property, Relation, closestNames } from '@lambdaorm/base'

/** Size of the description that goes inside a tool description: beyond it, the model reads the schema tools */
export const DOMAIN_DESCRIPTION_MAX_LENGTH = 12000

const property = (p: Property, primaryKey: string[]): string => {
	const pk = p.primaryKey || primaryKey.includes(p.name)
	const marks = [
		pk ? 'pk' : '',
		p.autoIncrement ? 'auto' : '',
		p.required && !pk ? 'required' : '',
		p.enum ? `enum ${p.enum}` : '',
		p.view === false ? 'hidden' : ''
	].filter(Boolean)
	return `${p.name}: ${p.type ?? 'string'}${marks.length ? ` (${marks.join(', ')})` : ''}`
}

const relationText = (r: Relation): string => `${r.name} → ${r.entity}${r.type === 'manyToOne' ? '[]' : ''}`

/** One entity in two lines: its properties (type, pk, required, enum) and its relations */
export const describeEntity = (e: Entity): string => {
	const lines = [`- ${e.name}${e.view ? ' (view)' : ''}: ${(e.properties ?? []).map(p => property(p, e.primaryKey ?? [])).join('; ')}`]
	// λORM names the type from the other side: manyToOne (Orders.details) is a list, oneToMany (Products.category) one row
	const relations = (e.relations ?? []).map(relationText)
	if (relations.length) lines.push(`  relations: ${relations.join('; ')}`)
	return lines.join('\n')
}

/**
 * The domain of a schema as text for a model: entities with their properties (type, pk, required, enum) and relations
 * (`relation → Entity[]` when an include of it is a list), and the enums. Cut at maxLength with a pointer to the schema tools.
 */
export const describeDomain = (domain: DomainSchema, maxLength = DOMAIN_DESCRIPTION_MAX_LENGTH): string => {
	const entities = (domain.entities ?? []).filter(e => !e.abstract)
	const parts = [`Domain (entities, properties: type, relations):\n${entities.map(describeEntity).join('\n')}`]
	const enums = domain.enums ?? []
	if (enums.length) parts.push(`Enums:\n${enums.map(e => `- ${e.name}: ${e.values.map(v => `${v.name}=${JSON.stringify(v.value)}`).join(', ')}`).join('\n')}`)
	const text = parts.join('\n\n')
	if (text.length <= maxLength) return text
	// a large domain (Ilusor's Cloud: 192 entities, 400 KB as JSON): its names, and the tools that describe a part of it
	const preamble = `Domain: ${entities.length} entities, too many to describe here. Find what a question needs with ` +
		'schema_search { text } (entities, properties and relations by name) and read them with schema_describe ' +
		'{ entities: [...] } (properties and relations, compact) before writing the query.\nEntities: '
	const names = entities.map(e => e.name).join(', ')
	if (preamble.length + names.length <= maxLength) return preamble + names
	// only the names are cut, never what to do
	const room = Math.max(0, maxLength - preamble.length)
	const cut = names.lastIndexOf(', ', room)
	return `${preamble}${cut > 0 ? names.slice(0, cut) + ', ' : ''}… (schema_search finds the rest)`
}

export interface DomainSearch {
	/** one line per match: an entity (its two lines), `Entity.property: type` or `Entity.relation → Target` */
	matches: string[]
	/** matches left out (beyond the limit), and how to narrow the search */
	more?: number
	hint?: string
	/** when nothing contains the text: the closest names */
	didYouMean?: string[]
}

/**
 * Entities, properties and relations whose name contains the text (case-insensitive; `Areas.name` narrows to one
 * entity). An entity that matches comes whole; the closest names when nothing contains it.
 */
export const searchDomain = (domain: DomainSchema, text: string, limit = 40): DomainSearch => {
	const entities = (domain.entities ?? []).filter(e => !e.abstract)
	const [entityPart, memberPart] = text.includes('.') ? text.split('.', 2) : [undefined, text]
	const term = (memberPart ?? '').trim().toLowerCase()
	const inEntity = entityPart?.trim().toLowerCase()
	const matches: string[] = []
	for (const e of entities) {
		if (inEntity !== undefined && !e.name.toLowerCase().includes(inEntity)) continue
		if (inEntity === undefined && e.name.toLowerCase().includes(term)) { matches.push(describeEntity(e)); continue }
		for (const p of e.properties ?? []) {
			if (p.name.toLowerCase().includes(term)) matches.push(`${e.name}.${property(p, e.primaryKey ?? [])}`)
		}
		for (const r of e.relations ?? []) {
			if (r.name.toLowerCase().includes(term)) matches.push(`${e.name}.${relationText(r)}`)
		}
	}
	if (matches.length === 0) {
		const names = entities.flatMap(e => [e.name, ...(e.properties ?? []).map(p => p.name), ...(e.relations ?? []).map(r => r.name)])
		const didYouMean = closestNames(term || text, names, 5)
		return didYouMean.length ? { matches, didYouMean } : { matches }
	}
	if (matches.length <= limit) return { matches }
	return { matches: matches.slice(0, limit), more: matches.length - limit, hint: 'Narrow it to one entity (Entity.text) or use a longer part of the name' }
}

/** Some entities, compact (describeEntity); the names that don't exist, apart */
export const describeEntities = (domain: DomainSchema, names: string[]): { entities: string[], notFound?: { name: string, didYouMean: string[] }[] } => {
	const all = (domain.entities ?? []).filter(e => !e.abstract)
	const found: string[] = []
	const notFound: { name: string, didYouMean: string[] }[] = []
	for (const name of names) {
		const e = all.find(p => p.name === name)
		if (e) found.push(describeEntity(e))
		else notFound.push({ name, didYouMean: closestNames(name, all.map(p => p.name)) })
	}
	return notFound.length ? { entities: found, notFound } : { entities: found }
}
