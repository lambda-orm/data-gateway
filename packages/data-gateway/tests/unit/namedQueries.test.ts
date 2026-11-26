// The queries of application.queries (docs/NAMED_QUERIES.md): listed with their parameters and model (never their
// text) in the view of who calls, run by their name with the permissions and the audit of execute, within their
// limits; as MCP tools query_<name>.
import { ctx, fakeGateway } from '../helpers/fakes'
import { DataGatewayMcpServer } from '../../src/lib/application/mcp/dataGatewayMcpServer'
import { ToolCatalog } from '../../src/lib/application/mcp/toolCatalog'
import { gatewayTools } from '../../src/lib/application/mcp/gatewayTools'
import { curatedTools, namedQueryTools } from '../../src/lib/application/mcp/namedQueryTools'

const QUERIES = [
	{ name: 'productById', description: 'a product by its id', query: 'Products.filter(p => p.id == id)' },
	{ name: 'renameProduct', query: 'Products.update(p => ({ name: name })).filter(p => p.id == id)' }
]

const setup = (limits: Record<string, { maxRows?: number, timeoutMs?: number }> = {}) => {
	const fixture = fakeGateway({ queryLimits: limits })
	fixture.orm.named = QUERIES
	return fixture
}

describe('named queries', () => {
	test('listed with their parameters, their model and whether they write; never their text', async () => {
		const { gateway } = setup()
		const list = await gateway.queries(ctx(['read']))
		expect(list).toEqual([
			{ name: 'productById', description: 'a product by its id', parameters: [{ name: 'id', type: 'integer' }], model: [{ name: 'id', type: 'integer' }], writes: false, reads: ['Products'] },
			{ name: 'renameProduct', parameters: [{ name: 'id', type: 'integer' }], model: [{ name: 'id', type: 'integer' }], writes: true, reads: ['Products'] }
		])
		expect(JSON.stringify(list)).not.toContain('Products.filter')
	})

	test('run by their name, as execute: its permissions, its audit with the name; an unknown one is 404', async () => {
		const { gateway, orm, audit } = setup()
		expect(await gateway.query(ctx(['read']), 'productById', { data: { id: 1 } })).toEqual([{ id: 1 }])
		expect(orm.executed.at(-1)).toMatchObject({ query: 'Products.filter(p => p.id == id)', data: { id: 1 } })
		await expect(gateway.query(ctx(['read']), 'renameProduct', { data: { id: 1, name: 'x' } })).rejects.toMatchObject({ status: 403 })
		await gateway.query(ctx(['read', 'write']), 'renameProduct', { data: { id: 1, name: 'x' } })
		expect(audit.entries.at(-1)).toMatchObject({ operation: 'execute', name: 'renameProduct', actions: ['update'] })
		await expect(gateway.query(ctx(['read']), 'nope', {})).rejects.toMatchObject({ status: 404, message: expect.stringContaining('query nope not found') })
	})

	test('within their limits: more rows than its maxRows is 422; longer than its timeout, 504', async () => {
		const { gateway, orm } = setup({ productById: { maxRows: 2 }, renameProduct: { timeoutMs: 20 } })
		orm.executeResult = [{ id: 1 }, { id: 2 }, { id: 3 }]
		await expect(gateway.query(ctx(['read']), 'productById', { data: { id: 1 } })).rejects.toMatchObject({ status: 422, name: 'TooManyRowsError' })
		orm.executeResult = 1
		orm.executeDelayMs = 100
		await expect(gateway.query(ctx(['read', 'write']), 'renameProduct', { data: { id: 1 } })).rejects.toMatchObject({ status: 504, message: expect.stringContaining('its timeout') })
	})

	test('one that uses what the view of who calls excludes is not listed to it', async () => {
		const { gateway, orm } = setup()
		const parameters = orm.parameters.bind(orm)
		orm.parameters = async (query: string, options?: any) => {
			if (options?.view === 'support' && query.includes('update')) throw Object.assign(new Error('excluded'), { name: 'ViewError' })
			return parameters(query, options)
		}
		;(orm as any).views = () => ['default', 'support']
		// the resolver of the fixture has no views: a principal with a view needs one that has them
		const { QueryUseCases } = await import('../../src/lib/application/usecases/queryUseCases')
		const { NamedQueryUseCases } = await import('../../src/lib/application/usecases/namedQueryUseCases')
		const { ViewResolver } = await import('../../src/lib/application/usecases/viewResolver')
		const { Auditor } = await import('../../src/lib/application/usecases/auditor')
		const queries = new QueryUseCases(orm, new Auditor({ write: () => undefined }, { now: () => new Date(), uptimeSeconds: () => 1 }, '', { enabled: false, includeData: false }), new ViewResolver(() => ['default', 'support']))
		const named = new NamedQueryUseCases(orm, queries)
		const support = { principal: { ...ctx(['read', 'write']).principal, view: 'support' }, transport: 'http' }
		expect((await named.list(support)).map(q => q.name)).toEqual(['productById'])
		expect((await named.list(ctx(['read', 'write']))).map(q => q.name)).toEqual(['productById', 'renameProduct'])
	})

	test('MCP: each one is a tool query_<name> with its parameters typed; a write only to who writes', async () => {
		const { gateway, orm } = setup()
		const mcp = new DataGatewayMcpServer(new ToolCatalog(gatewayTools(gateway)), orm, { name: 'shop', version: '1', pageSize: 100, maxRows: 50 }, undefined, namedQueryTools(gateway))
		const reader = (await mcp.listTools(ctx(['read']))).items
		const tool = reader.find(t => t.name === 'query_productById')!
		expect(tool).toMatchObject({ description: 'a product by its id Returns rows with: id: integer.', inputSchema: { properties: { id: { type: 'integer' } } }, annotations: { readOnlyHint: true } })
		expect(reader.map(t => t.name)).not.toContain('query_renameProduct')
		expect((await mcp.listTools(ctx(['read', 'write']))).items.map(t => t.name)).toContain('query_renameProduct')
		const result = await mcp.callTool(ctx(['read']), 'query_productById', { id: 1 })
		expect(result).toMatchObject({ isError: false, content: [{ text: '[{"id":1}]' }] })
		expect(orm.executed.at(-1)).toMatchObject({ query: 'Products.filter(p => p.id == id)', data: { id: 1 } })
		// mcp.tools.exclude takes them too
		const filtered = new DataGatewayMcpServer(new ToolCatalog(gatewayTools(gateway), { include: [], exclude: ['query_productById'] }), orm, { name: 'shop', version: '1', pageSize: 100, maxRows: 50 }, undefined, namedQueryTools(gateway))
		expect((await filtered.listTools(ctx(['read']))).items.map(t => t.name)).not.toContain('query_productById')
	})

	test('mcp.freeQueries false: an agent only with the named queries and the tools of the schema', async () => {
		const { gateway, orm } = setup()
		const mcp = new DataGatewayMcpServer(new ToolCatalog(curatedTools(gatewayTools(gateway), false)), orm, { name: 'shop', version: '1', pageSize: 100, maxRows: 50 }, undefined, namedQueryTools(gateway))
		const names = (await mcp.listTools(ctx(['read', 'write', 'script', 'queue']))).items.map(t => t.name)
		expect(names).toEqual(expect.arrayContaining(['query_productById', 'query_renameProduct', 'schema_domain']))
		for (const free of ['orm_execute', 'orm_execute_script', 'orm_execute_queued', 'orm_plan']) expect(names).not.toContain(free)
		expect(curatedTools(gatewayTools(gateway), true).map(t => t.name)).toContain('orm_execute')
	})
})

describe('the configuration of named queries', () => {
	test('their limits by schema, and freeQueries by schema', () => {
		const { ConfigReader } = require('../../src/lib/domain/config/configReader')
		const reading = new ConfigReader().read({
			orm: { schemas: [{ path: 'shop', workspace: '/tmp/shop', mcp: { freeQueries: false }, queries: { deviceWithType: { maxRows: 100, timeout: '5s' } } }] },
			transports: { http: { port: 9291 } }
		})
		expect(reading.issues).toEqual([])
		expect(reading.config.orm.schemas[0]).toMatchObject({ mcp: { freeQueries: false }, queries: { deviceWithType: { maxRows: 100, timeoutMs: 5000 } } })
		const bad = new ConfigReader().read({ orm: { schemas: [{ path: 'shop', workspace: '/tmp/shop', queries: { x: 3 } }] }, transports: { http: { port: 9291 } } })
		expect(bad.issues.join()).toContain('queries.x must be { maxRows, timeout }')
	})
})
