// The WebSocket API (JSON-RPC) over a real socket: methods, errors, notifications of queued executions and of state.
import WebSocket from 'ws'
import { InlineSchemaDirectory } from '../../src/lib/application/runtime/inlineSchemaDirectory'
import { SchemaRouter } from '../../src/lib/application/runtime/schemaRouter'
import { WebSocketTransport } from '../../src/lib/infrastructure/input/websocket/webSocketTransport'
import { BearerAuthenticator } from '../../src/lib/infrastructure/output/auth/authenticators'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { fakeGateway, FixedClock, GatewayFixture } from '../helpers/fakes'
import { call } from '../helpers/net'
import { protocolsFor } from '../../src/lib/domain/auth/protocolCredential'

const credentials = [
	{ name: 'agent', value: 'agent-token', permissions: ['read' as const] },
	{ name: 'backend', value: 'backend-token', permissions: ['read' as const, 'write' as const, 'script' as const, 'queue' as const, 'stageImport' as const] }
]
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
const logger = new ConsoleLogger('error')

interface Connection {
	socket: WebSocket
	request: (method: string, params?: unknown) => Promise<any>
	notifications: any[]
	next: (method: string) => Promise<any>
}

const open = (url: string, headers: Record<string, string>): Promise<Connection> => new Promise((resolve, reject) => {
	const socket = new WebSocket(url, { headers })
	let id = 0
	const pending = new Map<number, (message: any) => void>()
	const notifications: any[] = []
	const waiting: { method: string, resolve: (n: any) => void }[] = []
	socket.on('message', data => {
		const message = JSON.parse(data.toString())
		if (message.id !== undefined && message.id !== null) return pending.get(message.id)?.(message)
		if (!message.method) return pending.get(-1)?.(message)
		notifications.push(message)
		const i = waiting.findIndex(w => w.method === message.method)
		if (i >= 0) waiting.splice(i, 1)[0].resolve(message)
	})
	socket.once('unexpected-response', (_req, res) => reject(new Error(`handshake ${res.statusCode}`)))
	socket.once('error', reject)
	socket.once('open', () => resolve({
		socket,
		notifications,
		request: (method, params) => new Promise(resolve => {
			pending.set(++id, resolve)
			socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
		}),
		next: method => new Promise(resolve => {
			const already = notifications.find(n => n.method === method)
			if (already) return resolve(already)
			waiting.push({ method, resolve })
		})
	}))
})

