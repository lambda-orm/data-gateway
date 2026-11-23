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
    - { name: admin, value: admin-key, permissions: [ read, schemaRead, schemaWrite, schemaAdmin, workbenchWrite, build ] }
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
		expect((await call(base, '/admin', { headers: ADMIN })).body.can).toEqual({ schemaRead: true, schemaWrite: true, schemaAdmin: true, workbenchRead: true, workbenchWrite: true, build: true })
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

	test('one element changed (a form): its comments and the rest of the file stay; a conflict only on the same element', async () => {
		const file = path.join(root, 'iot/v1/lambdaORM.yaml')
		const before = fs.readFileSync(file, 'utf8')
		const at = ['domain', 'entities', 'Products', 'properties', 'name']
		const read = (await call(base, schemaUrl, { headers: ADMIN })).body
		const current = (await import('yaml')).parse(read.text).domain.entities.find((e: any) => e.name === 'Products').properties.find((p: any) => p.name === 'name')
		const changed = await call(base, schemaUrl, { method: 'PATCH', body: { op: 'set', at, value: { ...current, length: 120 }, expected: current }, headers: ADMIN })
		expect(changed).toMatchObject({ status: 200, body: { version: expect.any(String), added: expect.any(Number) } })
		const after = fs.readFileSync(file, 'utf8')
		expect(after).toContain('# northwind')
		expect(after.split('\n').length).toBe(before.split('\n').length + (changed.body.added - changed.body.removed))
		// another form read the same element before: 412 with what there is now
		const stale = await call(base, schemaUrl, { method: 'PATCH', body: { op: 'set', at, value: { ...current, length: 10 }, expected: current }, headers: ADMIN })
		expect(stale).toMatchObject({ status: 412, body: { details: { current: { length: 120 } } } })
		// another element, read before that change: applied
		const other = await call(base, schemaUrl, { method: 'PATCH', body: { op: 'add', at: ['domain', 'enums'], value: { name: 'Sizes', values: [{ name: 'small', value: 1 }] } }, headers: ADMIN })
		expect(other.status).toBe(200)
		// a change that leaves the schema invalid is not written
		const invalid = await call(base, schemaUrl, { method: 'PATCH', body: { op: 'set', at: ['domain', 'entities', 'Products'], value: { name: 'Products', extends: 'Nothing', properties: [] } }, headers: ADMIN })
		expect(invalid.status).toBe(422)
		expect((await call(base, schemaUrl, { method: 'PATCH', body: { op: 'remove', at: ['domain', 'entities', 'Nope'] }, headers: ADMIN })).status).toBe(404)
		expect((await call(base, schemaUrl, { method: 'PATCH', body: { op: 'set', at, value: current }, headers: READER })).status).toBe(403)
	})

	test('rename an entity: who pointed to it follows; references before a remove', async () => {
		const references = await call(base, '/admin/workspaces/iot%2Fv1/references', { body: { at: ['domain', 'entities', 'Orders'] }, headers: ADMIN })
		expect(references.body.references.length).toBeGreaterThan(0)
		const renamed = await call(base, schemaUrl, { method: 'PATCH', body: { op: 'rename', at: ['domain', 'entities', 'Orders'], to: 'Purchases' }, headers: ADMIN })
		expect(renamed.status).toBe(200)
		const text = fs.readFileSync(path.join(root, 'iot/v1/lambdaORM.yaml'), 'utf8')
		expect(text).not.toMatch(/entity: Orders\b/)
		expect(text).toMatch(/entity: Purchases/)
		await call(base, schemaUrl, { method: 'PATCH', body: { op: 'rename', at: ['domain', 'entities', 'Purchases'], to: 'Orders' }, headers: ADMIN })
	})

	test('the variables of the connections: which are defined and where they are used; never their value', async () => {
		const url = '/admin/workspaces/iot%2Fv1/variables'
		const text = fs.readFileSync(path.join(root, 'iot/v1/lambdaORM.yaml'), 'utf8')
		fs.writeFileSync(path.join(root, 'iot/v1/lambdaORM.yaml'), text.replace(/connection: .*/, 'connection: ${SHOP_CNX}'))
		fs.writeFileSync(path.join(root, 'iot/v1/.env'), '# by hand\nTZ=UTC\n')
		expect((await call(base, url, { headers: ADMIN })).body.variables).toEqual([
			{ name: 'SHOP_CNX', defined: false, usedBy: ['main'], used: true },
			{ name: 'TZ', defined: true, usedBy: [], used: false }
		])
		const set = await call(base, url, { method: 'PUT', body: { set: { SHOP_CNX: '{"host":"127.0.0.1","password":"secret"}' } }, headers: ADMIN })
		expect(set.body.variables[0]).toEqual({ name: 'SHOP_CNX', defined: true, usedBy: ['main'], used: true })
		expect(JSON.stringify(set.body)).not.toContain('secret')
		expect(fs.readFileSync(path.join(root, 'iot/v1/.env'), 'utf8')).toBe('# by hand\nTZ=UTC\nSHOP_CNX=\'{"host":"127.0.0.1","password":"secret"}\'\n')
		expect((await call(base, url, { method: 'PUT', body: { remove: ['TZ'] }, headers: { 'X-Api-Key': 'analyst-key' } })).status).toBe(403)
		expect((await call(base, url, { method: 'PUT', body: { set: { 'bad name': 'x' } }, headers: ADMIN })).status).toBe(400)
		await call(base, url, { method: 'PUT', body: { remove: ['TZ'] }, headers: ADMIN })
		expect(fs.readFileSync(path.join(root, 'iot/v1/.env'), 'utf8')).toBe('# by hand\nSHOP_CNX=\'{"host":"127.0.0.1","password":"secret"}\'\n')
		fs.writeFileSync(path.join(root, 'iot/v1/lambdaORM.yaml'), text)
	})

		test('build: the model and the repositories in src/domain; a repository written once is the user\'s; also as a zip', async () => {
		const url = '/admin/workspaces/iot%2Fv1/build'
		expect((await call(base, url, { body: {}, headers: READER })).status).toBe(403)
		const built = await call(base, url, { body: { language: 'node', write: true }, headers: ADMIN })
		expect(built.status).toBe(200)
		expect(built.body.files).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: 'src/domain/model.ts', written: 'created' }),
			expect.objectContaining({ path: 'src/domain/repositoryProduct.ts', written: 'created' })
		]))
		const model = fs.readFileSync(path.join(root, 'iot/v1/src/domain/model.ts'), 'utf8')
		expect(model).toContain('export class Product')
		expect(model).toContain("from '@lambdaorm/lib'")
		fs.writeFileSync(path.join(root, 'iot/v1/src/domain/repositoryProduct.ts'), '// mine\n')
		const again = await call(base, url, { body: { write: true }, headers: ADMIN })
		expect(again.body.files.find((f: any) => f.path.endsWith('repositoryProduct.ts')).written).toBe('kept')
		expect(again.body.files.find((f: any) => f.path.endsWith('model.ts')).written).toBe('updated')
		expect(fs.readFileSync(path.join(root, 'iot/v1/src/domain/repositoryProduct.ts'), 'utf8')).toBe('// mine\n')
		const response = await fetch(`${base}${url}.zip?language=client-node`, { headers: ADMIN })
		expect(response.headers.get('content-type')).toBe('application/zip')
		const zip = Buffer.from(await response.arrayBuffer())
		expect(zip.readUInt32LE(0)).toBe(0x04034b50)
		expect(zip.toString('latin1')).toContain('src/domain/model.ts')
		expect(zip.toString('utf8')).toContain("from '@lambdaorm/client'")
		fs.writeFileSync(path.join(os.tmpdir(), 'data-gateway-build-test.zip'), zip)
	})

		test('the files of data/ and src/ are listed and read; the .env, the state and what is outside them are not', async () => {
		const files = '/admin/workspaces/iot%2Fv1/files'
		fs.mkdirSync(path.join(root, 'iot/v1/data'), { recursive: true })
		fs.writeFileSync(path.join(root, 'iot/v1/data/seed.sql'), 'INSERT INTO categories VALUES (1);\n')
		const listed = await call(base, `${files}?dir=data`, { headers: ADMIN })
		expect(listed.body).toMatchObject({ roots: { data: 'data', src: 'src', model: 'src/domain' }, files: [expect.objectContaining({ path: 'data/seed.sql', dir: false })] })
		const read = await call(base, `${files}/content?path=data/seed.sql`, { headers: ADMIN })
		expect(read.body).toMatchObject({ path: 'data/seed.sql', text: 'INSERT INTO categories VALUES (1);\n' })
		expect((await call(base, `${files}/content?path=.env`, { headers: ADMIN })).status).toBe(400)
		expect((await call(base, `${files}/content?path=lambdaORM.yaml`, { headers: ADMIN })).status).toBe(403)
		expect((await call(base, `${files}/content?path=data/../.env`, { headers: ADMIN })).status).toBe(400)
		expect((await call(base, `${files}?dir=orm_state`, { headers: ADMIN })).status).toBe(403)
		expect((await call(base, `${files}?dir=data`, { headers: READER })).status).toBe(403)
	})

		test('validation: a YAML error at its line, a type that is not of λORM a warning, an extends of nothing an error', async () => {
		const yaml = await call(base, '/admin/validate', { body: { text: 'domain:\n  entities:\n    - name: A\n   bad: x\n' }, headers: ADMIN })
		expect(yaml.body).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ severity: 'error', line: expect.any(Number) })]) })
		const typed = await call(base, '/admin/validate', { body: { text: 'domain:\n  entities:\n    - name: A\n      primaryKey: [id]\n      properties:\n        - name: id\n          type: nope\n' }, headers: ADMIN })
		expect(typed.body.valid).toBe(true)
		expect(typed.body.issues).toEqual([expect.objectContaining({ severity: 'warning', line: 7, message: expect.stringContaining('"nope" is not a type of λORM') })])
		const extended = await call(base, '/admin/validate', { body: { text: 'domain:\n  entities:\n    - name: A\n      extends: Nothing\n      properties: [ { name: id } ]\n' }, headers: ADMIN })
		expect(extended.body.valid).toBe(false)
		// a name twice in a list: a form would edit only one of them
		const twice = await call(base, '/admin/validate', { body: { text: 'domain:\n  entities:\n    - name: A\n      properties:\n        - name: id\n        - name: id\n' }, headers: ADMIN })
		expect(twice.body).toMatchObject({ valid: false, issues: [expect.objectContaining({ message: 'A.properties: "id" twice', line: 6 })] })
				// the code of the schema is not run to validate it
		const started = await call(base, '/admin/validate', { body: { text: 'domain: { entities: [] }\napplication:\n  start:\n    - expression: "throw \\"ran\\""\n' }, headers: ADMIN })
		expect(started.body.valid).toBe(true)
	})

	test('the state of the UI: each credential its own, in .data-gateway/state.sqlite; null forgets it', async () => {
		expect((await call(base, '/admin/session', { method: 'GET', headers: READER })).body).toEqual({ state: null })
		const state = { version: 1, tabs: [{ kind: 'query', title: 'Query 1', initial: { mode: 'query', query: 'Products.map(p => p.name)' } }], active: 0, expanded: ['s:northwind'] }
		const saved = await call(base, '/admin/session', { method: 'PUT', body: { state }, headers: READER })
		expect(saved).toMatchObject({ status: 200, body: { updatedAt: expect.any(String) } })
		expect((await call(base, '/admin/session', { method: 'GET', headers: READER })).body).toEqual({ state, updatedAt: saved.body.updatedAt })
		// another credential doesn't see it
		expect((await call(base, '/admin/session', { method: 'GET', headers: ANALYST })).body).toEqual({ state: null })
		expect((await call(base, '/admin/session', { method: 'PUT', body: { state: [1] }, headers: READER })).status).toBe(400)
		expect(fs.existsSync(path.join(root, '.data-gateway/state.sqlite'))).toBe(true)
		await call(base, '/admin/session', { method: 'PUT', body: { state: null }, headers: READER })
		expect((await call(base, '/admin/session', { method: 'GET', headers: READER })).body).toEqual({ state: null })
		// without a credential, nothing
		expect((await call(base, '/admin/session', { method: 'GET' })).status).toBe(401)
	})

	test('expressions: the language of 3xpr, the variables of a stage condition, one checked; a bad condition in the schema', async () => {
		const language = await call(base, '/admin/expressions', { method: 'GET', headers: ADMIN })
		expect(language.status).toBe(200)
		expect(language.body.functions).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'in', returnType: 'boolean' })]))
		expect(language.body.contexts.stageSource.map((v: any) => v.name)).toEqual(['entity', 'action', 'category', 'type', 'read', 'write', 'dml', 'ddl'])
		const right = await call(base, '/admin/expressions/check', { body: { expression: 'entity.in(["A","B"]) && read' }, headers: ADMIN })
		expect(right.body).toEqual({ valid: true, variables: ['entity', 'read'], unknown: [] })
		const unknown = await call(base, '/admin/expressions/check', { body: { expression: 'entity == "A" && foo' }, headers: ADMIN })
		expect(unknown.body).toMatchObject({ valid: false, unknown: ['foo'] })
		const broken = await call(base, '/admin/expressions/check', { body: { expression: 'entity.in(["A"' }, headers: ADMIN })
		expect(broken.body).toMatchObject({ valid: false, error: expect.stringContaining('incomplete') })
		const stage = 'domain: { entities: [] }\ninfrastructure:\n  sources:\n    - { name: a, dialect: PostgreSQL }\n  stages:\n    - name: default\n      sources:\n        - name: a\n          condition: entity.in(["A"\n'
		const checked = await call(base, '/admin/validate', { body: { text: stage }, headers: ADMIN })
		expect(checked.body).toMatchObject({ valid: false, issues: [expect.objectContaining({ severity: 'error', line: 9, message: expect.stringContaining('default.a: the condition incomplete') })] })
	})

	test('workspaces created and removed (to .trash); bad routes and the ones taken refused', async () => {
		const created = await call(base, '/admin/workspaces', { body: { path: 'sales/v1' }, headers: ADMIN })
		expect(created).toMatchObject({ status: 201, body: { path: 'sales/v1', version: expect.any(String) } })
		expect(fs.existsSync(path.join(root, 'sales/v1/lambdaORM.yaml'))).toBe(true)
		// with a name and a description: on top of the new file, its comment kept
		const named = await call(base, '/admin/workspaces', { body: { path: 'shop', name: 'Shop', description: 'The shop: products and orders' }, headers: ADMIN })
		expect(named.status).toBe(201)
		const shop = fs.readFileSync(path.join(root, 'shop/lambdaORM.yaml'), 'utf8')
		expect(shop).toMatch(/^# A schema of λORM[^\n]*\nname: Shop\ndescription: "The shop: products and orders"\ndomain:/)
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

	test('a file of workbench/ that is not valid YAML is a problem, not an item, and nothing saved replaces it', async () => {
		const broken = path.join(root, 'iot/v1/workbench/broken.query.yaml')
		fs.writeFileSync(broken, 'query: Orders.map(p => ({ month: month(p.orderDate) }))\n')
		const listed = (await call(base, '/admin/workbench?schema=iot%2Fv1', { headers: READER })).body
		expect(listed.items.find((i: any) => i.name === 'broken')).toBeUndefined()
		expect(listed.problems).toEqual([expect.objectContaining({ schema: 'iot/v1', file: 'workbench/broken.query.yaml', message: expect.any(String) })])
		const saved = await call(base, '/admin/workbench', { method: 'PUT', body: { items: [{ id: 'new', kind: 'query', schema: 'iot/v1', name: 'broken', mode: 'query', query: 'x' }] }, headers: ANALYST })
		expect(saved.status).toBe(409)
		expect(fs.readFileSync(broken, 'utf8')).toMatch(/month: month/)
		fs.rmSync(broken)
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
