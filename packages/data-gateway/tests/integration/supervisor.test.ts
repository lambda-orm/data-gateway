// The runtime of the process with real workers: the supervisor, the edge in a thread, schemas in threads and in a
// process, each with its own env. Every schema points to a database that doesn't exist: "ready/*" don't check their
// connections at start (plan, metadata, the schema and scripts don't connect), "northwind/*" do (they stay in error,
// retried, without touching the others).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startSupervisor } from '../../src/lib/infrastructure/build/main'
import { Supervisor } from '../../src/lib/application/runtime/supervisor'
import { YamlFileConfigSource } from '../../src/lib/infrastructure/output/config/yamlFileConfigSource'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { call, freePort } from '../helpers/net'

const NORTHWIND = fs.readFileSync(path.join(__dirname, '../fixtures/northwind/lambdaORM.yaml'), 'utf8')
const withConnection = (connection: string) => NORTHWIND.replace(/connection: .*/, `connection: ${connection}`)

const workspace = (files: Record<string, string>): string => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-workspace-'))
	for (const [file, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
		fs.writeFileSync(path.join(root, file), text)
	}
	return root
}

/** The schema processes (process mode) of this test: children running the worker bootstrap */
const schemaProcesses = (): number[] => execSync(`ps -o pid=,args= --ppid ${process.pid}`).toString().split('\n')
	.filter(line => line.includes('workerBootstrap.js') && !line.includes('ps -o'))
	.map(line => Number(line.trim().split(/\s+/)[0]))

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

