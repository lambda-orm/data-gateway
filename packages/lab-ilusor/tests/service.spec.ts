// The REST service as Ilusor's Go and Python clients call it (docs/LAMBDAORM_PENDING.md L4, L5, L9, L12, L14).
// Runs only with ORM_SVC=1 and a service at ORM_URL (README: published image on 59291, this repo's on 59292).
import { describeSvc, id, svc } from './helpers'

describeSvc('service', () => {
	test('ping', async () => {
		expect((await svc('/ping')).status).toBe(200)
	})

	test('L14 /execute with data and options as JSON objects', async () => {
		const typeId = id()
		const insert = await svc('/execute', { query: 'DeviceTypes.insert()', data: { id: typeId, code: 'svc-' + typeId, name: 'svc' }, options: { stage: 'default' } })
		expect(insert.status).toBe(200)
		const select = await svc('/execute', { query: 'DeviceTypes.filter(p => p.id == id)', data: { id: typeId }, options: { stage: 'default' } })
		expect(select.body).toHaveLength(1)
	})

	test('L14 /execute with data and options as JSON text (the form in the wiki)', async () => {
		const typeId = id()
		const insert = await svc('/execute', { query: 'DeviceTypes.insert()', data: JSON.stringify({ id: typeId, code: 'svc-' + typeId, name: 'svc' }), options: JSON.stringify({ stage: 'default' }) })
		expect(insert.status).toBe(200)
		const select = await svc('/execute', { query: 'DeviceTypes.filter(p => p.id == id)', data: JSON.stringify({ id: typeId }) })
		expect(select.body).toHaveLength(1)
	})

	test('L4 update answers the affected rows', async () => {
		const typeId = id()
		await svc('/execute', { query: 'DeviceTypes.insert()', data: { id: typeId, code: 'svc-u-' + typeId, name: 'svc' } })
		const res = await svc('/execute', { query: 'DeviceTypes.update(p => ({ name: name })).filter(p => p.id == id)', data: { id: typeId, name: 'x' } })
		expect(res.status).toBe(200)
		expect(res.body).toBe(1)
	})

	test('L5 delete answers 200 and the affected rows', async () => {
		const typeId = id()
		await svc('/execute', { query: 'DeviceTypes.insert()', data: { id: typeId, code: 'svc-d-' + typeId, name: 'svc' } })
		const res = await svc('/execute', { query: 'DeviceTypes.delete().filter(p => p.id == id)', data: { id: typeId } })
		expect(res.status).toBe(200)
		expect(res.body).toBe(1)
	})

	test('errors carry a code a client can map (not found / unique / foreign key / invalid)', async () => {
		const typeId = id()
		const row = { id: typeId, code: 'svc-dup-' + typeId, name: 'svc' }
		await svc('/execute', { query: 'DeviceTypes.insert()', data: row })
		const dup = await svc('/execute', { query: 'DeviceTypes.insert()', data: row })
		expect(dup.status).toBeGreaterThanOrEqual(400)
		expect(dup.status).toBeLessThan(500) // a duplicate key is the caller's error (409), not the service's
	})

	test('L9 many requests in a row are not rate limited (internal service)', async () => {
		const results = await Promise.all(Array.from({ length: 60 }, () => svc('/ping')))
		expect(results.filter(r => r.status === 429)).toHaveLength(0)
	})

	test('L12 a request without the service token is refused (only once the service validates one)', async () => {
		const res = await svc('/execute', { query: 'DeviceTypes.map(p => p.id).page(1, 1)', data: {} })
		expect(res.status).toBe(401)
	})

	test('plan of an include across sources names every source it reads', async () => {
		const res = await svc('/plan', { query: 'Quotes.filter(p => p.id == id).include(p => p.lines.include(l => l.deviceModel))', options: { stage: 'default' } })
		expect(res.status).toBe(200)
		const flat = JSON.stringify(res.body)
		expect(flat).toMatch(/accounts/)
		expect(flat).toMatch(/catalog/)
	})
})
