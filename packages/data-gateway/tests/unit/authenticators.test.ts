// Authenticators: the right secret gives the credential's principal, anything else a reason (never an exception).
import { ApiKeyAuthenticator, BasicAuthenticator, BearerAuthenticator, NoneAuthenticator, secretEquals } from '../../src/lib/infrastructure/output/auth/authenticators'

const credentials = [
	{ name: 'agent', value: 'k-agent', permissions: ['read' as const] },
	{ name: 'backend', value: 'k-backend', permissions: ['read' as const, 'write' as const] }
]

describe('authenticators', () => {
	test('none: anonymous with every permission', async () => {
		const result = await new NoneAuthenticator().authenticate()
		expect(result.valid).toBe(true)
		expect(result.principal?.name).toBe('anonymous')
		expect([...result.principal!.permissions]).toEqual(['read', 'write', 'script', 'queue', 'stageImport'])
	})

	test('bearer', async () => {
		const auth = new BearerAuthenticator(credentials)
		const ok = await auth.authenticate({ authorization: 'Bearer k-backend' })
		expect(ok.principal?.name).toBe('backend')
		expect([...ok.principal!.permissions]).toEqual(['read', 'write'])
		for (const authorization of [undefined, '', 'Bearer wrong', 'k-backend', 'Basic k-backend']) {
			const bad = await auth.authenticate({ authorization })
			// recognized: a bearer token was sent (a wrong one); else another method of authentication.methods may take it
			expect(bad).toEqual({ valid: false, reason: 'a valid token is required (Authorization: Bearer <token>)', recognized: authorization === 'Bearer wrong' })
		}
	})

	test('api key, on its header', async () => {
		const auth = new ApiKeyAuthenticator(credentials, 'x-api-key')
		expect((await auth.authenticate({ 'x-api-key': 'k-agent' })).principal?.name).toBe('agent')
		expect((await auth.authenticate({ 'x-api-key': ['k-agent'] })).principal?.name).toBe('agent')
		expect((await auth.authenticate({ authorization: 'Bearer k-agent' })).valid).toBe(false)
	})

	test('the context of a key is the one of its principal (with roles too); without it, none', async () => {
		const auth = new ApiKeyAuthenticator([
			{ name: 'ana', value: 'k-ana', permissions: ['read' as const], context: { username: 'ana@acme' } },
			{ name: 'bob', value: 'k-bob', permissions: [], roles: ['analyst'], context: { username: 'bob@acme' } },
			...credentials
		], 'x-api-key')
		expect((await auth.authenticate({ 'x-api-key': 'k-ana' })).principal?.context).toEqual({ username: 'ana@acme' })
		expect((await auth.authenticate({ 'x-api-key': 'k-bob' })).principal).toMatchObject({ roles: ['analyst'], context: { username: 'bob@acme' } })
		expect((await auth.authenticate({ 'x-api-key': 'k-agent' })).principal?.context).toBeUndefined()
	})

	test('basic', async () => {
		const auth = new BasicAuthenticator([{ name: 'ana', username: 'ana', password: 'p:ss', permissions: ['read'] }])
		const basic = (text: string) => 'Basic ' + Buffer.from(text).toString('base64')
		expect((await auth.authenticate({ authorization: basic('ana:p:ss') })).principal?.name).toBe('ana')
		expect((await auth.authenticate({ authorization: basic('ana:wrong') })).valid).toBe(false)
		expect((await auth.authenticate({ authorization: basic('bob:p:ss') })).valid).toBe(false)
	})

	test('secret comparison', () => {
		expect(secretEquals('abc', 'abc')).toBe(true)
		expect(secretEquals('abc', 'abd')).toBe(false)
		expect(secretEquals('abc', 'abcd')).toBe(false)
		expect(secretEquals('', '')).toBe(true)
	})
})
