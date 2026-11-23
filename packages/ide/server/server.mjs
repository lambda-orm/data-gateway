// The backend of the data-gateway-ide (docs/DATA_GATEWAY.md §11.9): it serves the app and is its proxy to the
// data-gateways. The browser talks only to it (its own origin: the gateways answer no CORS); a request to a gateway
// carries its URL in the path, {IDE}/gw/{base64url of the URL}/{rest of the path}: REST, MCP (Streamable HTTP and SSE)
// and the upgrade of a WebSocket alike. It keeps no connection and no credential: they stay in the browser.
//
// DATA_GATEWAY_IDE_TARGETS: the origins it may reach, separated by commas (http://data-gateway:9292), or * for any (a
// local IDE). Without it, none: an open proxy would reach any host of the network of the IDE.
// PORT (8080), HOST (0.0.0.0), DATA_GATEWAY_IDE_DIST (./dist next to this folder).
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** The origins the proxy may reach: '*' or a set of origins */
export const targetsOf = (text) => {
	const value = (text ?? '').trim()
	if (value === '*') return '*'
	const origins = new Set()
	for (const part of value.split(',').map(p => p.trim()).filter(Boolean)) {
		try { origins.add(new URL(part).origin) } catch { console.warn(`[data-gateway-ide] DATA_GATEWAY_IDE_TARGETS: "${part}" is not a URL: ignored`) }
	}
	return origins
}

const fromBase64url = (text) => Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

/** /gw/{base64url}/{rest}?{query} → the URL of the gateway, or an error with its status */
export const targetOf = (requestUrl, allowed) => {
	const match = /^\/gw\/([A-Za-z0-9_-]+)(\/[^?]*)?(\?.*)?$/.exec(requestUrl)
	if (!match) return { status: 404, error: 'NotFoundError', message: 'a proxied request is /gw/{base64url of the URL of the gateway}/{path}' }
	let base
	try { base = new URL(fromBase64url(match[1])) } catch { return { status: 400, error: 'BadRequestError', message: 'the target of the proxy is not a URL' } }
	if (base.protocol !== 'http:' && base.protocol !== 'https:') return { status: 400, error: 'BadRequestError', message: `the target of the proxy must be http or https, not ${base.protocol}` }
	if (base.username || base.password) return { status: 400, error: 'BadRequestError', message: 'the target of the proxy can\'t carry a user: the credential goes in the headers' }
	if (allowed !== '*' && !allowed.has(base.origin)) {
		return { status: 403, error: 'ForbiddenTargetError', message: `the IDE may not reach ${base.origin}: add it to DATA_GATEWAY_IDE_TARGETS of the IDE` }
	}
	const url = new URL(base.origin)
	url.pathname = `${base.pathname.replace(/\/+$/, '')}${match[2] ?? ''}` || '/'
	url.search = match[3] ?? ''
	return { url }
}

