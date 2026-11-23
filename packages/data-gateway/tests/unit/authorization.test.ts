// Permissions (docs/DATA_GATEWAY.md §6.2) and what a query does, from its metadata.
import { authorize, requiredPermissions } from '../../src/lib/domain/auth/authorizationPolicy'
import { principal } from '../../src/lib/domain/auth/principal'
import { classifyQuery } from '../../src/lib/domain/query/queryClassification'

describe('query classification (orm.metadata)', () => {
	const sentence = (name: string, entity: string, children: any[] = []): any => ({ classtype: 'Sentence', name, entity, children })

	test('a select reads', () => {
		expect(classifyQuery(sentence('select', 'Products', [{ classtype: 'Field', name: 'id', children: [] }])))
			.toEqual({ actions: ['select'], entities: ['Products'], writes: false })
	})

	test('a write in the root or in an include writes', () => {
		for (const action of ['insert', 'update', 'delete', 'upsert', 'merge', 'bulkInsert']) {
			expect(classifyQuery(sentence(action, 'Products')).writes).toBe(true)
		}
		const include = sentence('select', 'Orders', [{ classtype: 'Arrow', name: 'include', children: [sentence('insert', 'Orders.details')] }])
		expect(classifyQuery(include)).toEqual({ actions: ['select', 'insert'], entities: ['Orders', 'Orders.details'], writes: true })
	})

	test('no sentence found is treated as a write, to be safe', () => {
		expect(classifyQuery({ classtype: 'Constant', name: '1', children: [] } as any).writes).toBe(true)
	})
})

describe('authorization policy', () => {
	const reader = principal('agent', ['read'])
	const writer = principal('backend', ['read', 'write'])

	test('permissions by operation', () => {
		expect(requiredPermissions('plan')).toEqual(['read'])
		expect(requiredPermissions('execute', false)).toEqual(['read'])
		expect(requiredPermissions('execute', true)).toEqual(['write'])
		expect(requiredPermissions('executeQueued', false)).toEqual(['queue'])
		expect(requiredPermissions('executeQueued', true)).toEqual(['queue', 'write'])
		expect(requiredPermissions('executeScript')).toEqual(['script'])
		expect(requiredPermissions('stageImport')).toEqual(['stageImport'])
		expect(requiredPermissions('stageExport')).toEqual(['read'])
	})

	test('a missing permission answers 403 naming the credential and the permission', () => {
		expect(() => authorize(reader, 'execute', false)).not.toThrow()
		expect(() => authorize(reader, 'execute', true)).toThrow(expect.objectContaining({
			status: 403, name: 'ForbiddenError', message: 'the credential "agent" does not have the "write" permission'
		}))
		expect(() => authorize(writer, 'execute', true)).not.toThrow()
		expect(() => authorize(writer, 'executeScript')).toThrow(expect.objectContaining({ status: 403 }))
	})
})
