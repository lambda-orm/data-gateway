// JWT / OIDC (docs/JWT.md): the configuration, the tokens of an issuer checked with its JWKS (served here, with keys made
// here: rotation, an issuer down, discovery), the principal of the claims (name, roles → permissions, context) and the
// methods in order (a JWT for the users, an API key for the services).
import http from 'http'
import { AddressInfo } from 'net'
import { exportJWK, generateKeyPair, JWK, SignJWT } from 'jose'
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { JwtConfig } from '../../src/lib/domain/config/dataGatewayConfig'
import { JwtAuthenticator, claimOf } from '../../src/lib/infrastructure/output/auth/jwtAuthenticator'
import { ApiKeyAuthenticator, MethodsAuthenticator } from '../../src/lib/infrastructure/output/auth/authenticators'
import { requestOptions } from '../../src/lib/application/usecases/requestOptions'
import { principal, refusalOf } from '../../src/lib/domain/auth/principal'

const minimal = { orm: { schemas: [{ path: 'shop', workspace: '/tmp/shop' }] }, transports: { http: { port: 9291 } } }
const read = (authentication: unknown) => new ConfigReader().read({ ...minimal, authentication })

describe('configuration', () => {
	test('jwt: the issuer, its roles mapped to permissions and its claims to the context; defaults', () => {
		const reading = read({
			adapter: 'jwt',
			issuer: 'https://auth.example.com/realms/shop',
			audience: 'data-gateway',
			principal: { name: 'preferred_username', permissions: { claim: 'realm_access.roles', roles: { reader: ['read'], backend: ['read', 'write'] } } },
			context: { tenant: 'tenant_id' }
		})
		expect(reading.issues).toEqual([])
		expect(reading.config?.authentication).toEqual({
			adapter: 'jwt',
			credentials: [],
			jwt: {
				issuer: 'https://auth.example.com/realms/shop',
				audience: ['data-gateway'],
				algorithms: ['RS256', 'ES256', 'PS256'],
				clockToleranceSec: 30,
				principal: { name: 'preferred_username', permissions: { claim: 'realm_access.roles', roles: { reader: { permissions: ['read'] }, backend: { permissions: ['read', 'write'] } } } },
				context: { tenant: 'tenant_id' }
			}
		})
		expect(read({ adapter: 'jwt', issuer: 'http://localhost:8180', secret: 's3cret' }).config?.authentication.jwt).toMatchObject({ algorithms: ['HS256'], principal: { name: 'sub' } })
	})

	test('what would leave it open or is wrong stops it', () => {
		const issues = (authentication: unknown) => read(authentication).issues.join('\n')
		expect(issues({ adapter: 'jwt' })).toContain('issuer is required')
		expect(issues({ adapter: 'jwt', issuer: 'ftp://x' })).toContain('is not an http(s) URL')
		expect(issues({ adapter: 'jwt', issuer: 'https://x', algorithms: ['none'] })).toContain('"none" is not RS')
		expect(issues({ adapter: 'jwt', issuer: 'https://x', algorithms: ['HS256'] })).toContain('HS256 needs a secret')
		expect(issues({ adapter: 'jwt', issuer: 'https://x', secret: 's', algorithms: ['RS256'] })).toContain('is for the keys of the issuer')
		expect(issues({ adapter: 'jwt', issuer: 'https://x', secret: '' })).toContain('secret is empty')
		// a role must say its permissions: one without them never gets all
		expect(issues({ adapter: 'jwt', issuer: 'https://x', principal: { permissions: { claim: 'roles', roles: { admin: null } } } })).toContain('roles.admin must be a list')
		expect(issues({ adapter: 'jwt', issuer: 'https://x', principal: { permissions: { claim: 'roles', roles: { admin: ['root'] } } } })).toContain('unknown permissions root')
		expect(issues({ adapter: 'jwt', issuer: 'https://x', context: { 'a-b': 'x' } })).toContain('is not a name of a variable')
		expect(issues({ adapter: 'jwt', issuer: 'https://x', clockTolerance: '1h' })).toContain('up to 5m')
	})

	test('methods: jwt and local keys in order; none is not a method, they don\'t nest', () => {
		const reading = read({ methods: [{ adapter: 'jwt', issuer: 'https://x' }, { adapter: 'local', type: 'apikey', keys: [{ name: 'svc', value: 'k', permissions: ['read'] }] }] })
		expect(reading.issues).toEqual([])
		expect(reading.config?.authentication.adapter).toBe('methods')
		expect(reading.config?.authentication.methods?.map(m => m.adapter)).toEqual(['jwt', 'local'])
		expect(read({ methods: [{ adapter: 'none' }] }).issues.join()).toContain('none would let everyone in')
		expect(read({ methods: [] }).issues.join()).toContain('methods must be a non empty list')
		expect(read({ adapter: 'jwt', methods: [{ adapter: 'jwt', issuer: 'https://x' }] }).issues.join()).toContain('adapter and methods together')
	})
})

