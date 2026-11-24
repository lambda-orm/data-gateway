import { expressions } from '3xpr'
import { expressionProblem } from '../../../domain/admin/expressions'
import { ExpressionLanguage, ExpressionLanguagePort, ExpressionSign } from '../../../application/ports/output/adminPorts'

const sign = ([name, metadata]: [string, any]): ExpressionSign => ({
	name,
	params: (metadata?.params ?? []).map((p: any) => ({ name: p.name, type: p.type, multiple: p.multiple || undefined })),
	returnType: metadata?.returnType ?? 'any',
	description: metadata?.doc?.description
})

/** The expressions of λORM: 3xpr */
export class ThreeExprLanguage implements ExpressionLanguagePort {
	private described?: ExpressionLanguage

	public language (): ExpressionLanguage {
		if (!this.described) {
			this.described = {
				functions: expressions.functions.map(sign).sort((a, b) => a.name.localeCompare(b.name)),
				operators: expressions.operators.map(sign),
				constants: expressions.constants.map(([name]) => name)
			}
		}
		return this.described
	}

	public evaluate (expression: string, data: Record<string, unknown>): unknown {
		return expressions.eval(expression, data)
	}

	public check (expression: string): { error?: string, variables: string[] } {
		try {
			expressions.build(expression)
			return { variables: expressions.parameters(expression).map(p => p.name) }
		} catch (error: any) {
			return { error: expressionProblem(String(error?.message ?? error)), variables: [] }
		}
	}
}
