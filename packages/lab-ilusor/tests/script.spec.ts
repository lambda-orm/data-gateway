// Transactional scripts (docs/EXPRESSION_PLAN.md F3, docs/LAMBDAORM_PENDING.md L32): orm.executeScript evaluates a 3xpr
// script whose orm.execute calls all run in one transaction, also across sources (catalog + accounts).
import { Orm } from '../../../../lib'
import { id, newOrm } from './helpers'

describe('script', () => {
	let orm: Orm
	beforeAll(async () => { orm = await newOrm() })
	afterAll(async () => { await orm.end() })

	const typeExists = async (typeId: string) => (await orm.execute('DeviceTypes.filter(p => p.id == id)', { id: typeId })).length === 1
	const accountExists = async (accountId: string) => (await orm.execute('Accounts.filter(p => p.id == id)', { id: accountId })).length === 1

	test('L32 several orm.execute in two sources commit together; the result is the last value', async () => {
		const typeId = id(); const accountId = id()
		const result = await orm.executeScript(`
			orm.execute("DeviceTypes.insert()", { id: typeId, code: "s-" + typeId, name: "script" });
			orm.execute("Accounts.insert()", { id: accountId, name: "script" });
			"done"
		`, { typeId, accountId })
		expect(result).toBe('done')
		expect(await typeExists(typeId)).toBe(true)
		expect(await accountExists(accountId)).toBe(true)
	})

	test('L32 a failing statement rolls back the previous ones in both sources and rejects with its error', async () => {
		const typeId = id(); const accountId = id()
		await expect(orm.executeScript(`
			orm.execute("DeviceTypes.insert()", { id: typeId, code: "s-" + typeId, name: "script" });
			orm.execute("Accounts.insert()", { id: accountId, name: "script" });
			orm.execute("Accounts.insert()", { id: accountId, name: "duplicate key" });
		`, { typeId, accountId })).rejects.toThrow(/duplicate key|accounts_pk/)
		expect(await typeExists(typeId)).toBe(false)
		expect(await accountExists(accountId)).toBe(false)
	})

	test('L32 throw aborts the script (business rule) and rolls back; the next statements never run', async () => {
		const typeId = id(); const accountId = id()
		await expect(orm.executeScript(`
			orm.execute("DeviceTypes.insert()", { id: typeId, code: "s-" + typeId, name: "script" });
			found = orm.execute("DeviceTypes.filter(p => p.id == typeId)", { typeId: typeId });
			if (found.length() == 1) { throw "type already used"; }
			orm.execute("Accounts.insert()", { id: accountId, name: "never" });
		`, { typeId, accountId })).rejects.toThrow(/^type already used$/)
		expect(await typeExists(typeId)).toBe(false)
		expect(await accountExists(accountId)).toBe(false)
	})

	test('L32 a statement sees what the previous ones wrote, before the commit (read your writes)', async () => {
		const typeId = id(); const modelId = id()
		const model = await orm.executeScript(`
			orm.execute("DeviceTypes.insert()", { id: typeId, code: "s-" + typeId, name: "script" });
			orm.execute("DeviceModels.insert()", { id: modelId, name: "model " + modelId, deviceTypeId: typeId });
			rows = orm.execute("DeviceModels.filter(p => p.id == modelId).map(p => ({ id: p.id, type: p.deviceTypeId }))", { modelId: modelId });
			return rows[0];
		`, { typeId, modelId })
		expect(model).toEqual({ id: modelId, type: typeId })
	})

	test('L32 for in over the data: one insert per item, all or nothing', async () => {
		const typeId = id()
		const models = [id(), id(), id()]
		const count = await orm.executeScript(`
			orm.execute("DeviceTypes.insert()", { id: typeId, code: "s-" + typeId, name: "script" });
			for (m in models) {
				orm.execute("DeviceModels.insert()", { id: m, name: "model " + m, deviceTypeId: typeId });
			}
			orm.execute("DeviceModels.filter(p => p.deviceTypeId == typeId)", { typeId: typeId }).length()
		`, { typeId, models })
		expect(count).toBe(3)
	})

	test('L32 try/catch inside the script: a handled error does not abort it', async () => {
		const typeId = id()
		const result = await orm.executeScript(`
			try { throw "handled"; } catch (e) { note = e.message; }
			orm.execute("DeviceTypes.insert()", { id: typeId, code: "s-" + typeId, name: note });
			note
		`, { typeId })
		expect(result).toBe('handled')
		expect(await typeExists(typeId)).toBe(true)
	})

	test('L32 the script works on a copy of data, and cannot read environment variables', async () => {
		const data = { n: 1 }
		expect(await orm.executeScript('n = n + 1; extra = "x"; n', data)).toBe(2)
		expect(data).toEqual({ n: 1 })
		await expect(orm.executeScript('$ORM_CATALOG_CNX', {})).rejects.toThrow(/environment variables are not allowed/)
	})

	test('L32 orm.execute without options inside a script runs on the stage of the script', async () => {
		const typeId = id()
		await orm.executeScript('orm.execute("DeviceTypes.insert()", { id: typeId, code: "s-" + typeId, name: "script" })', { typeId }, { stage: 'default' })
		expect(await typeExists(typeId)).toBe(true)
		await expect(orm.executeScript('orm.execute("DeviceTypes.filter(p => p.id == typeId)", { typeId: typeId }, { stage: "ddl" })', { typeId }, { stage: 'default' }))
			.rejects.toThrow('inside a transaction of stage "default"')
	})
})
