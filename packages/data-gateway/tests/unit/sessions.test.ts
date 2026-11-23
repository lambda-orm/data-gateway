// The sessions of management (docs/DATA_GATEWAY_SESSIONS_PLAN.md): the service on a store in memory and on SQLite, the
// ends (idle, lifetime, revoked), the limit per credential, who may list and revoke, the audit (never the token), the
// address behind a trusted proxy, and the configuration.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SessionService } from '../../src/lib/application/session/sessionService'
import { MemorySessionStore, NodeSessionSecrets, SqliteSessionStore } from '../../src/lib/infrastructure/output/session/sessionStores'
import { ClientAddress } from '../../src/lib/infrastructure/input/http/clientAddress'
import { SessionStorePort } from '../../src/lib/application/ports/output/sessionPorts'
import { principal } from '../../src/lib/domain/auth/principal'
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { parseDuration } from '../../src/lib/domain/config/durations'
import { ClockPort } from '../../src/lib/application/ports/output/supportPorts'

class Clock implements ClockPort {
	public time = Date.parse('2026-11-23T10:00:00.000Z')
	public now () { return new Date(this.time) }
	public uptimeSeconds () { return 1 }
	public advance (ms: number) { this.time += ms }
}

const MIN = 60000
const settings = { idleTimeoutMs: 30 * MIN, maxLifetimeMs: 12 * 60 * MIN, maxPerCredential: 0 }
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined }
const modeler = principal('modeler', ['read', 'schemaRead'])
const admin = principal('admin', ['read', 'sessionAdmin'])

const setup = (store: SessionStorePort = new MemorySessionStore(), overrides: Partial<typeof settings> = {}) => {
	const clock = new Clock()
	const audit: any[] = []
	const service = new SessionService({ ...settings, ...overrides }, store, new NodeSessionSecrets(), clock, silent, { write: entry => audit.push(entry) })
	return { clock, audit, service, store }
}

const error = (run: () => unknown) => { try { run() } catch (e: any) { return { status: e.status, name: e.name, message: e.message } } return undefined }

