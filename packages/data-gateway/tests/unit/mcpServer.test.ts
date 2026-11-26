// The MCP server of a schema over the real facade with fake λORM ports: catalog per credential, results, errors.
import { DataGatewayMcpServer } from '../../src/lib/application/mcp/dataGatewayMcpServer'
import { describeDomain, describeEntities, searchDomain } from '../../src/lib/application/mcp/domainDescription'
import { gatewayTools } from '../../src/lib/application/mcp/gatewayTools'
import { ToolCatalog, ToolFilter } from '../../src/lib/application/mcp/toolCatalog'
import { TOOL_NAMES } from '../../src/lib/domain/config/configReader'

/** The tools of a schema without the administration (admin off) */
const GATEWAY_TOOLS = TOOL_NAMES.filter(name => !name.startsWith('admin_'))
import { ALL, ctx, fakeGateway } from '../helpers/fakes'

const server = (options: { filter?: ToolFilter, maxRows?: number, pageSize?: number } = {}) => {
	const fixture = fakeGateway()
	const mcp = new DataGatewayMcpServer(new ToolCatalog(gatewayTools(fixture.gateway), options.filter), fixture.orm, {
		name: 'test', version: '9.9.9', pageSize: options.pageSize ?? 100, maxRows: options.maxRows ?? 500
	})
	return { ...fixture, mcp }
}

const names = async (mcp: DataGatewayMcpServer, permissions: any[]) => (await mcp.listTools(ctx(permissions))).items.map(t => t.name)