describe('webSocket transport (schema at a route)', () => {
	let fixture: GatewayFixture
	let transport: WebSocketTransport
	let url: string
	let router: SchemaRouter | undefined

	beforeAll(async () => {
		fixture = fakeGateway()
		const directory = new InlineSchemaDirectory([{
			path: 'iot/v1', gateway: fixture.gateway, mcp: undefined as any, transports: ['webSocket'],
			authenticators: { webSocket: new BearerAuthenticator(credentials) }, queueOutcomes: fixture.queueOutcomes
		}], new FixedClock(), '9.9.9')
		transport = new WebSocketTransport({ port: 0, host: '127.0.0.1', basePath: '', maxConnections: 3, maxPayload: 1024 * 1024, asyncapiEnabled: true },
			{ directory, logger, rootAuthenticator: new BearerAuthenticator(credentials) })
		await transport.start()
		url = `ws://127.0.0.1:${transport.address!.port}`
	})
	afterAll(async () => { router?.closeAll(); await transport.stop() })

	test('methods of the schema with the params of REST; null for no value', async () => {
		const c = await open(`${url}/iot/v1`, bearer('agent-token'))
		try {
			expect(await c.request('query.execute', { query: 'Products.filter(p => p.id == id)', data: { id: 1 } })).toEqual({ jsonrpc: '2.0', id: 1, result: [{ id: 1 }] })
			expect((await c.request('query.plan', { query: 'Products' })).result).toMatchObject({ dialect: 'PostgreSQL' })
			expect((await c.request('schema.entity', { entity: 'Products' })).result).toEqual({ name: 'Products' })
			expect((await c.request('schema.entity', { entity: 'Nope' })).error).toEqual({ code: -32000, message: 'entity Nope not found', data: { name: 'NotFoundError', status: 404 } })
			expect((await c.request('general.version')).result).toEqual({ version: '9.9.9' })
			expect((await c.request('stage.exists', { stage: 'default' })).result).toEqual({ exists: true })
		} finally {
			c.socket.close()
		}
	})

	test('a browser: the credential in the subprotocols (it can\'t send headers); lambdaorm answered; none, refused', async () => {
		const socket = new WebSocket(`${url}/iot/v1`, protocolsFor({ Authorization: 'Bearer agent-token' }))
		const opened = await new Promise<string>((resolve, reject) => {
			socket.once('open', () => resolve(socket.protocol))
			socket.once('unexpected-response', (_req, res) => reject(new Error(`handshake ${res.statusCode}`)))
			socket.once('error', reject)
		})
		expect(opened).toBe('lambdaorm')
		const reply = await new Promise<any>(resolve => {
			socket.once('message', data => resolve(JSON.parse(data.toString())))
			socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'general.version' }))
		})
		socket.close()
		expect(reply.result).toEqual({ version: '9.9.9' })
		// a wrong credential in the subprotocols: 401, as in a header
		const refused = new WebSocket(`${url}/iot/v1`, protocolsFor({ Authorization: 'Bearer nope' }))
		const status = await new Promise<number>(resolve => refused.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0)))
		expect(status).toBe(401)
	})

	test('errors: forbidden write (-32000 with name and status), unknown method, invalid params, parse, invalid request', async () => {
		const c = await open(`${url}/iot/v1`, bearer('agent-token'))
		try {
			expect((await c.request('query.execute', { query: 'Products.insert()' })).error).toEqual({
				code: -32000, message: 'the credential "agent" does not have the "write" permission', data: { name: 'ForbiddenError', status: 403 }
			})
			expect((await c.request('query.nope')).error).toMatchObject({ code: -32601 })
			expect((await c.request('schema.entity', {})).error).toEqual({ code: -32602, message: 'params.entity is required (a string)' })
			expect((await c.request('schema.entities', [1])).error).toMatchObject({ code: -32602 })
			const parse = new Promise<any>(resolve => c.socket.once('message', d => resolve(JSON.parse(d.toString()))))
			c.socket.send('{nope')
			expect((await parse).error.code).toBe(-32700)
			const invalid = new Promise<any>(resolve => c.socket.once('message', d => resolve(JSON.parse(d.toString()))))
			c.socket.send(JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'general.ping' }]))
			expect((await invalid).error.code).toBe(-32600)
		} finally {
			c.socket.close()
		}
	})

	test('executeQueued with notify: queue.completed / queue.failed to that connection only', async () => {
		const backend = await open(`${url}/iot/v1`, bearer('backend-token'))
		const other = await open(`${url}/iot/v1`, bearer('backend-token'))
		try {
			const first = await backend.request('query.executeQueued', { topic: 't', query: 'Products', notify: true })
			const second = await backend.request('query.executeQueued', { topic: 't', query: 'Products', notify: true })
			const silent = await backend.request('query.executeQueued', { topic: 't', query: 'Products' })
			const n = (queueId: string) => Number(queueId.split('-')[1])
			fixture.queue.finish(n(first.result.queueId))
			fixture.queue.finish(n(second.result.queueId), false)
			fixture.queue.finish(n(silent.result.queueId))
			expect((await backend.next('queue.completed')).params).toEqual({ queueId: first.result.queueId, ok: true, rows: 3 })
			expect((await backend.next('queue.failed')).params).toEqual({ queueId: second.result.queueId, ok: false, error: 'topic down' })
			await new Promise(resolve => setTimeout(resolve, 50))
			expect(backend.notifications).toHaveLength(2)
			expect(other.notifications).toHaveLength(0)
		} finally {
			backend.socket.close()
			other.socket.close()
		}
	})

	test('an execution that ends before its id is answered is still notified', async () => {
		const backend = await open(`${url}/iot/v1`, bearer('backend-token'))
		try {
			const original = fixture.queue.execute.bind(fixture.queue)
			fixture.queue.execute = args => { const id = original(args); fixture.queue.finish(fixture.queue.calls.length); return id }
			const queued = await backend.request('query.executeQueued', { topic: 't', query: 'Products', notify: true })
			expect((await backend.next('queue.completed')).params.queueId).toBe(queued.result.queueId)
			fixture.queue.execute = original
		} finally {
			backend.socket.close()
		}
	})

	test('handshake: 401, 404 elsewhere, 503 over maxConnections; root: general and gateway.schemas only', async () => {
		await expect(open(`${url}/iot/v1`, {})).rejects.toThrow('handshake 401')
		await expect(open(`${url}/iot/v2`, bearer('agent-token'))).rejects.toThrow('handshake 404')
		const root = await open(url, bearer('agent-token'))
		try {
			expect((await root.request('gateway.schemas')).result).toEqual([expect.objectContaining({ path: 'iot/v1', status: 'ready' })])
			expect((await root.request('general.ping')).result).toMatchObject({ message: 'pong' })
			expect((await root.request('query.execute', { query: 'Products' })).error).toMatchObject({ code: -32601 })
			const a = await open(`${url}/iot/v1`, bearer('agent-token'))
			const b = await open(`${url}/iot/v1`, bearer('agent-token'))
			await expect(open(`${url}/iot/v1`, bearer('agent-token'))).rejects.toThrow('handshake 503')
			a.socket.close()
			b.socket.close()
		} finally {
			root.socket.close()
		}
		const base = url.replace('ws://', 'http://')
		expect((await call(base, '/asyncapi.json')).body).toMatchObject({ asyncapi: '3.0.0', servers: { 'iot/v1': { pathname: '/iot/v1' } } })
		// no CORS (4.0.0): an IDE reads it through its backend
		expect((await fetch(`${base}/asyncapi.json`, { headers: { Origin: 'http://ide.example' } })).headers.get('access-control-allow-origin')).toBeNull()
		expect((await call(base, '/status')).body).toMatchObject({ transport: 'webSocket' })
	})
})

