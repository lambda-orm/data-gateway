import { expressions } from '3xpr'
import { expressionProblem } from '../../../domain/admin/expressions'
import { ExpressionLanguage, ExpressionLanguagePort, ExpressionSign } from '../../../application/ports/output/adminPorts'

const sign = ([name, metadata]: [string, any]): ExpressionSign => ({
	name,
	params: (metadata?.params ?? []).map((p: any) => ({ name: p.name, type: p.type, multiple: p.multiple || undefined })),
	returnType: metadata?.returnType ?? 'any',
	description: metadata?.doc?.description
})

/**
 * The functions λORM adds to 3xpr (its SentenceLibrary, not exported): the expressions of the properties use them
 * (readValue: decrypt(email,$KEY)). Here only to know them (check, the language): λORM evaluates them.
 */
const ORM_FUNCTIONS: [string, string][] = [
	['encrypt(value:string,key:string):string', 'Encrypt a string (AES, λORM)'],
	['decrypt(value:string,key:string):string', 'Decrypt a string (AES, λORM)'],
	['toBase64(value:string):string', 'Convert a string to base64 (λORM)'],
	['getBase64(value:string):string', 'Get a string from base64 (λORM)']
]
let ormFunctions = false
const addOrmFunctions = (): void => {
	if (ormFunctions) return
	ormFunctions = true
	for (const [signature, description] of ORM_FUNCTIONS) {
		const name = signature.slice(0, signature.indexOf('('))
		if (expressions.functions.some(([known]) => known === name)) continue
		expressions.addFunction(signature, () => { throw new Error(`${name} is evaluated by λORM`) }, { description })
	}
}

/** The expressions of λORM: 3xpr, with the functions λORM adds */
export class ThreeExprLanguage implements ExpressionLanguagePort {
	private described?: ExpressionLanguage

	constructor () { addOrmFunctions() }

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
