// A large real model (Ilusor's Cloud: 192 entities in 16 sources, relations of several fields) on the whole gateway,
// without its databases: the schema, plan and the errors of a query a person or an LLM makes by hand (L41). Copy of
// ~/ilusor/dev/cloud/data-gateway/workspace/lambdaORM.yaml in tests/fixtures/ilusor (only the model; its connections
// are variables, given here unreachable).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { startGateway } from '../../src/lib/infrastructure/build/main'
import { RunningGateway } from '../../src/lib/infrastructure/build/dataGatewayBuilder'
import { YamlFileConfigSource } from '../../src/lib/infrastructure/output/config/yamlFileConfigSource'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { call, freePort } from '../helpers/net'

const WORKSPACE = path.join(__dirname, '../fixtures/ilusor')
const MODEL = fs.readFileSync(path.join(WORKSPACE, 'lambdaORM.yaml'), 'utf8')
// every connection of the model, unreachable: nothing here connects
const CONNECTIONS = [...new Set(MODEL.match(/\$\{(ORM_[A-Z_]+)\}/g)!.map(p => p.slice(2, -1)))]
const unreachable = (name: string) => name.includes('DOCUMENTS')
	? JSON.stringify({ url: 'mongodb://127.0.0.1:1/x' })
	: JSON.stringify({ host: '127.0.0.1', port: 1, user: 'x', password: 'x', database: 'x' })

describe('Ilusor\'s model on the gateway', () => {
	let gateway: RunningGateway
	let base: string
	let mcp: Client
	const key = { 'X-Api-Key': 'reader-key' }

	beforeAll(async () => {
		const [port, mcpPort] = [await freePort(), await freePort()]
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-'))
		const file = path.join(dir, 'data-gateway.config.yaml')
		fs.writeFileSync(file, `
orm:
  workspacePath: $WORKSPACE
  schemas:
    - path: ''
      env:
${CONNECTIONS.map(name => `        ${name}: '${unreachable(name)}'`).join('\n')}
runtime: { checkConnections: false }
logger: { level: error }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: reader, value: reader-key, permissions: [ read ] }
rateLimit: { max: 0 }
transports:
  http: { port: $PORT, host: 127.0.0.1 }
  mcpHttp: { port: $MCP_PORT, host: 127.0.0.1, legacySse: false }
`)
		gateway = await startGateway({ source: new YamlFileConfigSource(file, { WORKSPACE, PORT: String(port), MCP_PORT: String(mcpPort) }), bootLogger: new ConsoleLogger('error') })
		base = `http://127.0.0.1:${port}`
		mcp = new Client({ name: 'test', version: '1.0.0' })
		await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: key } }))
	}, 60000)
	afterAll(async () => { await mcp?.close(); await gateway?.stop() })

	test('the schema and a plan over a relation of several fields', async () => {
		const entities = await call(base, '/entities', { headers: key })
		expect(entities.status).toBe(200)
		expect(entities.body.length).toBeGreaterThan(150)
		const plan = await call(base, '/plan', { body: { query: 'Devices.filter(p => p.area.name == "Living").map(p => p.id)' }, headers: key })
		expect(plan.status).toBe(200)
		expect(plan.body.sentence).toMatch(/location_id/)
	})

	test.each([
		['Area.map(p => p.name)', 'entity Area not found; did you mean Areas?'],
		['Areas.map(p => p.nam)', 'nam is neither a property nor a relation of Areas; did you mean name?'],
		['Areas.map(p => p.areaType.nme)', 'did you mean name?'],
		['Areas.include(p => p.zone)', 'relation zone not found in Areas; did you mean zoneVertices?'],
		['Areas.map(p => count(p.id))', 'the key of Areas is locationId, code'],
		['Areas.foo()', 'function: foo not found']
	])('REST: %s is 400 and says %s', async (query, message) => {
		const answer = await call(base, '/plan', { body: { query }, headers: key })
		expect(answer.status).toBe(400)
		expect(answer.body.message).toContain(message)
	})

	test('MCP: the same error, with its status', async () => {
		const result: any = await mcp.callTool({ name: 'orm_plan', arguments: { query: 'Areas.map(p => p.nam)' } })
		expect(result.isError).toBe(true)
		expect(result.structuredContent).toMatchObject({ status: 400 })
		expect(result.content[0].text).toContain('did you mean name?')
	})
})
