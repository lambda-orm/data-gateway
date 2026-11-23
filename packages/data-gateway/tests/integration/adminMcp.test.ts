// The administration over MCP, read only (docs/DATA_GATEWAY_ADMIN_PLAN.md phase 6): an agent with schemaRead reads the
// lambdaORM.yaml and validates a change; one without it doesn't see the tools; with admin off they don't exist.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startGateway } from '../../src/lib/infrastructure/build/main'
import { RunningGateway } from '../../src/lib/infrastructure/build/dataGatewayBuilder'
import { YamlFileConfigSource } from '../../src/lib/infrastructure/output/config/yamlFileConfigSource'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { freePort } from '../helpers/net'

const NORTHWIND = fs.readFileSync(path.join(__dirname, '../fixtures/northwind/lambdaORM.yaml'), 'utf8')

const start = async (admin: boolean): Promise<{ gateway: RunningGateway, url: string }> => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-admin-mcp-'))
	fs.mkdirSync(path.join(root, 'shop'))
	fs.writeFileSync(path.join(root, 'shop/lambdaORM.yaml'), NORTHWIND)
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
    - { name: admin, value: admin-key, permissions: [ read, schemaRead ] }
    - { name: reader, value: reader-key, permissions: [ read ] }
transports:
  mcpHttp: { port: ${port}, host: 127.0.0.1, legacySse: false }
${admin ? `  management: { port: ${await freePort()}, host: 127.0.0.1 }` : ''}
`)
	const gateway = await startGateway({ source: new YamlFileConfigSource(file, {}), bootLogger: new ConsoleLogger('error') })
	return { gateway, url: `http://127.0.0.1:${port}/shop/mcp` }
}

const client = async (url: string, key: string) => {
	const c = new Client({ name: 'test', version: '1.0.0' })
	await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { 'X-Api-Key': key } } }))
	return c
}
const text = (result: any) => JSON.parse(result.content[0].text)

describe('the administration over MCP (read only)', () => {
	let running: { gateway: RunningGateway, url: string }
	beforeAll(async () => { running = await start(true) }, 60000)
	afterAll(() => running?.gateway.stop())

	test('with schemaRead: the lambdaORM.yaml as written, and a change validated without saving it', async () => {
		const mcp = await client(running.url, 'admin-key')
		try {
			const names = (await mcp.listTools()).tools.map(t => t.name)
			expect(names).toEqual(expect.arrayContaining(['admin_schema_get', 'admin_schema_validate', 'admin_stage_fetch']))
			const tool = (await mcp.listTools()).tools.find(t => t.name === 'admin_schema_get')!
			expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
			const read = text(await mcp.callTool({ name: 'admin_schema_get', arguments: {} }))
			expect(read).toEqual({ text: NORTHWIND, version: expect.any(String) })
			const checked = text(await mcp.callTool({ name: 'admin_schema_validate', arguments: { text: 'domain:\n  entities:\n    - name: A\n      properties:\n        - name: id\n        - name: id\n' } }))
			expect(checked).toMatchObject({ valid: false, issues: [expect.objectContaining({ message: 'A.properties: "id" twice' })] })
		} finally { await mcp.close() }
	})

	test('without schemaRead the tools are not listed, nor can they be called', async () => {
		const mcp = await client(running.url, 'reader-key')
		try {
			expect((await mcp.listTools()).tools.map(t => t.name).filter(n => n.startsWith('admin_'))).toEqual([])
			await expect(mcp.callTool({ name: 'admin_schema_get', arguments: {} })).rejects.toThrow()
		} finally { await mcp.close() }
	})
})

describe('admin off', () => {
	test('there are no administration tools', async () => {
		const running = await start(false)
		const mcp = await client(running.url, 'admin-key')
		try {
			expect((await mcp.listTools()).tools.map(t => t.name).filter(n => n.startsWith('admin_'))).toEqual([])
		} finally {
			await mcp.close()
			await running.gateway.stop()
		}
	}, 60000)
})
