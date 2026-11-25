// The five transports of the reference runner: each one turns an operation of the common API
// (docs/DATA_GATEWAY_CLIENTS_PLAN.md §3) into its call, and its answer or error into the same result. Node ≥ 22, no
// dependencies (fetch and WebSocket are global).
import { errorCode } from './errors.mjs'

export class GatewayError extends Error {
	constructor ({ code, name, status, dbCode, message, transport }) {
		super(message)
		this.name = 'GatewayError'
		Object.assign(this, { code, errorName: name, status, dbCode, transport })
	}
}

const fail = (transport, { name, status, dbCode, message }) =>
	new GatewayError({ code: errorCode({ name, status, dbCode }), name, status, dbCode, message, transport })

/** operation → [method, path, body] of the REST API, under the route of the schema */
const REST = {
	execute: a => ['POST', '/execute', { query: a.query, data: a.data ?? {}, options: a.options }],
	executeScript: a => ['POST', '/script', { script: a.script, data: a.data ?? {}, options: a.options }],
	plan: a => ['POST', '/plan', { query: a.query, options: a.options }],
	metadata: a => ['POST', '/metadata', { query: a.query }],
	model: a => ['POST', '/model', { query: a.query }],
	parameters: a => ['POST', '/parameters', { query: a.query }],
	constraints: a => ['POST', '/constraints', { query: a.query }],
	schemaVersion: () => ['GET', '/schema/version'],
	domain: () => ['GET', '/domain'],
	entities: () => ['GET', '/entities'],
	entity: a => ['GET', `/entities/${encodeURIComponent(a.entity)}`],
	search: a => ['GET', `/search?q=${encodeURIComponent(a.text)}`],
	describe: a => ['GET', `/describe?entities=${a.entities.map(encodeURIComponent).join(',')}`],
	enums: () => ['GET', '/enums'],
	enum: a => ['GET', `/enums/${encodeURIComponent(a.enum)}`],
	sources: () => ['GET', '/sources'],
	source: a => ['GET', `/sources/${encodeURIComponent(a.source)}`],
	mappings: () => ['GET', '/mappings'],
	mapping: a => ['GET', `/mappings/${encodeURIComponent(a.mapping)}`],
	stages: () => ['GET', '/stages'],
	stage: a => ['GET', `/stages/${encodeURIComponent(a.stage)}`],
	views: () => ['GET', '/views'],
	stageExists: a => ['GET', `/stages/${encodeURIComponent(a.stage)}/exists`],
	stageExport: a => ['GET', `/stages/${encodeURIComponent(a.stage)}/export`],
	version: () => ['GET', '/version'],
	health: () => ['GET', '/health'],
	queries: () => ['GET', '/queries'],
	query: a => ['POST', `/queries/${encodeURIComponent(a.name)}`, { data: a.data ?? {}, options: a.options }]
}

/** operation → [method, params] of the JSON-RPC API (webSocket) */
const RPC = {
	execute: a => ['query.execute', { query: a.query, data: a.data ?? {}, options: a.options }],
	executeScript: a => ['query.script', { script: a.script, data: a.data ?? {}, options: a.options }],
	plan: a => ['query.plan', { query: a.query, options: a.options }],
	metadata: a => ['query.metadata', { query: a.query }],
	model: a => ['query.model', { query: a.query }],
	parameters: a => ['query.parameters', { query: a.query }],
	constraints: a => ['query.constraints', { query: a.query }],
	schemaVersion: () => ['schema.version', {}],
	domain: () => ['schema.domain', {}],
	entities: () => ['schema.entities', {}],
	entity: a => ['schema.entity', { entity: a.entity }],
	search: a => ['schema.search', { text: a.text }],
	describe: a => ['schema.describe', { entities: a.entities }],
	enums: () => ['schema.enums', {}],
	enum: a => ['schema.enum', { enum: a.enum }],
	sources: () => ['schema.sources', {}],
	source: a => ['schema.source', { source: a.source }],
	mappings: () => ['schema.mappings', {}],
	mapping: a => ['schema.mapping', { mapping: a.mapping }],
	stages: () => ['schema.stages', {}],
	stage: a => ['schema.stage', { stage: a.stage }],
	views: () => ['schema.views', {}],
	stageExists: a => ['stage.exists', { stage: a.stage }],
	stageExport: a => ['stage.export', { stage: a.stage }],
	version: () => ['general.version', {}],
	health: () => ['general.health', {}],
	queries: () => ['queries.list', {}],
	query: a => ['queries.execute', { name: a.name, data: a.data ?? {}, options: a.options }]
}

