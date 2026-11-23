/**
 * The expressions of a schema (3xpr): what each kind of expression has to work with. A condition of a source of a
 * stage (infrastructure.stages[].sources[].condition) is evaluated for each sentence with what it is about: the first
 * source of the stage whose condition is true takes it, and a last one without condition takes the rest.
 */
export interface ExpressionVariable {
	name: string
	type: string
	description: string
}

export const EXPRESSION_CONTEXTS: Record<string, ExpressionVariable[]> = {
	stageSource: [
		{ name: 'entity', type: 'string', description: 'the entity of the sentence (Products)' },
		{ name: 'action', type: 'string', description: 'select, insert, update, delete, bulkInsert, merge, createEntity, dropEntity…' },
		{ name: 'category', type: 'string', description: 'select, insert, upsert, update, delete, truncate, create, add, alter or drop' },
		{ name: 'type', type: 'string', description: 'dql, dml, ddl or metadata' },
		{ name: 'read', type: 'boolean', description: 'a select' },
		{ name: 'write', type: 'boolean', description: 'not a select' },
		{ name: 'dml', type: 'boolean', description: 'a sentence of data (dml or dql)' },
		{ name: 'ddl', type: 'boolean', description: 'a sentence of structure (push, drop)' }
	]
}

export type ExpressionContext = keyof typeof EXPRESSION_CONTEXTS

/** A message of 3xpr said as what is wrong with the expression */
export const expressionProblem = (message: string): string => {
	const reason = message.replace(/^[\s\S]*?error:\s*/, '').replace(/^(Type)?Error:\s*/, '').trim()
	if (/Cannot read propert/.test(reason)) return 'incomplete: a parenthesis, a bracket, a quote or an operand is missing'
	if (/^Operand undefined/.test(reason)) return 'an operator is not known or an operand is missing'
	return reason || message
}
