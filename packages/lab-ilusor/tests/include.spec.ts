// One expression per use case: aggregates, includes across Postgres schemas (sources) and transactions
// (docs/LAMBDAORM_PENDING.md L15, L16, L17, L31).
import { Orm } from '@lambdaorm/lib'
import { id, newOrm } from './helpers'

describe('include', () => {
	let orm: Orm
	beforeAll(async () => { orm = await newOrm() })
	afterAll(async () => { await orm.end() })

	/** catalog: a type and a model; accounts: an account and a quote with two lines pointing at the model. */
	const seedQuote = async () => {
		const typeId = id(); const modelId = id(); const accountId = id(); const quoteId = id()
		await orm.execute('DeviceTypes.insert()', { id: typeId, code: 'inc-' + typeId, name: 'Camera', icon: 'camera' })
		await orm.execute('DeviceModels.insert()', { id: modelId, name: 'Model ' + modelId, deviceTypeId: typeId })
		await orm.execute('Accounts.insert()', { id: accountId, name: 'Account ' + accountId })
		await orm.execute('Quotes.insert().include(p => p.lines)', {
			id: quoteId, tenantId: id(), accountId, status: 'draft', version: 1,
			lines: [
				{ id: id(), quoteId, deviceModelId: modelId, quantity: 2, unitPrice: 10.5 },
				{ id: id(), quoteId, deviceModelId: modelId, quantity: 1, unitPrice: 99 }
			]
		})
		return { typeId, modelId, accountId, quoteId }
	}

	test('insert of an aggregate with its composite children in one sentence', async () => {
		const { quoteId } = await seedQuote()
		const lines = await orm.execute('QuoteLines.filter(p => p.quoteId == id)', { id: quoteId })
		expect(lines).toHaveLength(2)
	})

	test('include 3 levels across sources: quote (accounts) → lines → model (catalog) → type', async () => {
		const { quoteId, modelId } = await seedQuote()
		const [quote] = await orm.execute(
			'Quotes.filter(p => p.id == id).include(p => p.lines.include(l => l.deviceModel.include(m => m.deviceType.map(t => [t.name, t.icon]))))',
			{ id: quoteId })
		expect(quote.lines).toHaveLength(2)
		expect(quote.lines[0].deviceModel.id).toBe(modelId)
		expect(quote.lines[0].deviceModel.deviceType).toMatchObject({ name: 'Camera', icon: 'camera' })
	})

	test('include across schemas the other way: account (accounts) → locations → areas (site)', async () => {
		const accountId = id(); const locationId = id()
		await orm.execute('Accounts.insert()', { id: accountId, name: 'With areas' })
		await orm.execute('Locations.insert()', { id: locationId, accountId, name: 'Home' })
		await orm.execute('Areas.bulkInsert()', [
			{ id: id(), locationId, name: 'Living' },
			{ id: id(), locationId, name: 'Kitchen' }
		])
		const [account] = await orm.execute(
			'Accounts.filter(p => p.id == id).include(p => p.locations.include(l => l.areas.map(a => [a.id, a.name])))',
			{ id: accountId })
		expect(account.locations[0].areas.map((a: any) => a.name).sort()).toEqual(['Kitchen', 'Living'])
	})

	test('a list with map: only the columns asked for, plus a field of a relation', async () => {
		const { accountId } = await seedQuote()
		const rows = await orm.execute('Quotes.filter(p => p.accountId == id).map(p => [p.id, p.status, p.account.name])', { id: accountId })
		expect(rows).toHaveLength(1)
		// a relation's field comes as <relation>_<field> (account_name)
		expect(Object.keys(rows[0]).sort()).toEqual(['account_name', 'id', 'status'])
	})

	test('L15 filter by a field of a relation in another source (QuoteLines → DeviceModels)', async () => {
		const { modelId, quoteId } = await seedQuote()
		const rows = await orm.execute('QuoteLines.filter(p => p.deviceModel.name == name && p.quoteId == quoteId)', { name: 'Model ' + modelId, quoteId })
		expect(rows).toHaveLength(2)
	})

	test('L15 across sources: with ||, with no match in the other source, and a clear error when compared with a field', async () => {
		const { modelId, quoteId } = await seedQuote()
		const either = await orm.execute('QuoteLines.filter(p => p.quoteId == quoteId && (p.deviceModel.name == name || p.quantity > 100))', { name: 'Model ' + modelId, quoteId })
		expect(either).toHaveLength(2)
		const none = await orm.execute('QuoteLines.filter(p => p.quoteId == quoteId && p.deviceModel.name == name)', { name: 'no such model', quoteId })
		expect(none).toHaveLength(0)
		await expect(orm.execute('QuoteLines.filter(p => p.deviceModel.name == p.quoteId)', {}))
			.rejects.toThrow(/in another source, so it can only be compared with values/)
	})

	test('L33 in() with a list in a variable (Postgres)', async () => {
		const { quoteId } = await seedQuote()
		const lines = await orm.execute('QuoteLines.filter(p => p.quoteId == quoteId)', { quoteId })
		const ids = lines.map((l: any) => l.id)
		expect(await orm.execute('QuoteLines.filter(p => in(p.id, ids))', { ids })).toHaveLength(2)
		expect(await orm.execute('QuoteLines.filter(p => p.id.in(ids))', { ids: [ids[0]] })).toHaveLength(1)
	})

	test('L16 a transaction across two sources is all or nothing', async () => {
		const typeId = id(); const accountId = id()
		// the error comes from a query (duplicate key); an error thrown by the callback is L26 and L31
		await expect(orm.transaction({ stage: 'default' }, async tr => {
			await tr.execute('DeviceTypes.insert()', { id: typeId, code: 'tx-' + typeId, name: 'tx' })
			await tr.execute('Accounts.insert()', { id: accountId, name: 'tx' })
			await tr.execute('Accounts.insert()', { id: accountId, name: 'duplicate key' })
		})).rejects.toThrow()
		expect(await orm.execute('DeviceTypes.filter(p => p.id == id)', { id: typeId })).toHaveLength(0)
		expect(await orm.execute('Accounts.filter(p => p.id == id)', { id: accountId })).toHaveLength(0)
	})

	test('L31 orm.execute inside orm.transaction (not through tr) runs in that transaction: a rollback undoes it in both sources', async () => {
		const typeId = id(); const accountId = id()
		await expect(orm.transaction({ stage: 'default' }, async () => {
			// as a repository, a service method or a listener would do: plain orm.execute, no tr
			await orm.execute('DeviceTypes.insert()', { id: typeId, code: 'l31-' + typeId, name: 'l31' })
			await orm.execute('Accounts.insert()', { id: accountId, name: 'l31' })
			throw new Error('abort the use case')
		})).rejects.toThrow('abort the use case')
		expect(await orm.execute('DeviceTypes.filter(p => p.id == id)', { id: typeId })).toHaveLength(0)
		expect(await orm.execute('Accounts.filter(p => p.id == id)', { id: accountId })).toHaveLength(0)
	})

	test('L31 orm.execute inside orm.transaction: the commit keeps both writes, and they see each other before it', async () => {
		const typeId = id(); const accountId = id()
		let seenInside: any[] = []
		await orm.transaction({ stage: 'default' }, async () => {
			await orm.execute('DeviceTypes.insert()', { id: typeId, code: 'l31c-' + typeId, name: 'l31' })
			await orm.execute('Accounts.insert()', { id: accountId, name: 'l31' })
			seenInside = await orm.execute('DeviceTypes.filter(p => p.id == id)', { id: typeId })
		})
		expect(seenInside).toHaveLength(1)
		expect(await orm.execute('DeviceTypes.filter(p => p.id == id)', { id: typeId })).toHaveLength(1)
		expect(await orm.execute('Accounts.filter(p => p.id == id)', { id: accountId })).toHaveLength(1)
	})

	test('L31 an execution on another stage inside a transaction joins it (and rolls back with it)', async () => {
		const typeId = id()
		await expect(orm.transaction({ stage: 'default' }, async tr => {
			await orm.execute('DeviceTypes.insert()', { id: typeId, code: 'l31s-' + typeId, name: 'l31' })
			await tr.execute('Accounts.filter(p => p.id == id)', { id: typeId }, { stage: 'ddl' })
			throw new Error('abort')
		})).rejects.toThrow('abort')
		expect(await orm.execute('DeviceTypes.filter(p => p.id == id)', { id: typeId })).toHaveLength(0)
	})

	test('L17 update of an aggregate with include: children not sent are removed, new ones added, the rest updated', async () => {
		const { quoteId, modelId } = await seedQuote()
		const [quote] = await orm.execute('Quotes.filter(p => p.id == id).include(p => p.lines)', { id: quoteId })
		const kept = { ...quote.lines[0], quantity: 7 }
		const added = { id: id(), quoteId, deviceModelId: modelId, quantity: 3, unitPrice: 1 }
		await orm.execute('Quotes.update().include(p => p.lines)', { ...quote, status: 'sent', lines: [kept, added] })
		const lines = await orm.execute('QuoteLines.filter(p => p.quoteId == id)', { id: quoteId })
		expect(lines.map((l: any) => l.id).sort()).toEqual([kept.id, added.id].sort())
		expect(lines.find((l: any) => l.id === kept.id).quantity).toBe(7)
	})
})

describe('transaction callback errors', () => {
	let orm: Orm
	beforeAll(async () => { orm = await newOrm() })
	afterAll(async () => { await orm.end() })

	test('L26 an error thrown by the callback rejects orm.transaction and rolls back', async () => {
		const accountId = id()
		await expect(orm.transaction({ stage: 'default' }, async tr => {
			await tr.execute('Accounts.insert()', { id: accountId, name: 'tx' })
			throw new Error('boom')
		})).rejects.toThrow('boom')
		expect(await orm.execute('Accounts.filter(p => p.id == id)', { id: accountId })).toHaveLength(0)
	})
})