// hop-by-hop (RFC 9110 §7.6.1) and what is of the browser and the IDE, not of the gateway
const HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']
const DROPPED_REQUEST = [...HOP, 'cookie', 'origin', 'referer', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']
const DROPPED_RESPONSE = [...HOP, 'set-cookie']

const without = (headers, names) => Object.fromEntries(Object.entries(headers).filter(([name]) => !names.includes(name.toLowerCase())))

/**
 * Who the gateway is told the client is (X-Forwarded-For): the address of the browser as this server sees it. The
 * gateway believes it only from its trusted proxies (transports.management.trustedProxies: this IDE); what the browser
 * sent in that header is dropped (it could say anything).
 */
const forwardedFor = (req) => {
	const address = req.socket.remoteAddress ?? ''
	return address.startsWith('::ffff:') ? address.slice(7) : address
}

const sendJson = (res, status, body) => {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
	res.end(JSON.stringify(body))
}

const log = (method, url, status) => console.log(`[data-gateway-ide] ${method} ${url.origin}${url.pathname} ${status}`)

/** A request to a gateway: method, body and headers (without the browser's own), streamed both ways */
const proxy = (req, res, allowed) => {
	const target = targetOf(req.url, allowed)
	if (!target.url) return sendJson(res, target.status, { error: target.error, message: target.message })
	const { url } = target
	const client = url.protocol === 'https:' ? https : http
	const upstream = client.request(url, { method: req.method, headers: { ...without(req.headers, DROPPED_REQUEST), host: url.host, 'x-forwarded-for': forwardedFor(req) } }, (answer) => {
		log(req.method, url, answer.statusCode)
		res.writeHead(answer.statusCode ?? 502, answer.statusMessage, without(answer.headers, DROPPED_RESPONSE))
		answer.pipe(res)
	})
	upstream.on('error', (error) => {
		log(req.method, url, 502)
		if (res.headersSent) return res.destroy(error)
		sendJson(res, 502, { error: 'BadGatewayError', message: `the IDE can't reach ${url.origin}: ${error.code ?? error.message}` })
	})
	// the browser went away (an SSE closed): so does the request to the gateway
	res.on('close', () => { if (!res.writableFinished) upstream.destroy() })
	req.pipe(upstream)
}

/** The upgrade of a WebSocket: the same request to the gateway (its subprotocols carry the credential), then the bytes */
const upgrade = (req, socket, head, allowed) => {
	const refuse = (status, body) => {
		socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n${JSON.stringify(body)}`)
	}
	const target = targetOf(req.url, allowed)
	if (!target.url) return refuse(target.status, { error: target.error, message: target.message })
	const { url } = target
	const client = url.protocol === 'https:' ? https : http
	const headers = { ...without(req.headers, DROPPED_REQUEST), host: url.host, 'x-forwarded-for': forwardedFor(req), connection: 'Upgrade', upgrade: req.headers.upgrade ?? 'websocket' }
	const upstream = client.request(url, { method: req.method, headers })
	upstream.on('upgrade', (answer, gatewaySocket, gatewayHead) => {
		log('WS', url, 101)
		const lines = [`HTTP/1.1 101 ${answer.statusMessage ?? 'Switching Protocols'}`]
		for (let i = 0; i < answer.rawHeaders.length; i += 2) {
			if (answer.rawHeaders[i].toLowerCase() !== 'set-cookie') lines.push(`${answer.rawHeaders[i]}: ${answer.rawHeaders[i + 1]}`)
		}
		socket.write(`${lines.join('\r\n')}\r\n\r\n`)
		if (gatewayHead?.length) socket.write(gatewayHead)
		if (head?.length) gatewaySocket.write(head)
		gatewaySocket.pipe(socket)
		socket.pipe(gatewaySocket)
		const close = () => { socket.destroy(); gatewaySocket.destroy() }
		socket.on('error', close)
		gatewaySocket.on('error', close)
		socket.on('close', close)
		gatewaySocket.on('close', close)
	})
	// the gateway refused the upgrade (401, 404, 503): its answer, as it is
	upstream.on('response', (answer) => {
		log('WS', url, answer.statusCode)
		const lines = [`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage ?? ''}`]
		for (const [name, value] of Object.entries(without(answer.headers, DROPPED_RESPONSE))) lines.push(`${name}: ${value}`)
		lines.push('Connection: close')
		socket.write(`${lines.join('\r\n')}\r\n\r\n`)
		answer.pipe(socket)
	})
	upstream.on('error', (error) => {
		log('WS', url, 502)
		refuse(502, { error: 'BadGatewayError', message: `the IDE can't reach ${url.origin}: ${error.code ?? error.message}` })
	})
	socket.on('error', () => upstream.destroy())
	upstream.end()
}

// the app: nothing from elsewhere (Monaco and its workers are bundled), never framed; it talks only to its own origin
const SECURITY = {
	'Content-Security-Policy': "default-src 'self'; connect-src 'self' data: blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'no-referrer',
	'X-Content-Type-Options': 'nosniff'
}
const TYPES = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8'
}

