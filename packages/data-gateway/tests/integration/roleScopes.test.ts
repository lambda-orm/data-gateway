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
logger: { level: error }
rateLimit: { max: 0 }
authorization:
  roles:
    support: { permissions: [read], views: [support] }
    backend: { permissions: [read, write] }
    analyst: { permissions: [read], views: [support, default], stages: [default, reporting], schemas: [shop] }
    elsewhere: { permissions: [read, write], schemas: [sales] }
    admin: { permissions: [read, write, schemaRead, roles, observability] }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: carla, value: carla-key, roles: [support, backend] }
    - { name: ana, value: ana-key, roles: [analyst] }
    - { name: boss, value: boss-key, roles: [admin] }
    - { name: legacy, value: legacy-key, roles: [backend] }
    - { name: eve, value: eve-key, roles: [elsewhere] }
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

test('a stage its role allows; the view chosen with it; a role of other schemas gives nothing here', async () => {
	expect((await execute('ana-key', 'Customers.map(p => p.name)', { stage: 'reporting' })).body).toEqual([{ name: 'Alfreds' }])
	expect((await execute('ana-key', 'Customers.update(p => ({ name: n })).filter(p => p.id == 1)', {}, { n: 'x' })).status).toBe(403)
	const whoami = await call(base, '/whoami', { headers: key('ana-key') })
	expect(whoami.body).toMatchObject({ name: 'ana', view: 'support', stage: 'default', views: ['support', 'default'], stages: ['default', 'reporting'], roles: ['analyst'], permissions: ['read'] })
	// elsewhere applies in sales, not in shop
	expect((await execute('eve-key', 'Customers.map(p => p.name)')).status).toBe(403)
})

test('a role extended from the administration applies at once; each change recorded', async () => {
	const session = await login(admin, key('boss-key'))
	expect((await call(admin, '/admin/roles', { headers: await login(admin, key('ana-key')) })).status).toBe(403)
	// a role is of the gateway: not of one schema
	expect((await call(admin, '/admin/roles/analyst', { method: 'PUT', body: { schema: 'shop', config: { permissions: ['write'] } }, headers: session })).status).toBe(400)
	const saved = await call(admin, '/admin/roles/analyst', { method: 'PUT', body: { config: { permissions: ['write'] }, reason: 'they fix names' }, headers: session })
	expect(saved.status).toBe(200)
	expect((await execute('ana-key', 'Customers.update(p => ({ name: n })).filter(p => p.id == 1)', {}, { n: 'Alfreds Futterkiste' })).status).toBe(200)
	// nobody gives what it doesn't have
	expect((await call(admin, '/admin/roles/analyst', { method: 'PUT', body: { config: { permissions: ['ddl'] } }, headers: session })).status).toBe(403)
	const listed = await call(admin, '/admin/roles', { headers: session })
	expect(listed.body).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'analyst', source: 'state', config: { permissions: ['write'] }, updatedBy: 'boss' })]))
	const changes = await call(admin, '/admin/roles/changes', { headers: session })
	expect(changes.body[0]).toMatchObject({ key: 'analyst', by: 'boss', reason: 'they fix names', after: { permissions: ['write'] } })
	expect((await call(admin, '/admin/roles/analyst', { method: 'DELETE', headers: session })).status).toBe(200)
	expect((await execute('ana-key', 'Customers.update(p => ({ name: n })).filter(p => p.id == 1)', {}, { n: 'x' })).status).toBe(403)
	// kept in the SQLite of the volume, next to the sessions
	expect(fs.existsSync(path.join(dir, '.data-gateway', 'state.sqlite'))).toBe(true)
})

test('the access: the keys with their roles and context, never their secrets; with the permission roles', async () => {
	expect((await call(admin, '/admin/access', { headers: await login(admin, key('ana-key')) })).status).toBe(403)
	const access = await call(admin, '/admin/access', { headers: await login(admin, key('boss-key')) })
	expect(access.status).toBe(200)
	expect(access.body.permissions).toEqual(expect.arrayContaining(['read', 'write', 'roles']))
	expect(access.body.authentications[0]).toMatchObject({ where: { level: 'global' }, adapter: 'local', type: 'apikey', header: 'x-api-key' })
	expect(access.body.authentications[0].credentials).toEqual(expect.arrayContaining([{ name: 'ana', roles: ['analyst'] }, { name: 'eve', roles: ['elsewhere'] }]))
	expect(JSON.stringify(access.body)).not.toMatch(/(carla|ana|boss|legacy|eve)-key/)
})

test('the observability: over the YAML, kept in the state, with the permission observability; back to the YAML', async () => {
	expect((await call(admin, '/admin/observability', { headers: await login(admin, key('ana-key')) })).status).toBe(403)
	const session = await login(admin, key('boss-key'))
	expect((await call(admin, '/admin/observability', { headers: session })).body).toEqual({ prometheus: true })
	expect((await call(admin, '/admin/observability', { method: 'PUT', body: { config: { exporter: { endpoint: 'http://x', headers: 'Authorization=t' } } }, headers: session })).status).toBe(400)
	const saved = await call(admin, '/admin/observability', { method: 'PUT', body: { config: { metrics: { enabled: true }, explore: { grafana: 'https://grafana.example.com', loki: 'logs' } }, reason: 'to Grafana' }, headers: session })
	expect(saved.status).toBe(200)
	expect(saved.body).toMatchObject({ override: { metrics: { enabled: true } }, effective: { explore: { loki: 'logs' } }, updatedBy: 'boss' })
	// kept: a gateway that starts again applies it
	expect((await call(admin, '/admin/observability', { headers: session })).body.override).toEqual({ metrics: { enabled: true }, explore: { grafana: 'https://grafana.example.com', loki: 'logs' } })
	expect((await call(admin, '/admin/observability', { method: 'DELETE', headers: session })).body).toEqual({ prometheus: true })
	expect((await call(admin, '/admin/observability', { method: 'DELETE', headers: session })).status).toBe(404)
	// the changes of the roles are only theirs
	expect((await call(admin, '/admin/roles/changes', { headers: session })).body.every((c: any) => c.area === 'roles')).toBe(true)
})

test('me: any credential, its own roles with what each gives, its context', async () => {
	const me = await call(admin, '/admin/me', { headers: await login(admin, key('ana-key')) })
	expect(me.status).toBe(200)
	expect(me.body).toEqual({ name: 'ana', permissions: ['read'], roles: [{ name: 'analyst', permissions: ['read'], schemas: { shop: {} }, views: ['support', 'default'], stages: ['default', 'reporting'] }] })
})

test('scopes: the views and the stages of every schema, for the roles; with the permission roles', async () => {
	expect((await call(admin, '/admin/scopes', { headers: await login(admin, key('ana-key')) })).status).toBe(403)
	const scopes = await call(admin, '/admin/scopes', { headers: await login(admin, key('boss-key')) })
	expect(scopes.body).toEqual([{ path: 'shop', views: ['default', 'support'], stages: ['default', 'reporting'] }])
})

test('state: where the gateway keeps it and its schema, with the permission roles', async () => {
	expect((await call(admin, '/admin/state', { headers: await login(admin, key('ana-key')) })).status).toBe(403)
	const state = await call(admin, '/admin/state', { headers: await login(admin, key('boss-key')) })
	expect(state.body).toMatchObject({ kind: 'sqlite', dialect: 'SQLite', managedBy: 'node:sqlite', available: true })
	expect(state.body.schema).toContain('name: Sessions')
})
