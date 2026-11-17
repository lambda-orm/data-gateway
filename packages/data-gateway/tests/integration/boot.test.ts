// The whole gateway from a configuration: real λORM (@lambdaorm/lib) on the northwind fixture, real http transport.
// The fixture's source is unreachable: plan, metadata, the schema and the authorization happen before connecting.
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

const WORKSPACE = path.join(__dirname, '../fixtures/northwind')

const writeConfig = (yaml: string): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-'))
	const file = path.join(dir, 'data-gateway.config.yaml')
	fs.writeFileSync(file, yaml)
	return file
}

describe('gateway from its configuration file', () => {
	let gateway: RunningGateway
	let base: string
	let mcpPort: number

	beforeAll(async () => {
		const port = await freePort()
		mcpPort = await freePort()
		const file = writeConfig(`
orm:
  workspacePath: $WORKSPACE
logger: { level: error }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: agent, value: $AGENT_KEY, permissions: [ read ] }
    - { name: backend, value: backend-key }
rateLimit: { max: 0 }
transports:
  http:
    port: $PORT
    host: 127.0.0.1
  mcpHttp:
    port: $MCP_PORT
    host: 127.0.0.1
    legacySse: false
`)
		const env = { WORKSPACE, PORT: String(port), MCP_PORT: String(mcpPort), AGENT_KEY: 'agent-key' }
		gateway = await startGateway({ source: new YamlFileConfigSource(file, env), bootLogger: new ConsoleLogger('error') })
		base = `http://127.0.0.1:${port}`
	})
	afterAll(() => gateway?.stop())

	test('answers with the schema of the workspace', async () => {
		expect((await call(base, '/ping')).status).toBe(200)
		const entities = await call(base, '/entities', { headers: { 'X-Api-Key': 'agent-key' } })
		expect(entities.status).toBe(200)
		expect(entities.body.map((e: any) => e.name)).toEqual(expect.arrayContaining(['Products', 'Orders', 'Customers']))
		expect((await call(base, '/entities', { headers: { 'X-Api-Key': 'wrong' } })).status).toBe(401)
	})

	test('plan and metadata with real λORM', async () => {
		const plan = await call(base, '/plan', { body: { query: 'Products.filter(p => p.price > 10)' }, headers: { 'X-Api-Key': 'agent-key' } })
		expect(plan.status).toBe(200)
		expect(plan.body).toMatchObject({ entity: 'Products', dialect: 'PostgreSQL', source: 'main' })
		const metadata = await call(base, '/metadata', { body: { query: 'Orders.insert().include(p => p.details)' }, headers: { 'X-Api-Key': 'agent-key' } })
		expect(metadata.body).toMatchObject({ classtype: 'Sentence', name: 'insert', entity: 'Orders' })
	})

	test('a read credential is refused a write before λORM connects (real metadata classification)', async () => {
		for (const query of ['Products.insert()', 'Products.delete().filter(p => p.id == 1)', 'Orders.insert().include(p => p.details)']) {
			const res = await call(base, '/execute', { body: { query, data: {} }, headers: { 'X-Api-Key': 'agent-key' } })
			expect([query, res.status, res.body.error]).toEqual([query, 403, 'ForbiddenError'])
		}
	})

	test('MCP over Streamable HTTP with the real domain in the description of orm_execute', async () => {
		const client = new Client({ name: 'boot', version: '1' })
		await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { 'X-Api-Key': 'agent-key' } } }))
		try {
			const execute = (await client.listTools()).tools.find(t => t.name === 'orm_execute')!
			expect(execute.description).toMatch(/- Customers: .*address: string.*\n {2}relations: orders → Orders\[\]/)
			expect(execute.description).toMatch(/- Orders\.details: orderId: integer \(pk\); productId: integer \(pk\).*\n {2}relations: order → Orders; product → Products$/)
			const plan = await client.callTool({ name: 'orm_plan', arguments: { query: 'Products.filter(p => p.price > 10)' } })
			expect((plan.content as any)[0].text).toMatch(/"dialect":"PostgreSQL"/)
			const denied = await client.callTool({ name: 'orm_execute', arguments: { query: 'Products.delete().filter(p => p.id == 1)' } })
			expect(denied.isError).toBe(true)
		} finally {
			await client.close()
		}
	})

	test('scripts are disabled by default', async () => {
		const res = await call(base, '/script', { body: { script: '1' }, headers: { 'X-Api-Key': 'backend-key' } })
		expect(res).toMatchObject({ status: 403, body: { error: 'ScriptDisabledError' } })
	})
})

describe('configuration problems stop the start', () => {
	test('missing file', async () => {
		await expect(startGateway({ source: new YamlFileConfigSource('/nope/data-gateway.config.yaml', {}), bootLogger: new ConsoleLogger('error') }))
			.rejects.toMatchObject({ name: 'ConfigError', issues: ['configuration file not found: /nope/data-gateway.config.yaml (mount it, or set DATA_GATEWAY_CONFIG_PATH)'] })
	})

	test('every problem is listed: a local credential whose variable is not defined, no transport', async () => {
		const file = writeConfig(`
orm: { workspacePath: ${WORKSPACE} }
authentication: { adapter: local, type: bearer, token: $SERVICE_TOKEN }
transports: { http: { port: $PORT } }
`)
		await expect(startGateway({ source: new YamlFileConfigSource(file, {}), bootLogger: new ConsoleLogger('error') }))
			.rejects.toMatchObject({
				name: 'ConfigError',
				issues: [
					'authentication: token is not defined (a local credential without its secret would leave the gateway open)',
					'no transport exposed: configure transports.<name>.port'
				]
			})
	})

	test('a workspace without lambdaORM.yaml', async () => {
		const port = await freePort()
		const file = writeConfig(`
orm: { workspacePath: ${fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'))} }
transports: { http: { port: ${port} } }
`)
		await expect(startGateway({ source: new YamlFileConfigSource(file, {}), bootLogger: new ConsoleLogger('error') }))
			.rejects.toMatchObject({ name: 'ConfigError' })
	})
})
