// The commands of a workspace as jobs (docs/DATA_GATEWAY_ADMIN_PLAN.md §4, phase 3a), on a real PostgreSQL: push and
// drop only after their preview and with the same lambdaORM.yaml, fetch, export (also saved in data/), import with the
// rows it will write, and the permissions. Needs DATA_GATEWAY_TEST_POSTGRES, the connection of an empty database
// ({"host":"127.0.0.1","port":55432,"user":"postgres","password":"…","database":"shop"}); skipped without it.
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { startGateway } from '../../src/lib/infrastructure/build/main'
import { RunningGateway } from '../../src/lib/infrastructure/build/dataGatewayBuilder'
import { YamlFileConfigSource } from '../../src/lib/infrastructure/output/config/yamlFileConfigSource'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { call, freePort, login } from '../helpers/net'
import { startSupervisor } from '../../src/lib/infrastructure/build/main'
import { Supervisor } from '../../src/lib/application/runtime/supervisor'
import { Client } from 'pg'

const ADMIN_KEY = { 'X-Api-Key': 'admin-key' }
/** a session of management logged in with ADMIN_KEY (management takes no credential directly) */
const ADMIN: Record<string, string> = {}
const READER_KEY = { 'X-Api-Key': 'reader-key' }
/** a session of management logged in with READER_KEY (management takes no credential directly) */
const READER: Record<string, string> = {}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const POSTGRES = process.env.DATA_GATEWAY_TEST_POSTGRES

