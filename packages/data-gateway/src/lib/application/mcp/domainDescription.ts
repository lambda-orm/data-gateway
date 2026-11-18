import { DomainSchema, Entity, Property } from '@lambdaorm/base'

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

const entity = (e: Entity): string => {
	const lines = [`- ${e.name}${e.view ? ' (view)' : ''}: ${(e.properties ?? []).map(p => property(p, e.primaryKey ?? [])).join('; ')}`]
	// λORM names the type from the other side: manyToOne (Orders.details) is a list, oneToMany (Products.category) one row
	const relations = (e.relations ?? []).map(r => `${r.name} → ${r.entity}${r.type === 'manyToOne' ? '[]' : ''}`)
	if (relations.length) lines.push(`  relations: ${relations.join('; ')}`)
	return lines.join('\n')
}

/**
 * The domain of a schema as text for a model: entities with their properties (type, pk, required, enum) and relations
 * (`relation → Entity[]` when an include of it is a list), and the enums. Cut at maxLength with a pointer to the schema tools.
 */
export const describeDomain = (domain: DomainSchema, maxLength = DOMAIN_DESCRIPTION_MAX_LENGTH): string => {
	const entities = (domain.entities ?? []).filter(e => !e.abstract)
	const parts = [`Domain (entities, properties: type, relations):\n${entities.map(entity).join('\n')}`]
	const enums = domain.enums ?? []
	if (enums.length) parts.push(`Enums:\n${enums.map(e => `- ${e.name}: ${e.values.map(v => `${v.name}=${JSON.stringify(v.value)}`).join(', ')}`).join('\n')}`)
	const text = parts.join('\n\n')
	if (text.length <= maxLength) return text
	const cut = text.slice(0, maxLength)
	return `${cut.slice(0, cut.lastIndexOf('\n'))}\n… (domain cut: read it whole with schema_domain or lambdaorm://schema/domain)`
}