describe('sessions', () => {
	test('a login gives a token once; the token authenticates with the credential and its permissions', () => {
		const { service, audit } = setup()
		const login = service.login(modeler, { app: 'data-gateway-ide', kind: 'web' }, '10.0.0.5')
		expect(login.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(login.session).toMatchObject({ credential: 'modeler', ip: '10.0.0.5', client: { app: 'data-gateway-ide', kind: 'web' }, expiresAt: '2026-11-23T22:00:00.000Z' })
		const auth = service.authenticate(login.token, '10.0.0.5')
		expect(auth.principal.name).toBe('modeler')
		expect([...auth.principal.permissions]).toEqual(['read', 'schemaRead'])
		expect(error(() => service.authenticate(undefined, undefined))).toMatchObject({ status: 401, name: 'SessionRequiredError' })
		expect(error(() => service.authenticate('not-a-token', undefined))).toMatchObject({ status: 401, name: 'SessionRequiredError' })
		// the audit: the login, with the id of the session, never the token
		expect(audit).toEqual([expect.objectContaining({ type: 'audit', transport: 'management', operation: 'login', credential: 'modeler', session: login.session.id, ip: '10.0.0.5', result: 'ok' })])
		expect(JSON.stringify(audit)).not.toContain(login.token)
	})

	test('it ends after 30 minutes without requests, or 12 hours after the login; a request renews the inactivity', () => {
		const { service, clock, audit } = setup()
		const { token } = service.login(modeler, undefined, undefined)
		clock.advance(29 * MIN)
		service.authenticate(token, undefined)
		clock.advance(29 * MIN)
		expect(service.authenticate(token, undefined).principal.name).toBe('modeler')
		clock.advance(31 * MIN)
		expect(error(() => service.authenticate(token, undefined))).toMatchObject({ name: 'SessionExpiredError', message: expect.stringMatching(/idleTimeout/) })
		// once ended it says the same, and it is audited once
		expect(error(() => service.authenticate(token, undefined))).toMatchObject({ name: 'SessionExpiredError', message: expect.stringMatching(/idleTimeout/) })
		expect(audit.filter(e => e.operation === 'sessionExpired')).toEqual([expect.objectContaining({ reason: 'idle' })])
		const busy = setup()
		const second = busy.service.login(modeler, undefined, undefined)
		// 24 × 29 minutes = 11 h 36 min, always active; 29 more pass the 12 hours
		for (let i = 0; i < 24; i++) { busy.clock.advance(29 * MIN); busy.service.authenticate(second.token, undefined) }
		busy.clock.advance(29 * MIN)
		expect(error(() => busy.service.authenticate(second.token, undefined))).toMatchObject({ name: 'SessionExpiredError', message: expect.stringMatching(/maxLifetime/) })
	})

	test('the lists: one\'s own; all only with sessionAdmin; the current one marked; never a token', () => {
		const { service } = setup()
		const mine = service.login(modeler, undefined, '10.0.0.5')
		service.login(modeler, undefined, '10.0.0.6')
		const theirs = service.login(admin, undefined, '10.0.0.7')
		const me = service.authenticate(mine.token, undefined)
		const own = service.list(me, false)
		expect(own.map(s => [s.credential, s.ip, s.current])).toEqual([['modeler', '10.0.0.5', true], ['modeler', '10.0.0.6', false]])
		expect(JSON.stringify(own)).not.toContain(mine.token)
		expect(own[0]).not.toHaveProperty('permissions')
		expect(error(() => service.list(me, true))).toMatchObject({ status: 403, name: 'ForbiddenError', message: expect.stringMatching(/sessionAdmin/) })
		const all = service.list(service.authenticate(theirs.token, undefined), true)
		expect(all.map(s => s.credential)).toEqual(['admin', 'modeler', 'modeler'])
	})

	test('revoking: one\'s own, or another credential\'s with sessionAdmin; a revoked session says who and when', () => {
		const { service, audit } = setup()
		const a = service.login(modeler, undefined, undefined)
		const b = service.login(modeler, undefined, undefined)
		const boss = service.login(admin, undefined, undefined)
		const me = service.authenticate(a.token, undefined)
		// another credential's: only with sessionAdmin
		expect(error(() => service.revoke(me, boss.session.id))).toMatchObject({ status: 403 })
		expect(error(() => service.revokeCredential(me, 'admin', false))).toMatchObject({ status: 403 })
		// "close the others": its own credential's, but the caller's session
		expect(service.revokeCredential(me, 'modeler', true)).toEqual({ revoked: 1 })
		expect(error(() => service.authenticate(b.token, undefined))).toMatchObject({ name: 'SessionRevokedError', message: expect.stringMatching(/by "modeler"/) })
		expect(service.authenticate(a.token, undefined).session.id).toBe(a.session.id)
		// the administrator revokes it
		service.revoke(service.authenticate(boss.token, undefined), a.session.id)
		expect(error(() => service.authenticate(a.token, undefined))).toMatchObject({ name: 'SessionRevokedError', message: expect.stringMatching(/by "admin"/) })
		expect(error(() => service.revoke(service.authenticate(boss.token, undefined), a.session.id))).toMatchObject({ status: 404 })
		expect(audit.filter(e => e.operation === 'sessionRevoked').map(e => [e.session, e.by])).toEqual([[b.session.id, 'modeler'], [a.session.id, 'admin']])
		// the logout
		const auth = service.authenticate(boss.token, undefined)
		service.logout(auth)
		expect(error(() => service.authenticate(boss.token, undefined))).toMatchObject({ name: 'SessionRevokedError' })
	})

	test('maxPerCredential: a new login closes the oldest of that credential', () => {
		const { service, clock } = setup(undefined, { maxPerCredential: 2 })
		const first = service.login(modeler, undefined, undefined)
		clock.advance(1000)
		const second = service.login(modeler, undefined, undefined)
		clock.advance(1000)
		const third = service.login(modeler, undefined, undefined)
		service.login(admin, undefined, undefined)
		expect(error(() => service.authenticate(first.token, undefined))).toMatchObject({ name: 'SessionRevokedError', message: expect.stringMatching(/maxPerCredential/) })
		expect(service.authenticate(second.token, undefined).principal.name).toBe('modeler')
		expect(service.authenticate(third.token, undefined).principal.name).toBe('modeler')
		expect(service.count()).toEqual({ active: 3, connected: 0 })
	})

	test('on SQLite: shared by two services on the same file (two replicas); only the hash of the token is kept', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-'))
		const file = path.join(dir, '.data-gateway', 'state.sqlite')
		const one = new SqliteSessionStore(file)
		const two = new SqliteSessionStore(file)
		try {
			const a = setup(one)
			const b = setup(two)
			const login = a.service.login(modeler, { app: 'data-gateway-ide', version: '1.0.0', kind: 'desktop' }, '10.0.0.5')
			// the other replica authenticates it, and sees its revocation on the next request
			expect(b.service.authenticate(login.token, '10.0.0.9').session).toMatchObject({ id: login.session.id, client: { kind: 'desktop' } })
			a.service.revoke(a.service.authenticate(login.token, undefined), login.session.id)
			expect(error(() => b.service.authenticate(login.token, undefined))).toMatchObject({ name: 'SessionRevokedError' })
			expect(fs.readFileSync(file).includes(Buffer.from(login.token))).toBe(false)
			// a day after it ended, it is removed
			a.clock.advance(25 * 60 * MIN)
			expect(one.purge(new Date(a.clock.time - 24 * 60 * MIN).toISOString())).toBe(1)
			expect(one.byId(login.session.id)).toBeUndefined()
		} finally {
			one.close()
			two.close()
		}
	})
})