;(POSTGRES ? describe : describe.skip)('commands of a workspace (PostgreSQL)', () => {
	let gateway: RunningGateway
	let base: string
	let workspace: string
	const commands = '/admin/workspaces/shop/commands'

	const schemaOf = () => `# the shop
domain:
  entities:
    - name: Categories
      primaryKey: [id]
      uniqueKey: [name]
      properties:
        - { name: id, type: integer, required: true, autoIncrement: true }
        - { name: name, type: string, length: 80, required: true }
infrastructure:
  mappings:
    - name: default
  sources:
    - name: main
      dialect: PostgreSQL
      mapping: default
      connection: ${POSTGRES}
  stages:
    - name: default
      sources:
        - name: main
`

	/** Waits for a job to end */
	const finished = async (id: string) => {
		for (let i = 0; i < 100; i++) {
			const job = (await call(base, `/admin/workspaces/shop/jobs/${id}`, { headers: ADMIN })).body
			if (job.status !== 'running') return job
			await sleep(50)
		}
		throw new Error(`job ${id} did not end`)
	}

	beforeAll(async () => {
		// the database empty: what a previous run left is not there
		const db = new Client(JSON.parse(POSTGRES!))
		await db.connect()
		try { await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public') } finally { await db.end() }
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-commands-'))
		workspace = path.join(root, 'shop')
		fs.mkdirSync(workspace)
		fs.writeFileSync(path.join(workspace, 'lambdaORM.yaml'), schemaOf())
		const port = await freePort()
		const file = path.join(root, 'data-gateway.config.yaml')
		fs.writeFileSync(file, `
orm: { workspacePath: ${root} }
logger: { level: error }
audit: { enabled: false }
rateLimit: { max: 0 }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: admin, value: admin-key, permissions: [ read, write, stageImport, ddl, schemaRead, schemaWrite, workbenchWrite ] }
    - { name: reader, value: reader-key, permissions: [ read ] }
transports:
  management: { port: ${port}, host: 127.0.0.1 }
`)
		gateway = await startGateway({ source: new YamlFileConfigSource(file, {}), bootLogger: new ConsoleLogger('error') })
		base = `http://127.0.0.1:${port}`
		Object.assign(ADMIN, await login(base, ADMIN_KEY))
		Object.assign(READER, await login(base, READER_KEY))
	}, 60000)
	afterAll(() => gateway?.stop())

	test('the panel: the stages and what each credential may run', async () => {
		expect((await call(base, commands, { headers: ADMIN })).body).toMatchObject({ stages: ['default'], can: { push: true, drop: true, import: true, export: true, fetch: true } })
		expect((await call(base, commands, { headers: READER })).body.can).toMatchObject({ push: false, drop: false, import: false, fetch: true })
		expect((await call(base, `${commands}/version`, { method: 'POST', body: {}, headers: READER })).body).toMatchObject({ version: expect.any(String) })
	})

	test('push only runs its preview: the sentences first, then a job that creates the tables', async () => {
		expect((await call(base, `${commands}/push`, { body: {}, headers: ADMIN })).body.error).toBe('PreviewRequiredError')
		expect((await call(base, `${commands}/push/preview`, { body: {}, headers: READER })).status).toBe(403)
		const preview = await call(base, `${commands}/push/preview`, { body: { stage: 'default' }, headers: ADMIN })
		expect(preview.body).toMatchObject({ previewId: expect.any(String), stage: 'default', sentences: [{ source: 'main', sentences: expect.arrayContaining([expect.stringMatching(/CREATE TABLE/i)]) }] })
		const started = await call(base, `${commands}/push`, { body: { previewId: preview.body.previewId }, headers: ADMIN })
		expect(started).toMatchObject({ status: 202, body: { command: 'push', stage: 'default', status: 'running', credential: 'admin' } })
		const job = await finished(started.body.id)
		expect(job).toMatchObject({ status: 'done' })
		// a preview runs once
		expect((await call(base, `${commands}/push`, { body: { previewId: preview.body.previewId }, headers: ADMIN })).body.error).toBe('PreviewRequiredError')
		// the table is there: a row can be written
		expect((await call(base, '/shop/execute', { body: { query: 'Categories.insert()', data: { name: 'Beverages' } }, headers: ADMIN })).status).toBe(200)
	})

	test('fetch and export are jobs; an export can be saved in data/', async () => {
		const fetched = await finished((await call(base, `${commands}/fetch`, { body: {}, headers: READER })).body.id)
		expect(fetched.status).toBe('done')
		const exported = await finished((await call(base, `${commands}/export`, { body: { save: true }, headers: ADMIN })).body.id)
		expect(exported).toMatchObject({ status: 'done', file: expect.stringMatching(/^data\/default-.*\.json$/) })
		expect(JSON.stringify(exported.result)).toContain('Beverages')
		expect(fs.readFileSync(path.join(workspace, exported.file), 'utf8')).toContain('Beverages')
		expect((await call(base, `${commands}/export`, { body: { save: true }, headers: READER })).status).toBe(403)
		const jobs = (await call(base, '/admin/workspaces/shop/jobs', { headers: READER })).body
		expect(jobs.map((j: any) => j.command)).toEqual(['export', 'fetch', 'push'])
		expect(jobs[0].result).toBeUndefined()
		// each job leaves its record next to the state of λORM
		expect(fs.readdirSync(path.join(workspace, 'orm_state/jobs')).length).toBeGreaterThanOrEqual(3)
	})

	test('import: the rows of each entity first, then the job', async () => {
		const exported = (await call(base, '/shop/stages/default/export', { headers: ADMIN })).body
		const data = { ...exported, entities: exported.entities.map((e: any) => ({ ...e, rows: e.rows.map((r: any) => ({ ...r, id: r.id + 100, name: `${r.name} 2` })) })) }
		const preview = await call(base, `${commands}/import/preview`, { body: { data }, headers: ADMIN })
		expect(preview.body).toMatchObject({ rows: { Categories: 1 } })
		const job = await finished((await call(base, `${commands}/import`, { body: { previewId: preview.body.previewId }, headers: ADMIN })).body.id)
		expect(job.status).toBe('done')
		expect((await call(base, '/shop/execute', { body: { query: 'Categories.map(p => p.name).sort(p => p.name)' }, headers: READER })).body).toEqual([{ name: 'Beverages' }, { name: 'Beverages 2' }])
	})

	test('pull: a table created in the database comes into the schema; the yaml keeps its comments', async () => {
		const db = new Client(JSON.parse(POSTGRES!))
		await db.connect()
		try { await db.query('CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name VARCHAR(50) NOT NULL)') } finally { await db.end() }
		expect((await call(base, `${commands}/pull/preview`, { body: {}, headers: READER })).status).toBe(403)
		const preview = await call(base, `${commands}/pull/preview`, { body: {}, headers: ADMIN })
		expect(preview.body.diff.added).toBeGreaterThan(0)
		expect(JSON.stringify(preview.body.diff.hunks)).toMatch(/suppliers|Suppliers/)
		const job = await finished((await call(base, `${commands}/pull`, { body: { previewId: preview.body.previewId }, headers: ADMIN })).body.id)
		expect(job).toMatchObject({ status: 'done', result: { file: 'lambdaORM.yaml' } })
		const yaml = fs.readFileSync(path.join(workspace, 'lambdaORM.yaml'), 'utf8')
		expect(yaml).toMatch(/^# the shop/)
		expect(yaml).toMatch(/[Ss]uppliers/)
		expect(yaml).toContain('connection: ${POSTGRES}'.replace('${POSTGRES}', POSTGRES!))
	})

	test('introspect: the entities of some data into the schema; incorporate needs a gateway that reloads its schemas', async () => {
		const data = [{ id: 1, name: 'Acme', country: 'AR' }]
		const preview = await call(base, `${commands}/introspect/preview`, { body: { data, name: 'Brands' }, headers: ADMIN })
		expect(preview.body).toMatchObject({ rows: { Brands: 1 } })
		expect(JSON.stringify(preview.body.diff.hunks)).toContain('Brands')
		const job = await finished((await call(base, `${commands}/introspect`, { body: { previewId: preview.body.previewId }, headers: ADMIN })).body.id)
		expect(job.status).toBe('done')
		expect(fs.readFileSync(path.join(workspace, 'lambdaORM.yaml'), 'utf8')).toContain('Brands')
		const again = await call(base, `${commands}/incorporate/preview`, { body: { data, name: 'Makers' }, headers: ADMIN })
		const failed = await finished((await call(base, `${commands}/incorporate`, { body: { previewId: again.body.previewId }, headers: ADMIN })).body.id)
		expect(failed).toMatchObject({ status: 'failed', error: { message: expect.stringMatching(/does not reload its schemas/) } })
	})

	test('drop: a preview made with another lambdaORM.yaml is not run', async () => {
		const preview = await call(base, `${commands}/drop/preview`, { body: {}, headers: ADMIN })
		expect(preview.body.sentences.length).toBeGreaterThan(0)
		fs.appendFileSync(path.join(workspace, 'lambdaORM.yaml'), '# changed\n')
		expect((await call(base, `${commands}/drop`, { body: { previewId: preview.body.previewId }, headers: ADMIN })).body).toMatchObject({ error: 'PreviewRequiredError', message: expect.stringMatching(/changed since the preview/) })
		const again = await call(base, `${commands}/drop/preview`, { body: {}, headers: ADMIN })
		const job = await finished((await call(base, `${commands}/drop`, { body: { previewId: again.body.previewId }, headers: ADMIN })).body.id)
		expect(job.status).toBe('done')
		expect((await call(base, '/shop/execute', { body: { query: 'Categories.map(p => p.name)' }, headers: READER })).status).not.toBe(200)
	})
})

;(POSTGRES ? describe : describe.skip)('incorporate with the supervisor (PostgreSQL)', () => {
	let supervisor: Supervisor
	let base: string

	beforeAll(async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-incorporate-'))
		const connection = { ...JSON.parse(POSTGRES!), database: 'shop2' }
		// a database of its own, empty (it is created if it isn't there)
		const server = new Client(JSON.parse(POSTGRES!))
		await server.connect()
		try {
			await server.query('DROP DATABASE IF EXISTS shop2 WITH (FORCE)')
			await server.query('CREATE DATABASE shop2')
		} finally { await server.end() }
		fs.mkdirSync(path.join(root, 'shop'))
		fs.writeFileSync(path.join(root, 'shop/lambdaORM.yaml'), `# the shop
domain:
  entities: []
infrastructure:
  mappings:
    - name: default
  sources:
    - { name: main, dialect: PostgreSQL, mapping: default, connection: '${JSON.stringify(connection)}' }
  stages:
    - name: default
      sources:
        - name: main
`)
		const port = await freePort()
		const file = path.join(root, 'data-gateway.config.yaml')
		fs.writeFileSync(file, `
orm: { workspacePath: ${root}, watch: { intervalMs: 500, debounceMs: 100 } }
logger: { level: error }
audit: { enabled: false }
rateLimit: { max: 0 }
runtime: { checkConnections: false, heartbeat: { intervalMs: 200, timeoutMs: 3000 }, restart: { initialDelayMs: 200, maxDelayMs: 1000 } }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: admin, value: admin-key, permissions: [ read, write, stageImport, ddl, schemaRead, schemaWrite ] }
transports:
  management: { port: ${port}, host: 127.0.0.1 }
`)
		supervisor = await startSupervisor({ source: new YamlFileConfigSource(file, process.env), bootLogger: new ConsoleLogger('error') })
		base = `http://127.0.0.1:${port}`
		for (let i = 0; i < 100; i++) {
			const states = await call(base, '/schemas').then(r => r.body).catch(() => [])
			if (Array.isArray(states) && states[0]?.status === 'ready') break
			await sleep(100)
		}
		Object.assign(ADMIN, await login(base, ADMIN_KEY))
	}, 60000)
	afterAll(() => supervisor?.stop(), 30000)

	test('the entities of some data written, the schema reloaded, the tables pushed and the rows imported', async () => {
		const data = [{ id: 1, name: 'Acme' }, { id: 2, name: 'Initech' }]
		const preview = await call(base, '/admin/workspaces/shop/commands/incorporate/preview', { body: { data, name: 'Brands' }, headers: ADMIN })
		expect(preview.body).toMatchObject({ rows: { Brands: 2 } })
		const started = await call(base, '/admin/workspaces/shop/commands/incorporate', { body: { previewId: preview.body.previewId }, headers: ADMIN })
		let job: any
		for (let i = 0; i < 200; i++) {
			job = (await call(base, `/admin/workspaces/shop/jobs/${started.body.id}`, { headers: ADMIN })).body
			if (job.status !== 'running') break
			await sleep(100)
		}
		expect(job).toMatchObject({ status: 'done', result: { imported: { Brands: 2 } } })
		const names = await call(base, '/shop/execute', { body: { query: 'Brands.map(p => p.name).sort(p => p.name)' }, headers: ADMIN })
		expect(names.body).toEqual([{ name: 'Acme' }, { name: 'Initech' }])
	}, 60000)
})

;(POSTGRES ? describe : describe.skip)('migrations, migrate, seed and what can lose data (PostgreSQL)', () => {
	let supervisor: Supervisor
	let base: string
	let root: string
	const commands = '/admin/workspaces/shop/commands'

	const schemaOf = (length: number, connection: unknown) => `# the shop, with the history of its migrations
domain:
  entities:
    - name: Categories
      primaryKey: [id]
      properties:
        - { name: id, type: integer, required: true }
        - { name: name, type: string, length: ${length}, required: true }
infrastructure:
  migrations: {}
  mappings:
    - name: default
  sources:
    - { name: main, dialect: PostgreSQL, mapping: default, connection: '${JSON.stringify(connection)}' }
  stages:
    - name: default
      sources:
        - name: main
      seed: [data/categories.json]
`

	const finished = async (id: string) => {
		for (let i = 0; i < 200; i++) {
			const job = (await call(base, `/admin/workspaces/shop/jobs/${id}`, { headers: ADMIN })).body
			if (job.status !== 'running') return job
			await sleep(100)
		}
		throw new Error(`job ${id} did not end`)
	}
	/** a preview, and the job of running it with these options */
	const run = async (command: string, body: Record<string, unknown> = {}, options: Record<string, unknown> = {}) => {
		const preview = await call(base, `${commands}/${command}/preview`, { body, headers: ADMIN })
		expect(preview.status).toBe(200)
		const started = await call(base, `${commands}/${command}`, { body: { previewId: preview.body.previewId, ...options }, headers: ADMIN })
		return { preview: preview.body, job: await finished(started.body.id) }
	}
	/** migrations only reads: a job without preview */
	const migrations = async () => finished((await call(base, `${commands}/migrations`, { body: {}, headers: ADMIN })).body.id)
	/** the schema served is the one just written (the monitor reloads it) */
	const reloaded = async (length: number) => {
		for (let i = 0; i < 100; i++) {
			const preview = await call(base, `${commands}/push/preview`, { body: {}, headers: ADMIN })
			if (JSON.stringify(preview.body).includes(`VARCHAR(${length})`)) return
			await sleep(200)
		}
		throw new Error(`the schema with length ${length} was not reloaded`)
	}

	beforeAll(async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-migrations-'))
		const connection = { ...JSON.parse(POSTGRES!), database: 'shop3' }
		const server = new Client(JSON.parse(POSTGRES!))
		await server.connect()
		try {
			await server.query('DROP DATABASE IF EXISTS shop3 WITH (FORCE)')
			await server.query('CREATE DATABASE shop3')
		} finally { await server.end() }
		fs.mkdirSync(path.join(root, 'shop/data'), { recursive: true })
		fs.writeFileSync(path.join(root, 'shop/data/categories.json'), JSON.stringify({ entities: [{ entity: 'Categories', rows: [{ id: 1, name: 'Beverages' }, { id: 2, name: 'Condiments' }] }] }))
		fs.writeFileSync(path.join(root, 'shop/lambdaORM.yaml'), schemaOf(80, connection))
		const port = await freePort()
		const file = path.join(root, 'data-gateway.config.yaml')
		fs.writeFileSync(file, `
orm: { workspacePath: ${root}, watch: { intervalMs: 300, debounceMs: 100 } }
logger: { level: error }
audit: { enabled: false }
rateLimit: { max: 0 }
runtime: { checkConnections: false, heartbeat: { intervalMs: 200, timeoutMs: 3000 }, restart: { initialDelayMs: 200, maxDelayMs: 1000 } }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: admin, value: admin-key, permissions: [ read, write, stageImport, ddl, schemaRead, schemaWrite ] }
transports:
  management: { port: ${port}, host: 127.0.0.1 }
`)
		supervisor = await startSupervisor({ source: new YamlFileConfigSource(file, process.env), bootLogger: new ConsoleLogger('error') })
		base = `http://127.0.0.1:${port}`
		for (let i = 0; i < 100; i++) {
			const states = await call(base, '/schemas').then(r => r.body).catch(() => [])
			if (Array.isArray(states) && states[0]?.status === 'ready') break
			await sleep(100)
		}
		Object.assign(ADMIN, await login(base, ADMIN_KEY))
	}, 60000)
	afterAll(() => supervisor?.stop(), 30000)

	test('push, seed twice, a push that can lose data only when allowed, migrate back to the first version', async () => {
		const first = await run('push')
		expect(first.preview.destructive).toEqual([])
		expect(first.job).toMatchObject({ status: 'done' })
		const v1 = (await migrations()).result
		expect(v1).toMatchObject([{ stage: 'default', source: 'main', status: 'applied', version: expect.stringMatching(/^\d{12}$/) }])

		const seed = await run('seed')
		expect(seed.preview.files).toEqual(['data/categories.json'])
		expect(seed.job).toMatchObject({ status: 'done', result: [{ entities: [{ entity: 'Categories', inserted: 2, skipped: 0 }] }] })
		expect((await run('seed')).job.result).toMatchObject([{ entities: [{ entity: 'Categories', inserted: 0, skipped: 2 }] }])

		// a version of another second (the version is yyMMddHHmmss)
		await sleep(1100)
		fs.writeFileSync(path.join(root, 'shop/lambdaORM.yaml'), schemaOf(40, { ...JSON.parse(POSTGRES!), database: 'shop3' }))
		await reloaded(40)
		const refused = await run('push')
		expect(refused.preview.destructive).toEqual([{ source: 'main', sentence: expect.stringMatching(/VARCHAR\(40\)/), reason: expect.any(String) }])
		expect(refused.job).toMatchObject({ status: 'failed', error: { name: 'DestructiveChangeError' } })
		expect((await run('push', {}, { allowDestructive: true })).job).toMatchObject({ status: 'done' })
		const v2 = (await migrations()).result
		expect(v2).toHaveLength(2)

		const back = await run('migrate', { version: v1[0].version })
		expect(back.preview).toMatchObject({ version: v1[0].version, sentences: [{ source: 'main', version: v2[0].version, sentences: [expect.stringMatching(/VARCHAR\(80\)/)] }] })
		expect(back.job).toMatchObject({ status: 'done' })
		expect((await migrations()).result).toMatchObject([{ version: v2[0].version, status: 'undone' }, { version: v1[0].version, status: 'applied' }])
		// the rows are still there
		expect((await call(base, '/shop/execute', { body: { query: 'Categories.map(p => p.name).sort(p => p.name)' }, headers: ADMIN })).body).toEqual([{ name: 'Beverages' }, { name: 'Condiments' }])
	}, 120000)
})

