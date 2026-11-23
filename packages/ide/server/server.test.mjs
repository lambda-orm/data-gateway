// The backend of the IDE against a fake gateway: the targets it may reach, what it forwards and drops, a gateway it
// can't reach, the upgrade of a WebSocket (its subprotocols, then the bytes both ways), and the app with its headers.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer, targetOf, targetsOf } from './server.mjs'

// every socket of the servers of a test (also the upgraded ones), destroyed at the end
const sockets = new Set()
const listen = (server) => {
	server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
	return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}
const b64 = (text) => Buffer.from(text).toString('base64url')

let gateway, gatewayPort, ide, idePort, dist
const seen = []

before(async () => {
	gateway = http.createServer((req, res) => {
		seen.push({ method: req.method, url: req.url, headers: req.headers })
		let body = ''
		req.on('data', chunk => { body += chunk })
		req.on('end', () => {
			res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': 'a=b', 'X-Gateway': 'yes' })
			res.end(JSON.stringify({ method: req.method, url: req.url, body }))
		})
	})
	gateway.on('upgrade', (req, socket) => {
		if (req.headers['sec-websocket-protocol'] !== 'lambdaorm, lambdaorm.headers.abc') {
			socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n{"error":"Unauthorized"}')
			return
		}
		socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: lambdaorm\r\n\r\n')
		socket.on('data', data => socket.write(`echo:${data}`))
	})
	gatewayPort = await listen(gateway)
	dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-dist-'))
	fs.mkdirSync(path.join(dist, 'assets'))
	fs.writeFileSync(path.join(dist, 'index.html'), '<html>ide</html>')
	fs.writeFileSync(path.join(dist, 'assets', 'app-1.js'), 'console.log(1)')
	ide = createServer({ dist, targets: targetsOf(`http://127.0.0.1:${gatewayPort}, not a url`) })
	idePort = await listen(ide)
})

after(() => {
	for (const server of [ide, gateway]) server.close()
	for (const socket of sockets) socket.destroy()
})

const at = (target, rest = '') => `http://127.0.0.1:${idePort}/gw/${b64(target)}${rest}`

test('targets: * or origins; the path and the query of a target', () => {
	assert.equal(targetsOf('*'), '*')
	assert.deepEqual([...targetsOf('http://a:1/x, https://b')], ['http://a:1', 'https://b'])
	assert.equal(targetsOf(undefined).size, 0)
	const { url } = targetOf(`/gw/${b64('http://a:1/data-gateway/')}/admin/workspaces?x=1`, '*')
	assert.equal(url.toString(), 'http://a:1/data-gateway/admin/workspaces?x=1')
	assert.equal(targetOf(`/gw/${b64('http://a:1')}`, '*').url.toString(), 'http://a:1/')
	assert.equal(targetOf(`/gw/${b64('file:///etc/passwd')}/x`, '*').status, 400)
	assert.equal(targetOf(`/gw/${b64('http://u:p@a:1')}/x`, '*').status, 400)
	assert.equal(targetOf(`/gw/${b64('http://a:1')}/x`, new Set(['http://b:1'])).error, 'ForbiddenTargetError')
})

test('a request: method, body, query and the credential forwarded; cookies, origin and set-cookie dropped', async () => {
	const res = await fetch(at(`http://127.0.0.1:${gatewayPort}/base`, '/iot/execute?format=beautiful'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'k', Cookie: 'session=1', Origin: 'http://ide' },
		body: JSON.stringify({ query: 'A' })
	})
	assert.equal(res.status, 201)
	assert.deepEqual(await res.json(), { method: 'POST', url: '/base/iot/execute?format=beautiful', body: '{"query":"A"}' })
	assert.equal(res.headers.get('x-gateway'), 'yes')
	assert.equal(res.headers.get('set-cookie'), null)
	const last = seen.at(-1)
	assert.equal(last.headers['x-api-key'], 'k')
	assert.equal(last.headers.host, `127.0.0.1:${gatewayPort}`)
	assert.equal(last.headers.cookie, undefined)
	assert.equal(last.headers.origin, undefined)
})

test('a target not allowed: 403 that says how; a gateway not reached: 502', async () => {
	const forbidden = await fetch(at('http://127.0.0.1:1', '/schemas'))
	assert.equal(forbidden.status, 403)
	assert.match((await forbidden.json()).message, /DATA_GATEWAY_IDE_TARGETS/)
	const open = createServer({ dist, targets: '*' })
	const port = await listen(open)
	try {
		const down = await fetch(`http://127.0.0.1:${port}/gw/${b64('http://127.0.0.1:1')}/schemas`)
		assert.equal(down.status, 502)
		assert.equal((await down.json()).error, 'BadGatewayError')
	} finally {
		open.close()
		open.closeAllConnections()
	}
})

const upgradeTo = (url, protocols) => new Promise((resolve, reject) => {
	const req = http.request(url, { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Protocol': protocols } })
	req.on('upgrade', (res, socket) => resolve({ res, socket }))
	req.on('response', res => resolve({ res }))
	req.on('error', reject)
	req.end()
})

test('a WebSocket: the upgrade with its subprotocols, then the bytes both ways; a refusal as the gateway says it', async () => {
	const { res, socket } = await upgradeTo(at(`http://127.0.0.1:${gatewayPort}`, '/iot'), 'lambdaorm, lambdaorm.headers.abc')
	assert.equal(res.statusCode, 101)
	assert.equal(res.headers['sec-websocket-protocol'], 'lambdaorm')
	const echoed = new Promise(resolve => socket.once('data', data => resolve(String(data))))
	socket.write('hello')
	assert.equal(await echoed, 'echo:hello')
	socket.destroy()
	const refused = await upgradeTo(at(`http://127.0.0.1:${gatewayPort}`, '/iot'), 'lambdaorm')
	assert.equal(refused.res.statusCode, 401)
	refused.res.socket?.destroy()
	const forbidden = await upgradeTo(at('http://127.0.0.1:1', '/iot'), 'lambdaorm')
	assert.equal(forbidden.res.statusCode, 403)
	forbidden.res.socket?.destroy()
})

test('the app: its page (also for its own routes) never cached, its assets for a year, with its security headers', async () => {
	const page = await fetch(`http://127.0.0.1:${idePort}/`)
	assert.equal(await page.text(), '<html>ide</html>')
	assert.equal(page.headers.get('cache-control'), 'no-cache')
	assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/)
	assert.equal(page.headers.get('x-frame-options'), 'DENY')
	assert.equal(await (await fetch(`http://127.0.0.1:${idePort}/some/route`)).text(), '<html>ide</html>')
	const asset = await fetch(`http://127.0.0.1:${idePort}/assets/app-1.js`)
	assert.match(asset.headers.get('cache-control'), /immutable/)
	assert.equal((await fetch(`http://127.0.0.1:${idePort}/assets/missing.js`)).status, 404)
	assert.equal((await fetch(`http://127.0.0.1:${idePort}/../../etc/passwd`)).status, 200) // the app, never a file outside
	assert.equal(await (await fetch(`http://127.0.0.1:${idePort}/health`)).text(), 'ok')
})
