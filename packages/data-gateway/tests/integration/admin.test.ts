// The administration of the workspaces over REST (docs/DATA_GATEWAY_ADMIN_PLAN.md §2.2, phase 2), on files of a real
// folder: the permissions, the lambdaORM.yaml with its version (412 / 428), its validation, workspaces created and
// removed, and what is saved in them (workbench/). With the supervisor: a workspace created here starts, a schema
// written here reloads, a workspace removed goes.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { startGateway, startSupervisor } from '../../src/lib/infrastructure/build/main'
import { RunningGateway } from '../../src/lib/infrastructure/build/dataGatewayBuilder'
import { Supervisor } from '../../src/lib/application/runtime/supervisor'
import { YamlFileConfigSource } from '../../src/lib/infrastructure/output/config/yamlFileConfigSource'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { call, freePort } from '../helpers/net'

const NORTHWIND = fs.readFileSync(path.join(__dirname, '../fixtures/northwind/lambdaORM.yaml'), 'utf8')
const ADMIN = { 'X-Api-Key': 'admin-key' }
const READER = { 'X-Api-Key': 'reader-key' }
const ANALYST = { 'X-Api-Key': 'analyst-key' }

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

const configOf = (root: string, port: number, extra = '') => `
orm:
  workspacePath: ${root}
  watch: { intervalMs: 500, debounceMs: 100 }
${extra}
admin: { enabled: true }
logger: { level: error }
audit: { enabled: false }
rateLimit: { max: 0 }
runtime: { checkConnections: false, heartbeat: { intervalMs: 200, timeoutMs: 3000 }, restart: { initialDelayMs: 200, maxDelayMs: 1000 } }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: admin, value: admin-key, permissions: [ read, schemaRead, schemaWrite, schemaAdmin, workbenchWrite ] }
    - { name: analyst, value: analyst-key, permissions: [ read, workbenchWrite ] }
    - { name: reader, value: reader-key, permissions: [ read ] }
transports:
  http: { port: ${port}, host: 127.0.0.1 }
`

const workspaceRoot = () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-admin-'))
	fs.mkdirSync(path.join(root, 'iot/v1'), { recursive: true })
	fs.writeFileSync(path.join(root, 'iot/v1/lambdaORM.yaml'), NORTHWIND)
	return root
}

