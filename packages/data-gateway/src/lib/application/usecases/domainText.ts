import { DomainSchema, Entity, Property, Relation, closestNames } from '@lambdaorm/base'

// The domain as compact text, for a person or a model that writes a query over a large schema (L42): one entity in two
// lines, a search by part of a name, some entities described. The same on REST, WebSocket and MCP.

export const describeProperty = (p: Property, primaryKey: string[]): string => {
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

export const describeRelation = (r: Relation): string => `${r.name} → ${r.entity}${r.type === 'manyToOne' ? '[]' : ''}`

/** One entity in two lines: its properties (type, pk, required, enum) and its relations */
export const describeEntity = (e: Entity): string => {
	const lines = [`- ${e.name}${e.view ? ' (view)' : ''}: ${(e.properties ?? []).map(p => describeProperty(p, e.primaryKey ?? [])).join('; ')}`]
	// λORM names the type from the other side: manyToOne (Orders.details) is a list, oneToMany (Products.category) one row
	const relations = (e.relations ?? []).map(describeRelation)
	if (relations.length) lines.push(`  relations: ${relations.join('; ')}`)
	return lines.join('\n')
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
			if (p.name.toLowerCase().includes(term)) matches.push(`${e.name}.${describeProperty(p, e.primaryKey ?? [])}`)
		}
		for (const r of e.relations ?? []) {
			if (r.name.toLowerCase().includes(term)) matches.push(`${e.name}.${describeRelation(r)}`)
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

export interface DescribedEntities {
	entities: string[]
	notFound?: { name: string, didYouMean: string[] }[]
}

/** Some entities, compact (describeEntity); the names that don't exist, apart */
export const describeEntities = (domain: DomainSchema, names: string[]): DescribedEntities => {
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
