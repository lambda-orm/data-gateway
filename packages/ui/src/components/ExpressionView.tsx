import React from 'react'
import { expressionTokens, STAGE_SOURCE_VARIABLES } from '../domain/expressionTokens'

/** An expression of 3xpr shown as code, in the colors the editor gives it (read only) */
export const ExpressionView: React.FC<{ expression: string, variables?: string[], empty?: React.ReactNode }> = ({ expression, variables = STAGE_SOURCE_VARIABLES, empty }) => {
	if (!expression.trim()) return <span className="lw-expression-empty">{empty}</span>
	return (
		<code className="lw-expression-view">
			{expressionTokens(expression, variables.length ? variables : STAGE_SOURCE_VARIABLES).map((token, i) =>
				token.kind === 'space' ? token.text : <span key={i} className={`lw-tok-${token.kind}`}>{token.text}</span>)}
		</code>
	)
}
