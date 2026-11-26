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

const error = async (run: () => unknown) => { try { await run() } catch (e: any) { return { status: e.status, name: e.name, message: e.message } } return undefined }

describe('sessions', () => {
	test('a login gives a token once; the token authenticates with the credential and its permissions', async () => {
		const { service, audit } = setup()
		const login = await service.login(modeler, { app: 'data-gateway-ide', kind: 'web' }, '10.0.0.5')
		expect(login.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(login.session).toMatchObject({ credential: 'modeler', ip: '10.0.0.5', client: { app: 'data-gateway-ide', kind: 'web' }, expiresAt: '2026-11-23T22:00:00.000Z' })
		const auth = await service.authenticate(login.token, '10.0.0.5')
		expect(auth.principal.name).toBe('modeler')
		expect([...auth.principal.permissions]).toEqual(['read', 'schemaRead'])
		expect(await error(() => service.authenticate(undefined, undefined))).toMatchObject({ status: 401, name: 'SessionRequiredError' })
		expect(await error(() => service.authenticate('not-a-token', undefined))).toMatchObject({ status: 401, name: 'SessionRequiredError' })
		// the audit: the login, with the id of the session, never the token
		expect(audit).toEqual([expect.objectContaining({ type: 'audit', transport: 'management', operation: 'login', credential: 'modeler', session: login.session.id, ip: '10.0.0.5', result: 'ok' })])
		expect(JSON.stringify(audit)).not.toContain(login.token)
	})

	test('it ends after 30 minutes without requests, or 12 hours after the login; a request renews the inactivity', async () => {
		const { service, clock, audit } = setup()
		const { token } = await service.login(modeler, undefined, undefined)
		clock.advance(29 * MIN)
		await service.authenticate(token, undefined)
		clock.advance(29 * MIN)
		expect((await service.authenticate(token, undefined)).principal.name).toBe('modeler')
		clock.advance(31 * MIN)
		expect(await error(() => service.authenticate(token, undefined))).toMatchObject({ name: 'SessionExpiredError', message: expect.stringMatching(/idleTimeout/) })
		// once ended it says the same, and it is audited once
		expect(await error(() => service.authenticate(token, undefined))).toMatchObject({ name: 'SessionExpiredError', message: expect.stringMatching(/idleTimeout/) })
		expect(audit.filter(e => e.operation === 'sessionExpired')).toEqual([expect.objectContaining({ reason: 'idle' })])
		const busy = setup()
		const second = await busy.service.login(modeler, undefined, undefined)
		// 24 × 29 minutes = 11 h 36 min, always active; 29 more pass the 12 hours
		for (let i = 0; i < 24; i++) { busy.clock.advance(29 * MIN); await busy.service.authenticate(second.token, undefined) }
		busy.clock.advance(29 * MIN)
		expect(await error(() => busy.service.authenticate(second.token, undefined))).toMatchObject({ name: 'SessionExpiredError', message: expect.stringMatching(/maxLifetime/) })
	})

	test('the lists: one\'s own; all only with sessionAdmin; the current one marked; never a token', async () => {
		const { service } = setup()
		const mine = await service.login(modeler, undefined, '10.0.0.5')
		await service.login(modeler, undefined, '10.0.0.6')
		const theirs = await service.login(admin, undefined, '10.0.0.7')
		const me = await service.authenticate(mine.token, undefined)
		const own = await service.list(me, false)
		expect(own.map(s => [s.credential, s.ip, s.current])).toEqual([['modeler', '10.0.0.5', true], ['modeler', '10.0.0.6', false]])
		expect(JSON.stringify(own)).not.toContain(mine.token)
		expect(own[0]).not.toHaveProperty('permissions')
		expect(await error(() => service.list(me, true))).toMatchObject({ status: 403, name: 'ForbiddenError', message: expect.stringMatching(/sessionAdmin/) })
		const all = await service.list(await service.authenticate(theirs.token, undefined), true)
		expect(all.map(s => s.credential)).toEqual(['admin', 'modeler', 'modeler'])
	})

	test('revoking: one\'s own, or another credential\'s with sessionAdmin; a revoked session says who and when', async () => {
		const { service, audit } = setup()
		const a = await service.login(modeler, undefined, undefined)
		const b = await service.login(modeler, undefined, undefined)
		const boss = await service.login(admin, undefined, undefined)
		const me = await service.authenticate(a.token, undefined)
		// another credential's: only with sessionAdmin
		expect(await error(() => service.revoke(me, boss.session.id))).toMatchObject({ status: 403 })
		expect(await error(() => service.revokeCredential(me, 'admin', false))).toMatchObject({ status: 403 })
		// "close the others": its own credential's, but the caller's session
		expect(await service.revokeCredential(me, 'modeler', true)).toEqual({ revoked: 1 })
		expect(await error(() => service.authenticate(b.token, undefined))).toMatchObject({ name: 'SessionRevokedError', message: expect.stringMatching(/by "modeler"/) })
		expect((await service.authenticate(a.token, undefined)).session.id).toBe(a.session.id)
		// the administrator revokes it
		await service.revoke(await service.authenticate(boss.token, undefined), a.session.id)
		expect(await error(() => service.authenticate(a.token, undefined))).toMatchObject({ name: 'SessionRevokedError', message: expect.stringMatching(/by "admin"/) })
		expect(await error(async () => service.revoke(await service.authenticate(boss.token, undefined), a.session.id))).toMatchObject({ status: 404 })
		expect(audit.filter(e => e.operation === 'sessionRevoked').map(e => [e.session, e.by])).toEqual([[b.session.id, 'modeler'], [a.session.id, 'admin']])
		// the logout
		const auth = await service.authenticate(boss.token, undefined)
		await service.logout(auth)
		expect(await error(() => service.authenticate(boss.token, undefined))).toMatchObject({ name: 'SessionRevokedError' })
	})

	test('maxPerCredential: a new login closes the oldest of that credential', async () => {
		const { service, clock } = setup(undefined, { maxPerCredential: 2 })
		const first = await service.login(modeler, undefined, undefined)
		clock.advance(1000)
		const second = await service.login(modeler, undefined, undefined)
		clock.advance(1000)
		const third = await service.login(modeler, undefined, undefined)
		await service.login(admin, undefined, undefined)
		expect(await error(() => service.authenticate(first.token, undefined))).toMatchObject({ name: 'SessionRevokedError', message: expect.stringMatching(/maxPerCredential/) })
		expect((await service.authenticate(second.token, undefined)).principal.name).toBe('modeler')
		expect((await service.authenticate(third.token, undefined)).principal.name).toBe('modeler')
		expect(await service.count()).toEqual({ active: 3, connected: 0 })
	})

	test('presence: connected while a replica said so lately; activity listed; ended sessions found by check', async () => {
		const { service, clock } = setup()
		const a = await service.login(modeler, undefined, undefined)
		const b = await service.login(modeler, undefined, undefined)
		const me = await service.authenticate(a.token, undefined)
		await service.presence([a.session.id])
		await service.activity(a.session.id, { schema: 'shop', tab: 'query:1', ignored: 'x' } as any)
		expect((await service.list(me, false)).map(s => [s.id === a.session.id, s.connected, s.activity])).toEqual([
			[true, true, { schema: 'shop', tab: 'query:1' }], [false, false, undefined]
		])
		expect(await service.count()).toEqual({ active: 2, connected: 1 })
		// not said again for 45 s: no longer connected
		clock.advance(46000)
		expect((await service.count()).connected).toBe(0)
		// check: of some sessions, the ones that ended and why; the revoked one is announced to the sockets
		const announced: string[] = []
		service.ended.subscribe(({ id }) => announced.push(id))
		await service.revoke(me, b.session.id)
		expect(announced).toEqual([b.session.id])
		expect((await service.check([a.session.id, b.session.id])).map(e => [e.id, e.error.name])).toEqual([[b.session.id, 'SessionRevokedError']])
		expect(service.expiringInMs(a.session)).toBe(12 * 60 * MIN - 2 * MIN - 46000)
	})

	test('on SQLite: shared by two services on the same file (two replicas); only the hash of the token is kept', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-'))
		const file = path.join(dir, '.data-gateway', 'state.sqlite')
		const one = new SqliteSessionStore(file)
		const two = new SqliteSessionStore(file)
		try {
			const a = setup(one)
			const b = setup(two)
			const login = await a.service.login(modeler, { app: 'data-gateway-ide', version: '1.0.0', kind: 'desktop' }, '10.0.0.5')
			// the other replica authenticates it, and sees its revocation on the next request
			expect((await b.service.authenticate(login.token, '10.0.0.9')).session).toMatchObject({ id: login.session.id, client: { kind: 'desktop' } })
			await a.service.revoke(await a.service.authenticate(login.token, undefined), login.session.id)
			expect(await error(() => b.service.authenticate(login.token, undefined))).toMatchObject({ name: 'SessionRevokedError' })
			expect(fs.readFileSync(file).includes(Buffer.from(login.token))).toBe(false)
			// a day after it ended, it is removed
			a.clock.advance(25 * 60 * MIN)
			expect(await one.purge(new Date(a.clock.time - 24 * 60 * MIN).toISOString())).toBe(1)
			expect(await one.byId(login.session.id)).toBeUndefined()
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

describe('a session of a token (docs/JWT.md)', () => {
	const ann = { ...principal('ann', ['read']), context: { tenant: 't1' }, expiresAt: Date.parse('2026-11-23T10:20:00.000Z') }

	test('it ends with the token, and its requests carry its context; the list doesn\'t show it', async () => {
		const { service, clock } = setup()
		const { session, token } = await service.login(ann, {}, undefined)
		expect(session.expiresAt).toBe('2026-11-23T10:20:00.000Z')
		const auth = await service.authenticate(token, undefined)
		expect(auth.principal.context).toEqual({ tenant: 't1' })
		expect((await service.list(auth, false))[0]).not.toHaveProperty('context')
		clock.advance(19 * MIN)
		expect((await service.authenticate(token, undefined)).principal.name).toBe('ann')
		clock.advance(MIN)
		expect(await error(() => service.authenticate(token, undefined))).toMatchObject({ status: 401, name: 'SessionExpiredError', message: expect.stringMatching(/or the token it logged in with/) })
		// a credential without an end keeps sessions.maxLifetime
		expect((await service.login(modeler, {}, undefined)).session.expiresAt).toBe(new Date(clock.time + 12 * 60 * MIN).toISOString())
	})

	test('the store of SQLite keeps the context, also in a database of before it (the column added)', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-sessions-ctx-'))
		const file = path.join(dir, 'state.sqlite')
		const { DatabaseSync } = require('node:sqlite')
		const old = new DatabaseSync(file)
		old.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, credential TEXT NOT NULL, permissions TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT, client TEXT, activity TEXT, revoked_at TEXT, revoked_by TEXT)')
		old.close()
		const store = new SqliteSessionStore(file)
		const { service } = setup(store)
		const { token } = await service.login(ann, {}, undefined)
		expect((await service.authenticate(token, undefined)).principal.context).toEqual({ tenant: 't1' })
		store.close?.()
		fs.rmSync(dir, { recursive: true, force: true })
	})
})

describe('a connection of a token (docs/JWT.md §3)', () => {
	const { EventEmitter } = require('events')
	const WebSocket = require('ws')
	const socket = () => {
		const ws = new EventEmitter()
		ws.readyState = WebSocket.OPEN
		ws.closed = undefined
		ws.close = (code: number, reason: string) => { ws.closed = { code, reason }; ws.readyState = WebSocket.CLOSED; ws.emit('close') }
		return ws
	}

	test('closed with 4401 when its token expires; one without an end, never', async () => {
		const { closeWhenExpired, CREDENTIAL_EXPIRED } = require('../../src/lib/infrastructure/input/websocket/credentialExpiry')
		const ws = socket()
		closeWhenExpired(ws, { ...principal('ann', ['read']), expiresAt: Date.now() + 50 })
		expect(ws.closed).toBeUndefined()
		await new Promise(resolve => setTimeout(resolve, 80))
		expect(ws.closed).toEqual({ code: CREDENTIAL_EXPIRED, reason: 'the token expired: connect again with a new one' })
		const key = socket()
		closeWhenExpired(key, principal('svc', ['read']))
		await new Promise(resolve => setTimeout(resolve, 20))
		expect(key.closed).toBeUndefined()
		// already expired: at once
		const late = socket()
		closeWhenExpired(late, { ...principal('ann', ['read']), expiresAt: Date.now() - 1 })
		expect(late.closed?.code).toBe(4401)
	})
})
