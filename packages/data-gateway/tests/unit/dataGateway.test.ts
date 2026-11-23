// The facade and its use cases with fake ports: authorization, audit, script limits, queue and timeout.
import { ALL, ctx, FakeQueue, fakeGateway } from '../helpers/fakes'

describe('execute', () => {
	test('a select needs read; it is not audited', async () => {
		const { gateway, orm, audit } = fakeGateway()
		expect(await gateway.execute(ctx(['read']), { query: 'Products.filter(p => p.id == id)', data: { id: 1 } })).toEqual([{ id: 1 }])
		expect(orm.executed).toHaveLength(1)
		expect(audit.entries).toHaveLength(0)
	})

	test('a write with only read answers 403 before executing', async () => {
		const { gateway, orm, audit } = fakeGateway()
		await expect(gateway.execute(ctx(['read'], 'agent'), { query: 'Products.insert()', data: { id: 1 } }))
			.rejects.toMatchObject({ status: 403, name: 'ForbiddenError' })
		await expect(gateway.execute(ctx(['read']), { query: 'Orders.filter(p => p.id == 1).include(p => p.details.delete())' }))
			.rejects.toMatchObject({ status: 403 })
		expect(orm.executed).toHaveLength(0)
		expect(audit.entries).toHaveLength(0)
	})

	test('a write with write runs and leaves an audit entry, without data unless includeData', async () => {
		const { gateway, audit } = fakeGateway()
		await gateway.execute(ctx(['write'], 'backend', 'http'), { query: 'Products.insert()', data: { id: 1, name: 'secret' } })
		expect(audit.entries).toEqual([{
			type: 'audit', time: '2026-11-17T12:00:00.000Z', schema: '', transport: 'http', credential: 'backend',
			operation: 'execute', actions: ['insert'], entities: ['Products'], query: 'Products.insert()',
			rows: 1, durationMs: 5, result: 'ok'
		}])
		const withData = fakeGateway({ includeData: true })
		await withData.gateway.execute(ctx(ALL), { query: 'Products.insert()', data: { id: 1 } })
		expect(withData.audit.entries[0].data).toEqual({ id: 1 })
	})

	test('a failed write is audited with its error; rows = affected rows', async () => {
		const { gateway, orm, audit } = fakeGateway()
		orm.executeResult = new Error('duplicate key')
		await expect(gateway.execute(ctx(ALL), { query: 'Products.insert()' })).rejects.toThrow('duplicate key')
		expect(audit.entries[0]).toMatchObject({ result: 'error', error: 'duplicate key' })
		orm.executeResult = 3
		await gateway.execute(ctx(ALL), { query: 'Products.delete()' })
		expect(audit.entries[1]).toMatchObject({ result: 'ok', rows: 3, actions: ['delete'] })
	})

	test('audit disabled writes nothing', async () => {
		const { gateway, audit } = fakeGateway({ auditEnabled: false })
		await gateway.execute(ctx(ALL), { query: 'Products.insert()' })
		expect(audit.entries).toHaveLength(0)
	})

	test('a query is required', async () => {
		const { gateway } = fakeGateway()
		await expect(gateway.execute(ctx(ALL), { query: ' ' })).rejects.toMatchObject({ status: 400, name: 'QueryError' })
		await expect(gateway.plan(ctx(ALL), {} as any)).rejects.toMatchObject({ status: 400 })
	})

	test('longer than server.timeout answers 504', async () => {
		const { gateway, orm } = fakeGateway({ timeoutMs: 20 })
		orm.executeDelayMs = 200
		await expect(gateway.execute(ctx(ALL), { query: 'Products' })).rejects.toMatchObject({ status: 504, name: 'TimeoutError' })
	})
})

