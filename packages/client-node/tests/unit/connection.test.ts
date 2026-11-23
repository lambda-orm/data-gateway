// The connection string: its scheme is the transport; the credential goes apart, never in the URL. No gateway.
import { parseConnection } from '../../src/lib'

describe('connection string', () => {
	test.each([
		['http://localhost:8080/northwind', 'http', 'http://localhost:8080/northwind'],
		['https://api.example.com/data/accounts/v1/', 'http', 'https://api.example.com/data/accounts/v1'],
		['ws://localhost:8083/northwind', 'ws', 'ws://localhost:8083/northwind'],
		['wss://gw/iot/v1', 'ws', 'wss://gw/iot/v1'],
		['mcp+http://localhost:8081/northwind', 'mcp+http', 'http://localhost:8081/northwind'],
		['mcp+https://gw/iot/v1', 'mcp+http', 'https://gw/iot/v1'],
		['mcp+sse://localhost:8081/northwind', 'mcp+sse', 'http://localhost:8081/northwind'],
		['mcp+sses://gw/iot/v1', 'mcp+sse', 'https://gw/iot/v1'],
		['mcp+ws://localhost:8082/northwind', 'mcp+ws', 'ws://localhost:8082/northwind'],
		['mcp+wss://gw/iot/v1', 'mcp+ws', 'wss://gw/iot/v1']
	])('%s → %s', (connection, transport, url) => {
		expect(parseConnection(connection, {}, {})).toMatchObject({ transport, url })
	})

	test('unknown scheme', () => {
		expect(() => parseConnection('ftp://gw/northwind', {}, {})).toThrow('unknown transport ftp')
	})

	test('a credential in the URL is an error, not a warning', () => {
		expect(() => parseConnection('http://user:secret@gw/northwind', {}, {})).toThrow('has a credential')
		expect(() => parseConnection('http://gw/northwind?apiKey=secret', {}, {})).toThrow('has a credential (apiKey=)')
		expect(() => parseConnection('ws://gw/northwind?token=secret', {}, {})).toThrow('has a credential (token=)')
	})

	test('options of the URL without secrets: timeout and stage; anything else is an error', () => {
		expect(parseConnection('http://gw/northwind?timeout=5000&stage=reports', {}, {})).toMatchObject({ timeout: 5000, stage: 'reports' })
		expect(() => parseConnection('http://gw/northwind?retries=3', {}, {})).toThrow('unknown option of the connection string: retries')
	})

	test('the credential as headers: apiKey (X-Api-Key, or another header) and token (Bearer)', () => {
		expect(parseConnection('http://gw/n', { apiKey: 'k' }, {}).headers).toEqual({ 'X-Api-Key': 'k' })
		expect(parseConnection('http://gw/n', { apiKey: 'k', apiKeyHeader: 'X-Key' }, {}).headers).toEqual({ 'X-Key': 'k' })
		expect(parseConnection('http://gw/n', { token: 't', headers: { 'X-Trace': '1' } }, {}).headers).toEqual({ Authorization: 'Bearer t', 'X-Trace': '1' })
	})

	test('the environment: DATA_GATEWAY_URL, DATA_GATEWAY_API_KEY, DATA_GATEWAY_TOKEN; what is given wins', () => {
		const env = { DATA_GATEWAY_URL: 'ws://gw/iot/v1', DATA_GATEWAY_API_KEY: 'env-key', DATA_GATEWAY_TOKEN: 'env-token' }
		expect(parseConnection(undefined, {}, env)).toMatchObject({ transport: 'ws', headers: { 'X-Api-Key': 'env-key', Authorization: 'Bearer env-token' } })
		expect(parseConnection('http://gw/n', { apiKey: 'given' }, env).headers['X-Api-Key']).toBe('given')
		expect(() => parseConnection(undefined, {}, {})).toThrow('DATA_GATEWAY_URL')
	})

	test('defaults: 30 s, a cut list is an error', () => {
		expect(parseConnection('http://gw/n', {}, {})).toMatchObject({ timeout: 30000, onTruncated: 'error' })
		expect(parseConnection('http://gw/n', { timeout: 1000, onTruncated: 'return' }, {})).toMatchObject({ timeout: 1000, onTruncated: 'return' })
	})
})
