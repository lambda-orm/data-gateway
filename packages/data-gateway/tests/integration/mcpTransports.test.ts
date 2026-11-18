// The MCP transports over real sockets with the clients of the MCP SDK (Streamable HTTP, SSE) and a raw ws client,
// on the real facade, use cases and MCP server with fake λORM ports.
import WebSocket from 'ws'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { DataGatewayMcpServer } from '../../src/lib/application/mcp/dataGatewayMcpServer'
import { gatewayTools } from '../../src/lib/application/mcp/gatewayTools'
import { ToolCatalog } from '../../src/lib/application/mcp/toolCatalog'
import { McpHttpTransport } from '../../src/lib/infrastructure/input/mcp/mcpHttpTransport'
import { McpWebSocketTransport } from '../../src/lib/infrastructure/input/mcp/mcpWebSocketTransport'
import { BearerAuthenticator } from '../../src/lib/infrastructure/output/auth/authenticators'
import { NoMetrics } from '../../src/lib/infrastructure/output/metrics/promClientMetrics'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { fakeGateway, FixedClock, GatewayFixture } from '../helpers/fakes'
import { InlineSchemaDirectory } from '../../src/lib/application/runtime/inlineSchemaDirectory'
import { call } from '../helpers/net'

const credentials = [
	{ name: 'agent', value: 'agent-token', permissions: ['read' as const] },
	{ name: 'backend', value: 'backend-token', permissions: ['read' as const, 'write' as const, 'script' as const, 'queue' as const, 'stageImport' as const] }
]
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
const logger = new ConsoleLogger('error')

const mcpServer = (fixture: GatewayFixture) => new DataGatewayMcpServer(new ToolCatalog(gatewayTools(fixture.gateway)), fixture.orm, {
	name: 'northwind', version: '9.9.9', pageSize: 50, maxRows: 2
})

/** One schema at the root, on the MCP transports */
const directory = (fixture: GatewayFixture) => new InlineSchemaDirectory([{
	path: '',
	gateway: fixture.gateway,
	mcp: mcpServer(fixture),
	transports: ['mcpHttp', 'mcpWebSocket'],
	authenticators: { mcpHttp: new BearerAuthenticator(credentials), mcpWebSocket: new BearerAuthenticator(credentials) }
}], new FixedClock(), '9.9.9')

const startHttp = async (fixture: GatewayFixture, options: { stateful?: boolean, maxConnections?: number, basePath?: string } = {}) => {
	const transport = new McpHttpTransport({
		port: 0,
		host: '127.0.0.1',
		basePath: options.basePath ?? '',
		requestBodySize: '1mb',
		rateLimit: { windowMs: 1000, max: 0 },
		legacySse: true,
		stateful: options.stateful ?? false,
		maxConnections: options.maxConnections ?? 10
	}, { directory: directory(fixture), metrics: new NoMetrics(), logger })
	await transport.start()
	return { transport, base: `http://127.0.0.1:${transport.address!.port}${options.basePath ?? ''}` }
}

const connect = async (transport: StreamableHTTPClientTransport | SSEClientTransport): Promise<Client> => {
	const client = new Client({ name: 'test', version: '1.0.0' })
	await client.connect(transport)
	return client
}

const streamable = (base: string, token: string) => new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: bearer(token) } })

const text = (result: any): string => result.content[0].text

