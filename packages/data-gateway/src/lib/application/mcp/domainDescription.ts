import { DomainSchema } from '@lambdaorm/base'
import { describeEntity } from '../usecases/domainText'

export { describeEntities, searchDomain } from '../usecases/domainText'

/** Size of the description that goes inside a tool description: beyond it, the model reads the schema tools */
export const DOMAIN_DESCRIPTION_MAX_LENGTH = 12000

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

