#!/usr/bin/env node
// The tokens of a real identity provider (docs/OIDC_LOGIN.md §1, the acceptance of docs/JWT.md §10): Keycloak
// (oidc/docker-compose.yml) gives them with a user and its password, and the gateway, which knows only its issuer,
// takes them on the five transports: the roles of the realm become permissions, the claim country the context of the
// view sales. A token of another audience or a changed one is refused; when the realm rotates its key, the gateway
// takes the tokens of the new one. Node ≥ 22, no dependencies.
//
//   node runner/oidc.mjs     (scripts/ci-local.sh oidc starts Keycloak, Postgres and the gateway first)
import { createHash, randomBytes } from 'node:crypto'
import { CONNECTIONS } from './index.mjs'
import { connect } from './transports.mjs'
import { startLoopback } from '../../ide-desktop/src/oidcLoopback.mjs'

const KEYCLOAK = process.env.CONFORMANCE_KEYCLOAK ?? 'http://127.0.0.1:19480'
const REALM = `${KEYCLOAK}/realms/data-gateway`
const failures = []
const check = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      ${detail}`}`); if (!ok) failures.push(name) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** a token of the realm: the password grant of a client of the suite */
const token = async (username, client = 'conformance') => {
	const response = await fetch(`${REALM}/protocol/openid-connect/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'password', client_id: client, username, password: `${username}-password`, scope: 'openid' })
	})
	const body = await response.json()
	if (!body.access_token) throw new Error(`Keycloak gave no token to ${username}: ${JSON.stringify(body)}`)
	return body.access_token
}

const claimsOf = jwt => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
const headerOf = jwt => JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8'))

/** the outcome of an operation on a transport with a token: its result, or its error */
const run = async (transport, jwt, operation, args) => {
	let client
	try {
		client = await connect(CONNECTIONS[transport], { Authorization: `Bearer ${jwt}` })
		return { result: await client.call(operation, args) }
	} catch (error) {
		return { error: { code: error.code, status: error.status, name: error.errorName ?? error.name, message: error.message } }
	} finally {
		await client?.close?.().catch?.(() => undefined)
	}
}

const COUNTRIES = 'Customers.map(p => ({ country: p.country }))'

/**
 * The login of the desktop app (docs/OIDC_LOGIN.md §2), without a browser: its loopback, the authorization of the public
 * client of the IDE with PKCE, the form of Keycloak filled as a person would, its answer to the loopback, the code
 * exchanged with the verifier. What the system browser does, by HTTP.
 */
const desktopLogin = async (username) => {
	const loopback = await startLoopback({ timeoutMs: 60000 })
	const verifier = randomBytes(48).toString('base64url')
	const state = randomBytes(16).toString('base64url')
	const authorize = new URL(`${REALM}/protocol/openid-connect/auth`)
	for (const [k, v] of Object.entries({ response_type: 'code', client_id: 'data-gateway-ide', redirect_uri: loopback.redirectUri, scope: 'openid profile', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })) authorize.searchParams.set(k, v)
	const page = await fetch(authorize, { redirect: 'manual' })
	const cookies = page.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
	const action = /<form[^>]+action="([^"]+)"/.exec(await page.text())?.[1]?.replace(/&amp;/g, '&')
	if (!action) throw new Error('Keycloak gave no form of login')
	const posted = await fetch(action, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies }, body: new URLSearchParams({ username, password: `${username}-password`, credentialId: '' }) })
	const location = posted.headers.get('location')
	if (!location?.startsWith(loopback.redirectUri)) throw new Error(`Keycloak didn't go back to the loopback: ${posted.status} ${location}`)
	await fetch(location)
	const answer = new URLSearchParams((await loopback.answer).slice(1))
	if (answer.get('state') !== state) throw new Error('the answer of the login is not the one asked for (state)')
	const tokens = await (await fetch(`${REALM}/protocol/openid-connect/token`, {
		method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'data-gateway-ide', code: answer.get('code'), redirect_uri: loopback.redirectUri, code_verifier: verifier })
	})).json()
	return tokens
}

/** A new access token with the refresh token, as the IDE renews it (the public client, no secret) */
const renewed = async (refresh) => (await fetch(`${REALM}/protocol/openid-connect/token`, {
	method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
	body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'data-gateway-ide', refresh_token: refresh })
})).json()

