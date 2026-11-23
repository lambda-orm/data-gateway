import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { CodeEditor } from '@lambdaorm/ui'
import { getJson, SchemaState, usePrefs } from './shared'
import { viaProxy } from './proxy'

/**
 * What a connection opens in tabs, with its credential: the REST API (its Swagger), its WebSocket (its AsyncAPI and a
 * console) and its MCP (its tools, called). The management of the gateway tells its transports at
 * GET {basePath}/transports; the backend of the IDE reaches them on the host of the connection, or at the URLs the
 * connection fixes. Every URL here goes through the backend of the IDE (viaProxy).
 */
export interface TransportInfo { name: 'http' | 'webSocket' | 'mcpHttp' | 'mcpWebSocket', port: number, basePath: string, docs?: string, schemaPath?: string }
export interface Endpoints {
	/** the management of the gateway (the connection's URL): its schemas */
	management: string
	/** the REST base of the http transport, and its OpenAPI */
	rest?: string
	openapi?: string
	/** the WebSocket (ws(s)://…), and its AsyncAPI */
	webSocket?: string
	asyncapi?: string
	/** the MCP (Streamable HTTP) */
	mcp?: string
	/** the URLs as the backend of the IDE reaches them, to show */
	targets: { rest?: string, webSocket?: string, mcp?: string }
}

/** Where the transports of a gateway are: what it tells, on the host of the connection; what the connection fixes, first */
export const endpointsOf = (management: string, transports: TransportInfo[] | undefined, fixed: { rest?: string, webSocket?: string, mcp?: string } = {}): Endpoints => {
	const url = new URL(management)
	const at = (t: TransportInfo, scheme: string) => `${scheme}://${url.hostname}:${t.port}${t.basePath}`
	const http = transports?.find(t => t.name === 'http')
	const ws = transports?.find(t => t.name === 'webSocket')
	const mcp = transports?.find(t => t.name === 'mcpHttp')
	const secure = url.protocol === 'https:'
	const clean = (u?: string) => u?.trim().replace(/\/+$/, '') || undefined
	const targets = {
		rest: clean(fixed.rest) ?? (http ? at(http, secure ? 'https' : 'http') : undefined),
		webSocket: clean(fixed.webSocket) ?? (ws ? at(ws, secure ? 'wss' : 'ws') : undefined),
		mcp: clean(fixed.mcp) ?? (mcp ? at(mcp, secure ? 'https' : 'http') : undefined)
	}
	const rest = targets.rest ? viaProxy(targets.rest) : undefined
	const webSocket = targets.webSocket ? viaProxy(targets.webSocket) : undefined
	return {
		management: viaProxy(management),
		rest,
		openapi: rest && http?.docs ? `${rest}${http.docs}` : undefined,
		webSocket,
		asyncapi: webSocket && ws?.docs ? `${webSocket.replace(/^ws/, 'http')}${ws.docs}` : undefined,
		mcp: targets.mcp ? viaProxy(targets.mcp) : undefined,
		targets
	}
}

/** The transports a gateway tells at its management (the connection's URL, through the backend of the IDE) */
export const useTransports = (management: string) => {
	const [transports, setTransports] = useState<TransportInfo[]>()
	useEffect(() => {
		let alive = true
		getJson(viaProxy(management), '/transports').then(t => { if (alive) setTransports(t) }, () => { if (alive) setTransports(undefined) })
		return () => { alive = false }
	}, [management])
	return transports
}