describe('claims', () => {
	test('a name as it is (Auth0 names them with a URL) or a path with dots', () => {
		const claims = { 'https://shop.example.com/roles': ['admin'], realm_access: { roles: ['reader'] }, sub: 'u1' }
		expect(claimOf(claims, 'https://shop.example.com/roles')).toEqual(['admin'])
		expect(claimOf(claims, 'realm_access.roles')).toEqual(['reader'])
		expect(claimOf(claims, 'realm_access.nope.deeper')).toBeUndefined()
	})
})

/** An issuer: its keys (the JWKS served here, that can change or fail) and its discovery document */
class Issuer {
	public keys: JWK[] = []
	public down = false
	public jwksRequests = 0
	private server?: http.Server
	public url = ''

	async start (): Promise<void> {
		this.server = http.createServer((req, res) => {
			if (this.down) { res.writeHead(500).end(); return }
			if (req.url === '/.well-known/openid-configuration') {
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ issuer: this.url, jwks_uri: `${this.url}/certs` }))
				return
			}
			if (req.url === '/certs') {
				this.jwksRequests++
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: this.keys }))
				return
			}
			res.writeHead(404).end()
		})
		await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve))
		this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`
	}

	stop (): Promise<void> { return new Promise(resolve => this.server ? this.server.close(() => resolve()) : resolve()) }
}

type Key = { privateKey: CryptoKey, kid: string, alg: string }
const newKey = async (alg: string, kid: string, issuer: Issuer): Promise<Key> => {
	const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true })
	issuer.keys.push({ ...await exportJWK(publicKey), kid, alg, use: 'sig' })
	return { privateKey: privateKey as CryptoKey, kid, alg }
}
const sign = (key: Key, claims: Record<string, unknown>, options: { iss: string, aud?: string, exp?: string | number, nbf?: number }) => {
	const jwt = new SignJWT(claims).setProtectedHeader({ alg: key.alg, kid: key.kid }).setIssuedAt().setIssuer(options.iss).setExpirationTime(options.exp ?? '5m')
	if (options.aud) jwt.setAudience(options.aud)
	if (options.nbf) jwt.setNotBefore(options.nbf)
	return jwt.sign(key.privateKey)
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('the tokens of an issuer', () => {
	const issuer = new Issuer()
	let rsa: Key
	let config: JwtConfig
	beforeAll(async () => {
		await issuer.start()
		rsa = await newKey('RS256', 'k1', issuer)
		config = {
			issuer: issuer.url,
			audience: ['data-gateway'],
			algorithms: ['RS256', 'ES256'],
			clockToleranceSec: 0,
			principal: { name: 'preferred_username', permissions: { claim: 'realm_access.roles', roles: { reader: { permissions: ['read'] }, backend: { permissions: ['read', 'write', 'script'] } } } },
			context: { tenant: 'tenant_id', region: 'address.region' }
		}
	})
	afterAll(() => issuer.stop())

	test('valid: its name, the permissions of its roles, its context and when it ends; the jwksUri discovered', async () => {
		const authenticator = new JwtAuthenticator(config)
		const token = await sign(rsa, { preferred_username: 'ann', realm_access: { roles: ['reader', 'backend', 'other'] }, tenant_id: 't1', address: { region: 'eu' } }, { iss: issuer.url, aud: 'data-gateway' })
		const result = await authenticator.authenticate(bearer(token))
		expect(result.valid).toBe(true)
		expect(result.principal?.name).toBe('ann')
		expect([...result.principal!.permissions].sort()).toEqual(['read', 'script', 'write'])
		expect(result.principal?.context).toEqual({ tenant: 't1', region: 'eu' })
		expect(result.principal?.expiresAt).toBeGreaterThan(Date.now())
		// no known role: valid, without permissions (403 later, not 401)
		const none = await authenticator.authenticate(bearer(await sign(rsa, { preferred_username: 'bob' }, { iss: issuer.url, aud: 'data-gateway' })))
		expect(none.valid).toBe(true)
		expect([...none.principal!.permissions]).toEqual([])
		expect(none.principal?.context).toBeUndefined()
	})

	test('refused, with why: expired, issuer, audience, not yet valid, signature, algorithm, unknown key, no name', async () => {
		const authenticator = new JwtAuthenticator(config)
		const claims = { preferred_username: 'ann' }
		const reasonOf = async (token: string) => {
			const result = await authenticator.authenticate(bearer(token))
			expect(result.valid).toBe(false)
			expect(refusalOf(result)).toMatchObject({ status: 401, challenge: expect.stringContaining('Bearer error="invalid_token"') })
			return result.reason
		}
		expect(await reasonOf(await sign(rsa, claims, { iss: issuer.url, aud: 'data-gateway', exp: Math.floor(Date.now() / 1000) - 60 }))).toBe('the token is not valid: expired')
		expect(await reasonOf(await sign(rsa, claims, { iss: 'https://other', aud: 'data-gateway' }))).toBe('the token is not valid: issuer')
		expect(await reasonOf(await sign(rsa, claims, { iss: issuer.url, aud: 'another-api' }))).toBe('the token is not valid: audience')
		expect(await reasonOf(await sign(rsa, claims, { iss: issuer.url, aud: 'data-gateway', nbf: Math.floor(Date.now() / 1000) + 600 }))).toBe('the token is not valid: not yet valid')
		const forged = await sign({ ...await newKey('RS256', 'k1-forged', new Issuer()), kid: 'k1' }, claims, { iss: issuer.url, aud: 'data-gateway' })
		expect(await reasonOf(forged)).toBe('the token is not valid: signature')
		const ps = await newKey('PS256', 'k-ps', issuer)
		expect(await reasonOf(await sign(ps, claims, { iss: issuer.url, aud: 'data-gateway' }))).toBe('the token is not valid: algorithm')
		const stranger = await newKey('RS256', 'k-stranger', new Issuer())
		expect(await reasonOf(await sign(stranger, claims, { iss: issuer.url, aud: 'data-gateway' }))).toBe('the token is not valid: unknown key')
		expect(await reasonOf(await sign(rsa, {}, { iss: issuer.url, aud: 'data-gateway' }))).toBe('the token is not valid: no preferred_username')
	})

	test('not a JWT: not recognized (another method may take it)', async () => {
		const authenticator = new JwtAuthenticator(config)
		for (const headers of [{}, { authorization: 'Bearer opaque-token' }, { authorization: 'Basic dTpw' }]) {
			expect(await authenticator.authenticate(headers)).toMatchObject({ valid: false, recognized: false })
		}
	})

	test('the keys rotate: a token of a new kid reads the JWKS again (not more often than the cooldown)', async () => {
		const authenticator = new JwtAuthenticator(config, undefined, { cacheMaxAgeMs: 600_000, cooldownMs: 0 })
		expect((await authenticator.authenticate(bearer(await sign(rsa, { preferred_username: 'ann' }, { iss: issuer.url, aud: 'data-gateway' })))).valid).toBe(true)
		const before = issuer.jwksRequests
		const rotated = await newKey('ES256', 'k2', issuer)
		const result = await authenticator.authenticate(bearer(await sign(rotated, { preferred_username: 'ann' }, { iss: issuer.url, aud: 'data-gateway' })))
		expect(result.valid).toBe(true)
		expect(issuer.jwksRequests).toBe(before + 1)
	})

	test('an issuer that can\'t be reached: 503, not 401; it is tried again', async () => {
		issuer.down = true
		const authenticator = new JwtAuthenticator(config)
		const token = await sign(rsa, { preferred_username: 'ann' }, { iss: issuer.url, aud: 'data-gateway' })
		const down = await authenticator.authenticate(bearer(token))
		expect(refusalOf(down)).toMatchObject({ status: 503, message: expect.stringContaining('can\'t be checked now') })
		expect(down.challenge).toBeUndefined()
		issuer.down = false
		expect((await authenticator.authenticate(bearer(token))).valid).toBe(true)
	})

	test('a shared secret (HS256, development)', async () => {
		const authenticator = new JwtAuthenticator({ ...config, secret: 'a-secret-of-at-least-32-bytes-long!', algorithms: ['HS256'] })
		const key = new TextEncoder().encode('a-secret-of-at-least-32-bytes-long!')
		const token = await new SignJWT({ preferred_username: 'dev' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(issuer.url).setAudience('data-gateway').setExpirationTime('1m').sign(key)
		expect((await authenticator.authenticate(bearer(token))).principal?.name).toBe('dev')
		const other = await new SignJWT({ preferred_username: 'dev' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(issuer.url).setAudience('data-gateway').setExpirationTime('1m').sign(new TextEncoder().encode('another-secret-of-32-bytes-long!!!'))
		expect((await authenticator.authenticate(bearer(other))).reason).toBe('the token is not valid: signature')
	})

	test('methods: a JWT for the users, an API key for the services; the first that recognizes it decides', async () => {
		const methods = new MethodsAuthenticator([new JwtAuthenticator(config), new ApiKeyAuthenticator([{ name: 'billing', value: 'svc-key', permissions: ['read', 'write'] }])])
		expect((await methods.authenticate(bearer(await sign(rsa, { preferred_username: 'ann' }, { iss: issuer.url, aud: 'data-gateway' })))).principal?.name).toBe('ann')
		expect((await methods.authenticate({ 'x-api-key': 'svc-key' })).principal?.name).toBe('billing')
		// a wrong key is refused as a key, an expired JWT as a JWT: not tried by the other
		expect((await methods.authenticate({ 'x-api-key': 'wrong' })).reason).toBe('a valid API key is required (x-api-key)')
		expect((await methods.authenticate(bearer(await sign(rsa, { preferred_username: 'ann' }, { iss: issuer.url, aud: 'data-gateway', exp: 1 }))))).toMatchObject({ valid: false, reason: 'the token is not valid: expired' })
		// nothing: the reasons of both, and the Bearer challenge
		expect(await methods.authenticate({})).toMatchObject({ valid: false, reason: expect.stringContaining('; or a valid API key'), challenge: 'Bearer' })
	})
})

describe('the context reaches λORM from the identity, never from the client', () => {
	test('requestOptions: the context of the principal replaces the one sent', () => {
		const who = { ...principal('ann', ['read']), context: { tenant: 't1' } }
		expect(requestOptions({ stage: 'default', context: { tenant: 'other' } } as any, { principal: who, transport: 'http' })).toEqual({ stage: 'default', context: { tenant: 't1' } })
		expect(requestOptions({ context: { tenant: 'other' } } as any, { principal: principal('svc', ['read']), transport: 'http' })).toEqual({})
	})
})
