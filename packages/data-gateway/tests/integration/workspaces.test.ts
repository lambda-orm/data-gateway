// Workspaces that appear, change and go while the gateway runs, with real workers (docs/DATA_GATEWAY_ADMIN_PLAN.md
// §2.1, phase 1): a new folder is a new schema, a lambdaORM.yaml that breaks keeps the last version that started, one
// that is fixed replaces it, a folder removed takes its schema; a WebSocket client is told each change.
import fs from 'fs'
import os from 'os'
import path from 'path'
import WebSocket from 'ws'
import { startSupervisor } from '../../src/lib/infrastructure/build/main'
import { Supervisor } from '../../src/lib/application/runtime/supervisor'
import { YamlFileConfigSource } from '../../src/lib/infrastructure/output/config/yamlFileConfigSource'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { call, freePort } from '../helpers/net'

const NORTHWIND = fs.readFileSync(path.join(__dirname, '../fixtures/northwind/lambdaORM.yaml'), 'utf8')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const until = async <T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 20000): Promise<T> => {
	const end = Date.now() + timeoutMs
	let value = await read()
	while (!done(value)) {
		if (Date.now() > end) throw new Error(`timed out; last value: ${JSON.stringify(value)}`)
		await sleep(100)
		value = await read()
	}
	return value
}

describe('workspaces watched while the gateway runs', () => {
	let supervisor: Supervisor
	let root: string
	let base: string
	let socket: WebSocket
	const notifications: any[] = []
	const write = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
		fs.writeFileSync(path.join(root, file), text)
	}
	const states = async () => (await call(base, '/schemas')).body as { path: string, status: string, pending?: string }[]
	const state = async (p: string) => (await states()).find(s => s.path === p)
	const notified = (p: string, kind: string) => until(async () => notifications, n => n.some(x => x.method === 'workspace.changed' && x.params.path === p && x.params.kind === kind))

	beforeAll(async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-watch-'))
		write('iot/v1/lambdaORM.yaml', NORTHWIND)
		const [http, ws] = [await freePort(), await freePort()]
		const file = path.join(os.tmpdir(), `data-gateway-watch-${process.pid}.yaml`)
		fs.writeFileSync(file, `
orm:
  workspacePath: ${root}
  watch: { intervalMs: 500, debounceMs: 100 }
logger: { level: error }
audit: { enabled: false }
rateLimit: { max: 0 }
runtime:
  checkConnections: false
  heartbeat: { intervalMs: 200, timeoutMs: 3000 }
  restart: { initialDelayMs: 200, maxDelayMs: 1000 }
transports:
  http: { port: ${http}, host: 127.0.0.1 }
  webSocket: { port: ${ws}, host: 127.0.0.1 }
`)
		supervisor = await startSupervisor({ source: new YamlFileConfigSource(file, process.env), bootLogger: new ConsoleLogger('error') })
		base = `http://127.0.0.1:${http}`
		await until(() => call(base, '/schemas').then(r => r.body).catch(() => []), (s: any[]) => Array.isArray(s) && s[0]?.status === 'ready')
		// a connection to the root: told the changes of every workspace
		socket = await until(async () => {
			const s = new WebSocket(`ws://127.0.0.1:${ws}/`)
			return await new Promise<WebSocket | undefined>(resolve => { s.once('open', () => resolve(s)); s.once('error', () => resolve(undefined)) })
		}, s => s !== undefined) as WebSocket
		socket.on('message', data => notifications.push(JSON.parse(data.toString())))
	}, 60000)

	afterAll(async () => {
		socket?.close()
		await supervisor?.stop()
	}, 30000)

	test('a new folder with a lambdaORM.yaml is a new schema, served without restarting the gateway', async () => {
		write('iot/v2/lambdaORM.yaml', NORTHWIND)
		await until(() => state('iot/v2'), s => s?.status === 'ready')
		expect((await call(base, '/iot/v2/entities')).body.map((e: any) => e.name)).toContain('Categories')
		expect((await call(base, '/iot/v1/entities')).status).toBe(200)
		await notified('iot/v2', 'added')
	}, 30000)

	test('a lambdaORM.yaml that breaks: the last version that started keeps serving, and says why', async () => {
		write('iot/v1/lambdaORM.yaml', 'domain:\n  entities: [ { name: Broken\n')
		const broken = await until(() => state('iot/v1'), s => s?.pending !== undefined)
		expect(broken).toMatchObject({ status: 'ready', pending: expect.stringMatching(/^the new version did not start: /) })
		expect((await call(base, '/iot/v1/entities')).body.map((e: any) => e.name)).toContain('Categories')
		await notified('iot/v1', 'schema')
	}, 30000)

	test('fixed: the new version replaces it, without a moment out of service', async () => {
		const renamed = NORTHWIND.replace(/name: Categories$/m, 'name: Kinds')
		write('iot/v1/lambdaORM.yaml', renamed)
		const answers: number[] = []
		const polling = (async () => {
			for (let i = 0; i < 60; i++) {
				answers.push((await call(base, '/iot/v1/version')).status)
				await sleep(50)
			}
		})()
		await until(() => call(base, '/iot/v1/entities').then(r => r.body.map((e: any) => e.name)), names => names.includes('Kinds'))
		await polling
		expect((await state('iot/v1'))?.pending).toBeUndefined()
		expect(answers.every(status => status === 200)).toBe(true)
	}, 30000)

	test('other files of a workspace are notified, not reloaded', async () => {
		write('iot/v1/workbench/reports/sales.query.yaml', 'query: Orders.map(p => count(1))\n')
		await until(async () => notifications, n => n.some(x => x.params?.kind === 'files' && x.params.files?.includes('workbench/reports/sales.query.yaml')))
		expect((await state('iot/v1'))?.status).toBe('ready')
	}, 30000)

	test('a folder removed takes its schema: its routes are 404', async () => {
		fs.rmSync(path.join(root, 'iot/v2'), { recursive: true, force: true })
		await until(() => states(), s => !s.some(x => x.path === 'iot/v2'))
		expect((await call(base, '/iot/v2/entities')).status).toBe(404)
		await notified('iot/v2', 'removed')
	}, 30000)
})