const main = async () => {
	const [alice, bob, carla] = await Promise.all(['alice', 'bob', 'carla'].map(user => token(user)))
	const claims = claimsOf(carla)
	check('Keycloak: a token of the realm with the audience, the roles and the country', claims.aud === 'data-gateway' && claims.roles?.includes('sales') && claims.country === 'Germany', JSON.stringify(claims))

	for (const transport of Object.keys(CONNECTIONS)) {
		console.log(`${transport}`)
		const read = await run(transport, bob, 'execute', { query: 'Categories.map(p => p.name).page(1, 2)' })
		check(`${transport}: a reader (bob) reads`, Array.isArray(read.result) && read.result.length === 2, JSON.stringify(read))
		const write = await run(transport, bob, 'execute', { query: 'Categories.update(p => ({ name: name })).filter(p => p.id == 1)', data: { name: 'Beverages' } })
		check(`${transport}: a reader (bob) doesn't write`, write.error?.code === 'forbidden', JSON.stringify(write))
		const writes = await run(transport, alice, 'execute', { query: 'Categories.update(p => ({ name: name })).filter(p => p.id == 1)', data: { name: 'Beverages' } })
		check(`${transport}: a backend (alice) writes`, writes.result === 1 || writes.result === '1' || (writes.result && !writes.error), JSON.stringify(writes))
		const countries = await run(transport, carla, 'execute', { query: COUNTRIES })
		const names = Array.isArray(countries.result) ? countries.result.map(r => r.country ?? r) : []
		check(`${transport}: sales (carla) sees the customers of its country (the claim, in the context of the view)`, names.length > 0 && names.every(n => n === 'Germany'), JSON.stringify(countries).slice(0, 300))
		const excluded = await run(transport, carla, 'execute', { query: 'Categories.map(p => p.name)' })
		check(`${transport}: sales (carla) doesn't see what its view excludes`, excluded.error?.code === 'forbidden', JSON.stringify(excluded))
	}

	console.log('refused')
	const other = await token('alice', 'another-audience')
	const wrong = await run('http', other, 'execute', { query: COUNTRIES })
	check('a token of another audience: 401', wrong.error?.code === 'unauthorized', JSON.stringify(wrong))
	const [h, , s] = alice.split('.')
	const changed = `${h}.${Buffer.from(JSON.stringify({ ...claimsOf(alice), roles: ['backend', 'admin'] })).toString('base64url')}.${s}`
	check('a changed token (its signature no longer matches): 401', (await run('http', changed, 'execute', { query: COUNTRIES })).error?.code === 'unauthorized')

	console.log('the IDE: the desktop app signs in, and renews its token')
	const login = await desktopLogin('carla')
	check('the login of the desktop app: the loopback takes the code, exchanged with its verifier (PKCE)', typeof login.access_token === 'string' && typeof login.refresh_token === 'string', JSON.stringify(login).slice(0, 200))
	const signedIn = await run('http', login.access_token, 'execute', { query: COUNTRIES })
	check('its token: the gateway sees carla (sales, Germany)', Array.isArray(signedIn.result) && signedIn.result.length > 0 && signedIn.result.every(r => r.country === 'Germany'), JSON.stringify(signedIn).slice(0, 200))
	const renewal = await renewed(login.refresh_token)
	check('renewed with the refresh token (the public client, no secret): another token', typeof renewal.access_token === 'string' && renewal.access_token !== login.access_token, JSON.stringify(renewal).slice(0, 200))
	const afterRenewal = await run('http', renewal.access_token, 'execute', { query: COUNTRIES })
	check('the renewed token: the gateway takes it, still carla', Array.isArray(afterRenewal.result) && afterRenewal.result.every(r => r.country === 'Germany'), JSON.stringify(afterRenewal).slice(0, 200))

	console.log('rotation')
	// a new key of the realm, before the one that signs: its tokens have another kid, which the gateway doesn't have yet
	const admin = await (await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
		method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin' })
	})).json()
	const auth = { Authorization: `Bearer ${admin.access_token}`, 'Content-Type': 'application/json' }
	const realm = await (await fetch(`${KEYCLOAK}/admin/realms/data-gateway`, { headers: auth })).json()
	const created = await fetch(`${KEYCLOAK}/admin/realms/data-gateway/components`, {
		method: 'POST', headers: auth,
		body: JSON.stringify({ name: `rotated-${Date.now()}`, providerId: 'rsa-generated', providerType: 'org.keycloak.keys.KeyProvider', parentId: realm.id, config: { priority: ['500'], keySize: ['2048'], algorithm: ['RS256'] } })
	})
	check('Keycloak: a new key of the realm', created.status === 201, String(created.status))
	const rotated = await token('alice')
	check('the tokens after it are signed with another key', headerOf(rotated).kid !== headerOf(alice).kid, `${headerOf(rotated).kid} ${headerOf(alice).kid}`)
	// the gateway refreshes its JWKS on an unknown kid, at most once every 30 s: it takes the new tokens without a restart
	let taken
	for (let i = 0; i < 45 && !taken; i++) {
		const outcome = await run('http', await token('alice'), 'execute', { query: COUNTRIES })
		if (outcome.result) taken = outcome
		else await sleep(1000)
	}
	check('after the rotation the gateway takes the tokens of the new key (no restart)', !!taken)

	console.log(failures.length ? `\n${failures.length} failed` : '\noidc passed')
	process.exit(failures.length ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