/** The credential of a WebSocket from a browser: in its subprotocols (it can't send headers) — the gateway reads them */
const protocolsFor = (headers: Record<string, string>): string[] => {
	const base64 = btoa(unescape(encodeURIComponent(JSON.stringify(headers)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
	return ['lambdaorm', `lambdaorm.headers.${base64}`]
}

const useSchemas = (rest: string) => {
	const [schemas, setSchemas] = useState<SchemaState[]>([])
	useEffect(() => { getJson(rest, '/schemas').then((all: SchemaState[]) => setSchemas(all.filter(s => s.status === 'ready')), () => setSchemas([])) }, [rest])
	return schemas
}

const SchemaPick: React.FC<{ schemas: SchemaState[], value: string, onChange: (schema: string) => void }> = ({ schemas, value, onChange }) => {
	const { t } = usePrefs()
	return (
		<label className="dg-inline">{t.schema}
			<select aria-label={t.schema} value={value} onChange={e => onChange(e.target.value)}>
				{schemas.map(s => <option key={s.path} value={s.path}>{s.path || '/'}</option>)}
			</select>
		</label>
	)
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

// Swagger UI: large, loaded only when its tab opens
const SwaggerUI = React.lazy(async () => {
	await import('swagger-ui-react/swagger-ui.css')
	return import('swagger-ui-react')
})

/** The REST API of the connection in Swagger UI: its requests go to the connection, with its credential */
export const SwaggerTab: React.FC<{ endpoints: Endpoints, headers: () => Record<string, string> }> = ({ endpoints, headers }) => {
	const { t } = usePrefs()
	const [spec, setSpec] = useState<any>()
	const [error, setError] = useState<string>()
	useEffect(() => {
		if (!endpoints.openapi) return
		getJson(endpoints.openapi, '').then(
			// the servers it tells are the gateway's own (its port): the browser reaches it through the backend of the IDE
			document => setSpec({ ...document, servers: [{ url: endpoints.rest!, description: endpoints.targets.rest }] }),
			e => setError(e?.message ?? String(e)))
	}, [endpoints.openapi, endpoints.rest])
	if (!endpoints.openapi) return <div className="dg-pane"><p className="dg-muted">{t.notExposed}</p></div>
	return (
		<div className="dg-tool dg-swagger">
			{error && <div className="dg-error" role="alert">{error}</div>}
			{spec && (
				<Suspense fallback={<p className="dg-muted">{t.loading}</p>}>
					<SwaggerUI spec={spec} tryItOutEnabled persistAuthorization={false}
						requestInterceptor={(request: any) => { request.headers = { ...request.headers, ...headers() }; return request }} />
				</Suspense>
			)}
		</div>
	)
}

/** The WebSocket of the connection: its methods (AsyncAPI), a request written as JSON-RPC, what comes back */
export const WebSocketTab: React.FC<{ endpoints: Endpoints, headers: () => Record<string, string>, theme: 'light' | 'dark' }> = ({ endpoints, headers, theme }) => {
	const { t } = usePrefs()
	const schemas = useSchemas(endpoints.management)
	const [schema, setSchema] = useState('')
	useEffect(() => { if (!schemas.some(s => s.path === schema) && schemas[0]) setSchema(schemas[0].path) }, [schemas])
	const [methods, setMethods] = useState<string[]>([])
	useEffect(() => {
		if (!endpoints.asyncapi) return
		getJson(endpoints.asyncapi, '').then((doc: any) => {
			// the methods of its messages (JSON-RPC): their names, as the document tells them
			const names = new Set<string>()
			const walk = (v: any) => {
				if (!v || typeof v !== 'object') return
				if (typeof v.method === 'string') names.add(v.method)
				const method = v.properties?.method
				for (const m of [method?.const, ...(method?.enum ?? []), ...(method?.examples ?? [])]) if (typeof m === 'string') names.add(m)
				Object.values(v).forEach(walk)
			}
			walk(doc)
			setMethods([...names].sort())
		}, () => setMethods([]))
	}, [endpoints.asyncapi])
	const socket = useRef<WebSocket>()
	const [state, setState] = useState<'closed' | 'connecting' | 'open'>('closed')
	const [log, setLog] = useState<{ at: string, way: 'out' | 'in' | 'info', text: string }[]>([])
	const [request, setRequest] = useState(pretty({ jsonrpc: '2.0', id: 1, method: 'general.version' }))
	const add = (way: 'out' | 'in' | 'info', text: string) => setLog(l => [...l.slice(-199), { at: new Date().toLocaleTimeString(), way, text }])
	useEffect(() => () => socket.current?.close(), [])
	const connect = () => {
		if (!endpoints.webSocket) return
		socket.current?.close()
		const url = `${endpoints.webSocket}${schema ? `/${schema}` : ''}`
		setState('connecting')
		const ws = new WebSocket(url, protocolsFor(headers()))
		socket.current = ws
		ws.onopen = () => { setState('open'); add('info', `${t.connected} ${endpoints.targets.webSocket}${schema ? `/${schema}` : ''}`) }
		ws.onmessage = e => { try { add('in', pretty(JSON.parse(String(e.data)))) } catch { add('in', String(e.data)) } }
		ws.onclose = e => { setState('closed'); add('info', `${t.closed}${e.code ? ` (${e.code}${e.reason ? `: ${e.reason}` : ''})` : ''}`) }
		ws.onerror = () => add('info', t.unreachable)
	}
	const send = () => {
		if (socket.current?.readyState !== WebSocket.OPEN) return
		let text = request
		try { text = JSON.stringify(JSON.parse(request)) } catch { /* sent as it is: the gateway answers the parse error */ }
		socket.current.send(text)
		add('out', request)
		// the next request, with the next id
		try { const r = JSON.parse(request); if (typeof r.id === 'number') setRequest(pretty({ ...r, id: r.id + 1 })) } catch { /* as it is */ }
	}
	const useMethod = (method: string) => { try { const r = JSON.parse(request); setRequest(pretty({ jsonrpc: '2.0', id: r.id ?? 1, method, params: r.method === method ? r.params : {} })) } catch { setRequest(pretty({ jsonrpc: '2.0', id: 1, method, params: {} })) } }
	if (!endpoints.webSocket) return <div className="dg-pane"><p className="dg-muted">{t.notExposed}</p></div>
	return (
		<div className="dg-tool">
			<div className="dg-tool-bar">
				<SchemaPick schemas={schemas} value={schema} onChange={setSchema} />
				<code className="dg-muted">{endpoints.targets.webSocket}/{schema}</code>
				<span className="dg-spacer" />
				<span className={`dg-status dg-${state === 'open' ? 'ready' : state === 'connecting' ? 'pending' : 'error'}`}>{state === 'open' ? t.connected : state === 'connecting' ? t.checking : t.closed}</span>
				{state === 'open' ? <button onClick={() => socket.current?.close()}>{t.disconnect}</button> : <button className="dg-primary" onClick={connect} disabled={state === 'connecting'}>{t.connect}</button>}
			</div>
			{methods.length > 0 && (
				<div className="dg-chips" aria-label={t.methods}>{methods.map(m => <button key={m} type="button" className="dg-chip" onClick={() => useMethod(m)}>{m}</button>)}</div>
			)}
			<div className="dg-tool-split">
				<div>
					<CodeEditor ariaLabel={t.request} language="json" theme={theme} value={request} onChange={setRequest} height={220} onRun={send} />
					<button className="dg-primary" onClick={send} disabled={state !== 'open'} title="Ctrl+Enter">{t.send}</button>
				</div>
				<ol className="dg-log" aria-label={t.messages}>
					{log.map((m, i) => <li key={i} className={`dg-log-${m.way}`}><span className="dg-muted">{m.at} {m.way === 'out' ? '→' : m.way === 'in' ? '←' : '·'}</span><pre>{m.text}</pre></li>)}
				</ol>
			</div>
		</div>
	)
}

/** A skeleton of the arguments of a tool, from its input schema: what it requires, with a value of its type */
const argumentsOf = (schema: any): Record<string, unknown> => {
	const props = schema?.properties ?? {}
	const required: string[] = schema?.required ?? Object.keys(props)
	return Object.fromEntries(required.map(name => {
		const p = props[name] ?? {}
		const type = Array.isArray(p.type) ? p.type[0] : p.type
		return [name, p.default ?? (p.enum ? p.enum[0] : type === 'number' || type === 'integer' ? 0 : type === 'boolean' ? false : type === 'object' ? {} : type === 'array' ? [] : '')]
	}))
}

/** The MCP of the connection: its tools (of a schema), each called with its arguments, what it gives back */
export const McpTab: React.FC<{ endpoints: Endpoints, headers: () => Record<string, string>, theme: 'light' | 'dark' }> = ({ endpoints, headers, theme }) => {
	const { t } = usePrefs()
	const schemas = useSchemas(endpoints.management)
	const [schema, setSchema] = useState('')
	useEffect(() => { if (!schemas.some(s => s.path === schema) && schemas[0]) setSchema(schemas[0].path) }, [schemas])
	const client = useRef<any>()
	const [state, setState] = useState<'closed' | 'connecting' | 'open'>('closed')
	const [error, setError] = useState<string>()
	const [tools, setTools] = useState<any[]>([])
	const [tool, setTool] = useState<any>()
	const [args, setArgs] = useState('{}')
	const [result, setResult] = useState<string>()
	const [busy, setBusy] = useState(false)
	useEffect(() => () => { client.current?.close?.() }, [])
	const url = endpoints.mcp ? `${endpoints.mcp}${schema ? `/${schema}` : ''}/mcp` : ''
	const shown = endpoints.targets.mcp ? `${endpoints.targets.mcp}${schema ? `/${schema}` : ''}/mcp` : ''
	const connect = async () => {
		setState('connecting'); setError(undefined); setTools([]); setTool(undefined); setResult(undefined)
		try {
			await client.current?.close?.()
			const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
				import('@modelcontextprotocol/sdk/client/index.js'),
				import('@modelcontextprotocol/sdk/client/streamableHttp.js')
			])
			const c = new Client({ name: 'data-gateway-ide', version: __APP_VERSION__ })
			await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: headers() } }))
			client.current = c
			setTools((await c.listTools()).tools ?? [])
			setState('open')
		} catch (e: any) {
			setState('closed')
			setError(e?.message === 'Failed to fetch' ? t.unreachable : (e?.message ?? String(e)))
		}
	}
	const pick = (name: string) => { const found = tools.find(x => x.name === name); setTool(found); setArgs(pretty(argumentsOf(found?.inputSchema))); setResult(undefined) }
	const call = async () => {
		if (!client.current || !tool) return
		setBusy(true)
		try {
			const answer = await client.current.callTool({ name: tool.name, arguments: JSON.parse(args || '{}') })
			// the text of each content: JSON when it is
			setResult((answer.content ?? []).map((c: any) => { if (c.type !== 'text') return pretty(c); try { return pretty(JSON.parse(c.text)) } catch { return c.text } }).join('\n\n') || pretty(answer))
		} catch (e: any) { setResult(`${e?.message ?? e}`) } finally { setBusy(false) }
	}
	const toolsSorted = useMemo(() => [...tools].sort((a, b) => a.name.localeCompare(b.name)), [tools])
	if (!endpoints.mcp) return <div className="dg-pane"><p className="dg-muted">{t.notExposed}</p></div>
	return (
		<div className="dg-tool">
			<div className="dg-tool-bar">
				<SchemaPick schemas={schemas} value={schema} onChange={setSchema} />
				<code className="dg-muted">{shown}</code>
				<span className="dg-spacer" />
				<span className={`dg-status dg-${state === 'open' ? 'ready' : state === 'connecting' ? 'pending' : 'error'}`}>{state === 'open' ? t.connected : state === 'connecting' ? t.checking : t.closed}</span>
				<button className="dg-primary" onClick={connect} disabled={state === 'connecting' || !url}>{state === 'open' ? t.reconnect : t.connect}</button>
			</div>
			{error && <div className="dg-error" role="alert">{error}</div>}
			{state === 'open' && (
				<div className="dg-tool-split">
					<ul className="dg-tools" aria-label={t.mcpTools}>
						{toolsSorted.map(x => (
							<li key={x.name}><button type="button" className={tool?.name === x.name ? 'dg-selected' : ''} title={x.description} onClick={() => pick(x.name)}><code>{x.name}</code><span className="dg-muted dg-clamp">{x.description}</span></button></li>
						))}
					</ul>
					<div>
						{tool
							? (
								<>
									<h3><code>{tool.name}</code></h3>
									{tool.description && <p className="dg-muted">{tool.description}</p>}
									<CodeEditor ariaLabel={t.arguments} language="json" theme={theme} value={args} onChange={setArgs} height={180} onRun={call} />
									<button className="dg-primary" onClick={call} disabled={busy} title="Ctrl+Enter">{busy ? t.checking : t.call}</button>
									{result !== undefined && <CodeEditor ariaLabel={t.result} language="json" theme={theme} value={result} onChange={() => undefined} readOnly height={320} />}
								</>
								)
							: <p className="dg-muted">{t.pickTool}</p>}
					</div>
				</div>
			)}
		</div>
	)
}