/** operation → [tool, arguments] of the MCP server of the schema */
const MCP = {
	execute: a => ['orm_execute', { query: a.query, data: a.data ?? {}, options: a.options }],
	executeScript: a => ['orm_execute_script', { script: a.script, data: a.data ?? {}, options: a.options }],
	plan: a => ['orm_plan', { query: a.query, options: a.options }],
	metadata: a => ['orm_metadata', { query: a.query }],
	model: a => ['orm_model', { query: a.query }],
	parameters: a => ['orm_parameters', { query: a.query }],
	constraints: a => ['orm_constraints', { query: a.query }],
	schemaVersion: () => ['schema_version', {}],
	domain: () => ['schema_domain', {}],
	entities: () => ['schema_entities', {}],
	entity: a => ['schema_entities', { entity: a.entity }],
	search: a => ['schema_search', { text: a.text }],
	describe: a => ['schema_describe', { entities: a.entities }],
	enums: () => ['schema_enums', {}],
	enum: a => ['schema_enums', { enum: a.enum }],
	sources: () => ['schema_sources', {}],
	source: a => ['schema_sources', { source: a.source }],
	mappings: () => ['schema_mappings', {}],
	mapping: a => ['schema_mappings', { mapping: a.mapping }],
	stages: () => ['schema_stages', {}],
	stage: a => ['schema_stages', { stage: a.stage }],
	views: () => ['schema_views', {}],
	stageExists: a => ['stage_exists', { stage: a.stage }],
	stageExport: a => ['stage_export', { stage: a.stage }],
	version: () => ['gateway_version', {}],
	health: () => ['gateway_health', {}],
	// a named query is the tool query_<name> (MCP has no list of them: they are in tools/list)
	query: a => [`query_${a.name}`, a.data ?? {}]
}

const clean = (value) => JSON.parse(JSON.stringify(value)) // drops undefined (options not given)
const unsupported = (transport, operation) => new GatewayError({
	code: 'unsupported', status: undefined, message: `${operation} is not available on ${transport}`, transport
})

// ------------------------------------------------------------------------------------------------------------- REST
export class RestTransport {
	constructor (url, headers) { this.name = 'http'; this.base = url; this.headers = headers }
	async open () {}
	async close () {}
	async call (operation, args) {
		const route = REST[operation]
		if (!route) throw unsupported(this.name, operation)
		const [method, path, body] = route(args)
		const response = await fetch(this.base + path, {
			method,
			headers: { ...this.headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
			body: body ? JSON.stringify(clean(body)) : undefined
		})
		if (response.status === 204) return null
		const text = await response.text()
		const payload = text === '' ? null : JSON.parse(text)
		if (!response.ok) {
			throw fail(this.name, { name: payload?.error, status: response.status, dbCode: payload?.code, message: payload?.message ?? text })
		}
		return payload
	}
}

// ---------------------------------------------------------------------------------------------- JSON-RPC over a socket
class RpcSocket {
	constructor (url, headers) { this.url = url; this.headers = headers; this.next = 1; this.pending = new Map() }
	open () {
		return new Promise((resolve, reject) => {
			this.ws = new WebSocket(this.url, { headers: this.headers })
			this.ws.onopen = () => resolve()
			this.ws.onerror = () => reject(new Error(`can't connect to ${this.url}`))
			this.ws.onmessage = (event) => {
				const message = JSON.parse(event.data)
				const waiting = message.id !== undefined && this.pending.get(message.id)
				if (!waiting) return // a notification
				this.pending.delete(message.id)
				waiting(message)
			}
			this.ws.onclose = () => {
				for (const waiting of this.pending.values()) waiting({ error: { code: -32603, message: 'the connection was closed' } })
				this.pending.clear()
			}
		})
	}
	request (method, params) {
		const id = this.next++
		return new Promise(resolve => {
			this.pending.set(id, resolve)
			this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
		})
	}
	notify (method, params) { this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params })) }
	close () { this.ws?.close() }
}

