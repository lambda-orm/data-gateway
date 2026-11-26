// Two replicas of a gateway through a Valkey (docs/REPLICAS.md), on the same PostgreSQL: a write through one drops the
// cached result of the other at once and reaches the subscribers of the other; only one dispatches the outbox, and when
// it goes the other takes it. Needs DATA_GATEWAY_TEST_POSTGRES (the connection of a server: the database replicas is
// created) and DATA_GATEWAY_TEST_VALKEY (valkey://host:port).
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { Client } from 'pg'
import { Orm } from '@lambdaorm/lib'
import { startSupervisor } from '../../src/lib/infrastructure/build/main'
import { Supervisor } from '../../src/lib/application/runtime/supervisor'
import { YamlFileConfigSource } from '../../src/lib/infrastructure/output/config/yamlFileConfigSource'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { call, freePort } from '../helpers/net'

const POSTGRES = process.env.DATA_GATEWAY_TEST_POSTGRES
const VALKEY = process.env.DATA_GATEWAY_TEST_VALKEY
const KEY = { 'X-Api-Key': 'backend-key' }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const until = async (test: () => Promise<boolean> | boolean, ms = 10000) => {
	const end = Date.now() + ms
	while (Date.now() < end) { if (await test()) return true; await sleep(100) }
	return false
}

