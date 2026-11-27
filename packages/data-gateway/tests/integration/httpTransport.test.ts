import fs from 'fs'
import os from 'os'
import path from 'path'
// The REST transport over a real socket, with the real facade and use cases on fake λORM ports.
import { HttpTransport, ObservabilityInfo, TransportInfo } from '../../src/lib/infrastructure/input/http/httpTransport'
import { ApiKeyAuthenticator, BearerAuthenticator } from '../../src/lib/infrastructure/output/auth/authenticators'
import { NoMetrics, PromClientMetrics } from '../../src/lib/infrastructure/output/metrics/promClientMetrics'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { fakeGateway, FixedClock, GatewayFixture } from '../helpers/fakes'
import { InlineSchemaDirectory } from '../../src/lib/application/runtime/inlineSchemaDirectory'
import { call } from '../helpers/net'
import { AuthenticatorPort } from '../../src/lib/application/ports/output/supportPorts'

const credentials = [
	{ name: 'agent', value: 'agent-token', permissions: ['read' as const] },
	{ name: 'backend', value: 'backend-token', permissions: ['read' as const, 'write' as const, 'script' as const, 'queue' as const, 'stageImport' as const] }
]
const agent = { Authorization: 'Bearer agent-token' }
const backend = { Authorization: 'Bearer backend-token' }

