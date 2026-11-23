import { Metadata } from '@lambdaorm/base'

/** What a query does, read from its metadata tree: every sentence is a node with classtype "Sentence" and name = action. */
export interface QueryClassification {
	/** Actions of every sentence, the root one first (select, insert, update, delete, upsert, merge, bulkInsert, …) */
	actions: string[]
	/** Entities the sentences act on */
	entities: string[]
	/** True when any sentence is not a select, or when no sentence could be found (treated as a write, to be safe) */
	writes: boolean
}

const SENTENCE = 'Sentence'

export const classifyQuery = (metadata: Metadata): QueryClassification => {
	const actions: string[] = []
	const entities: string[] = []
	const walk = (node: Metadata | undefined): void => {
		if (!node) return
		if (node.classtype === SENTENCE) {
			actions.push(node.name)
			if (node.entity && !entities.includes(node.entity)) entities.push(node.entity)
		}
		for (const child of node.children || []) walk(child)
	}
	walk(metadata)
	const writes = actions.length === 0 || actions.some(action => action !== 'select')
	return { actions: [...new Set(actions)], entities, writes }
}