describe('supervisor with real workers', () => {
	let supervisor: Supervisor
	let base: string
	let mcpBase: string
	const states = async () => (await call(base, '/schemas')).body as { path: string, status: string, reason?: string, restarts: number }[]
	const state = async (p: string) => (await states()).find(s => s.path === p)!

	beforeAll(async () => {
		const root = workspace({
			'ready/a/lambdaORM.yaml': NORTHWIND,
			'ready/b/lambdaORM.yaml': NORTHWIND,
			// the same variable in both: each worker gets its own value
			'northwind/v1/lambdaORM.yaml': withConnection('${DB_CONNECTION}'),
			'northwind/v2/lambdaORM.yaml': withConnection('${DB_CONNECTION}')
		})
		const [http, mcp] = [await freePort(), await freePort()]
		const file = path.join(root, 'data-gateway.config.yaml')
		fs.writeFileSync(file, `
orm:
  workspacePath: ${root}
  schemas:
    - path: northwind/v1
      env: { DB_CONNECTION: $V1_DB }
    - path: northwind/v2
      env: { DB_CONNECTION: $V2_DB }
    - path: ready/a
      scripts: { enabled: true, maxIterations: 100000000 }
      runtime: { checkConnections: false }
    - path: ready/b
      runtime: { mode: process, checkConnections: false }
logger: { level: error }
audit: { enabled: false }
rateLimit: { max: 0 }
server: { timeout: 60000 }
runtime:
  heartbeat: { intervalMs: 200, timeoutMs: 3000 }
  restart: { initialDelayMs: 200, maxDelayMs: 1000 }
transports:
  http: { port: ${http}, host: 127.0.0.1 }
  mcpHttp: { port: ${mcp}, host: 127.0.0.1, legacySse: false }
`)
		const env = {
			...process.env,
			V1_DB: '{"host":"127.0.0.1","port":1,"user":"x","password":"x","database":"x"}',
			V2_DB: '{"host":"127.0.0.1","port":2,"user":"x","password":"x","database":"x"}'
		}
		supervisor = await startSupervisor({ source: new YamlFileConfigSource(file, env), env, bootLogger: new ConsoleLogger('error') })
		base = `http://127.0.0.1:${http}`
		mcpBase = `http://127.0.0.1:${mcp}`
		await until(() => call(base, '/schemas').then(r => r.body).catch(() => []),
			(s: any[]) => Array.isArray(s) && s.length === 4 && s.filter(x => x.path.startsWith('ready/')).every(x => x.status === 'ready') && s.filter(x => x.path.startsWith('northwind/')).every(x => x.status === 'error'))
	}, 60000)

	afterAll(() => supervisor?.stop(), 30000)

	test('a schema whose database is down stays in error with its reason; each worker connected with its own value', async () => {
		const all = await states()
		expect(all.map(s => [s.path, s.status])).toEqual([['northwind/v1', 'error'], ['northwind/v2', 'error'], ['ready/a', 'ready'], ['ready/b', 'ready']])
		expect(all[0].reason).toMatch(/127\.0\.0\.1:1\b/)
		expect(all[1].reason).toMatch(/127\.0\.0\.1:2\b/)
		const health = await call(base, '/health')
		expect(health).toMatchObject({ status: 200, body: { message: 'DEGRADED' } })
	})

	test('REST per schema: ready answers, in error 503, unknown 404', async () => {
		const plan = await call(base, '/ready/a/plan', { body: { query: 'Products.filter(p => p.price > 10)' } })
		expect(plan).toMatchObject({ status: 200, body: { entity: 'Products', dialect: 'PostgreSQL' } })
		expect((await call(base, '/ready/b/entities')).body.map((e: any) => e.name)).toContain('Products')
		const down = await call(base, '/northwind/v1/plan', { body: { query: 'Products' } })
		expect(down).toMatchObject({ status: 503, body: { error: 'SchemaUnavailableError' } })
		expect((await call(base, '/nope/plan', { body: { query: 'Products' } })).status).toBe(404)
	})

	test('MCP per schema: each with its own server; a schema down is a JSON-RPC error', async () => {
		const client = async (p: string) => {
			const c = new Client({ name: 'test', version: '1' })
			await c.connect(new StreamableHTTPClientTransport(new URL(`${mcpBase}/${p}/mcp`)))
			return c
		}
		const a = await client('ready/a')
		const b = await client('ready/b')
		try {
			expect(a.getServerVersion()?.name).toBe('data-gateway ready/a')
			expect(b.getServerVersion()?.name).toBe('data-gateway ready/b')
			const tools = (await b.listTools()).tools
			expect(tools.find(t => t.name === 'orm_execute')?.description).toMatch(/- Products: /)
			expect((await a.callTool({ name: 'orm_plan', arguments: { query: 'Products' } })).isError).toBe(false)
		} finally {
			await a.close()
			await b.close()
		}
		await expect(client('northwind/v1')).rejects.toThrow()
	})

	test('a heavy script in one schema does not slow the other', async () => {
		const heavy = call(base, '/ready/a/script', { body: { script: 'i = 0; while (i < n) { i = i + 1 }; i', data: { n: 1200000 } } })
		await sleep(200)
		const started = Date.now()
		expect((await call(base, '/ready/b/ping')).status).toBe(200)
		expect((await call(base, '/ready/b/plan', { body: { query: 'Products' } })).status).toBe(200)
		expect(Date.now() - started).toBeLessThan(500)
		expect(await heavy).toMatchObject({ status: 200, body: 1200000 })
	}, 30000)

	test('/metrics: the edge and every schema worker, operations by schema; /{schema}/metrics only that one', async () => {
		await call(base, '/ready/a/plan', { body: { query: 'Products' } })
		const all = String((await call(base, '/metrics')).body)
		expect(all).toMatch(/node_nodejs_eventloop_lag_seconds\{worker="edge"\}/)
		expect(all).toMatch(/node_nodejs_eventloop_lag_seconds\{worker="schema:ready\/a"\}/)
		expect(all).toMatch(/node_nodejs_eventloop_lag_seconds\{worker="schema:ready\/b"\}/)
		expect(all).toMatch(/data_gateway_requests_total\{transport="http",schema="ready\/a",method="plan",status="200",credential="anonymous",worker="edge"\}/)
		expect(all).toMatch(/data_gateway_schema_status\{schema="northwind\/v1",status="error",worker="edge"\} 1/)
		const one = String((await call(base, '/ready/a/metrics')).body)
		expect(one).toMatch(/worker="schema:ready\/a"/)
		expect(one).not.toMatch(/worker="schema:ready\/b"/)
		expect(one).not.toMatch(/schema="ready\/b"/)
	})

	test('load: a burst on one schema does not raise the latency of the other beyond 250 ms', async () => {
		const burst = Array.from({ length: 30 }, () => call(base, '/ready/a/script', { body: { script: 'i = 0; while (i < n) { i = i + 1 }; i', data: { n: 100000 } } }))
		await sleep(100)
		const latencies: number[] = []
		for (let i = 0; i < 15; i++) {
			const started = Date.now()
			expect((await call(base, '/ready/b/plan', { body: { query: 'Products' } })).status).toBe(200)
			latencies.push(Date.now() - started)
		}
		latencies.sort((x, y) => x - y)
		const p95 = latencies[Math.floor(latencies.length * 0.95) - 1]
		expect(p95).toBeLessThan(250)
		const answers = await Promise.all(burst)
		expect(answers.every(a => a.status === 200)).toBe(true)
	}, 60000)

	test('a hung worker (it stops answering the heartbeat) is terminated and restarted; the other keeps answering', async () => {
		const before = (await state('ready/b')).restarts
		const [child] = schemaProcesses()
		// frozen: it neither answers nor exits, like a synchronous infinite loop
		process.kill(child, 'SIGSTOP')
		const pending = call(base, '/ready/b/entities')
		expect((await call(base, '/ready/a/ping')).status).toBe(200)
		const answer = await pending
		expect(answer).toMatchObject({ status: 503, body: { error: 'SchemaUnavailableError' } })
		const after = await until(() => state('ready/b'), s => s.status === 'ready' && s.restarts > before)
		expect(after.restarts).toBe(before + 1)
		expect((await call(base, '/ready/b/entities')).status).toBe(200)
	}, 40000)

	test('a schema process that is killed is restarted alone', async () => {
		const children = schemaProcesses()
		expect(children).toHaveLength(1)
		for (const pid of children) process.kill(pid, 'SIGKILL')
		await until(() => state('ready/b'), s => s.status !== 'ready', 5000)
		expect((await call(base, '/ready/a/ping')).status).toBe(200)
		const back = await until(() => state('ready/b'), s => s.status === 'ready')
		expect(back.restarts).toBeGreaterThanOrEqual(1)
		expect((await call(base, '/ready/b/entities')).status).toBe(200)
	}, 40000)
})
