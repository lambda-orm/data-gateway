// The history of a schema over REST (docs/OBSERVABILITY.md §5.3): a change from the IDE (management, with a session)
// leaves its schema.patch with who (credential, session, client, IP), the element before and after and the diff.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { parse } from 'yaml'
import { startGateway } from '../../src/lib/infrastructure/build/main'
import { RunningGateway } from '../../src/lib/infrastructure/build/dataGatewayBuilder'
import { YamlFileConfigSource } from '../../src/lib/infrastructure/output/config/yamlFileConfigSource'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { call, freePort } from '../helpers/net'

const NORTHWIND = fs.readFileSync(path.join(__dirname, '../fixtures/northwind/lambdaORM.yaml'), 'utf8')
const schemaUrl = '/admin/workspaces/iot%2Fv1/schema'
const historyUrl = '/admin/workspaces/iot%2Fv1/history'

let gateway: RunningGateway
let base: string
let root: string
const MODELER: Record<string, string> = {}
const READER: Record<string, string> = {}

beforeAll(async () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-history-'))
	fs.mkdirSync(path.join(root, 'iot/v1'), { recursive: true })
	fs.writeFileSync(path.join(root, 'iot/v1/lambdaORM.yaml'), NORTHWIND)
	const port = await freePort()
	const file = path.join(root, 'data-gateway.config.yaml')
	fs.writeFileSync(file, `
orm:
  workspacePath: ${root}
logger: { level: error }
audit: { enabled: false }
metrics: { enabled: false }
rateLimit: { max: 0 }
runtime: { checkConnections: false }
authorization:
  roles:
    modeler: { permissions: [ read, schemaRead, schemaWrite ] }
    reader: { permissions: [ read ] }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: modeler, value: modeler-key, roles: [ modeler ] }
    - { name: reader, value: reader-key, roles: [ reader ] }
transports:
  management: { port: ${port}, host: 127.0.0.1 }
`)
	gateway = await startGateway({ source: new YamlFileConfigSource(file, {}), bootLogger: new ConsoleLogger('error') })
	base = `http://127.0.0.1:${port}`
	const session = async (key: string) => {
		const answer = await call(base, '/sessions', { method: 'POST', body: { client: { app: 'data-gateway-ide', version: '2.1.0' } }, headers: { 'X-Api-Key': key } })
		return { 'X-Data-Gateway-Session': answer.body.token }
	}
	Object.assign(MODELER, await session('modeler-key'))
	Object.assign(READER, await session('reader-key'))
}, 60000)
afterAll(async () => {
	await gateway?.stop()
	fs.rmSync(root, { recursive: true, force: true })
})

test('a patch from the IDE: its schema.patch, with who, before, after and the diff', async () => {
	const at = ['domain', 'entities', 'Products', 'properties', 'name']
	const read = (await call(base, schemaUrl, { headers: MODELER })).body
	const current = parse(read.text).domain.entities.find((e: any) => e.name === 'Products').properties.find((p: any) => p.name === 'name')
	const changed = await call(base, schemaUrl, { method: 'PATCH', body: { op: 'set', at, value: { ...current, length: 120 }, expected: current }, headers: MODELER })
	expect(changed.status).toBe(200)
	const history = await call(base, historyUrl, { headers: MODELER })
	expect(history.status).toBe(200)
	const [change] = history.body.items
	expect(change).toMatchObject({
		kind: 'schema.patch',
		schema: 'iot/v1',
		target: 'domain/entities/Products/properties/name',
		op: 'set',
		before: current,
		after: { ...current, length: 120 },
		result: 'ok',
		actor: { credential: 'modeler', client: 'data-gateway-ide 2.1.0', session: expect.any(String), ip: expect.stringMatching(/127\.0\.0\.1/) }
	})
	expect(change.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
	expect(change.diff).toEqual([{ op: current.length === undefined ? 'add' : 'replace', path: expect.stringMatching(/^\/domain\/entities\/\d+\/properties\/\d+\/length$/), value: 120 }])
	expect(change.version.before).toBe(read.version.slice(0, 16))
	expect(change.version.after).toBe(changed.body.version.slice(0, 16))
	// a form that still has the element as it was: 412, saying who changed it
	const stale = await call(base, schemaUrl, { method: 'PATCH', body: { op: 'set', at, value: { ...current, length: 10 }, expected: current }, headers: MODELER })
	expect(stale.status).toBe(412)
	expect(JSON.stringify(stale.body)).toContain('"changedBy"')
	expect(stale.body.details?.changedBy ?? stale.body.changedBy).toMatchObject({ credential: 'modeler', client: 'data-gateway-ide 2.1.0', kind: 'schema.patch', target: at.join('/'), time: change.time })
	// λORM will not take it for a change from outside
	expect(fs.readFileSync(path.join(root, 'iot/v1/logs/schema.hash'), 'utf8')).toBe(change.version.after)
})

test('filters, pages and permissions', async () => {
	expect((await call(base, `${historyUrl}?kind=schema.write`, { headers: MODELER })).body).toEqual({ items: [] })
	expect((await call(base, `${historyUrl}?limit=0`, { headers: MODELER })).status).toBe(400)
	expect((await call(base, historyUrl, { headers: READER })).status).toBe(403)
})
