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
import ts from 'typescript'
import { Orm } from '@lambdaorm/client'
import { call, freePort } from '../helpers/net'
import { globalQueryableDeclarations } from '../helpers/queryableDeclarations'

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
	let wsPort: number

	beforeAll(async () => {
		const port = await freePort()
		mcpPort = await freePort()
		wsPort = await freePort()
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
  webSocket:
    port: $WS_PORT
    host: 127.0.0.1
`)
		const env = { WORKSPACE, PORT: String(port), MCP_PORT: String(mcpPort), WS_PORT: String(wsPort), AGENT_KEY: 'agent-key' }
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

	test('typings: the domain as declarations that compile with Queryable, and catch a wrong property', async () => {
		const res = await fetch(`${base}/typings`, { headers: { 'X-Api-Key': 'agent-key' } })
		expect(res.headers.get('content-type')).toMatch(/text\/plain/)
		const typings = await res.text()
		expect(typings).toMatch(/interface QryOrder \{[^}]*details: ManyToOne<QryOrdersDetail>/)
		expect(typings).toMatch(/declare const Orders: Queryable<QryOrder> & \{ details: Queryable<QryOrdersDetail> \}/)
		const diagnostics = (query: string) => {
			const files: Record<string, string> = { 'queryable.d.ts': globalQueryableDeclarations(), 'typings.d.ts': typings, 'query.ts': `const q = ${query}\n` }
			const host = ts.createCompilerHost({})
			const read = host.getSourceFile
			host.getSourceFile = (name, version) => files[name] !== undefined ? ts.createSourceFile(name, files[name], version) : read(name, version)
			const program = ts.createProgram(Object.keys(files), { noEmit: true, strict: false, target: ts.ScriptTarget.ES2020, lib: ['lib.es2020.d.ts'], types: [] }, host)
			return ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
		}
		expect(diagnostics('Orders.filter(p => p.customer.name == \'x\').include(p => p.details.include(d => d.product)).page(1, 10)')).toEqual([])
		expect(diagnostics('Products.map(p => ({ category: p.category.name, n: count(1) })).sort(p => desc(p.n))')).toEqual([])
		expect(diagnostics('Orders.details.filter(p => p.quantity > 1)')).toEqual([])
		expect(diagnostics('Orders.filter(p => p.nope == 1)')).toEqual([expect.stringMatching(/Property 'nope' does not exist on type 'QryOrder'/)])
	})

	test('whoami: the credential and what the schema offers; typings need read', async () => {
		expect((await call(base, '/whoami', { headers: { 'X-Api-Key': 'agent-key' } })).body).toEqual({ name: 'agent', permissions: ['read'], schema: '', scripts: false })
		expect((await call(base, '/whoami')).status).toBe(401)
	})

	test('@lambdaorm/client by REST and by WebSocket answers the same (real λORM)', async () => {
		const rest = new Orm()
		const ws = new Orm()
		await rest.init(base, { headers: { 'X-Api-Key': 'agent-key' } })
		await ws.init(`ws://127.0.0.1:${wsPort}`, { headers: { 'X-Api-Key': 'agent-key' } })
		try {
			const query = 'Orders.filter(p => p.customerId == id).include(p => p.details)'
			expect(await ws.plan(query, undefined)).toEqual(await rest.plan(query, undefined))
			expect(await ws.metadata(query)).toEqual(await rest.metadata(query))
			expect(await ws.parameters(query)).toEqual(await rest.parameters(query))
			expect((await ws.schema.entities()).map(e => e.name)).toEqual((await rest.schema.entities()).map(e => e.name))
			expect(await ws.schema.entity('Nope')).toBeUndefined()
			expect((await ws.general.version()).version).toBe((await rest.general.version()).version)
			await expect(ws.execute('Products.delete().filter(p => p.id == 1)', {})).rejects.toMatchObject({ name: 'ForbiddenError', status: 403, rpcCode: -32000 })
			await expect(new Orm().init(`ws://127.0.0.1:${wsPort}`, { headers: { 'X-Api-Key': 'wrong' } })).rejects.toThrow()
			expect(() => rest.on('queue.completed', () => undefined)).toThrow(/WebSocket/)
		} finally {
			await ws.end()
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
