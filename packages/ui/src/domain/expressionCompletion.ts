import type { CompletionItem } from '../components/CodeEditor'
import { ExpressionLanguage } from '../application/ports'

/** What the values of the variables of a sentence can be, to suggest them inside quotes */
export const EXPRESSION_VALUES: Record<string, string[]> = {
	action: ['select', 'insert', 'insertConditional', 'bulkInsert', 'update', 'upsert', 'delete', 'bulkDelete', 'merge', 'bulkMerge', 'truncateEntity',
		'createEntity', 'createSequence', 'createFk', 'createIndex', 'alterProperty', 'addProperty', 'addPk', 'addUk', 'addFk',
		'dropSequence', 'dropEntity', 'dropProperty', 'dropPk', 'dropUk', 'dropFk', 'dropIndex'],
	category: ['select', 'insert', 'upsert', 'update', 'delete', 'truncate', 'create', 'add', 'alter', 'drop'],
	type: ['dql', 'dml', 'ddl', 'metadata']
}

const signature = (name: string, params: { name: string, type?: string, multiple?: boolean }[], returnType: string) =>
	`${name}(${params.map(p => `${p.multiple ? '...' : ''}${p.name}${p.type ? `: ${p.type}` : ''}`).join(', ')}): ${returnType}`

/**
 * What to suggest at a column (1-based) of a line of an expression of 3xpr: inside quotes, the names of the entities or
 * the values of the variable the string is compared with (action == "…"); after a dot, the functions as methods (their
 * first parameter is what is before the dot); else the variables of its context, the functions and the constants.
 */
export const expressionCompletions = (language: ExpressionLanguage | undefined, context: string, entities: string[], line: string, column: number): CompletionItem[] => {
	const before = line.slice(0, column - 1)
	const variables = language?.contexts[context] ?? []
	// inside a string: count the quotes before the cursor
	const quotes = (before.match(/"/g) ?? []).length
	if (quotes % 2 === 1) {
		const opened = before.lastIndexOf('"')
		const compared = /([A-Za-z_]\w*)\s*(?:===|!==|==|!=|\.in\(\s*\[?[^\]]*|\.includes\(\s*)\s*$/.exec(before.slice(0, opened))
		const values = compared && EXPRESSION_VALUES[compared[1]] ? EXPRESSION_VALUES[compared[1]] : entities
		const detail = compared && EXPRESSION_VALUES[compared[1]] ? compared[1] : 'entity'
		return values.map(v => ({ label: v, kind: 'value' as const, insertText: v, detail }))
	}
	const functions = language?.functions ?? []
	if (/\.\s*[A-Za-z_]*$/.test(before)) {
		return functions.filter(f => f.params.length > 0).map(f => ({
			label: f.name,
			kind: 'function' as const,
			insertText: f.params.length > 1 ? `${f.name}($1)` : `${f.name}()`,
			snippet: f.params.length > 1,
			detail: signature(f.name, f.params.slice(1), f.returnType),
			documentation: f.description
		}))
	}
	return [
		...variables.map(v => ({ label: v.name, kind: 'variable' as const, insertText: v.name, detail: v.type, documentation: v.description })),
		...functions.map(f => ({
			label: f.name,
			kind: 'function' as const,
			insertText: f.params.length ? `${f.name}($1)` : `${f.name}()`,
			snippet: f.params.length > 0,
			detail: signature(f.name, f.params, f.returnType),
			documentation: f.description
		})),
		...(language?.constants ?? []).map(c => ({ label: c, kind: 'constant' as const, insertText: c }))
	]
}