export class WebSocketTransport {
	constructor (url, headers) { this.name = 'ws'; this.socket = new RpcSocket(url, headers) }
	open () { return this.socket.open() }
	async close () { this.socket.close() }
	async call (operation, args) {
		const route = RPC[operation]
		if (!route) throw unsupported(this.name, operation)
		const [method, params] = route(args)
		const message = await this.socket.request(method, clean(params))
		if (message.error) {
			const data = message.error.data ?? {}
			throw fail(this.name, { name: data.name, status: data.status, dbCode: data.code, message: message.error.message })
		}
		return message.result ?? null
	}
}

// ----------------------------------------------------------------------------------------------------------------- MCP
const INITIALIZE = { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'data-gateway-conformance', version: '0.1.0' } }

/** The answer of tools/call as what REST answers; a cut list (mcp.maxRows) is an error unless onTruncated is return */
const toolResult = (transport, result) => {
	const text = result.content?.find(c => c.type === 'text')?.text
	if (result.isError) {
		const structured = result.structuredContent ?? {}
		const name = structured.error ?? text?.slice(0, text.indexOf(':'))
		throw fail(transport, { name, status: structured.status, dbCode: structured.code, message: structured.message ?? text })
	}
	const value = text === undefined || text === '' ? null : JSON.parse(text)
	if (value && typeof value === 'object' && value.truncated === true && Array.isArray(value.rows)) {
		throw new GatewayError({ code: 'truncated', message: `${value.returned} of ${value.total} rows (mcp.maxRows): ${value.hint}`, transport })
	}
	return value
}

class McpBase {
	async call (operation, args) {
		const route = MCP[operation]
		if (!route) throw unsupported(this.name, operation)
		const [tool, toolArgs] = route(args)
		const message = await this.request('tools/call', { name: tool, arguments: clean(toolArgs) })
		if (message.error) throw fail(this.name, { name: 'McpError', status: message.error.code === -32001 ? 401 : 400, message: message.error.message })
		return toolResult(this.name, message.result)
	}
}

/** MCP Streamable HTTP: every request a POST to {schema}/mcp (the gateway is stateless) */
export class McpHttpTransport extends McpBase {
	constructor (url, headers) { super(); this.name = 'mcp+http'; this.url = url + '/mcp'; this.headers = headers; this.next = 1 }
	async post (body) {
		const response = await fetch(this.url, {
			method: 'POST',
			headers: { ...this.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(this.session ? { 'mcp-session-id': this.session } : {}) },
			body: JSON.stringify(body)
		})
		this.session = response.headers.get('mcp-session-id') ?? this.session
		const text = await response.text()
		if (body.id === undefined) return undefined
		if (response.status === 401) return { error: { code: -32001, message: JSON.parse(text).error?.message ?? text } }
		// a JSON answer, or a stream with the answer as the data of one event
		if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
			const data = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).pop()
			return JSON.parse(data)
		}
		return JSON.parse(text)
	}
	async request (method, params) { return this.post({ jsonrpc: '2.0', id: this.next++, method, params }) }
	async open () {
		const answer = await this.request('initialize', INITIALIZE)
		if (answer.error) throw fail(this.name, { name: 'McpError', status: answer.error.code === -32001 ? 401 : 400, message: answer.error.message })
		await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
	}
	async close () {}
}