/** The static files of the app: the page never cached, its assets (named by their hash) for a year; else the page */
const serveStatic = (req, res, dist) => {
	if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'MethodNotAllowedError', message: `${req.method} ${req.url}` })
	let pathname
	try { pathname = decodeURIComponent(new URL(req.url, 'http://ide').pathname) } catch { return sendJson(res, 400, { error: 'BadRequestError', message: 'an invalid path' }) }
	let file = path.join(dist, path.normalize(pathname).replace(/^([/\\])+/, ''))
	if (!file.startsWith(dist)) return sendJson(res, 404, { error: 'NotFoundError', message: pathname })
	if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
		// an asset that is not there is a 404; any other path is the app (its own routes)
		if (pathname.startsWith('/assets/')) return sendJson(res, 404, { error: 'NotFoundError', message: pathname })
		file = path.join(dist, 'index.html')
	}
	const asset = file.startsWith(path.join(dist, 'assets') + path.sep)
	res.writeHead(200, { ...SECURITY, 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': asset ? 'public, max-age=31536000, immutable' : 'no-cache' })
	if (req.method === 'HEAD') return res.end()
	fs.createReadStream(file).pipe(res)
}

/**
 * The desktop app (docs/DATA_GATEWAY_IDE_DESKTOP_PLAN.md §3.2): this server only proxies, on 127.0.0.1, for the page of
 * the app (its origin, app://ide). A request needs the token of this run in its path (/t/<token>/gw/…: a WebSocket
 * can't send headers), comes from that origin (CORS answered only to it) and names this server as its Host (DNS
 * rebinding). Anything else is a 403: another process or web page of the machine can't use it as a proxy.
 */
const desktopGuard = (req, desktop, port) => {
	const prefix = `/t/${desktop.token}`
	if (!req.url.startsWith(`${prefix}/`)) return { status: 403, error: 'ForbiddenError', message: 'not a request of the app' }
	if (req.headers.host !== `127.0.0.1:${port}`) return { status: 403, error: 'ForbiddenError', message: 'not a host of the app' }
	if (req.headers.origin !== desktop.appOrigin) return { status: 403, error: 'ForbiddenError', message: 'not an origin of the app' }
	return { url: req.url.slice(prefix.length) }
}

/** CORS for the page of the desktop app only: whatever headers and method it asks for (a connection names its own key header) */
const corsFor = (req, appOrigin) => ({
	'Access-Control-Allow-Origin': appOrigin,
	'Access-Control-Allow-Methods': req.headers['access-control-request-method'] ?? 'GET, POST, PUT, PATCH, DELETE',
	'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
	'Access-Control-Expose-Headers': '*',
	'Access-Control-Max-Age': '600',
	// Private Network Access: the page (app://) reaches a loopback address
	...(req.headers['access-control-request-private-network'] ? { 'Access-Control-Allow-Private-Network': 'true' } : {}),
	Vary: 'Origin'
})

/**
 * @param options.dist the app (static files); none in the desktop app, which serves it itself
 * @param options.targets the origins the proxy may reach ('*': any)
 * @param options.desktop { token, appOrigin }: the desktop mode (only proxy, only for that page)
 */
export const createServer = ({ dist = path.resolve(process.env.DATA_GATEWAY_IDE_DIST ?? path.join(here, '..', 'dist')), targets = targetsOf(process.env.DATA_GATEWAY_IDE_TARGETS), desktop } = {}) => {
	const portOf = () => server.address()?.port
	const server = http.createServer((req, res) => {
		if (req.url === '/health') {
			res.writeHead(200, { 'Content-Type': 'text/plain' })
			return res.end('ok')
		}
		if (desktop) {
			const guard = desktopGuard(req, desktop, portOf())
			if (!guard.url) return sendJson(res, guard.status, { error: guard.error, message: guard.message })
			const cors = corsFor(req, desktop.appOrigin)
			if (req.method === 'OPTIONS') {
				res.writeHead(204, cors)
				return res.end()
			}
			for (const [name, value] of Object.entries(cors)) res.setHeader(name, value)
			req.url = guard.url
			if (req.url.startsWith('/gw/')) return proxy(req, res, targets)
			return sendJson(res, 404, { error: 'NotFoundError', message: req.url })
		}
		if (req.url.startsWith('/gw/')) return proxy(req, res, targets)
		serveStatic(req, res, dist)
	})
	server.on('upgrade', (req, socket, head) => {
		if (desktop) {
			const guard = desktopGuard(req, desktop, portOf())
			if (!guard.url) return socket.end(`HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n`)
			req.url = guard.url
		}
		if (req.url.startsWith('/gw/')) return upgrade(req, socket, head, targets)
		socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
	})
	// a long command or an SSE stream may take long: no timeout of its own (the gateway has server.timeout)
	server.requestTimeout = 0
	server.headersTimeout = 60000
	return server
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	const port = Number(process.env.PORT ?? 8080)
	const host = process.env.HOST ?? '0.0.0.0'
	const targets = targetsOf(process.env.DATA_GATEWAY_IDE_TARGETS)
	const server = createServer({ targets })
	server.listen(port, host, () => {
		const reach = targets === '*' ? 'any target (DATA_GATEWAY_IDE_TARGETS=*)' : targets.size ? [...targets].join(', ') : 'no target: set DATA_GATEWAY_IDE_TARGETS'
		console.log(`[data-gateway-ide] listening on ${host}:${port}; the proxy reaches ${reach}`)
	})
	const stop = () => server.close(() => process.exit(0))
	process.on('SIGTERM', stop)
	process.on('SIGINT', stop)
}
