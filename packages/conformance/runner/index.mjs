#!/usr/bin/env node
// The reference runner of the conformance suite: every case of cases/*.json on every transport of the gateway, and a
// matrix case × transport. A client's runner does the same with the client (README.md).
//
//   node runner/index.mjs [--transport http,ws,mcp+http,mcp+sse,mcp+ws] [--case <text in the name>]
//
// Environment: CONFORMANCE_HOST (default 127.0.0.1) and the ports of docker-compose.yml.
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, GatewayError } from './transports.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = process.env.CONFORMANCE_HOST ?? '127.0.0.1'
const SCHEMA = 'northwind'
export const CONNECTIONS = {
	http: `http://${HOST}:19080/${SCHEMA}`,
	ws: `ws://${HOST}:19083/${SCHEMA}`,
	'mcp+http': `mcp+http://${HOST}:19081/${SCHEMA}`,
	'mcp+sse': `mcp+sse://${HOST}:19081/${SCHEMA}`,
	'mcp+ws': `mcp+ws://${HOST}:19082/${SCHEMA}`
}
export const CREDENTIALS = { reader: 'conformance-reader-key', backend: 'conformance-backend-key' }

// ----------------------------------------------------------------------------------------------------------- the cases
export const loadCases = () => readdirSync(join(ROOT, 'cases')).filter(f => f.endsWith('.json')).sort()
	.flatMap(file => JSON.parse(readFileSync(join(ROOT, 'cases', file), 'utf8')).map(c => ({ ...c, file })))

/** a case of one step can be written without steps */
export const stepsOf = (testCase) => testCase.steps ?? [{ operation: testCase.operation, args: testCase.args, expect: testCase.expect, mcp: testCase.mcp }]

/** "$0", "$1"…: the result of that step; "$transport": the name of the transport (for values that must not collide) */
export const resolve = (value, results, transport) => {
	if (typeof value === 'string') {
		if (value === '$transport') return transport
		const ref = /^\$(\d+)$/.exec(value)
		if (ref) return results[Number(ref[1])]
		return value.replaceAll('$transport', transport)
	}
	if (Array.isArray(value)) return value.map(v => resolve(v, results, transport))
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, results, transport)]))
	return value
}

/** the expectation of a step on a transport: `mcp` replaces it on the three MCP transports */
export const expectationOf = (step, transport, results) =>
	resolve((transport.startsWith('mcp+') && step.mcp) ? step.mcp : step.expect, results, transport)

// ------------------------------------------------------------------------------------------------------- comparisons
const deepEqual = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v
/** every key of expected is in actual with a matching value; lists have the same length and match one by one */
const matches = (actual, expected) => {
	if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => matches(actual[i], e))
	if (expected && typeof expected === 'object') return actual !== null && typeof actual === 'object' && Object.entries(expected).every(([k, e]) => matches(actual[k], e))
	return actual === expected
}
const show = (v) => { const text = JSON.stringify(v); return text === undefined ? 'undefined' : text.length > 300 ? text.slice(0, 300) + '…' : text }

/** null when the outcome is what was expected; else what went wrong */
export const check = (expect, outcome) => {
	if (expect.error) {
		if (!outcome.error) return `expected the error ${show(expect.error)}, got the result ${show(outcome.result)}`
		const e = outcome.error
		if (e.code !== expect.error.code) return `expected the error code ${expect.error.code}, got ${e.code} (${e.errorName ?? '?'} ${e.status ?? ''}: ${e.message})`
		if (expect.error.name && e.errorName !== expect.error.name) return `expected the error ${expect.error.name}, got ${e.errorName}`
		return null
	}
	if (outcome.error) return `unexpected error ${outcome.error.code} (${outcome.error.errorName ?? '?'} ${outcome.error.status ?? ''}): ${outcome.error.message}`
	const r = outcome.result
	if ('result' in expect && !deepEqual(r, expect.result)) return `expected ${show(expect.result)}, got ${show(r)}`
	if ('match' in expect && !matches(r, expect.match)) return `expected to match ${show(expect.match)}, got ${show(r)}`
	if ('length' in expect && (!Array.isArray(r) || r.length !== expect.length)) return `expected a list of ${expect.length}, got ${Array.isArray(r) ? `a list of ${r.length}` : show(r)}`
	if ('keys' in expect && !(r && typeof r === 'object' && expect.keys.every(k => k in r))) return `expected the keys ${show(expect.keys)}, got ${show(r)}`
	if ('type' in expect && typeof r !== expect.type) return `expected a ${expect.type}, got ${show(r)}`
	return null
}

// ------------------------------------------------------------------------------------------------------------- the run
const runCase = async (testCase, transport, connections) => {
	const results = []
	for (const [i, step] of stepsOf(testCase).entries()) {
		const conn = await connections(testCase.credential ?? 'reader')
		const outcome = {}
		try {
			outcome.result = await conn.call(step.operation, resolve(step.args ?? {}, results, transport))
		} catch (error) {
			if (!(error instanceof GatewayError)) throw error
			outcome.error = error
		}
		results.push(outcome.result)
		const problem = check(expectationOf(step, transport, results), outcome)
		if (problem) return `step ${i} (${step.operation}): ${problem}`
	}
	return null
}

const main = async () => {
	const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
	const transports = (arg('--transport') ?? Object.keys(CONNECTIONS).join(',')).split(',')
	const filter = arg('--case')
	const cases = loadCases().filter(c => !filter || c.name.includes(filter))
	const failures = []
	let passed = 0
	for (const transport of transports) {
		const open = {}
		const connections = async (credential) => {
			open[credential] ??= await connect(CONNECTIONS[transport], { 'X-Api-Key': CREDENTIALS[credential] })
			return open[credential]
		}
		console.log(`\n${transport}  ${CONNECTIONS[transport]}`)
		for (const testCase of cases) {
			if (testCase.transports && !testCase.transports.includes(transport)) continue
			let problem
			try {
				problem = await runCase(testCase, transport, connections)
			} catch (error) {
				problem = `failed to run: ${error.message}`
			}
			if (problem) failures.push({ transport, name: testCase.name, problem })
			else passed++
			console.log(`  ${problem ? '✗' : '✓'} ${testCase.name}${problem ? `\n      ${problem}` : ''}`)
		}
		for (const conn of Object.values(open)) await conn.close()
	}
	console.log(`\n${passed} passed, ${failures.length} failed (${cases.length} cases × ${transports.length} transports)`)
	process.exit(failures.length ? 1 : 0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
