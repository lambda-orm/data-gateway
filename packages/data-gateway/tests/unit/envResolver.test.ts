// Environment variables in the configuration file (docs/DATA_GATEWAY.md §2).
import { resolveEnv } from '../../src/lib/infrastructure/output/config/envResolver'

const env = { PORT: '8080', HOST: 'db', TOKEN: 's3cret' }

describe('environment variables', () => {
	test('a whole $VAR or ${VAR} takes the value, or undefined (the key disappears) when not defined', () => {
		expect(resolveEnv({ port: '$PORT', token: '${TOKEN}', size: '$SIZE', host: '${MISSING}' }, env))
			.toEqual({ port: '8080', token: 's3cret' })
	})

	test('${VAR} inside a string is interpolated; one missing makes the whole value undefined', () => {
		expect(resolveEnv({ url: 'http://${HOST}:${PORT}/x', other: '${HOST}:${NOPE}' }, env)).toEqual({ url: 'http://db:8080/x' })
	})

	test('a $ that is not a variable is kept (secrets may contain $)', () => {
		expect(resolveEnv({ token: 'a$b', price: '10$', text: 'US$ 5' }, env)).toEqual({ token: 'a$b', price: '10$', text: 'US$ 5' })
	})

	test('the whole tree: lists, nested objects, other types untouched', () => {
		expect(resolveEnv({ list: ['$PORT', 'x', '$NOPE'], deep: { a: { b: '$HOST' } }, n: 1, b: true, z: null }, env))
			.toEqual({ list: ['8080', 'x', undefined], deep: { a: { b: 'db' } }, n: 1, b: true, z: null })
	})
})