describe('webSocket transport with the edge router', () => {
	test('a schema not ready answers 503 without closing; schema.statusChanged when it changes', async () => {
		const fixture = fakeGateway()
		const router = new SchemaRouter([{ path: 'iot/v1', transports: ['webSocket'], maxConcurrent: 0, timeout: 1000, authenticators: { webSocket: new BearerAuthenticator(credentials) } }], new FixedClock(), '9.9.9')
		const transport = new WebSocketTransport({ port: 0, host: '127.0.0.1', basePath: '/gw', maxConnections: 5, maxPayload: 1024 * 1024, asyncapiEnabled: false },
			{ directory: router, logger, rootAuthenticator: new BearerAuthenticator(credentials) })
		await transport.start()
		try {
			const c = await open(`ws://127.0.0.1:${transport.address!.port}/gw/iot/v1`, bearer('agent-token'))
			expect((await c.request('query.execute', { query: 'Products' })).error).toMatchObject({ code: -32000, data: { name: 'SchemaUnavailableError', status: 503 } })
			let events: ((e: any) => void) | undefined
			router.connect('iot/v1', { request: async (r: any) => (fixture.gateway as any)[r.op](...(r.principal ? [{ principal: { name: r.principal.name, permissions: new Set(r.principal.permissions) }, transport: r.transport }] : []), ...r.args), close: () => undefined, onEvent: l => { events = l } }, { name: 'n', version: '1', instructions: '' })
			router.setState({ path: 'iot/v1', status: 'ready', since: 'now', restarts: 0 })
			expect((await c.next('schema.statusChanged')).params).toEqual({ path: 'iot/v1', status: 'ready' })
			expect((await c.request('query.execute', { query: 'Products' })).result).toEqual([{ id: 1 }])
			expect(events).toBeDefined()
			c.socket.close()
		} finally {
			router.closeAll()
			await transport.stop()
		}
	})
})
