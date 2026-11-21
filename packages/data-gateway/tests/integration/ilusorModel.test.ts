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
import { LambdaOrmAdapter } from '../../src/lib/infrastructure/output/orm/lambdaOrmAdapter'

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

	// what a model reads to write a query over a large schema (L42): small, and enough to find the names
	const tool = async (name: string, args: Record<string, unknown> = {}): Promise<any> => JSON.parse((await mcp.callTool({ name, arguments: args }) as any).content[0].text)

	test('MCP: orm_execute describes a large domain by its names and points to schema_search / schema_describe', async () => {
		const { tools } = await mcp.listTools()
		const execute = tools.find(t => t.name === 'orm_execute')!
		expect(execute.description).toMatch(/Domain: \d+ entities, too many to describe here/)
		expect(execute.description).toContain('Areas, ')
		expect(execute.description!.length).toBeLessThan(15000)
		expect(JSON.stringify(tools).length).toBeLessThan(30000)
	})

	test('MCP: schema_search finds properties and relations by part of their name, compact', async () => {
		const result = await tool('schema_search', { text: 'Areas.type' })
		expect(result.matches).toEqual(expect.arrayContaining(['Areas.areaTypeId: text', 'Areas.areaType → AreaTypes']))
		const all = await tool('schema_search', { text: 'threshold' })
		expect(all.matches.length).toBeGreaterThan(5)
		expect(JSON.stringify(all).length).toBeLessThan(12000)
		expect(await tool('schema_search', { text: 'Aeras' })).toMatchObject({ matches: [], didYouMean: expect.arrayContaining(['Areas']) })
	})

	test('MCP: schema_describe gives some entities in two lines each, and the names it doesn\'t know apart', async () => {
		const result = await tool('schema_describe', { entities: ['Areas', 'Devices', 'Area'] })
		expect(result.entities).toHaveLength(2)
		expect(result.entities[0]).toMatch(/^- Areas: code: text \(pk\); [^\n]*\n {2}relations: .*areaType → AreaTypes/)
		expect(result.notFound).toEqual([{ name: 'Area', didYouMean: ['Areas'] }])
		expect(JSON.stringify(result).length).toBeLessThan(5000)
	})

	test('REST: /search and /describe answer what schema_search and schema_describe do', async () => {
		const search = await call(base, '/search?q=Areas.type', { headers: key })
		expect(search.status).toBe(200)
		expect(search.body.matches).toEqual(expect.arrayContaining(['Areas.areaType → AreaTypes']))
		const describe = await call(base, '/describe?entities=Areas,Area', { headers: key })
		expect(describe.body).toMatchObject({ entities: [expect.stringMatching(/^- Areas: /)], notFound: [{ name: 'Area', didYouMean: ['Areas'] }] })
		expect((await call(base, '/search', { headers: key })).status).toBe(400)
		expect((await call(base, '/search?q=Areas', { headers: { 'X-Api-Key': 'wrong' } })).status).toBe(401)
	})

	test('REST: a route that does not exist is a 404 in JSON with the closest routes', async () => {
		const answer = await call(base, '/schema/entities', { headers: key })
		expect(answer.status).toBe(404)
		expect(answer.body).toEqual({ error: 'NotFoundError', message: expect.stringMatching(/^GET \/schema\/entities is not a route of this gateway; did you mean .*GET \/entities/) })
		expect((await call(base, '/nothing/here/at/all/really', { headers: key })).body.message).toMatch(/the schemas are at \/schemas/)
	})

	test('MCP: the same error, with its status', async () => {
		const result: any = await mcp.callTool({ name: 'orm_plan', arguments: { query: 'Areas.map(p => p.nam)' } })
		expect(result.isError).toBe(true)
		expect(result.structuredContent).toMatchObject({ status: 400 })
		expect(result.content[0].text).toContain('did you mean name?')
	})
})

describe('a connection whose variable is not set', () => {
	test('checking the connections at start names the variable and where to give it (L43)', async () => {
		const saved = { ...process.env }
		for (const name of CONNECTIONS) process.env[name] = unreachable(name)
		delete process.env.ORM_SALES_DOCUMENTS_CNX
		const orm = new LambdaOrmAdapter()
		try {
			await orm.init(WORKSPACE)
			await expect(orm.checkConnections(2000)).rejects.toThrow(
				'source salesDocuments needs ORM_SALES_DOCUMENTS_CNX, which is not set: give it in orm.schemas[].env of data-gateway.config.yaml')
			delete process.env.ORM_IAM_CNX
			const other = new LambdaOrmAdapter()
			await other.init(WORKSPACE)
			await expect(other.checkConnections(2000)).rejects.toThrow('sources iam, salesDocuments need ORM_IAM_CNX, ORM_SALES_DOCUMENTS_CNX, which are not set: give them in')
			await other.end()
		} finally {
			await orm.end()
			process.env = saved
		}
	})
})
