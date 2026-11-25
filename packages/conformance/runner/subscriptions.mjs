#!/usr/bin/env node
// The subscriptions of the gateway (docs/SUBSCRIPTIONS.md) against the suite's northwind: over WebSocket (JSON-RPC) and
// over SSE, a subscription to an entity and one to a query; a write over REST must reach both, and one of a role whose
// view filters its rows must not tell it of rows it can't see. Node ≥ 22, no dependencies.
//
//   node runner/subscriptions.mjs
import { CONNECTIONS, CREDENTIALS, jwt } from './index.mjs'

const REST = CONNECTIONS.http
const WS = CONNECTIONS.ws
const KEY = { 'X-Api-Key': CREDENTIALS.backend }
const failures = []
const check = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      ${detail}`}`); if (!ok) failures.push(name) }

const rest = async (query, data = {}) => {
	const response = await fetch(`${REST}/execute`, { method: 'POST', headers: { ...KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, data }) })
	return response.json()
}

/** a WebSocket of JSON-RPC: requests by id, and the notifications it receives */
const socket = (headers) => new Promise((resolve, reject) => {
	const ws = new WebSocket(WS, { headers })
	const pending = new Map()
	const notifications = []
	let next = 1
	ws.onerror = () => reject(new Error(`can't connect to ${WS}`))
	ws.onmessage = event => {
		const message = JSON.parse(String(event.data))
		if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } else if (message.method) notifications.push(message)
	}
	ws.onopen = () => resolve({
		notifications,
		request: (method, params) => new Promise(done => { const id = next++; pending.set(id, done); ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })) }),
		close: () => ws.close()
	})
})

/** an SSE stream: the events it receives, until closed */
const stream = async (path, headers) => {
	const abort = new AbortController()
	const response = await fetch(`${REST}${path}`, { headers: { ...headers, Accept: 'text/event-stream' }, signal: abort.signal })
	const events = []
	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	;(async () => {
		try {
			for (;;) {
				const { value, done } = await reader.read()
				if (done) break
				buffer += decoder.decode(value, { stream: true })
				let end
				while ((end = buffer.indexOf('\n\n')) >= 0) {
					const block = buffer.slice(0, end)
					buffer = buffer.slice(end + 2)
					const event = /^event: (.*)$/m.exec(block)?.[1]
					const data = /^data: (.*)$/m.exec(block)?.[1]
					if (event) events.push({ event, data: data ? JSON.parse(data) : undefined })
				}
			}
		} catch { /* aborted */ }
	})()
	return { status: response.status, events, close: () => abort.abort() }
}

const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await new Promise(r => setTimeout(r, 50)) } return false }

const main = async () => {
	console.log(`\nsubscriptions  ${WS}  ${REST}/subscribe`)
	const name = `conformance subscriptions ${Date.now()}`
	const ws = await socket(KEY)
	const entity = await ws.request('subscribe.entity', { entity: 'Categories' })
	const query = await ws.request('subscribe.query', { query: 'Categories.filter(p => p.name == name).map(p => p.name)', data: { name } })
	check('WebSocket: subscribe.entity and subscribe.query answer their subscription', !!entity.result?.subscription && !!query.result?.subscription && Array.isArray(query.result.result) && query.result.result.length === 0, JSON.stringify({ entity, query }))
	const sse = await stream(`/subscribe?entity=Categories`, KEY)
	check('SSE: GET /subscribe is an event stream', sse.status === 200 && await until(() => sse.events.some(e => e.event === 'subscribed')), JSON.stringify(sse.events))

	// a user of the view sales (the customers of Germany): a write of a customer of France is not told to it
	const sales = await socket({ Authorization: `Bearer ${jwt('jwt-sales', ['sales'], 600, { country: 'Germany' })}` })
	await sales.request('subscribe.entity', { entity: 'Customers' })

	const inserted = await rest('Categories.insert()', { name })
	await rest('Customers.update(p => ({ name: name })).filter(p => p.id == id)', { id: 'BLONP', name: 'Blondel père et fils' })
	await rest('Customers.update(p => ({ name: name })).filter(p => p.id == id)', { id: 'ALFKI', name: 'Alfreds Futterkiste' })
	check('WebSocket: data.changed of the entity, with its keys', await until(() => ws.notifications.some(n => n.method === 'data.changed' && n.params.entity === 'Categories' && n.params.action === 'insert' && n.params.keys?.length === 1)), JSON.stringify(ws.notifications))
	check('WebSocket: query.changed with the new result', await until(() => ws.notifications.some(n => n.method === 'query.changed' && JSON.stringify(n.params.result) === JSON.stringify([{ name }]))), JSON.stringify(ws.notifications))
	check('SSE: data.changed of the entity', await until(() => sse.events.some(e => e.event === 'data.changed' && e.data.entity === 'Categories')), JSON.stringify(sse.events))
	check('a view: only the change of a row it sees (ALFKI, not BLONP)', await until(() => sales.notifications.some(n => n.params?.keys?.some(k => k.id === 'ALFKI'))) && !sales.notifications.some(n => n.params?.keys?.some(k => k.id === 'BLONP')), JSON.stringify(sales.notifications))

	await rest('Categories.delete().filter(p => p.name == name)', { name })
	ws.close(); sales.close(); sse.close()
	console.log(`\n${failures.length ? `${failures.length} failed` : 'subscriptions passed'}`)
	process.exit(failures.length ? 1 : 0)
	void inserted
}

main().catch(error => { console.error(error); process.exit(1) })
