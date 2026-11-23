// Column types and values Ilusor stores (docs/LAMBDAORM_PENDING.md L1, L2, L3, L6).
import { Orm } from '@lambdaorm/lib'
import { id, newOrm, pgColumn } from './helpers'

describe('types', () => {
	let orm: Orm
	beforeAll(async () => { orm = await newOrm() })
	afterAll(async () => { await orm.end() })

	test('L1 jsonb: an object goes in and comes back as the same object', async () => {
		const modelId = id()
		const settings = { video: { quality: 'high', fps: 15 }, tags: ['a', 'b'], enabled: true }
		await orm.execute('DeviceModels.insert()', { id: modelId, name: 'json', settings })
		const [row] = await orm.execute('DeviceModels.filter(p => p.id == id)', { id: modelId })
		expect(row.settings).toEqual(settings)
	})

	test('L1 jsonb: a list goes in and comes back as a list', async () => {
		const paramId = id()
		const sets = [{ code: 'a', value: 1 }, { code: 'b', value: 2 }]
		await orm.execute('Parameters.insert()', { id: paramId, code: 'p-' + paramId, locationId: id(), sets })
		const [row] = await orm.execute('Parameters.filter(p => p.id == id)', { id: paramId })
		expect(row.sets).toEqual(sets)
	})

	test('L2 dateTime keeps milliseconds', async () => {
		const modelId = id()
		const createdAt = new Date('2026-11-16T10:00:00.123Z')
		await orm.execute('DeviceModels.insert()', { id: modelId, name: 'ms', createdAt })
		const [row] = await orm.execute('DeviceModels.filter(p => p.id == id)', { id: modelId })
		expect(new Date(row.createdAt).toISOString()).toBe(createdAt.toISOString())
	})

	test('L2 dateTime is an instant: the column is timestamptz with milliseconds', async () => {
		const column = await pgColumn('catalog', 'device_models', 'created_at')
		expect(column?.data_type).toBe('timestamp with time zone')
		expect(column?.datetime_precision).toBe(3)
	})

	test('L3 compare with an empty string literal', async () => {
		const accountId = id()
		await orm.execute('Accounts.insert()', { id: accountId, name: 'empty', managedByTenantId: '' })
		const rows = await orm.execute('Accounts.filter(p => p.id == id && p.managedByTenantId == "")', { id: accountId })
		expect(rows).toHaveLength(1)
	})

	test('L3 an empty string parameter stays an empty string (not NULL)', async () => {
		const accountId = id()
		await orm.execute('Accounts.insert()', { id: accountId, name: 'empty-param', managedByTenantId: '' })
		const rows = await orm.execute('Accounts.filter(p => p.id == id && p.managedByTenantId == v)', { id: accountId, v: '' })
		expect(rows).toHaveLength(1)
		const [row] = await orm.execute('Accounts.filter(p => p.id == id)', { id: accountId })
		expect(row.managedByTenantId).toBe('')
	})

	test('L6 a column named with a reserved word (order): insert, filter and sort', async () => {
		const a = id(); const b = id()
		await orm.execute('DeviceTypes.insert()', { id: a, code: 'order-a-' + a, name: 'A', order: 2 })
		await orm.execute('DeviceTypes.insert()', { id: b, code: 'order-b-' + b, name: 'B', order: 1 })
		const rows = await orm.execute('DeviceTypes.filter(p => p.id.in([a, b]) && p.order > 0).sort(p => p.order)', { a, b })
		expect(rows.map((r: any) => r.id)).toEqual([b, a])
	})
})