const start = async (fixture: GatewayFixture, options: Partial<{ basePath: string, rateLimit: { windowMs: number, max: number }, metrics: boolean, requestBodySize: string, authenticator: AuthenticatorPort, transports: TransportInfo[], observability: ObservabilityInfo }> = {}) => {
	const transport = new HttpTransport({
		port: 0,
		host: '127.0.0.1',
		basePath: options.basePath ?? '',
		requestBodySize: options.requestBodySize ?? '1mb',
		rateLimit: options.rateLimit ?? { windowMs: 1000, max: 0 },
		swaggerEnabled: true,
		transports: options.transports,
		observability: options.observability
	}, {
		directory: new InlineSchemaDirectory([{
			path: '', gateway: fixture.gateway, mcp: undefined as any, transports: ['http'], authenticators: { http: options.authenticator ?? new BearerAuthenticator(credentials) }
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

	test('the view and the context are the gateway\'s: the ones of the client never reach λORM', async () => {
		const options = { stage: 'default', view: 'admin', context: { tenant: 'other' } }
		await call(base, '/execute', { body: { query: 'Products', options }, headers: agent })
		await call(base, '/plan', { body: { query: 'Products', options }, headers: agent })
		await call(base, '/script', { body: { script: 'x', options }, headers: backend })
		await call(base, '/execute-queued', { body: { topic: 't', query: 'Products', options }, headers: backend })
		for (const sent of [fixture.orm.executed.at(-1), fixture.orm.planned.at(-1), fixture.orm.scripts.at(-1), fixture.queue.calls.at(-1)]) {
			expect(sent!.options).toMatchObject({ stage: 'default' })
			expect(sent!.options).not.toHaveProperty('view')
			expect(sent!.options).not.toHaveProperty('context')
		}
	})

	test('schema and stage endpoints; an unknown name answers 404', async () => {
		for (const path of ['/schema', '/schema/version', '/domain', '/sources', '/sources/main', '/entities', '/entities/Products', '/enums', '/mappings', '/mappings/default', '/stages', '/stages/default', '/views', '/stages/default/exists', '/stages/default/export']) {
			const res = await call(base, path, { headers: agent })
			expect([path, res.status]).toEqual([path, 200])
		}
		for (const path of ['/entities/Nope', '/enums/Nope', '/sources/Nope', '/mappings/Nope', '/mappings/default/Nope', '/stages/Nope']) {
			const res = await call(base, path, { headers: agent })
			expect([path, res.status, res.body?.error]).toEqual([path, 404, 'NotFoundError'])
		}
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
	test('4.0.0: no UI and no CORS (a browser of another origin reaches it through a backend)', async () => {
		const { transport, base } = await start(fakeGateway())
		try {
			expect((await fetch(`${base}/ui/`)).status).toBe(401)
			const res = await fetch(`${base}/ping`, { headers: { Origin: 'http://ide.example' } })
			expect(res.status).toBe(200)
			expect(res.headers.get('access-control-allow-origin')).toBeNull()
			const preflight = await fetch(`${base}/execute`, { method: 'OPTIONS', headers: { Origin: 'http://ide.example', 'Access-Control-Request-Method': 'POST' } })
			expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
		} finally {
			await transport.stop()
		}
	})

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

	test('where its traces are seen (observability.explore), without a credential', async () => {
		const explore = { grafana: 'https://grafana.example.com', tempo: 'tempo', orgId: 1 }
		const { transport, base } = await start(fakeGateway(), { observability: { explore } })
		try {
			expect(await (await fetch(`${base}/observability`)).json()).toEqual({ explore })
		} finally {
			await transport.stop()
		}
	})

	test('its transports and its OpenAPI document, without a credential (an IDE finds there its WebSocket and MCP)', async () => {
		const transports: TransportInfo[] = [
			{ name: 'http', port: 9291, basePath: '/data-gateway', docs: '/openapi.json' },
			{ name: 'webSocket', port: 9293, basePath: '', schemaPath: '/{schema}', docs: '/asyncapi.json' }
		]
		const { transport, base } = await start(fakeGateway(), { transports })
		try {
			expect(await (await fetch(`${base}/transports`)).json()).toEqual(transports)
			const document = await (await fetch(`${base}/openapi.json`)).json()
			expect(document.openapi).toMatch(/^3\./)
			expect(document.info.version).toBe('9.9.9')
			expect(Object.keys(document.paths).length).toBeGreaterThan(5)
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

	test('Authorize offers the credential of the configuration: the bearer token, or the API key in its header', async () => {
		const spec = async (base: string) => fetch(`${base}/doc/swagger-ui-init.js`).then(r => r.text())
		const bearer = await start(fakeGateway())
		const apikey = await start(fakeGateway(), { authenticator: new ApiKeyAuthenticator(credentials, 'x-api-key') })
		try {
			const withBearer = await spec(bearer.base)
			expect(withBearer).toMatch(/"bearerAuth"/)
			expect(withBearer).not.toMatch(/"apiKeyAuth"/)
			const withKey = await spec(apikey.base)
			expect(withKey).toMatch(/"apiKeyAuth": \{\s*"type": "apiKey",\s*"in": "header",\s*"name": "x-api-key"/)
			expect(withKey).not.toMatch(/"bearerAuth"/)
			// the key works on a real call
			expect((await call(apikey.base, '/whoami', { headers: { 'x-api-key': 'agent-token' } })).status).toBe(200)
		} finally {
			await bearer.transport.stop()
			await apikey.transport.stop()
		}
	})
})

describe('http transport with JWT (docs/JWT.md)', () => {
	const SECRET = 'a-secret-of-at-least-32-bytes-long!'
	const ISSUER = 'https://auth.example.com'
	let fixture: GatewayFixture
	let transport: HttpTransport
	let base: string
	const token = async (claims: Record<string, unknown>, exp: string | number = '5m') => {
		const { SignJWT } = await import('jose')
		return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setAudience('data-gateway').setExpirationTime(exp).sign(new TextEncoder().encode(SECRET))
	}

	beforeAll(async () => {
		const { JwtAuthenticator } = await import('../../src/lib/infrastructure/output/auth/jwtAuthenticator')
		const { MethodsAuthenticator } = await import('../../src/lib/infrastructure/output/auth/authenticators')
		fixture = fakeGateway()
		const jwt = new JwtAuthenticator({
			issuer: ISSUER, audience: ['data-gateway'], secret: SECRET, algorithms: ['HS256'], clockToleranceSec: 0,
			principal: { name: 'sub', permissions: { claim: 'roles', roles: { reader: { permissions: ['read'] } } } },
			context: { tenant: 'tenant_id' }
		})
		;({ transport, base } = await start(fixture, { authenticator: new MethodsAuthenticator([jwt, new ApiKeyAuthenticator([{ name: 'svc', value: 'svc-key', permissions: ['read'] }, { name: 'ana', value: 'ana-key', permissions: ['read'], context: { username: 'ana@acme' } }])]) }))
	})
	afterAll(() => transport.stop())

	test('a valid token: its roles and its context reach λORM; the context sent by the client never', async () => {
		const res = await call(base, '/execute', { body: { query: 'Products', options: { context: { tenant: 'other' } } }, headers: { Authorization: `Bearer ${await token({ sub: 'ann', roles: ['reader'], tenant_id: 't1' })}` } })
		expect(res.status).toBe(200)
		expect(fixture.orm.executed.at(-1)!.options).toMatchObject({ context: { tenant: 't1' }, actor: { credential: 'ann' } })
		// a write: its roles don't allow it
		expect((await call(base, '/execute', { body: { query: 'Products.insert()', data: {} }, headers: { Authorization: `Bearer ${await token({ sub: 'ann', roles: ['reader'] })}` } })).status).toBe(403)
	})

	test('an expired token: 401 with why and WWW-Authenticate; a service with its API key, next to it', async () => {
		const expired = await call(base, '/execute', { body: { query: 'Products' }, headers: { Authorization: `Bearer ${await token({ sub: 'ann' }, Math.floor(Date.now() / 1000) - 60)}` } })
		expect(expired).toMatchObject({ status: 401, body: { message: 'the token is not valid: expired' } })
		expect(expired.headers.get('www-authenticate')).toBe('Bearer error="invalid_token", error_description="expired"')
		const service = await call(base, '/execute', { body: { query: 'Products' }, headers: { 'X-Api-Key': 'svc-key' } })
		expect(service.status).toBe(200)
		expect(fixture.orm.executed.at(-1)!.options).not.toHaveProperty('context')
		expect((await call(base, '/execute', { body: { query: 'Products' } })).headers.get('www-authenticate')).toBe('Bearer')
	})

	test('a key of a user: its context reaches λORM as the one of a token; the one sent by the client never', async () => {
		const res = await call(base, '/execute', { body: { query: 'Products', options: { context: { username: 'other' } } }, headers: { 'X-Api-Key': 'ana-key' } })
		expect(res.status).toBe(200)
		expect(fixture.orm.executed.at(-1)!.options).toMatchObject({ context: { username: 'ana@acme' }, actor: { credential: 'ana' } })
	})
})

describe('http transport: ETag of a result (docs/RESULT_CACHE.md §5)', () => {
	let fixture: GatewayFixture
	let transport: HttpTransport
	let base: string
	beforeAll(async () => {
		fixture = fakeGateway()
		;({ transport, base } = await start(fixture))
	})
	afterAll(() => transport.stop())

	test('execute answers its ETag; the same If-None-Match is 304 without body; another result, another ETag', async () => {
		const first = await call(base, '/execute', { body: { query: 'Products' }, headers: agent })
		const etag = first.headers.get('etag')!
		expect(etag).toMatch(/^W\/".+"$/)
		expect(first.headers.get('cache-control')).toBe('private, no-cache')
		const again = await call(base, '/execute', { body: { query: 'Products' }, headers: { ...agent, 'If-None-Match': etag } })
		expect(again.status).toBe(304)
		expect(again.body).toBeUndefined()
		fixture.orm.executeResult = [{ id: 2 }]
		const changed = await call(base, '/execute', { body: { query: 'Products' }, headers: { ...agent, 'If-None-Match': etag } })
		expect(changed.status).toBe(200)
		expect(changed.headers.get('etag')).not.toBe(etag)
	})
})
