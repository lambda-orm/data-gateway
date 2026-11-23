// The WebSocket of events of management (docs/DATA_GATEWAY_SESSIONS_PLAN.md §4, phase 2), with two gateways on the
// same volume (two replicas): the upgrade takes a session (header or subprotocol), never a credential; a session with
// its socket open is connected for both; what the IDE looks at is listed; a revocation in one replica closes the
// socket in the other; a logout closes it at once.
import fs from 'fs'
import os from 'os'
import path from 'path'
import WebSocket from 'ws'
import { startGateway } from '../../src/lib/infrastructure/build/main'
import { RunningGateway } from '../../src/lib/infrastructure/build/dataGatewayBuilder'
import { YamlFileConfigSource } from '../../src/lib/infrastructure/output/config/yamlFileConfigSource'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { sessionProtocolsFor } from '../../src/lib/domain/auth/protocolCredential'
import { call, freePort, login } from '../helpers/net'

const NORTHWIND = fs.readFileSync(path.join(__dirname, '../fixtures/northwind/lambdaORM.yaml'), 'utf8')
const ADMIN_KEY = { 'X-Api-Key': 'admin-key' }
const READER_KEY = { 'X-Api-Key': 'reader-key' }

const configOf = (root: string, port: number) => `
orm: { workspacePath: ${root} }
logger: { level: error }
audit: { enabled: false }
runtime: { checkConnections: false }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: admin, value: admin-key, permissions: [ read, schemaRead, sessionAdmin ] }
    - { name: reader, value: reader-key, permissions: [ read ] }
transports:
  management: { port: ${port}, host: 127.0.0.1 }
`

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const until = async <T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10000): Promise<T> => {
	const end = Date.now() + timeoutMs
	let value = await read()
	while (!done(value)) {
		if (Date.now() > end) throw new Error(`timed out; last value: ${JSON.stringify(value)}`)
		await sleep(100)
		value = await read()
	}
	return value
}

/** A socket to the events, with what it received and how it closed */
const events = (url: string, options: { protocols?: string[], headers?: Record<string, string> }) => new Promise<{
	ws: WebSocket, messages: any[], closed: Promise<{ code: number, reason: string }>
}>((resolve, reject) => {
	const ws = new WebSocket(url, options.protocols ?? [], { headers: options.headers })
	const messages: any[] = []
	ws.on('message', data => messages.push(JSON.parse(String(data))))
	const closed = new Promise<{ code: number, reason: string }>(done => ws.on('close', (code, reason) => done({ code, reason: String(reason) })))
	ws.once('open', () => resolve({ ws, messages, closed }))
	ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error(`handshake ${res.statusCode}`), { status: res.statusCode })))
	ws.once('error', reject)
})

describe('the WebSocket of events of management, on two replicas', () => {
	let one: RunningGateway
	let two: RunningGateway
	let a: string
	let b: string

	beforeAll(async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-events-'))
		fs.mkdirSync(path.join(root, 'shop'))
		fs.writeFileSync(path.join(root, 'shop/lambdaORM.yaml'), NORTHWIND)
		const start = async () => {
			const port = await freePort()
			const file = path.join(root, `gateway-${port}.yaml`)
			fs.writeFileSync(file, configOf(root, port))
			return { gateway: await startGateway({ source: new YamlFileConfigSource(file, {}), bootLogger: new ConsoleLogger('error') }), base: `http://127.0.0.1:${port}` }
		}
		const first = await start()
		const second = await start()
		one = first.gateway
		two = second.gateway
		a = first.base
		b = second.base
	}, 60000)
	afterAll(async () => { await one?.stop(); await two?.stop() })

	test('the upgrade takes a session, never a credential', async () => {
		await expect(events(`${a.replace('http', 'ws')}/events`, {})).rejects.toMatchObject({ status: 401 })
		await expect(events(`${a.replace('http', 'ws')}/events`, { headers: ADMIN_KEY })).rejects.toMatchObject({ status: 401 })
		await expect(events(`${a.replace('http', 'ws')}/nothing`, { headers: await login(a, ADMIN_KEY) })).rejects.toMatchObject({ status: 404 })
		// a browser: the token in the subprotocols; lambdaorm is answered
		const session = await login(a, READER_KEY)
		const socket = await events(`${a.replace('http', 'ws')}/events`, { protocols: sessionProtocolsFor(session['X-Data-Gateway-Session']) })
		expect(socket.ws.protocol).toBe('lambdaorm')
		socket.ws.close()
	})

	test('connected for both replicas, with what it looks at; revoked in the other one, its socket closes', async () => {
		const reader = await login(a, READER_KEY)
		const id = (await call(a, '/sessions/current', { headers: reader })).body.id
		const socket = await events(`${a.replace('http', 'ws')}/events`, { headers: reader })
		socket.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'session.activity', params: { schema: 'shop', tab: 'query:1' } }))
		// replica two sees it connected, and what it looks at
		const admin = await login(b, ADMIN_KEY)
		const listedOn = async () => ((await call(b, '/sessions?all=true', { headers: admin })).body as any[]).find(s => s.id === id)
		expect(await until(listedOn, s => s?.connected === true && s?.activity?.tab === 'query:1'))
			.toMatchObject({ credential: 'reader', connected: true, activity: { schema: 'shop', tab: 'query:1' } })
		// revoked in replica two: replica one closes its socket (its next check), saying why
		expect((await call(b, `/sessions/${id}`, { method: 'DELETE', headers: admin })).status).toBe(204)
		const closed = await Promise.race([socket.closed, sleep(9000).then(() => undefined)])
		expect(closed).toEqual({ code: 4401, reason: 'SessionRevokedError' })
		expect(socket.messages).toContainEqual({ jsonrpc: '2.0', method: 'session.revoked', params: expect.objectContaining({ error: 'SessionRevokedError', message: expect.stringMatching(/by "admin"/) }) })
		// and no longer connected
		expect(await until(async () => (await call(b, '/sessions?all=true', { headers: admin })).body.find((s: any) => s.id === id), s => s === undefined)).toBeUndefined()
	}, 20000)

	test('a logout closes its socket at once', async () => {
		const reader = await login(a, READER_KEY)
		const socket = await events(`${a.replace('http', 'ws')}/events`, { headers: reader })
		const started = Date.now()
		expect((await call(a, '/sessions/current', { method: 'DELETE', headers: reader })).status).toBe(204)
		expect(await socket.closed).toEqual({ code: 4401, reason: 'SessionRevokedError' })
		expect(Date.now() - started).toBeLessThan(1000)
	})
})
