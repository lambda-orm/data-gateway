import { expressionProblem } from '../../src/lib/domain/admin/expressions'
import { ThreeExprLanguage } from '../../src/lib/infrastructure/output/admin/threeExprLanguage'
import { LambdaSchemaValidator } from '../../src/lib/infrastructure/output/admin/lambdaSchemaValidator'

describe('the expressions of a schema', () => {
	test('the messages of 3xpr said as what is wrong', () => {
		expect(expressionProblem('expression x( expression  error: TypeError: Cannot read properties of undefined (reading \'1\')')).toMatch(/incomplete/)
		expect(expressionProblem('expression a &&& b expression  error: Error: Operand undefined')).toMatch(/operator is not known/)
		expect(expressionProblem('expression x.nope() expression  error: Error: function: nope not found ')).toBe('function: nope not found')
	})

	test('3xpr: its functions described, an expression checked', () => {
		const language = new ThreeExprLanguage()
		const includes = language.language().functions.find(f => f.name === 'includes')
		expect(includes).toMatchObject({ returnType: 'boolean', params: [{ name: 'source' }, { name: 'value' }] })
		expect(language.check('entity.in(["A"]) && !write')).toEqual({ variables: ['entity', 'write'] })
		expect(language.check('entity.nope(1)').error).toMatch(/nope not found/)
	})

	test('the functions λORM adds (encrypt, decrypt…): known, as the expressions of the properties use them', () => {
		const language = new ThreeExprLanguage()
		const names = language.language().functions.map(f => f.name)
		expect(names).toEqual(expect.arrayContaining(['encrypt', 'decrypt', 'toBase64', 'getBase64']))
		expect(language.check('if(isNull(email)){null}else{decrypt(email,"${DATA_SECRET_KEY}")}')).toEqual({ variables: ['email'] })
		expect(language.check('toNumber(decrypt(lat,"k"))').error).toBeUndefined()
		// twice: added once
		expect(new ThreeExprLanguage().language().functions.filter(f => f.name === 'encrypt')).toHaveLength(1)
	})

	test('the validator: a condition that doesn\'t parse is an error, a variable of nothing a warning', async () => {
		const schema = (condition: string) => `domain: { entities: [] }\ninfrastructure:\n  sources:\n    - { name: a, dialect: PostgreSQL }\n  stages:\n    - name: default\n      sources:\n        - name: a\n          condition: '${condition}'\n`
		const validator = new LambdaSchemaValidator()
		expect(await validator.validate(schema('entity.in(["A"]) && read'))).toEqual([])
		const unknown = await validator.validate(schema('entity == "A" && foo'))
		expect(unknown).toEqual([expect.objectContaining({ severity: 'warning', line: 9, message: expect.stringContaining('uses foo') })])
		const broken = await validator.validate(schema('entity =='))
		expect(broken).toEqual([expect.objectContaining({ severity: 'error', line: 9 })])
	})
})