describe('executeScript', () => {
	test('needs script, is always audited', async () => {
		const { gateway, audit } = fakeGateway()
		await expect(gateway.executeScript(ctx(['read', 'write'], 'backend'), { script: '1' })).rejects.toMatchObject({ status: 403 })
		expect(await gateway.executeScript(ctx(['script']), { script: 'orm.execute("Products")' })).toBe(7)
		expect(audit.entries[0]).toMatchObject({ operation: 'executeScript', query: 'orm.execute("Products")', result: 'ok' })
	})

	test('disabled: 403; too long: 413; empty: 400; undefined result: null', async () => {
		expect(await fakeGateway({ scripts: { enabled: false } }).gateway.executeScript(ctx(ALL), { script: '1' }).catch(e => e))
			.toMatchObject({ status: 403, name: 'ScriptDisabledError' })
		const { gateway, orm } = fakeGateway({ scripts: { maxLength: 10, timeoutMs: 1234, maxIterations: 500 } })
		expect(await gateway.executeScript(ctx(ALL), { script: 'a = 1; a', data: { x: 1 }, options: { stage: 'default' } })).toBe(7)
		expect(orm.scripts[0]).toEqual({ script: 'a = 1; a', data: { x: 1 }, options: { stage: 'default', timeout: 1234, maxIterations: 500 } })
		await expect(gateway.executeScript(ctx(ALL), { script: 'x'.repeat(11) })).rejects.toMatchObject({ status: 413 })
		await expect(gateway.executeScript(ctx(ALL), { script: ' ' })).rejects.toMatchObject({ status: 400 })
		orm.scriptResult = undefined
		expect(await gateway.executeScript(ctx(ALL), { script: 'x' })).toBeNull()
	})

	test('a client may lower the limits, never raise them', async () => {
		const { gateway, orm } = fakeGateway({ scripts: { maxLength: 100, timeoutMs: 1000, maxIterations: 500 } })
		await gateway.executeScript(ctx(ALL), { script: 'x', options: { stage: 'default', timeout: 200, maxIterations: 9999999 } as any })
		expect(orm.scripts[0].options).toEqual({ stage: 'default', timeout: 200, maxIterations: 500 })
		await gateway.executeScript(ctx(ALL), { script: 'x', options: { timeout: 60000, maxIterations: 10 } as any })
		expect(orm.scripts[1].options).toEqual({ timeout: 1000, maxIterations: 10 })
	})
})

describe('executeQueued', () => {
	test('needs queue, and write when the query writes; audited', async () => {
		const { gateway, queue, audit } = fakeGateway()
		await expect(gateway.executeQueued(ctx(['read']), { topic: 't', query: 'Products' })).rejects.toMatchObject({ status: 403 })
		await expect(gateway.executeQueued(ctx(['queue']), { topic: 't', query: 'Products.insert()' })).rejects.toMatchObject({ status: 403 })
		expect(await gateway.executeQueued(ctx(['queue']), { topic: 't', query: 'Products', chunk: 10 })).toEqual({ queueId: 'queue-1' })
		expect(queue.calls[0]).toMatchObject({ topic: 't', query: 'Products', chunk: 10 })
		expect(audit.entries[0]).toMatchObject({ operation: 'executeQueued', actions: ['select'] })
	})

	test('without a queue: 503; without topic: 400', async () => {
		await expect(fakeGateway({ queue: null }).gateway.executeQueued(ctx(ALL), { topic: 't', query: 'Products' }))
			.rejects.toMatchObject({ status: 503, name: 'QueueUnavailableError' })
		const unavailable = new FakeQueue()
		unavailable.available = false
		await expect(fakeGateway({ queue: unavailable }).gateway.executeQueued(ctx(ALL), { topic: 't', query: 'Products' }))
			.rejects.toMatchObject({ status: 503 })
		await expect(fakeGateway().gateway.executeQueued(ctx(ALL), { topic: '', query: 'Products' })).rejects.toMatchObject({ status: 400 })
	})
})

describe('schema and stages', () => {
	test('schema needs read; an unknown name is a NotFoundError (404)', async () => {
		const { gateway } = fakeGateway()
		await expect(gateway.domain(ctx(['write']))).rejects.toMatchObject({ status: 403 })
		expect(await gateway.entity(ctx(['read']), 'Products')).toEqual({ name: 'Products' })
		await expect(gateway.entity(ctx(['read']), 'Nope')).rejects.toMatchObject({ name: 'NotFoundError', status: 404, message: 'entity Nope not found' })
		expect(await gateway.schema(ctx(['read']))).toEqual({ version: '1.0.0', domain: { entities: [{ name: 'Products' }], enums: [] }, infrastructure: undefined, application: undefined })
	})

	test('export needs read; import needs stageImport and is audited', async () => {
		const { gateway, orm, audit } = fakeGateway()
		expect(await gateway.stageExists(ctx(['read']), 'default')).toEqual({ exists: true })
		await expect(gateway.stageImport(ctx(['read', 'write']), 'default', {})).rejects.toMatchObject({ status: 403 })
		await gateway.stageImport(ctx(['stageImport']), 'default', { entities: [] })
		expect(orm.imported).toEqual([{ stage: 'default', data: { entities: [] } }])
		expect(audit.entries[0]).toMatchObject({ operation: 'stageImport', stage: 'default', result: 'ok' })
	})

	test('version, ping and health need no credential', async () => {
		const { gateway } = fakeGateway()
		expect(await gateway.version()).toEqual({ version: '9.9.9' })
		expect((await gateway.ping()).message).toBe('pong')
		expect(await gateway.health()).toMatchObject({ message: 'OK', uptime: 42 })
	})
})