describe('tool catalog', () => {
	test('every tool of the design, in its order', async () => {
		expect(await names(server().mcp, ALL)).toEqual(GATEWAY_TOOLS)
	})

	test('a credential sees only what it can use', async () => {
		const { mcp } = server()
		const read = await names(mcp, ['read'])
		expect(read).toContain('orm_execute')
		expect(read).not.toEqual(expect.arrayContaining(['orm_execute_script']))
		expect(read.filter(n => ['orm_execute_script', 'orm_execute_queued', 'stage_import'].includes(n))).toEqual([])
		// approval_status: who may write may wait (docs/MUTATION_APPROVAL.md)
		expect(await names(mcp, ['script'])).toEqual(['orm_execute_script', 'approval_status'])
		expect(await names(mcp, ['write'])).toEqual(['orm_execute', 'approval_status'])
	})

	test('orm_execute: read only description and annotations without write; destructive with it', async () => {
		const { mcp } = server()
		const readOnly = (await mcp.listTools(ctx(['read']))).items.find(t => t.name === 'orm_execute')!
		expect(readOnly.description).toMatch(/can only read/)
		expect(readOnly.description).toMatch(/Domain \(entities.*\n- Products: /)
		expect(readOnly.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
		const writer = (await mcp.listTools(ctx(['read', 'write']))).items.find(t => t.name === 'orm_execute')!
		expect(writer.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
		expect(writer.description).toMatch(/insert\(\)/)
		expect(writer.inputSchema).toMatchObject({ type: 'object', required: ['query'], additionalProperties: false })
	})

	test('mcp.tools include / exclude', async () => {
		expect(await names(server({ filter: { include: ['orm_execute', 'orm_plan'], exclude: [] } }).mcp, ALL)).toEqual(['orm_execute', 'orm_plan'])
		expect(await names(server({ filter: { include: [], exclude: ['orm_execute_script'] } }).mcp, ALL)).not.toContain('orm_execute_script')
	})

	test('pagination with an opaque cursor', async () => {
		const { mcp } = server({ pageSize: 10 })
		const first = await mcp.listTools(ctx(ALL))
		expect(first.items).toHaveLength(10)
		const second = await mcp.listTools(ctx(ALL), first.nextCursor)
		const third = await mcp.listTools(ctx(ALL), second.nextCursor)
		expect([...first.items, ...second.items, ...third.items].map(t => t.name)).toEqual(GATEWAY_TOOLS)
		expect(third.nextCursor).toBeUndefined()
		await expect(mcp.listTools(ctx(ALL), 'garbage')).rejects.toMatchObject({ name: 'McpRequestError' })
	})
})

describe('tools/call', () => {
	test('a query: rows as JSON text', async () => {
		const { mcp, orm } = server()
		const result = await mcp.callTool(ctx(['read']), 'orm_execute', { query: 'Products.filter(p => p.id == id)', data: { id: 1 } })
		expect(result).toEqual({ content: [{ type: 'text', text: '[{"id":1}]' }], isError: false })
		expect(orm.executed[0]).toMatchObject({ query: 'Products.filter(p => p.id == id)', data: { id: 1 } })
	})

	test('an object result also goes as structuredContent', async () => {
		const result = await server().mcp.callTool(ctx(['read']), 'orm_plan', { query: 'Products' })
		expect(result.structuredContent).toMatchObject({ entity: 'Products', dialect: 'PostgreSQL' })
	})

	test('a write with a read credential: isError for the model, nothing executed, audited nowhere', async () => {
		const { mcp, orm, audit } = server()
		const result = await mcp.callTool(ctx(['read']), 'orm_execute', { query: 'Products.insert()', data: { name: 'x' } })
		const message = 'the credential "tester" does not have the "write" permission'
		expect(result).toEqual({
			content: [{ type: 'text', text: `ForbiddenError: ${message}` }],
			structuredContent: { error: 'ForbiddenError', status: 403, message },
			isError: true
		})
		expect(orm.executed).toHaveLength(0)
		expect(audit.entries).toHaveLength(0)
	})

	test('a write with write runs and is audited with the transport', async () => {
		const { mcp, audit } = server()
		const result = await mcp.callTool(ctx(['read', 'write'], 'agent', 'mcpHttp'), 'orm_execute', { query: 'Products.insert()', data: { name: 'x' } })
		expect(result.isError).toBe(false)
		expect(audit.entries[0]).toMatchObject({ credential: 'agent', transport: 'mcpHttp', operation: 'execute', actions: ['insert'] })
	})

	test('an error of λORM: isError with its name and message, and the status REST would answer', async () => {
		const { mcp, orm } = server()
		const error = new Error('Products.nope not found')
		error.name = 'SchemaError'
		orm.executeResult = error
		expect(await mcp.callTool(ctx(['read']), 'orm_execute', { query: 'Products.map(p => p.nope)' }))
			.toEqual({
				content: [{ type: 'text', text: 'SchemaError: Products.nope not found' }],
				structuredContent: { error: 'SchemaError', status: 400, message: 'Products.nope not found' },
				isError: true
			})
	})

	test('an error of the database: structuredContent keeps its code (unique, foreign key) for a program', async () => {
		const { mcp, orm } = server()
		const error: any = new Error('duplicate key value violates unique constraint')
		error.name = 'ExecutionError'
		error.code = '23505'
		orm.executeResult = error
		const result = await mcp.callTool(ctx(['read', 'write']), 'orm_execute', { query: 'Products.insert()', data: { name: 'x' } })
		expect(result.isError).toBe(true)
		expect(result.structuredContent).toEqual({ error: 'ExecutionError', status: 409, code: '23505', message: error.message })
	})

	test('maxRows cuts and tells how to ask for less; 0 = no limit; only tools that return rows', async () => {
		const rows = Array.from({ length: 12 }, (_, id) => ({ id }))
		const limited = server({ maxRows: 5 })
		limited.orm.executeResult = rows
		const body = JSON.parse((await limited.mcp.callTool(ctx(['read']), 'orm_execute', { query: 'Products' })).content[0].text)
		expect(body).toMatchObject({ truncated: true, returned: 5, total: 12 })
		expect(body.rows).toEqual(rows.slice(0, 5))
		expect(body.hint).toMatch(/page\(1, 5\)/)
		const unlimited = server({ maxRows: 0 })
		unlimited.orm.executeResult = rows
		expect(JSON.parse((await unlimited.mcp.callTool(ctx(['read']), 'orm_execute', { query: 'Products' })).content[0].text)).toHaveLength(12)
	})

	test('unknown or invisible tool and invalid arguments: McpRequestError (JSON-RPC error, not isError)', async () => {
		const { mcp } = server()
		await expect(mcp.callTool(ctx(['read']), 'orm_nope', {})).rejects.toMatchObject({ name: 'McpRequestError', message: 'unknown tool "orm_nope"' })
		await expect(mcp.callTool(ctx(['read']), 'orm_execute_script', { script: '1' })).rejects.toMatchObject({ message: 'unknown tool "orm_execute_script"' })
		await expect(mcp.callTool(ctx(['read']), 'orm_execute', {})).rejects.toMatchObject({ message: 'orm_execute: "query" is required' })
		await expect(mcp.callTool(ctx(['read']), 'orm_execute', { query: 1, extra: true })).rejects
			.toMatchObject({ message: 'orm_execute: "query" must be string, not integer; "extra" is not an argument (valid: query, data, options)' })
		await expect(mcp.callTool(ctx(ALL), 'orm_execute_queued', { topic: 't', query: 'Products', chunk: 0 })).rejects.toMatchObject({ message: 'orm_execute_queued: "chunk" must be >= 1' })
	})

	test('schema tools with and without a name', async () => {
		const { mcp } = server()
		const text = async (name: string, args: Record<string, unknown> = {}) => JSON.parse((await mcp.callTool(ctx(['read']), name, args)).content[0].text)
		expect(await text('schema_entities')).toEqual([{ name: 'Products' }])
		expect(await text('schema_entities', { entity: 'Products' })).toEqual({ name: 'Products' })
		const missing = await mcp.callTool(ctx(['read']), 'schema_entities', { entity: 'Nope' })
		expect(missing).toMatchObject({ isError: true, structuredContent: { error: 'NotFoundError', status: 404, message: 'entity Nope not found' } })
		expect(await text('schema_mappings', { mapping: 'default' })).toEqual({ name: 'default' })
		expect(await text('gateway_version')).toEqual({ version: '9.9.9' })
		expect(await text('stage_exists', { stage: 'default' })).toEqual({ exists: true })
	})

	test('scripts and stage import with their permission', async () => {
		const { mcp, orm } = server()
		expect((await mcp.callTool(ctx(['script']), 'orm_execute_script', { script: 'x' })).content[0].text).toBe('7')
		expect((await mcp.callTool(ctx(['stageImport']), 'stage_import', { stage: 'default', data: { entities: [] } })).content[0].text).toBe('{"imported":true}')
		expect(orm.imported).toHaveLength(1)
	})
})

describe('resources', () => {
	test('list, templates and read', async () => {
		const { mcp } = server()
		expect((await mcp.listResources(ctx(['read']))).items.map(r => r.uri)).toEqual(['lambdaorm://schema/domain', 'lambdaorm://guide/expressions'])
		expect((await mcp.listResourceTemplates(ctx(['read'])))[0].uriTemplate).toBe('lambdaorm://entities/{entity}')
		expect((await mcp.readResource(ctx(['read']), 'lambdaorm://guide/expressions')).text).toMatch(/# λORM query language/)
		expect(JSON.parse((await mcp.readResource(ctx(['read']), 'lambdaorm://entities/Products')).text)).toEqual({ name: 'Products' })
		await expect(mcp.readResource(ctx(['read']), 'lambdaorm://entities/Nope')).rejects.toMatchObject({ name: 'McpRequestError' })
		await expect(mcp.readResource(ctx(['write']), 'lambdaorm://guide/expressions')).rejects.toMatchObject({ status: 403 })
	})
})

describe('domain description', () => {
	test('entities, properties, relations and enums; cut with a pointer', () => {
		const domain: any = {
			entities: [
				{ name: 'Base', abstract: true, properties: [{ name: 'x' }] },
				{
					name: 'Orders',
					primaryKey: ['id'],
					properties: [{ name: 'id', type: 'integer', required: true, autoIncrement: true }, { name: 'status', enum: 'Status', required: true }],
					// as λORM completes them: the list side is manyToOne
					relations: [{ name: 'details', type: 'manyToOne', entity: 'Orders.details' }, { name: 'customer', type: 'oneToMany', entity: 'Customers' }]
				}
			],
			enums: [{ name: 'Status', values: [{ name: 'open', value: 'O' }] }]
		}
		expect(describeDomain(domain)).toBe([
			'Domain (entities, properties: type, relations):',
			'- Orders: id: integer (pk, auto); status: string (required, enum Status)',
			'  relations: details → Orders.details[]; customer → Customers',
			'',
			'Enums:',
			'- Status: open="O"'
		].join('\n'))
		// too large: the names, and the tools that describe a part
		expect(describeDomain(domain, 150)).toBe('Domain: 1 entities, too many to describe here. Find what a question needs with ' +
			'schema_search { text } (entities, properties and relations by name) and read them with schema_describe ' +
			'{ entities: [...] } (properties and relations, compact) before writing the query.\nEntities: … (schema_search finds the rest)')
	})

	test('search: entities whole, properties and relations by part of their name, the closest when nothing contains it', () => {
		const domain: any = {
			entities: [
				{ name: 'Orders', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }, { name: 'customerId', type: 'string' }], relations: [{ name: 'customer', type: 'oneToMany', entity: 'Customers' }] },
				{ name: 'Customers', primaryKey: ['id'], properties: [{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }] }
			]
		}
		expect(searchDomain(domain, 'customer').matches).toEqual([
			'Orders.customerId: string', 'Orders.customer → Customers', '- Customers: id: string (pk); name: string'
		])
		expect(searchDomain(domain, 'Orders.id').matches).toEqual(['Orders.id: integer (pk)', 'Orders.customerId: string'])
		expect(searchDomain(domain, 'Ordrs')).toEqual({ matches: [], didYouMean: ['Orders'] })
		expect(searchDomain(domain, 'id', 2)).toMatchObject({ matches: ['Orders.id: integer (pk)', 'Orders.customerId: string'], more: 1 })
		expect(describeEntities(domain, ['Customers', 'Customer'])).toEqual({
			entities: ['- Customers: id: string (pk); name: string'], notFound: [{ name: 'Customer', didYouMean: ['Customers'] }]
		})
	})
})
