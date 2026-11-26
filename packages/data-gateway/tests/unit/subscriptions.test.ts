// The subscriptions of a connection (docs/SUBSCRIPTIONS.md): to an entity (only the keys its view sees), to a query or a
// named one (run again when what it reads is written, its new result only when it changed), with its identity.
import { ConnectionSubscriptions } from '../../src/lib/application/subscriptions/subscriptions'
import { Listeners } from '../../src/lib/application/runtime/listeners'
import { DataChangeSummary } from '../../src/lib/domain/runtime/channelProtocol'
import { ctx, fakeGateway } from '../helpers/fakes'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const setup = (max = 10) => {
	const fixture = fakeGateway()
	fixture.orm.entity = (name: string) => name === 'Products' ? { name, primaryKey: ['id'] } as any : undefined
	const changes = new Listeners<DataChangeSummary[]>()
	const events: { event: string, params: any }[] = []
	const subscriptions = new ConnectionSubscriptions(fixture.gateway, ctx(['read']), listener => changes.subscribe(listener), (event, params) => events.push({ event, params }), { max, debounceMs: 10 })
	return { ...fixture, changes, events, subscriptions }
}

describe('to an entity', () => {
	test('each write of it, only with the keys its view sees (read with its identity); without keys, its count', async () => {
		const { subscriptions, changes, events, orm } = setup()
		const { subscription } = await subscriptions.entity('Products')
		orm.executeResult = [{ id: 1 }]
		changes.emit([{ entity: 'Products', action: 'update', keys: [{ id: 1 }, { id: 2 }] }, { entity: 'Orders', action: 'insert', keys: [{ id: 9 }] }])
		await wait(5)
		expect(events).toEqual([{ event: 'data.changed', params: { subscription, entity: 'Products', action: 'update', keys: [{ id: 1 }] } }])
		expect(orm.executed.at(-1)).toMatchObject({ query: 'Products.filter(p => (p.id == k0_0) || (p.id == k1_0)).map(p => [p.id])', data: { k0_0: 1, k1_0: 2 } })
		// none of them visible: nothing
		orm.executeResult = []
		changes.emit([{ entity: 'Products', action: 'delete', keys: [{ id: 3 }] }])
		await wait(5)
		expect(events).toHaveLength(1)
		changes.emit([{ entity: 'Products', action: 'update', count: 4 }])
		await wait(5)
		expect(events.at(-1)).toEqual({ event: 'data.changed', params: { subscription, entity: 'Products', action: 'update', count: 4 } })
	})

	test('an entity it doesn\'t have is not found; more than the limit is 429', async () => {
		const { subscriptions } = setup(1)
		await expect(subscriptions.entity('Nope')).rejects.toMatchObject({ status: 404 })
		await subscriptions.entity('Products')
		await expect(subscriptions.entity('Products')).rejects.toMatchObject({ status: 429, name: 'TooManySubscriptionsError' })
	})
})

describe('to a query', () => {
	test('its result now; run again when what it reads is written, the new result only when it changed', async () => {
		const { subscriptions, changes, events, orm } = setup()
		orm.executeResult = [{ id: 1 }]
		const { subscription, result } = await subscriptions.query({ query: 'Products.map(p => p.id)', data: {} })
		expect(result).toEqual([{ id: 1 }])
		changes.emit([{ entity: 'Products', action: 'update' }])
		await wait(30)
		expect(events).toEqual([])
		orm.executeResult = [{ id: 1 }, { id: 2 }]
		changes.emit([{ entity: 'Products', action: 'insert' }])
		changes.emit([{ entity: 'Products', action: 'insert' }])
		await wait(30)
		expect(events).toEqual([{ event: 'query.changed', params: { subscription, result: [{ id: 1 }, { id: 2 }] } }])
		const runs = orm.executed.length
		changes.emit([{ entity: 'Orders', action: 'insert' }])
		await wait(30)
		expect(orm.executed).toHaveLength(runs)
	})

	test('a named query by its name; a query that writes is not subscribed', async () => {
		const { subscriptions, orm } = setup()
		orm.named = [{ name: 'productById', query: 'Products.filter(p => p.id == id)' }, { name: 'rename', query: 'Products.update(p => ({ name: n })).filter(p => p.id == id)' }]
		expect(await subscriptions.query({ name: 'productById', data: { id: 1 } })).toMatchObject({ result: [{ id: 1 }] })
		await expect(subscriptions.query({ name: 'rename', data: {} })).rejects.toMatchObject({ status: 400 })
		await expect(subscriptions.query({ query: 'Products.insert()' })).rejects.toMatchObject({ status: 400 })
		await expect(subscriptions.query({})).rejects.toMatchObject({ status: 400 })
	})

	test('unsubscribe and close: nothing more arrives', async () => {
		const { subscriptions, changes, events, orm } = setup()
		const { subscription } = await subscriptions.query({ query: 'Products', data: {} })
		subscriptions.unsubscribe(subscription)
		expect(() => subscriptions.unsubscribe(subscription)).toThrow(expect.objectContaining({ status: 404 }))
		await subscriptions.entity('Products')
		subscriptions.close()
		orm.executeResult = [{ id: 7 }]
		changes.emit([{ entity: 'Products', action: 'insert', keys: [{ id: 7 }] }])
		await wait(30)
		expect(events).toEqual([])
		expect(subscriptions.size).toBe(0)
	})
})
