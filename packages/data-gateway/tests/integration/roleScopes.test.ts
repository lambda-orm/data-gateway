// The roles with their views and stages (docs/ROLE_SCOPES.md) in a real gateway: λORM on SQLite with a view and two
// stages, keys with roles of authorization.roles and of the schema, a role without views nor stages; over REST
// the view and the stage asked for only among those of the roles, the permissions of the roles that allow both;
// /whoami says what it may choose; a role extended from the administration (the state of the gateway) applies at once.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Orm } from '@lambdaorm/lib'
import { startGateway } from '../../src/lib/infrastructure/build/main'
import { YamlFileConfigSource } from '../../src/lib/infrastructure/output/config/yamlFileConfigSource'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { RunningGateway } from '../../src/lib/infrastructure/build/dataGatewayBuilder'
import { call, freePort, login } from '../helpers/net'

let gateway: RunningGateway
let base: string
let admin: string
let dir: string
const key = (k: string) => ({ 'X-Api-Key': k })

beforeAll(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-roles-'))
	const workspace = path.join(dir, 'shop')
	fs.mkdirSync(workspace)
	fs.writeFileSync(path.join(workspace, 'lambdaORM.yaml'), `domain:
  entities:
    - name: Customers
      primaryKey: [id]
      properties:
        - { name: id, type: integer, required: true }
        - { name: name, type: string, length: 80, required: true }
        - { name: phone, type: string, length: 40 }
infrastructure:
  views:
    - name: default
    - name: support
      entities:
        - name: Customers
          properties:
            - { name: phone, exclude: true }
  mappings:
    - name: default
  sources:
    - { name: main, dialect: SQLjs, mapping: default, connection: '${path.join(dir, 'shop.sqlite')}' }
  stages:
    - name: default
      sources: [{ name: main }]
    - name: reporting
      sources: [{ name: main }]
`)
	const port = await freePort()
	const management = await freePort()
	const file = path.join(dir, 'data-gateway.config.yaml')
	fs.writeFileSync(file, `
orm:
  workspacePath: ${dir}
  schemas:
    - path: shop
      roles:
        analyst: { stages: [default, reporting] }
logger: { level: error }
rateLimit: { max: 0 }
authorization:
  roles:
    support: { permissions: [read], views: [support] }
    backend: { permissions: [read, write] }
    analyst: { permissions: [read], views: [support, default] }
    admin: { permissions: [read, write, schemaRead, roles] }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: carla, value: carla-key, roles: [support, backend] }
    - { name: ana, value: ana-key, roles: [analyst] }
    - { name: boss, value: boss-key, roles: [admin] }
    - { name: legacy, value: legacy-key, roles: [backend] }
transports:
  http: { port: ${port}, host: 127.0.0.1 }
  management: { port: ${management}, host: 127.0.0.1 }
`)
	// the table and a row, before the gateway opens the file (sql.js reads it when it starts)
	const orm = new Orm()
	await orm.init(path.join(workspace, 'lambdaORM.yaml'))
	await orm.stage.push({ stage: 'default' }).execute()
	await orm.execute('Customers.insert()', { id: 1, name: 'Alfreds', phone: '030-007' }, { stage: 'default' })
	await orm.end()
	gateway = await startGateway({ source: new YamlFileConfigSource(file, {}), bootLogger: new ConsoleLogger('error') })
	base = `http://127.0.0.1:${port}/shop`
	admin = `http://127.0.0.1:${management}`
}, 60000)
afterAll(async () => {
	await gateway?.stop()
	fs.rmSync(dir, { recursive: true, force: true })
})

const execute = (k: string, query: string, options?: object, data?: object) => call(base, '/execute', { body: { query, ...(data ? { data } : {}), ...(options ? { options } : {}) }, headers: key(k) })

test('a role without views nor stages: the view and the stage of the schema; another stage, 403', async () => {
	expect((await execute('legacy-key', 'Customers.map(p => p.phone)')).body).toEqual([{ phone: '030-007' }])
	expect((await execute('legacy-key', 'Customers.map(p => p.name)', { stage: 'reporting' })).status).toBe(403)
})

test('two roles of different views: the permissions of the one that allows the view chosen', async () => {
	// without choosing: the view of the schema (backend's), with its write
	expect((await execute('carla-key', 'Customers.map(p => p.phone)')).body).toEqual([{ phone: '030-007' }])
	// in support: only read, and the phone is not in it
	const inSupport = await execute('carla-key', 'Customers.map(p => p.name)', { view: 'support' })
	expect(inSupport.body).toEqual([{ name: 'Alfreds' }])
	expect((await execute('carla-key', 'Customers.map(p => p.phone)', { view: 'support' })).status).toBeGreaterThanOrEqual(400)
	expect((await execute('carla-key', 'Customers.update(p => ({ name: n })).filter(p => p.id == 1)', { view: 'support' }, { n: 'x' })).status).toBe(403)
	// a view no role of hers allows
	expect((await execute('carla-key', 'Customers.map(p => p.name)', { view: 'analytics' })).status).toBe(403)
})

test('a stage its role allows in this schema (extended by the schema); the view chosen with it', async () => {
	expect((await execute('ana-key', 'Customers.map(p => p.name)', { stage: 'reporting' })).body).toEqual([{ name: 'Alfreds' }])
	expect((await execute('ana-key', 'Customers.update(p => ({ name: n })).filter(p => p.id == 1)', {}, { n: 'x' })).status).toBe(403)
	const whoami = await call(base, '/whoami', { headers: key('ana-key') })
	expect(whoami.body).toMatchObject({ name: 'ana', view: 'support', stage: 'default', views: ['support', 'default'], stages: ['default', 'reporting'], roles: ['analyst'], permissions: ['read'] })
})

test('a role extended from the administration applies at once; each change recorded', async () => {
	const session = await login(admin, key('boss-key'))
	expect((await call(admin, '/admin/roles', { headers: await login(admin, key('ana-key')) })).status).toBe(403)
	const saved = await call(admin, '/admin/roles/analyst', { method: 'PUT', body: { schema: 'shop', config: { permissions: ['write'] }, reason: 'they fix names' }, headers: session })
	expect(saved.status).toBe(200)
	expect((await execute('ana-key', 'Customers.update(p => ({ name: n })).filter(p => p.id == 1)', {}, { n: 'Alfreds Futterkiste' })).status).toBe(200)
	// nobody gives what it doesn't have
	expect((await call(admin, '/admin/roles/analyst', { method: 'PUT', body: { config: { permissions: ['ddl'] } }, headers: session })).status).toBe(403)
	const listed = await call(admin, '/admin/roles', { headers: session })
	expect(listed.body).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'analyst', schema: 'shop', source: 'state', config: { permissions: ['write'] }, updatedBy: 'boss' })]))
	const changes = await call(admin, '/admin/roles/changes', { headers: session })
	expect(changes.body[0]).toMatchObject({ key: 'analyst@shop', by: 'boss', reason: 'they fix names', after: { permissions: ['write'] } })
	expect((await call(admin, '/admin/roles/analyst?schema=shop', { method: 'DELETE', headers: session })).status).toBe(200)
	expect((await execute('ana-key', 'Customers.update(p => ({ name: n })).filter(p => p.id == 1)', {}, { n: 'x' })).status).toBe(403)
	// kept in the SQLite of the volume, next to the sessions
	expect(fs.existsSync(path.join(dir, '.data-gateway', 'state.sqlite'))).toBe(true)
})