describe('admin over REST (inline)', () => {
	let gateway: RunningGateway
	let base: string
	let root: string
	const schemaUrl = '/admin/workspaces/iot%2Fv1/schema'

	beforeAll(async () => {
		root = workspaceRoot()
		const port = await freePort()
		const file = path.join(root, 'data-gateway.config.yaml')
		fs.writeFileSync(file, configOf(root, port))
		gateway = await startGateway({ source: new YamlFileConfigSource(file, {}), bootLogger: new ConsoleLogger('error') })
		base = `http://127.0.0.1:${port}`
	}, 60000)
	afterAll(() => gateway?.stop())

	test('what each credential may do; without the permission, 403', async () => {
		expect((await call(base, '/admin', { headers: ADMIN })).body.can).toEqual({ schemaRead: true, schemaWrite: true, schemaAdmin: true, workbenchRead: true, workbenchWrite: true })
		expect((await call(base, '/admin', { headers: READER })).body.can).toMatchObject({ schemaRead: false, workbenchRead: true, workbenchWrite: false })
		expect((await call(base, '/admin/workspaces', { headers: READER })).status).toBe(403)
		expect((await call(base, '/admin/workspaces')).status).toBe(401)
		const list = await call(base, '/admin/workspaces', { headers: ADMIN })
		expect(list.body).toEqual([expect.objectContaining({ path: 'iot/v1', status: 'ready', version: expect.any(String) })])
	})

	test('the lambdaORM.yaml with its version: 428 without it, 412 with an old one, 422 invalid, 200 written', async () => {
		const read = await call(base, schemaUrl, { headers: ADMIN })
		expect(read.body.text).toBe(NORTHWIND)
		expect(read.headers.get('etag')).toBe(`"${read.body.version}"`)
		const changed = NORTHWIND.replace(/name: Categories$/m, 'name: Kinds')
		expect((await call(base, schemaUrl, { method: 'PUT', body: { text: changed }, headers: ADMIN })).status).toBe(428)
		const invalid = await call(base, schemaUrl, { method: 'PUT', body: { text: 'domain:\n  entities: [ {\n' }, headers: { ...ADMIN, 'If-Match': `"${read.body.version}"` } })
		expect(invalid).toMatchObject({ status: 422, body: { error: 'SchemaValidationError', details: { issues: expect.arrayContaining([expect.objectContaining({ severity: 'error', line: expect.any(Number) })]) } } })
		const written = await call(base, schemaUrl, { method: 'PUT', body: { text: changed }, headers: { ...ADMIN, 'If-Match': `"${read.body.version}"` } })
		expect(written.status).toBe(200)
		expect(fs.readFileSync(path.join(root, 'iot/v1/lambdaORM.yaml'), 'utf8')).toBe(changed)
		// someone saving over the version read before: 412 with what there is now
		const stale = await call(base, schemaUrl, { method: 'PUT', body: { text: NORTHWIND }, headers: { ...ADMIN, 'If-Match': read.body.version } })
		expect(stale).toMatchObject({ status: 412, body: { error: 'PreconditionFailedError', details: { version: written.body.version, text: changed } } })
		expect((await call(base, schemaUrl, { method: 'PUT', body: { text: NORTHWIND }, headers: { 'X-Api-Key': 'analyst-key', 'If-Match': written.body.version } })).status).toBe(403)
	})

	test('validation: a YAML error at its line, a type that is not of λORM a warning, an extends of nothing an error', async () => {
		const yaml = await call(base, '/admin/validate', { body: { text: 'domain:\n  entities:\n    - name: A\n   bad: x\n' }, headers: ADMIN })
		expect(yaml.body).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ severity: 'error', line: expect.any(Number) })]) })
		const typed = await call(base, '/admin/validate', { body: { text: 'domain:\n  entities:\n    - name: A\n      primaryKey: [id]\n      properties:\n        - name: id\n          type: nope\n' }, headers: ADMIN })
		expect(typed.body.valid).toBe(true)
		expect(typed.body.issues).toEqual([expect.objectContaining({ severity: 'warning', line: 7, message: expect.stringContaining('"nope" is not a type of λORM') })])
		const extended = await call(base, '/admin/validate', { body: { text: 'domain:\n  entities:\n    - name: A\n      extends: Nothing\n      properties: [ { name: id } ]\n' }, headers: ADMIN })
		expect(extended.body.valid).toBe(false)
		// the code of the schema is not run to validate it
		const started = await call(base, '/admin/validate', { body: { text: 'domain: { entities: [] }\napplication:\n  start:\n    - expression: "throw \\"ran\\""\n' }, headers: ADMIN })
		expect(started.body.valid).toBe(true)
	})

	test('workspaces created and removed (to .trash); bad routes and the ones taken refused', async () => {
		const created = await call(base, '/admin/workspaces', { body: { path: 'sales/v1' }, headers: ADMIN })
		expect(created).toMatchObject({ status: 201, body: { path: 'sales/v1', version: expect.any(String) } })
		expect(fs.existsSync(path.join(root, 'sales/v1/lambdaORM.yaml'))).toBe(true)
		expect((await call(base, '/admin/workspaces', { body: { path: 'sales/v1' }, headers: ADMIN })).status).toBe(409)
		expect((await call(base, '/admin/workspaces', { body: { path: 'admin' }, headers: ADMIN })).status).toBe(400)
		expect((await call(base, '/admin/workspaces', { body: { path: 'iot' }, headers: ADMIN })).body.message).toMatch(/prefix/)
		expect((await call(base, '/admin/workspaces', { body: { path: 'copy/v1', copyOf: 'iot/v1' }, headers: ADMIN })).status).toBe(201)
		expect(fs.readFileSync(path.join(root, 'copy/v1/lambdaORM.yaml'), 'utf8')).toMatch(/name: Kinds/)
		expect((await call(base, '/admin/workspaces/iot%2Fv1', { method: 'DELETE', headers: ADMIN })).status).toBe(400)
		const removed = await call(base, '/admin/workspaces/iot%2Fv1?confirm=iot%2Fv1', { method: 'DELETE', headers: ADMIN })
		expect(removed).toMatchObject({ status: 200, body: { trash: expect.stringMatching(/^\.trash\/iot__v1-/) } })
		expect(fs.existsSync(path.join(root, 'iot/v1'))).toBe(false)
		expect(fs.existsSync(path.join(root, removed.body.trash, 'lambdaORM.yaml'))).toBe(true)
		// put it back for the rest
		fs.renameSync(path.join(root, removed.body.trash), path.join(root, 'iot/v1'))
	})

	test('workbench: folders, queries, scripts and diagrams as files; moved with their folder; 412 and 304', async () => {
		const at = '2026-11-22T10:00:00.000Z'
		const items = [
			{ id: 'f1', kind: 'folder', schema: 'iot/v1', name: 'reports', description: 'monthly', createdAt: at, updatedAt: at },
			{ id: 'q1', kind: 'query', schema: 'iot/v1', parentId: 'f1', name: 'sales by month', mode: 'query', query: 'Orders.map(p => count(1))', script: '', data: '{}', options: '{}', createdAt: at, updatedAt: at },
			{ id: 's1', kind: 'query', schema: 'iot/v1', parentId: 'f1', name: 'close', mode: 'script', query: '', script: 'orm.execute("Orders")', data: '{}', options: '{}', createdAt: at, updatedAt: at },
			{ id: 'd1', kind: 'diagram', schema: 'iot/v1', name: 'model', entities: ['Orders', 'Customers'], positions: { Orders: { x: 1, y: 2 } }, createdAt: at, updatedAt: at }
		]
		expect((await call(base, '/admin/workbench', { method: 'PUT', body: { items }, headers: READER })).status).toBe(403)
		const saved = await call(base, '/admin/workbench', { method: 'PUT', body: { items }, headers: ANALYST })
		expect(saved.status).toBe(200)
		const wb = path.join(root, 'iot/v1/workbench')
		expect(fs.readFileSync(path.join(wb, 'reports/sales by month.query.yaml'), 'utf8')).toMatch(/query: Orders\.map/)
		expect(fs.existsSync(path.join(wb, 'reports/close.script.yaml'))).toBe(true)
		expect(fs.existsSync(path.join(wb, 'model.diagram.yaml'))).toBe(true)
		const listed = await call(base, '/admin/workbench', { headers: READER })
		const byId = Object.fromEntries(listed.body.items.map((i: any) => [i.id, i]))
		expect(byId.q1).toMatchObject({ kind: 'query', parentId: 'f1', name: 'sales by month', mode: 'query', query: 'Orders.map(p => count(1))', version: expect.any(String) })
		expect(byId.s1).toMatchObject({ mode: 'script', script: 'orm.execute("Orders")' })
		expect(byId.d1).toMatchObject({ entities: ['Orders', 'Customers'], positions: { Orders: { x: 1, y: 2 } } })
		expect(byId.f1).toMatchObject({ kind: 'folder', description: 'monthly' })
		// nothing changed: 304
		const etag = listed.headers.get('etag')!
		expect((await call(base, '/admin/workbench', { headers: { ...READER, 'If-None-Match': etag } })).status).toBe(304)
		// the folder renamed: what it holds goes with it
		await call(base, '/admin/workbench', { method: 'PUT', body: { items: [{ ...byId.f1, name: 'monthly reports' }] }, headers: ANALYST })
		expect(fs.existsSync(path.join(wb, 'monthly reports/sales by month.query.yaml'))).toBe(true)
		expect(fs.existsSync(path.join(wb, 'reports'))).toBe(false)
		// another saved the query: the old version is a 412
		const now = (await call(base, '/admin/workbench', { headers: READER })).body.items.find((i: any) => i.id === 'q1')
		await call(base, '/admin/workbench', { method: 'PUT', body: { items: [{ ...now, query: 'Orders' }] }, headers: ANALYST })
		const stale = await call(base, '/admin/workbench', { method: 'PUT', body: { items: [{ ...now, query: 'Customers' }] }, headers: ANALYST })
		expect(stale).toMatchObject({ status: 412, body: { details: { ids: ['q1'] } } })
		expect((await call(base, '/admin/workbench', { method: 'PUT', body: { items: [{ ...now, version: undefined, id: 'x', name: '../escape' }] }, headers: ANALYST })).status).toBe(400)
		// a folder removed with what it holds
		const removed = await call(base, '/admin/workbench/remove', { body: { ids: ['f1'] }, headers: ANALYST })
		expect(removed.body.removed).toEqual(['f1'])
		expect(fs.existsSync(path.join(wb, 'monthly reports'))).toBe(false)
		expect((await call(base, '/admin/workbench', { headers: READER })).body.items.map((i: any) => i.id)).toEqual(['d1'])
	})

	test('a file written by hand in workbench/ is an item too', async () => {
		fs.writeFileSync(path.join(root, 'iot/v1/workbench/by hand.query.yaml'), 'query: Customers.page(1, 10)\ndata: { a: 1 }\n')
		const item = (await call(base, '/admin/workbench?schema=iot%2Fv1', { headers: READER })).body.items.find((i: any) => i.name === 'by hand')
		expect(item).toMatchObject({ id: 'file:workbench/by hand.query.yaml', kind: 'query', query: 'Customers.page(1, 10)', data: '{"a":1}' })
	})
})