describe('mcpHttp: Streamable HTTP (stateless)', () => {
	let fixture: GatewayFixture
	let transport: McpHttpTransport
	let base: string

	beforeAll(async () => {
		fixture = fakeGateway()
		;({ transport, base } = await startHttp(fixture))
	})
	afterAll(() => transport.stop())

	test('initialize → tools/list (per credential) → tools/call', async () => {
		const agent = await connect(streamable(base, 'agent-token'))
		try {
			expect(agent.getServerVersion()).toEqual({ name: 'northwind', version: '9.9.9' })
			expect(agent.getInstructions()).toMatch(/lambdaorm:\/\/guide\/expressions/)
			const { tools } = await agent.listTools()
			const names = tools.map(t => t.name)
			expect(names).toContain('orm_execute')
			expect(names).not.toContain('orm_execute_script')
			const orm = tools.find(t => t.name === 'orm_execute')!
			expect(orm.annotations).toMatchObject({ readOnlyHint: true })
			expect(orm.description).toMatch(/Products/)
			const result = await agent.callTool({ name: 'orm_execute', arguments: { query: 'Products.filter(p => p.id == id)', data: { id: 1 } } })
			expect(result).toMatchObject({ isError: false, content: [{ type: 'text', text: '[{"id":1}]' }] })
		} finally {
			await agent.close()
		}
	})

	test('a write with a read credential: isError; with write: runs, audited as mcpHttp', async () => {
		const agent = await connect(streamable(base, 'agent-token'))
		const backend = await connect(streamable(base, 'backend-token'))
		try {
			const denied = await agent.callTool({ name: 'orm_execute', arguments: { query: 'Products.insert()', data: { name: 'x' } } })
			expect(denied.isError).toBe(true)
			expect(text(denied)).toMatch(/does not have the "write" permission/)
			expect((await backend.listTools()).tools.map(t => t.name)).toContain('orm_execute_script')
			const ok = await backend.callTool({ name: 'orm_execute', arguments: { query: 'Products.insert()', data: { name: 'x' } } })
			expect(ok.isError).toBe(false)
			expect(fixture.audit.entries.at(-1)).toMatchObject({ credential: 'backend', transport: 'mcpHttp', operation: 'execute' })
		} finally {
			await agent.close()
			await backend.close()
		}
	})

	test('maxRows cuts the rows; unknown tool and invalid arguments are JSON-RPC errors', async () => {
		fixture.orm.executeResult = [{ id: 1 }, { id: 2 }, { id: 3 }]
		const agent = await connect(streamable(base, 'agent-token'))
		try {
			const cut = JSON.parse(text(await agent.callTool({ name: 'orm_execute', arguments: { query: 'Products' } })))
			expect(cut).toMatchObject({ truncated: true, returned: 2, total: 3 })
			await expect(agent.callTool({ name: 'orm_execute_script', arguments: { script: '1' } })).rejects.toThrow(/unknown tool "orm_execute_script"/)
			await expect(agent.callTool({ name: 'orm_execute', arguments: {} })).rejects.toThrow(/"query" is required/)
		} finally {
			fixture.orm.executeResult = [{ id: 1 }]
			await agent.close()
		}
	})

	test('resources: guide and entity template', async () => {
		const agent = await connect(streamable(base, 'agent-token'))
		try {
			expect((await agent.listResources()).resources.map(r => r.uri)).toEqual(['lambdaorm://schema/domain', 'lambdaorm://guide/expressions'])
			expect((await agent.listResourceTemplates()).resourceTemplates[0].uriTemplate).toBe('lambdaorm://entities/{entity}')
			const guide = await agent.readResource({ uri: 'lambdaorm://guide/expressions' })
			expect(guide.contents[0]).toMatchObject({ mimeType: 'text/markdown' })
		} finally {
			await agent.close()
		}
	})

	test('without a credential 401; GET (stream) 405 when stateless; /status open', async () => {
		const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }
		const denied = await call(base, '/mcp', { body: init, headers: { accept: 'application/json, text/event-stream' } })
		expect(denied.status).toBe(401)
		expect(denied.body).toMatchObject({ jsonrpc: '2.0', error: { code: -32001 } })
		expect((await call(base, '/mcp', { headers: bearer('agent-token') })).status).toBe(405)
		expect((await call(base, '/status')).body).toMatchObject({ transport: 'mcpHttp', stateful: false, schemas: [{ path: '', mcp: '/mcp', sse: '/sse' }] })
	})
})

