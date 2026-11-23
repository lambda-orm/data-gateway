/** A piece of an expression of 3xpr, by what it is: to show it in colors (read) as the editor does (Monarch, same rules) */
export interface ExpressionToken {
	text: string
	kind: 'variable' | 'function' | 'constant' | 'string' | 'number' | 'operator' | 'name' | 'space'
}

export const EXPRESSION_CONSTANTS = ['true', 'false', 'null']

const RULES: [RegExp, ExpressionToken['kind'] | 'word'][] = [
	[/^\s+/, 'space'],
	[/^"(?:[^"\\]|\\.)*"?|^'(?:[^'\\]|\\.)*'?|^`(?:[^`\\]|\\.)*`?/, 'string'],
	[/^\d+(?:\.\d+)?/, 'number'],
	[/^[A-Za-z_$][\w$]*/, 'word'],
	[/^(?:===|!==|==|!=|<=|>=|&&|\|\||\*\*|=>|[-+*/%<>!=&|^~?:.,;()[\]{}])/, 'operator']
]

/**
 * The tokens of an expression: a word that is a variable of its context (entity, action…) or a constant, a function
 * (a word before a parenthesis), a string, a number, an operator. What can't be read goes as a name, one character.
 */
export const expressionTokens = (expression: string, variables: string[]): ExpressionToken[] => {
	const tokens: ExpressionToken[] = []
	let rest = expression
	while (rest.length) {
		let matched = false
		for (const [rule, kind] of RULES) {
			const m = rule.exec(rest)
			if (!m) continue
			const text = m[0]
			rest = rest.slice(text.length)
			let k: ExpressionToken['kind'] = kind === 'word' ? 'name' : kind
			if (kind === 'word') {
				if (EXPRESSION_CONSTANTS.includes(text)) k = 'constant'
				else if (/^\s*\(/.test(rest)) k = 'function'
				else if (variables.includes(text) && !tokens[tokens.length - 1]?.text.endsWith('.')) k = 'variable'
			}
			tokens.push({ text, kind: k })
			matched = true
			break
		}
		if (!matched) { tokens.push({ text: rest[0], kind: 'name' }); rest = rest.slice(1) }
	}
	return tokens
}

/** The variables of a condition of a source of a stage, when the gateway doesn't say them (an older one) */
export const STAGE_SOURCE_VARIABLES = ['entity', 'action', 'category', 'type', 'read', 'write', 'dml', 'ddl']