describe('the address of the client', () => {
	test('X-Forwarded-For only from a trusted proxy, read from the right', () => {
		const address = new ClientAddress(['172.30.98.32/28', '::1'])
		expect(address.of('::ffff:172.30.98.40', '203.0.113.7')).toBe('203.0.113.7')
		expect(address.of('172.30.98.40', '198.51.100.1, 203.0.113.7')).toBe('203.0.113.7')
		expect(address.of('172.30.98.40', '203.0.113.7, 172.30.98.41')).toBe('203.0.113.7')
		expect(address.of('::1', '10.8.0.14')).toBe('10.8.0.14')
		// from anyone else, the header says nothing
		expect(address.of('10.0.0.9', '203.0.113.7')).toBe('10.0.0.9')
		expect(new ClientAddress([]).of('::ffff:10.0.0.9', '203.0.113.7')).toBe('10.0.0.9')
		expect(address.of('172.30.98.40', undefined)).toBe('172.30.98.40')
	})
})

describe('the configuration of the sessions', () => {
	const read = (management: unknown) => new ConfigReader().read({ orm: { workspacePath: '/w' }, transports: { management } })
	test('defaults, durations, the limit, the store and the trusted proxies', () => {
		expect(parseDuration('30m')).toBe(30 * MIN)
		expect(parseDuration('12h')).toBe(12 * 60 * MIN)
		expect(parseDuration('45s')).toBe(45000)
		expect(parseDuration(1500)).toBe(1500)
		expect(parseDuration('soon')).toBeUndefined()
		expect(read({ port: 9090 }).config?.transports.management).toEqual({
			port: 9090, host: '0.0.0.0', basePath: '',
			sessions: { idleTimeoutMs: 30 * MIN, maxLifetimeMs: 12 * 60 * MIN, maxPerCredential: 0, store: 'auto' },
			trustedProxies: []
		})
		expect(read({ port: 9090, sessions: { idleTimeout: '15m', maxLifetime: '8h', maxPerCredential: 3, store: 'memory' }, trustedProxies: ['10.0.0.0/8', '::1'] }).config?.transports.management)
			.toMatchObject({ sessions: { idleTimeoutMs: 15 * MIN, maxLifetimeMs: 8 * 60 * MIN, maxPerCredential: 3, store: 'memory' }, trustedProxies: ['10.0.0.0/8', '::1'] })
		const bad = read({ port: 9090, sessions: { idleTimeout: 'soon', store: 'redis' }, trustedProxies: ['10.0.0.0/40', 'proxy'] })
		expect(bad.issues).toEqual(expect.arrayContaining([
			expect.stringMatching(/idleTimeout "soon" is not a duration/),
			expect.stringMatching(/store "redis" is not auto or memory/),
			expect.stringMatching(/"10.0.0.0\/40" is not an IP address/),
			expect.stringMatching(/"proxy" is not an IP address/)
		]))
		expect(read({ port: 9090, sessions: { idleTimeout: '13h' } }).warnings).toContainEqual(expect.stringMatching(/idleTimeout is longer than maxLifetime/))
	})
})