describe('mcpHttp: legacy SSE and stateful sessions', () => {
	test('the SSE client of the SDK: list and call; the session belongs to its credential', async () => {
		const fixture = fakeGateway()
		const { transport, base } = await startHttp(fixture)
		try {
			const sse = new SSEClientTransport(new URL(`${base}/sse`), { requestInit: { headers: bearer('agent-token') }, eventSourceInit: { fetch: (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as any), ...bearer('agent-token') } }) } })
			const client = await connect(sse)
			try {
				expect((await client.listTools()).tools.map(t => t.name)).toContain('orm_plan')
				expect(text(await client.callTool({ name: 'orm_plan', arguments: { query: 'Products' } }))).toMatch(/PostgreSQL/)
				expect(transport.status().sessions.sse).toBe(1)
				// another credential can't post to this session
				const sessionId = (sse as any)._endpoint.searchParams.get('sessionId')
				const stolen = await call(base, `/messages?sessionId=${sessionId}`, { body: { jsonrpc: '2.0', id: 9, method: 'tools/list' }, headers: bearer('backend-token') })
				expect(stolen.status).toBe(404)
			} finally {
				await client.close()
			}
			expect((await call(base, '/sse')).status).toBe(401)
		} finally {
			await transport.stop()
		}
	})

	test('stateful Streamable HTTP keeps a session per client; maxConnections answers 503', async () => {
		const { transport, base } = await startHttp(fakeGateway(), { stateful: true, maxConnections: 1, basePath: '/gw' })
		try {
			const client = await connect(streamable(base, 'backend-token'))
			try {
				expect((await client.listTools()).tools).toHaveLength(22)
				expect(transport.status().sessions.streamable).toBe(1)
				await expect(connect(streamable(base, 'agent-token'))).rejects.toThrow()
			} finally {
				await client.close()
			}
		} finally {
			await transport.stop()
		}
	})
})

describe('mcpWebSocket', () => {
	let transport: McpWebSocketTransport
	let url: string

	beforeAll(async () => {
		transport = new McpWebSocketTransport({ port: 0, host: '127.0.0.1', basePath: '', maxConnections: 2, maxPayload: 1024 * 1024, asyncapiEnabled: true },
			{ directory: directory(fakeGateway()), logger })
		await transport.start()
		url = `ws://127.0.0.1:${transport.address!.port}/mcp`
	})
	afterAll(() => transport.stop())

	const open = (headers: Record<string, string>): Promise<{ socket: WebSocket, request: (method: string, params?: unknown) => Promise<any> }> =>
		new Promise((resolve, reject) => {
			const socket = new WebSocket(url, 'mcp', { headers })
			let id = 0
			const pending = new Map<number, (message: any) => void>()
			socket.on('message', data => {
				const message = JSON.parse(data.toString())
				pending.get(message.id)?.(message)
			})
			socket.once('unexpected-response', (_req, res) => reject(new Error(`handshake ${res.statusCode}`)))
			socket.once('error', reject)
			socket.once('open', () => resolve({
				socket,
				request: (method, params) => new Promise(resolve => {
					pending.set(++id, resolve)
					socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
				})
			}))
		})

	test('initialize → tools/list → tools/call over a raw ws client', async () => {
		const { socket, request } = await open(bearer('agent-token'))
		try {
			const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ws', version: '1' } })
			expect(init.result.serverInfo).toEqual({ name: 'northwind', version: '9.9.9' })
			socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))
			const list = await request('tools/list')
			expect(list.result.tools.map((t: any) => t.name)).not.toContain('orm_execute_script')
			const result = await request('tools/call', { name: 'orm_execute', arguments: { query: 'Products' } })
			expect(result.result).toMatchObject({ isError: false, content: [{ type: 'text', text: '[{"id":1}]' }] })
			const denied = await request('tools/call', { name: 'orm_execute', arguments: { query: 'Products.insert()' } })
			expect(denied.result.isError).toBe(true)
			const unknown = await request('tools/call', { name: 'nope', arguments: {} })
			expect(unknown.error).toMatchObject({ code: -32602, message: expect.stringMatching(/unknown tool "nope"/) })
		} finally {
			socket.close()
		}
	})

	test('handshake: 401 without a valid credential; 503 over maxConnections; 404 elsewhere', async () => {
		await expect(open({})).rejects.toThrow('handshake 401')
		await expect(open(bearer('wrong'))).rejects.toThrow('handshake 401')
		const a = await open(bearer('agent-token'))
		const b = await open(bearer('agent-token'))
		try {
			await expect(open(bearer('agent-token'))).rejects.toThrow('handshake 503')
		} finally {
			a.socket.close()
			b.socket.close()
		}
	})

	test('status and asyncapi over HTTP', async () => {
		const base = url.replace('ws://', 'http://').replace('/mcp', '')
		expect((await call(base, '/status')).body).toMatchObject({ transport: 'mcpWebSocket', schemas: [{ mcp: '/mcp' }] })
		const asyncapi = await call(base, '/asyncapi.json')
		expect(asyncapi.body).toMatchObject({ asyncapi: '3.0.0', servers: { root: { protocol: 'ws', pathname: '/mcp' } } })
		expect((await call(base, '/mcp')).status).toBe(426)
	})
})
