/** An entity as the domain has it: its name and its relations (to which entity) */
export interface RelatedEntity {
	name: string
	relations?: { name: string, entity: string }[]
}

/**
 * The entities a read depends on (docs/RESULT_CACHE.md §4): those of its sentences (the root and its includes), and
 * those reached through a relation it names (p.category.name in a map or a filter is a join, not a sentence). It may
 * name more than it reads (a word of a text that is also a relation): that only invalidates more, never less.
 */
export const readEntities = (query: string, sentences: string[], domain: RelatedEntity[]): string[] => {
	const named = new Set([...query.matchAll(/\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]))
	const byName = new Map(domain.map(e => [e.name, e]))
	const found = new Set(sentences)
	const pending = [...sentences]
	while (pending.length) {
		const entity = byName.get(pending.pop()!)
		for (const relation of entity?.relations ?? []) {
			if (named.has(relation.name) && !found.has(relation.entity)) {
				found.add(relation.entity)
				pending.push(relation.entity)
			}
		}
	}
	return [...found]
}
