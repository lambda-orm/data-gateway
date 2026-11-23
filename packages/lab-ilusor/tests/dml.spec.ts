// Writes and list queries Ilusor's repositories need (docs/LAMBDAORM_PENDING.md L4, L5, L18, L23).
import { Orm } from '../../../../lib'
import { affected, id, newOrm } from './helpers'

describe('dml', () => {
	let orm: Orm
	beforeAll(async () => { orm = await newOrm() })
	afterAll(async () => { await orm.end() })

	const newType = async (extra: any = {}) => {
		const typeId = id()
		await orm.execute('DeviceTypes.insert()', { id: typeId, code: 'dml-' + typeId, name: 'type', ...extra })
		return typeId
	}

	test('L4 update says how many rows it changed', async () => {
		const typeId = await newType()
		const result = await orm.execute('DeviceTypes.update(p => ({ name: name })).filter(p => p.id == id)', { id: typeId, name: 'renamed' })
		expect(affected(result)).toBe(1)
	})

	test('L4 update of a missing row says 0 (Ilusor answers "not found")', async () => {
		const result = await orm.execute('DeviceTypes.update(p => ({ name: name })).filter(p => p.id == id)', { id: id(), name: 'x' })
		expect(affected(result)).toBe(0)
	})

	test('L4 optimistic lock: the second update with the same version changes nothing', async () => {
		const quoteId = id()
		await orm.execute('Quotes.insert()', { id: quoteId, tenantId: id(), status: 'draft', version: 1 })
		const update = 'Quotes.update(p => ({ status: status, version: version + 1 })).filter(p => p.id == id && p.version == version)'
		const first = await orm.execute(update, { id: quoteId, status: 'sent', version: 1 })
		const second = await orm.execute(update, { id: quoteId, status: 'accepted', version: 1 })
		expect(affected(first)).toBe(1)
		expect(affected(second)).toBe(0)
		const [row] = await orm.execute('Quotes.filter(p => p.id == id)', { id: quoteId })
		expect(row).toMatchObject({ status: 'sent', version: 2 })
	})

	test('L5 delete with a filter deletes and says how many', async () => {
		const typeId = await newType()
		const result = await orm.execute('DeviceTypes.delete().filter(p => p.id == id)', { id: typeId })
		expect(affected(result)).toBe(1)
		expect(await orm.execute('DeviceTypes.filter(p => p.id == id)', { id: typeId })).toHaveLength(0)
	})

	test('L18 upsert: insert, then update the same key', async () => {
		const typeId = id()
		const code = 'upsert-' + typeId
		await orm.execute('DeviceTypes.upsert()', { id: typeId, code, name: 'first' })
		await orm.execute('DeviceTypes.upsert()', { id: typeId, code, name: 'second' })
		const rows = await orm.execute('DeviceTypes.filter(p => p.id == id)', { id: typeId })
		expect(rows).toHaveLength(1)
		expect(rows[0].name).toBe('second')
	})

	test('bulkInsert of many rows', async () => {
		const tag = id()
		const rows = Array.from({ length: 50 }, (_, i) => ({ id: id(), code: `bulk-${tag}-${i}`, name: `bulk ${tag}`, order: i }))
		await orm.execute('DeviceTypes.bulkInsert()', rows)
		const back = await orm.execute('DeviceTypes.filter(p => p.name == name).map(p => p.id)', { name: `bulk ${tag}` })
		expect(back).toHaveLength(50)
	})

	test('page + sort with a tie-breaker', async () => {
		const tag = id()
		const rows = Array.from({ length: 5 }, (_, i) => ({ id: id(), code: `page-${tag}-${i}`, name: `page ${tag}`, order: i % 2 }))
		await orm.execute('DeviceTypes.bulkInsert()', rows)
		const page = await orm.execute('DeviceTypes.filter(p => p.name == name).sort(p => [p.order, p.id]).page(2, 2)', { name: `page ${tag}` })
		const expected = [...rows].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).slice(2, 4).map(r => r.id)
		expect(page.map((r: any) => r.id)).toEqual(expected)
	})

	test('count', async () => {
		const tag = id()
		await orm.execute('DeviceTypes.bulkInsert()', [1, 2, 3].map(i => ({ id: id(), code: `count-${tag}-${i}`, name: `count ${tag}` })))
		const [row] = await orm.execute('DeviceTypes.filter(p => p.name == name).map(p => ({ n: count(1) }))', { name: `count ${tag}` })
		expect(Number(row.n)).toBe(3)
	})

	test('L23 text search: every "+" term must match (Ilusor: "a+b" = a AND b), case-insensitive', async () => {
		const tag = id().slice(0, 8)
		await orm.execute('DeviceModels.bulkInsert()', [
			{ id: id(), name: `Camera Living ${tag}`, nameNormalized: `camera living ${tag}` },
			{ id: id(), name: `Camera Garage ${tag}`, nameNormalized: `camera garage ${tag}` },
			{ id: id(), name: `Sensor Living ${tag}`, nameNormalized: `sensor living ${tag}` }
		])
		const rows = await orm.execute(
			'DeviceModels.filter(p => like(lower(p.name), t1) && like(lower(p.name), t2) && like(lower(p.name), t3))',
			{ t1: '%camera%', t2: '%living%', t3: `%${tag}%` })
		expect(rows.map((r: any) => r.name)).toEqual([`Camera Living ${tag}`])
	})
})
