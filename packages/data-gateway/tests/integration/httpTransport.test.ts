// The REST transport over a real socket, with the real facade and use cases on fake λORM ports.
import { HttpTransport } from '../../src/lib/infrastructure/input/http/httpTransport'
import { BearerAuthenticator } from '../../src/lib/infrastructure/output/auth/authenticators'
import { NoMetrics, PromClientMetrics } from '../../src/lib/infrastructure/output/metrics/promClientMetrics'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { fakeGateway, FixedClock, GatewayFixture } from '../helpers/fakes'
import { InlineSchemaDirectory } from '../../src/lib/application/runtime/inlineSchemaDirectory'
import { call } from '../helpers/net'

const credentials = [
	{ name: 'agent', value: 'agent-token', permissions: ['read' as const] },
	{ name: 'backend', value: 'backend-token', permissions: ['read' as const, 'write' as const, 'script' as const, 'queue' as const, 'stageImport' as const] }
]
const agent = { Authorization: 'Bearer agent-token' }
const backend = { Authorization: 'Bearer backend-token' }

const start = async (fixture: GatewayFixture, options: Partial<{ basePath: string, rateLimit: { windowMs: number, max: number }, metrics: boolean, requestBodySize: string }> = {}) => {
	const transport = new HttpTransport({
		port: 0,
		host: '127.0.0.1',
		basePath: options.basePath ?? '',
		requestBodySize: options.requestBodySize ?? '1mb',
		rateLimit: options.rateLimit ?? { windowMs: 1000, max: 0 },
		swaggerEnabled: true
	}, {
		directory: new InlineSchemaDirectory([{
			path: '', gateway: fixture.gateway, mcp: undefined as any, transports: ['http'], authenticators: { http: new BearerAuthenticator(credentials) }
		}], new FixedClock(), '9.9.9'),
		metrics: options.metrics ? new PromClientMetrics() : new NoMetrics(),
		logger: new ConsoleLogger('error')
	})
	await transport.start()
	return { transport, base: `http://127.0.0.1:${transport.address!.port}${options.basePath ?? ''}` }
}

describe('http transport', () => {
	let fixture: GatewayFixture
	let transport: HttpTransport
	let base: string

	beforeAll(async () => {
		fixture = fakeGateway()
		;({ transport, base } = await start(fixture, { metrics: true }))
	})
	afterAll(() => transport.stop())

	test('health routes need no credential; everything else does (401)', async () => {
		expect((await call(base, '/ping')).status).toBe(200)
		expect((await call(base, '/health')).body).toMatchObject({ message: 'OK' })
		const metrics = await call(base, '/metrics')
		expect(metrics.status).toBe(200)
		expect(metrics.headers.get('content-type')).toMatch(/text\/plain/)
		expect(String(metrics.body)).toMatch(/http_request_duration_seconds/)
		for (const headers of [{}, { Authorization: 'Bearer wrong' }] as Record<string, string>[]) {
			const res = await call(base, '/domain', { headers })
			expect(res.status).toBe(401)
			expect(res.body).toEqual({ error: 'Unauthorized', message: 'a valid token is required (Authorization: Bearer <token>)' })
		}
		expect((await call(base, '/version', { headers: agent })).body).toEqual({ version: '9.9.9' })
	})

	test('a read credential can query but not write (403), and nothing is executed', async () => {
		const ok = await call(base, '/execute', { body: { query: 'Products.filter(p => p.id == id)', data: { id: 1 } }, headers: agent })
		expect(ok).toMatchObject({ status: 200, body: [{ id: 1 }] })
		const executed = fixture.orm.executed.length
		const denied = await call(base, '/execute', { body: { query: 'Products.insert()', data: { id: 1 } }, headers: agent })
		expect(denied.status).toBe(403)
		expect(denied.body).toEqual({ error: 'ForbiddenError', message: 'the credential "agent" does not have the "write" permission' })
		expect((await call(base, '/script', { body: { script: '1' }, headers: agent })).status).toBe(403)
		expect((await call(base, '/stages/default/import', { body: { entities: [] }, headers: agent })).status).toBe(403)
		expect(fixture.orm.executed.length).toBe(executed)
	})

	test('a full credential writes, and the write is audited with its credential and transport', async () => {
		const res = await call(base, '/execute', { body: { query: 'Products.insert()', data: { id: 2 } }, headers: backend })
		expect(res.status).toBe(200)
		expect(fixture.audit.entries.at(-1)).toMatchObject({ credential: 'backend', transport: 'http', operation: 'execute', actions: ['insert'] })
	})

	test('every query endpoint', async () => {
		for (const path of ['/plan', '/metadata', '/model', '/parameters', '/constraints']) {
			expect((await call(base, path, { body: { query: 'Products' }, headers: agent })).status).toBe(200)
		}
		expect((await call(base, '/metadata', { body: { query: 'Products.insert()' }, headers: agent })).body).toMatchObject({ classtype: 'Sentence', name: 'insert' })
		expect((await call(base, '/script', { body: { script: 'x' }, headers: backend })).body).toBe(7)
		expect((await call(base, '/execute-queued', { body: { topic: 't', query: 'Products' }, headers: backend })).body).toBe('queue-1')
		expect((await call(base, '/plan', { body: {}, headers: agent })).status).toBe(400)
	})

	test('schema and stage endpoints; an unknown name answers 204', async () => {
		for (const path of ['/schema', '/schema/version', '/domain', '/sources', '/sources/main', '/entities', '/entities/Products', '/enums', '/mappings', '/mappings/default', '/stages', '/stages/default', '/views', '/stages/default/exists', '/stages/default/export']) {
			const res = await call(base, path, { headers: agent })
			expect([path, res.status]).toEqual([path, 200])
		}
		expect((await call(base, '/entities/Nope', { headers: agent })).status).toBe(204)
		expect((await call(base, '/stages/default/import', { body: { entities: [] }, headers: backend })).status).toBe(204)
	})

	test('?format=beautiful indents the JSON', async () => {
		const res = await fetch(`${base}/version?format=beautiful`, { headers: agent })
		expect(await res.text()).toBe('{\n  "version": "9.9.9"\n}')
	})

	test('a body larger than requestBodySize answers 413', async () => {
		const small = await start(fakeGateway(), { requestBodySize: '1kb' })
		try {
			const res = await call(small.base, '/execute', { body: { query: 'Products', data: { text: 'x'.repeat(5000) } }, headers: backend })
			expect(res.status).toBe(413)
		} finally {
			await small.transport.stop()
		}
	})
})

describe('http transport options', () => {
	test('basePath prefixes every route; rate limit (every request counts) answers 429', async () => {
		const { transport, base } = await start(fakeGateway(), { basePath: '/api', rateLimit: { windowMs: 60000, max: 3 } })
		try {
			expect((await call(base, '/ping')).status).toBe(200)
			expect((await call(base.replace('/api', ''), '/ping')).status).toBe(404)
			expect((await call(base, '/ping')).status).toBe(200)
			expect((await call(base, '/ping')).status).toBe(429)
		} finally {
			await transport.stop()
		}
	})

	test('swagger is served at /doc without a credential; / redirects to it', async () => {
		const { transport, base } = await start(fakeGateway())
		try {
			const res = await fetch(`${base}/doc/`)
			expect(res.status).toBe(200)
			expect(await res.text()).toMatch(/swagger/i)
			const root = await fetch(`${base}/`, { redirect: 'manual' })
			expect(root.status).toBe(302)
			expect(root.headers.get('location')).toBe('/doc/')
		} finally {
			await transport.stop()
		}
	})
})