;(POSTGRES && VALKEY ? describe : describe.skip)('two replicas through a Valkey (PostgreSQL)', () => {
	const replicas: { name: string, supervisor?: Supervisor, base: string }[] = []
	let hook: http.Server
	const received: string[] = []
	let root: string

	const replica = async (name: string, hookUrl: string) => {
		const port = await freePort()
		const file = path.join(root, `${name}.config.yaml`)
		fs.writeFileSync(file, `
orm: { workspacePath: ${path.join(root, 'workspace')}, watch: false }
logger: { level: error }
audit: { enabled: false }
rateLimit: { max: 0 }
runtime: { checkConnections: false, heartbeat: { intervalMs: 200, timeoutMs: 3000 }, restart: { initialDelayMs: 200, maxDelayMs: 1000 } }
cache: { enabled: true, ttl: 60s }
cluster:
  valkey: { url: ${VALKEY}, prefix: dg-test-${process.pid} }
outbox:
  interval: 1s
  destinations:
    - { type: webhook, url: ${hookUrl}, timeout: 2s }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: backend, value: backend-key, permissions: [ read, write ] }
transports:
  http: { port: ${port}, host: 127.0.0.1 }
`)
		const supervisor = await startSupervisor({ source: new YamlFileConfigSource(file, process.env), bootLogger: new ConsoleLogger('error') })
		const base = `http://127.0.0.1:${port}`
		expect(await until(async () => (await call(base, '/shop/health').catch(() => ({ status: 0 }))).status === 200, 30000)).toBe(true)
		return { name, supervisor, base }
	}

	const leaderOf = async (base: string): Promise<number> => {
		const text = await (await fetch(`${base}/metrics`)).text()
		const line = text.split('\n').find(l => l.startsWith('data_gateway_outbox_leader{') && l.includes('schema="shop"'))
		return line ? Number(line.split(' ').pop()) : -1
	}

	beforeAll(async () => {
		hook = http.createServer((req, res) => {
			req.resume()
			req.on('end', () => { received.push(String(req.headers['x-data-gateway-event'])); res.writeHead(200).end() })
		})
		await new Promise<void>(resolve => hook.listen(0, '127.0.0.1', resolve))
		const hookUrl = `http://127.0.0.1:${(hook.address() as any).port}/hooks`
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-replicas-'))
		const connection = { ...JSON.parse(POSTGRES!), database: 'replicas' }
		const server = new Client(JSON.parse(POSTGRES!))
		await server.connect()
		try {
			await server.query('DROP DATABASE IF EXISTS replicas WITH (FORCE)')
			await server.query('CREATE DATABASE replicas')
		} finally { await server.end() }
		fs.mkdirSync(path.join(root, 'workspace', 'shop'), { recursive: true })
		fs.writeFileSync(path.join(root, 'workspace', 'shop', 'lambdaORM.yaml'), `domain:
  entities:
    - name: Categories
      primaryKey: [id]
      properties:
        - { name: id, type: integer, required: true }
        - { name: name, type: string, length: 80, required: true }
infrastructure:
  outbox: { entities: [Categories], maxAttempts: 3 }
  mappings:
    - name: default
  sources:
    - { name: main, dialect: PostgreSQL, mapping: default, connection: '${JSON.stringify(connection)}' }
  stages:
    - name: default
      sources:
        - name: main
`)
		const orm = new Orm()
		try {
			await orm.init(path.join(root, 'workspace', 'shop'))
			await orm.stage.push({ stage: 'default' }).execute()
			await orm.execute('Categories.insert()', { id: 1, name: 'Beverages' })
		} finally { await orm.end() }
		replicas.push(await replica('a', hookUrl), await replica('b', hookUrl))
	}, 90000)
	afterAll(async () => {
		for (const r of replicas) await r.supervisor?.stop()
		await new Promise<void>(resolve => { hook.closeAllConnections(); hook.close(() => resolve()) })
		fs.rmSync(root, { recursive: true, force: true })
	}, 30000)

	test('a write through one replica drops the cached result of the other at once (not after its ttl)', async () => {
		const [a, b] = replicas
		const read = async () => (await call(b.base, '/shop/execute', { body: { query: 'Categories.filter(p => p.id == 1).map(p => p.name)' }, headers: KEY })).body
		expect(await read()).toEqual([{ name: 'Beverages' }])
		expect(await read()).toEqual([{ name: 'Beverages' }])
		const metrics = await (await fetch(`${b.base}/metrics`)).text()
		expect(metrics).toMatch(/data_gateway_cache_requests\{[^}]*result="hit"[^}]*\} [1-9]/)
		expect(metrics).toMatch(/data_gateway_cluster_connected\{[^}]*schema="shop"[^}]*\} 1/)
		expect((await call(a.base, '/shop/execute', { body: { query: 'Categories.update(p => ({ name: n })).filter(p => p.id == 1)', data: { n: 'Drinks' } }, headers: KEY })).body).toBe(1)
		expect(await until(async () => JSON.stringify(await read()) === JSON.stringify([{ name: 'Drinks' }]), 5000)).toBe(true)
	})

	test('a write through one replica reaches the subscribers of the other (SSE)', async () => {
		const [a, b] = replicas
		const controller = new AbortController()
		const response = await fetch(`${b.base}/shop/subscribe?entity=Categories`, { headers: KEY, signal: controller.signal })
		expect(response.status).toBe(200)
		const reader = response.body!.getReader()
		let text = ''
		const events = (async () => {
			try {
				for (;;) {
					const { value, done } = await reader.read()
					if (done) return
					text += Buffer.from(value).toString('utf8')
				}
			} catch { /* aborted */ }
		})()
		expect(await until(() => text.includes('event: subscribed'))).toBe(true)
		expect((await call(a.base, '/shop/execute', { body: { query: 'Categories.insert()', data: { id: 2, name: 'Condiments' } }, headers: KEY })).status).toBe(200)
		expect(await until(() => text.includes('event: data.changed'), 5000)).toBe(true)
		expect(text).toContain('"entity":"Categories","action":"insert","keys":[{"id":2}]')
		controller.abort()
		await events
	})

	test('one replica dispatches the outbox; when it goes, the other takes it', async () => {
		expect(await until(async () => (await leaderOf(replicas[0].base)) + (await leaderOf(replicas[1].base)) === 1, 10000)).toBe(true)
		const leader = (await leaderOf(replicas[0].base)) === 1 ? replicas[0] : replicas[1]
		const other = leader === replicas[0] ? replicas[1] : replicas[0]
		const before = received.length
		expect((await call(other.base, '/shop/execute', { body: { query: 'Categories.insert()', data: { id: 3, name: 'Confections' } }, headers: KEY })).status).toBe(200)
		expect(await until(() => received.length > before, 10000)).toBe(true)
		await sleep(2500)
		// each event once: one replica dispatches
		expect(new Set(received).size).toBe(received.length)
		await leader.supervisor!.stop()
		leader.supervisor = undefined
		expect(await until(async () => (await leaderOf(other.base)) === 1, 10000)).toBe(true)
		const after = received.length
		expect((await call(other.base, '/shop/execute', { body: { query: 'Categories.insert()', data: { id: 4, name: 'Dairy' } }, headers: KEY })).status).toBe(200)
		expect(await until(() => received.length > after, 10000)).toBe(true)
		expect(new Set(received).size).toBe(received.length)
	}, 60000)
})
