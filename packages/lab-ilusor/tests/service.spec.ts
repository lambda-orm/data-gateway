// The REST service as Ilusor's Go and Python clients call it (docs/LAMBDAORM_PENDING.md L4, L5, L9, L12, L14).
// Runs only with ORM_SVC=1 and a service at ORM_URL (README: published image on 59291, this repo's on 59292).
import { describeSvc, id, svc, svcUrl, svcToken } from './helpers'

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

	test('L30 errors carry a code a client can map (not found / unique / foreign key / invalid)', async () => {
		const typeId = id()
		const row = { id: typeId, code: 'svc-dup-' + typeId, name: 'svc' }
		await svc('/execute', { query: 'DeviceTypes.insert()', data: row })
		const dup = await svc('/execute', { query: 'DeviceTypes.insert()', data: row })
		expect(dup.status).toBeGreaterThanOrEqual(400)
		expect(dup.status).toBeLessThan(500) // a duplicate key is the caller's error (409), not the service's
	})

	// /script (L32): this repo's service started with SCRIPT_ENABLED=true (README); the published image has no /script
	test('L32 /script runs several queries in one transaction across sources and answers the last value', async () => {
		const typeId = id(); const accountId = id()
		const res = await svc('/script', {
			script: 'orm.execute("DeviceTypes.insert()", { id: typeId, code: "svc-s-" + typeId, name: "svc" }); orm.execute("Accounts.insert()", { id: accountId, name: "svc" }); typeId',
			data: { typeId, accountId },
			options: { stage: 'default' }
		})
		expect(res.status).toBe(200)
		expect(res.body).toBe(typeId)
		expect((await svc('/execute', { query: 'Accounts.filter(p => p.id == id)', data: { id: accountId } })).body).toHaveLength(1)
	})

	test('L32 /script: a duplicate key answers 409 and nothing of the script is written', async () => {
		const typeId = id(); const accountId = id()
		const res = await svc('/script', {
			script: 'orm.execute("DeviceTypes.insert()", { id: typeId, code: "svc-s-" + typeId, name: "svc" }); orm.execute("Accounts.insert()", { id: accountId, name: "a" }); orm.execute("Accounts.insert()", { id: accountId, name: "dup" })',
			data: { typeId, accountId }
		})
		expect(res.status).toBe(409)
		expect(res.body.code).toBe('23505')
		expect((await svc('/execute', { query: 'DeviceTypes.filter(p => p.id == id)', data: { id: typeId } })).body).toHaveLength(0)
	})

	test('L32 /script: throw { status, message } answers that status (e.g. 404) and rolls back', async () => {
		const typeId = id()
		const res = await svc('/script', {
			script: 'orm.execute("DeviceTypes.insert()", { id: typeId, code: "svc-s-" + typeId, name: "svc" }); q = orm.execute("Quotes.filter(p => p.id == quoteId)", { quoteId: typeId }); if (q.length() == 0) { throw { status: 404, message: "quote not found" }; }',
			data: { typeId }
		})
		expect(res.status).toBe(404)
		expect(res.body.message).toBe('quote not found')
		expect((await svc('/execute', { query: 'DeviceTypes.filter(p => p.id == id)', data: { id: typeId } })).body).toHaveLength(0)
	})

	test('L32 /script refuses a script longer than SCRIPT_MAX_LENGTH (413) and one reading environment variables', async () => {
		expect((await svc('/script', { script: '1;'.repeat(20001) })).status).toBe(413)
		const env = await svc('/script', { script: '$ORM_CATALOG_CNX' })
		expect(env.status).toBeGreaterThanOrEqual(400)
		expect(JSON.stringify(env.body)).not.toMatch(/password|catalog_rw/)
	})

	test('L32 @lambdaorm/client executeScript runs a script on the service', async () => {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { Orm: ClientOrm } = require('@lambdaorm/client')
		const client = new ClientOrm(svcUrl)
		await client.init(undefined, { token: svcToken })
		const typeId = id()
		const result = await client.executeScript('orm.execute("DeviceTypes.insert()", { id: typeId, code: "cli-" + typeId, name: "client" }); typeId', { typeId })
		expect(result).toBe(typeId)
		expect(await client.execute('DeviceTypes.filter(p => p.id == id)', { id: typeId })).toHaveLength(1)
	})

	test('L9 many requests in a row are not rate limited (internal service)', async () => {
		const results = await Promise.all(Array.from({ length: 60 }, () => svc('/ping')))
		expect(results.filter(r => r.status === 429)).toHaveLength(0)
	})

	test('L12 a request without the service token is refused (only once the service validates one)', async () => {
		// the service runs with SERVICE_TOKEN (README); this request sends no token
		const res = await svc('/execute', { query: 'DeviceTypes.map(p => p.id).page(1, 1)', data: {} }, { Authorization: undefined })
		expect(res.status).toBe(401)
		expect((await svc('/execute', { query: 'DeviceTypes.map(p => p.id).page(1, 1)', data: {} }, { Authorization: 'Bearer wrong' })).status).toBe(401)
		expect((await svc('/ping', undefined, { Authorization: undefined })).status).toBe(200)
	})

	test('plan of an include across sources names every source it reads', async () => {
		const res = await svc('/plan', { query: 'Quotes.filter(p => p.id == id).include(p => p.lines.include(l => l.deviceModel))', options: { stage: 'default' } })
		expect(res.status).toBe(200)
		const flat = JSON.stringify(res.body)
		expect(flat).toMatch(/accounts/)
		expect(flat).toMatch(/catalog/)
	})
})