describe('admin with the supervisor: what is written here is served', () => {
	let supervisor: Supervisor
	let base: string

	beforeAll(async () => {
		const root = workspaceRoot()
		const port = await freePort()
		const file = path.join(os.tmpdir(), `data-gateway-admin-${process.pid}.yaml`)
		fs.writeFileSync(file, configOf(root, port))
		supervisor = await startSupervisor({ source: new YamlFileConfigSource(file, process.env), bootLogger: new ConsoleLogger('error') })
		base = `http://127.0.0.1:${port}`
		await until(() => call(base, '/schemas').then(r => r.body).catch(() => []), (s: any[]) => Array.isArray(s) && s[0]?.status === 'ready')
	}, 60000)
	afterAll(() => supervisor?.stop(), 30000)

	const state = async (p: string) => ((await call(base, '/schemas')).body as any[]).find(s => s.path === p)

	test('a workspace created starts; its schema written is reloaded; removed, it goes', async () => {
		const copy = await call(base, '/admin/workspaces', { body: { path: 'sales/v1', copyOf: 'iot/v1' }, headers: ADMIN })
		expect(copy.status).toBe(201)
		await until(() => state('sales/v1'), s => s?.status === 'ready')
		expect((await call(base, '/sales/v1/entities', { headers: READER })).body.map((e: any) => e.name)).toContain('Categories')
		const read = await call(base, '/admin/workspaces/sales%2Fv1/schema', { headers: ADMIN })
		await call(base, '/admin/workspaces/sales%2Fv1/schema', { method: 'PUT', body: { text: read.body.text.replace(/name: Categories$/m, 'name: Kinds') }, headers: { ...ADMIN, 'If-Match': read.body.version } })
		await until(() => call(base, '/sales/v1/entities', { headers: READER }).then(r => r.body.map((e: any) => e.name)), names => names.includes('Kinds'))
		await call(base, '/admin/workspaces/sales%2Fv1?confirm=sales%2Fv1', { method: 'DELETE', headers: ADMIN })
		await until(() => state('sales/v1'), s => s === undefined)
		expect((await call(base, '/sales/v1/entities', { headers: READER })).status).toBe(404)
	}, 60000)
})