/** MCP HTTP+SSE (legacy): GET {schema}/sse opens the stream, whose first event names where to POST the requests */
export class McpSseTransport extends McpBase {
	constructor (url, headers) { super(); this.name = 'mcp+sse'; this.url = url + '/sse'; this.headers = headers; this.next = 1; this.pending = new Map() }
	async open () {
		this.abort = new AbortController()
		const response = await fetch(this.url, { headers: { ...this.headers, Accept: 'text/event-stream' }, signal: this.abort.signal })
		if (!response.ok) throw fail(this.name, { name: 'McpError', status: response.status, message: `GET ${this.url} answered ${response.status}` })
		const endpoint = new Promise((resolve) => { this.onEndpoint = resolve })
		this.reading = this.read(response.body.getReader())
		this.endpoint = new URL(await endpoint, this.url).toString()
		await this.request('initialize', INITIALIZE)
		await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
	}
	async read (reader) {
		const decoder = new TextDecoder()
		let buffer = ''
		try {
			for (;;) {
				const { value, done } = await reader.read()
				if (done) break
				buffer += decoder.decode(value, { stream: true })
				let end
				while ((end = buffer.indexOf('\n\n')) >= 0) {
					const raw = buffer.slice(0, end)
					buffer = buffer.slice(end + 2)
					let event = 'message'
					const data = []
					for (const line of raw.split('\n')) {
						if (line.startsWith('event:')) event = line.slice(6).trim()
						else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
					}
					if (event === 'endpoint') this.onEndpoint(data.join('\n'))
					else if (event === 'message' && data.length) {
						const message = JSON.parse(data.join('\n'))
						const waiting = message.id !== undefined && this.pending.get(message.id)
						if (waiting) { this.pending.delete(message.id); waiting(message) }
					}
				}
			}
		} catch { /* aborted */ }
	}
	async post (body) {
		const response = await fetch(this.endpoint, { method: 'POST', headers: { ...this.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
		await response.text()
	}
	request (method, params) {
		const id = this.next++
		const answer = new Promise(resolve => this.pending.set(id, resolve))
		return this.post({ jsonrpc: '2.0', id, method, params }).then(() => answer)
	}
	async close () { this.abort?.abort(); await this.reading }
}

/** MCP over WebSocket (not standard): the same JSON-RPC messages on a socket at {schema}/mcp */
export class McpWebSocketTransport extends McpBase {
	constructor (url, headers) { super(); this.name = 'mcp+ws'; this.socket = new RpcSocket(url + '/mcp', headers) }
	async open () {
		await this.socket.open()
		await this.socket.request('initialize', INITIALIZE)
		this.socket.notify('notifications/initialized')
	}
	request (method, params) { return this.socket.request(method, params) }
	async close () { this.socket.close() }
}

/** The transport of a connection string: the scheme of the URL (docs/DATA_GATEWAY_CLIENTS_PLAN.md §2) */
export const connect = async (connection, headers) => {
	const url = new URL(connection)
	const rest = (scheme) => `${scheme}://${url.host}${url.pathname.replace(/\/$/, '')}`
	const transports = {
		'http:': () => new RestTransport(rest('http'), headers),
		'https:': () => new RestTransport(rest('https'), headers),
		'ws:': () => new WebSocketTransport(rest('ws'), headers),
		'wss:': () => new WebSocketTransport(rest('wss'), headers),
		'mcp+http:': () => new McpHttpTransport(rest('http'), headers),
		'mcp+https:': () => new McpHttpTransport(rest('https'), headers),
		'mcp+sse:': () => new McpSseTransport(rest('http'), headers),
		'mcp+sses:': () => new McpSseTransport(rest('https'), headers),
		'mcp+ws:': () => new McpWebSocketTransport(rest('ws'), headers),
		'mcp+wss:': () => new McpWebSocketTransport(rest('wss'), headers)
	}
	const create = transports[url.protocol]
	if (!create) throw new Error(`unknown transport ${url.protocol} (http, https, ws, wss, mcp+http, mcp+https, mcp+sse, mcp+sses, mcp+ws, mcp+wss)`)
	const transport = create()
	await transport.open()
	return transport
}
