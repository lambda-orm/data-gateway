// What each transport makes of an answer, with a fake gateway: no network, no Docker.
import { GatewayError, isApprovalPending, parseConnection, queryText } from '../../src/lib'
import { RestTransport } from '../../src/lib/transports/rest'
import { McpHttpTransport } from '../../src/lib/transports/mcp'

const answer = (status: number, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
	new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status, headers })

let requests: { url: string, init: RequestInit }[]
const fakeFetch = (...answers: Response[]) => {
	requests = []
	jest.spyOn(global, 'fetch').mockImplementation(async (url: any, init: any) => { requests.push({ url: String(url), init }); return answers.shift()! })
}
afterEach(() => jest.restoreAllMocks())

const error = async (promise: Promise<unknown>): Promise<GatewayError> => {
	try { await promise } catch (e) { return e as GatewayError }
	throw new Error('it did not fail')
}

describe('REST', () => {
	const rest = () => new RestTransport(parseConnection('http://gw/northwind', { apiKey: 'k' }, {}))

	test('a query: POST /execute under the route of the schema, with the credential', async () => {
		fakeFetch(answer(200, [{ name: 'Chai' }]))
		expect(await rest().call('execute', { query: 'Products.map(p => p.name)', data: { a: 1 } })).toEqual([{ name: 'Chai' }])
		expect(requests[0].url).toBe('http://gw/northwind/execute')
		expect(requests[0].init.method).toBe('POST')
		expect(JSON.parse(String(requests[0].init.body))).toEqual({ query: 'Products.map(p => p.name)', data: { a: 1 } })
		expect((requests[0].init.headers as Record<string, string>)['X-Api-Key']).toBe('k')
	})

	test('a token given by a function: asked for on every request (the token of an identity provider, refreshed)', async () => {
		let n = 0
		const transport = new RestTransport(parseConnection('http://gw/northwind', { token: async () => `jwt-${++n}` }, {}))
		fakeFetch(answer(200, []), answer(200, []))
		await transport.call('execute', { query: 'Products' })
		await transport.call('execute', { query: 'Products' })
		expect(requests.map(r => (r.init.headers as Record<string, string>).Authorization)).toEqual(['Bearer jwt-1', 'Bearer jwt-2'])
	})

	test('an error: its status, name and the database code give the code', async () => {
		fakeFetch(answer(409, { error: 'ExecutionError', code: '23505', message: 'duplicate key' }))
		expect(await error(rest().call('execute', { query: 'Categories.insert()' })))
			.toMatchObject({ code: 'unique', errorName: 'ExecutionError', status: 409, dbCode: '23505', message: 'duplicate key', transport: 'http' })
	})

	test('the suggestions of an error of the query', async () => {
		fakeFetch(answer(400, { error: 'SchemaError', message: 'nme is neither …; did you mean name?', suggestions: [{ name: 'nme', didYouMean: ['name'] }] }))
		expect(await error(rest().call('execute', { query: 'Areas.map(p => p.nme)' }))).toMatchObject({ code: 'invalid', suggestions: [{ name: 'nme', didYouMean: ['name'] }] })
	})

	test('a refused connection: the code transport', async () => {
		jest.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED') }))
		expect(await error(rest().call('version', {}))).toMatchObject({ code: 'transport', message: expect.stringContaining('ECONNREFUSED') })
	})

	test('notifications and unknown operations are not on REST', async () => {
		expect(await error(rest().call('nope' as any, {}))).toMatchObject({ code: 'unsupported' })
	})
})

describe('a write that waits for a person (gateway 4.3)', () => {
	test('REST answers 202 with its approval; GET /approvals/{id} its state', async () => {
		const rest = new RestTransport(parseConnection('http://gw/northwind', { apiKey: 'k' }, {}))
		fakeFetch(answer(202, { approval: 'a-1', status: 'pending', expiresAt: '2026-11-26T13:00:00.000Z', message: 'waits' }), answer(200, { id: 'a-1', status: 'done', result: 1 }))
		const pending = await rest.call('execute', { query: 'Categories.update(p => ({ name: n })).filter(p => p.id == 1)', data: { n: 'x' } })
		expect(isApprovalPending(pending)).toBe(true)
		expect(isApprovalPending([{ name: 'Chai' }])).toBe(false)
		expect(await rest.call('approval', { id: 'a-1' })).toEqual({ id: 'a-1', status: 'done', result: 1 })
		expect(requests[1].url).toBe('http://gw/northwind/approvals/a-1')
		expect(requests[1].init.method).toBe('GET')
	})
})

describe('MCP', () => {
	const mcp = (onTruncated: 'error' | 'return' = 'error') => new McpHttpTransport(parseConnection('mcp+http://gw/northwind', { onTruncated }, {}))
	const tool = (result: unknown) => answer(200, { jsonrpc: '2.0', id: 1, result })

	test('the result of a tool is the JSON of its text, the same that REST answers', async () => {
		fakeFetch(tool({ content: [{ type: 'text', text: '[{"name":"Chai"}]' }], isError: false }))
		expect(await mcp().call('execute', { query: 'Products.map(p => p.name)' })).toEqual([{ name: 'Chai' }])
		const body = JSON.parse(String(requests[0].init.body))
		expect(requests[0].url).toBe('http://gw/northwind/mcp')
		expect(body).toMatchObject({ method: 'tools/call', params: { name: 'orm_execute', arguments: { query: 'Products.map(p => p.name)', data: {} } } })
	})

	test('an answer as a stream of events (text/event-stream)', async () => {
		fakeFetch(answer(200, 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"7"}]}}\n\n', { 'content-type': 'text/event-stream' }))
		expect(await mcp().call('execute', { query: 'x' })).toBe(7)
	})

	test('an isError result: the name, status and code of structuredContent', async () => {
		fakeFetch(tool({ content: [{ type: 'text', text: 'ExecutionError: duplicate key' }], structuredContent: { error: 'ExecutionError', status: 409, code: '23503', message: 'fk' }, isError: true }))
		expect(await error(mcp().call('execute', { query: 'x' }))).toMatchObject({ code: 'foreign_key', errorName: 'ExecutionError', status: 409, transport: 'mcp+http' })
	})

	test('a list cut at mcp.maxRows: the code truncated, or the cut result when asked', async () => {
		const cut = { rows: [1, 2], truncated: true, returned: 2, total: 9, hint: 'use page' }
		fakeFetch(tool({ content: [{ type: 'text', text: JSON.stringify(cut) }], isError: false }))
		expect(await error(mcp().call('execute', { query: 'x' }))).toMatchObject({ code: 'truncated', message: expect.stringContaining('2 of 9 rows') })
		fakeFetch(tool({ content: [{ type: 'text', text: JSON.stringify(cut) }], isError: false }))
		expect(await mcp('return').call('execute', { query: 'x' })).toEqual(cut)
	})

	test('not authenticated (-32001): the code unauthorized', async () => {
		fakeFetch(answer(401, { jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'a valid API key is required' } }))
		expect(await error(mcp().call('execute', { query: 'x' }))).toMatchObject({ code: 'unauthorized' })
	})
})

describe('queries as functions', () => {
	test('the text of the function is the query', () => {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore Products is a name of the query, not of this program
		expect(queryText(() => Products.filter(p => p.price > 10).map(p => p.name))).toBe('Products.filter(p => p.price > 10).map(p => p.name)')
		expect(queryText('Products')).toBe('Products')
	})
})