;(POSTGRES ? describe : describe.skip)('the dispatcher of the outbox (PostgreSQL, docs/OUTBOX_DISPATCHER.md)', () => {
	let supervisor: Supervisor
	let base: string
	let hook: http.Server
	let hookStatus = 500
	const received: { id: string, body: any }[] = []
	const outbox = '/admin/workspaces/shop/outbox'

	beforeAll(async () => {
		hook = http.createServer((req, res) => {
			let body = ''
			req.on('data', chunk => { body += chunk })
			req.on('end', () => { received.push({ id: String(req.headers['x-data-gateway-event']), body: JSON.parse(body) }); res.writeHead(hookStatus).end() })
		})
		await new Promise<void>(resolve => hook.listen(0, '127.0.0.1', resolve))
		const hookUrl = `http://127.0.0.1:${(hook.address() as any).port}/hooks`
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-outbox-'))
		const connection = { ...JSON.parse(POSTGRES!), database: 'shop4' }
		const server = new Client(JSON.parse(POSTGRES!))
		await server.connect()
		try {
			await server.query('DROP DATABASE IF EXISTS shop4 WITH (FORCE)')
			await server.query('CREATE DATABASE shop4')
		} finally { await server.end() }
		fs.mkdirSync(path.join(root, 'shop'))
		fs.writeFileSync(path.join(root, 'shop/lambdaORM.yaml'), `domain:
  entities:
    - name: Categories
      primaryKey: [id]
      properties:
        - { name: id, type: integer, required: true }
        - { name: name, type: string, length: 80, required: true }
infrastructure:
  outbox: { entities: [Categories], maxAttempts: 1 }
  mappings:
    - name: default
  sources:
    - { name: main, dialect: PostgreSQL, mapping: default, connection: '${JSON.stringify(connection)}' }
  stages:
    - name: default
      sources:
        - name: main
`)
		const port = await freePort()
		const file = path.join(root, 'data-gateway.config.yaml')
		fs.writeFileSync(file, `
orm: { workspacePath: ${root}, watch: false }
logger: { level: error }
audit: { enabled: false }
rateLimit: { max: 0 }
runtime: { checkConnections: false, heartbeat: { intervalMs: 200, timeoutMs: 3000 }, restart: { initialDelayMs: 200, maxDelayMs: 1000 } }
outbox:
  interval: 1s
  destinations:
    - { type: webhook, url: ${hookUrl}, secret: hook-secret, timeout: 2s }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: admin, value: admin-key, permissions: [ read, write, stageImport, ddl, schemaRead, schemaWrite ] }
transports:
  management: { port: ${port}, host: 127.0.0.1 }
`)
		supervisor = await startSupervisor({ source: new YamlFileConfigSource(file, process.env), bootLogger: new ConsoleLogger('error') })
		base = `http://127.0.0.1:${port}`
		for (let i = 0; i < 100; i++) {
			const states = await call(base, '/schemas').then(r => r.body).catch(() => [])
			if (Array.isArray(states) && states[0]?.status === 'ready') break
			await sleep(100)
		}
		Object.assign(ADMIN, await login(base, ADMIN_KEY))
	}, 60000)
	afterAll(async () => {
		await supervisor?.stop()
		await new Promise<void>(resolve => { hook.closeAllConnections(); hook.close(() => resolve()) })
	}, 30000)

	const until = async (test: () => Promise<boolean> | boolean, ms = 10000) => {
		const end = Date.now() + ms
		while (Date.now() < end) { if (await test()) return true; await sleep(100) }
		return false
	}

	test('a write leaves its event; the webhook fails, it is dead; listed, retried, delivered', async () => {
		const preview = await call(base, '/admin/workspaces/shop/commands/push/preview', { body: {}, headers: ADMIN })
		const started = await call(base, '/admin/workspaces/shop/commands/push', { body: { previewId: preview.body.previewId }, headers: ADMIN })
		expect(await until(async () => (await call(base, `/admin/workspaces/shop/jobs/${started.body.id}`, { headers: ADMIN })).body.status === 'done')).toBe(true)
		expect((await call(base, '/shop/execute', { body: { query: 'Categories.insert()', data: { id: 1, name: 'Beverages' } }, headers: ADMIN })).status).toBe(200)

		expect(await until(() => received.length >= 1)).toBe(true)
		expect(received[0].body).toMatchObject({ entity: 'Categories', action: 'insert', keys: [{ id: 1 }] })
		expect(received[0].body).not.toHaveProperty('name')
		let dead: any[] = []
		expect(await until(async () => { dead = (await call(base, `${outbox}?status=dead`, { headers: ADMIN })).body; return Array.isArray(dead) && dead.length === 1 })).toBe(true)
		expect(dead[0]).toMatchObject({ entity: 'Categories', status: 'dead', error: expect.stringContaining('answered 500') })

		hookStatus = 200
		expect((await call(base, `${outbox}/${dead[0].id}/retry`, { method: 'POST', body: {}, headers: ADMIN })).body).toEqual({ id: dead[0].id, status: 'pending' })
		expect(await until(async () => (await call(base, `${outbox}?status=done`, { headers: ADMIN })).body.length === 1)).toBe(true)
		expect(received.filter(r => r.id === dead[0].id).length).toBeGreaterThanOrEqual(2)
		expect((await call(base, `${outbox}?status=dead`, { headers: ADMIN })).body).toEqual([])
		expect((await call(base, `${outbox}/nope/retry`, { method: 'POST', body: {}, headers: ADMIN })).status).toBe(404)
	}, 60000)
})
