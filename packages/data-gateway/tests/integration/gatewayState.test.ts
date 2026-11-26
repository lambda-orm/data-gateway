// The state of the gateway (docs/GATEWAY_STATE.md): the same stores on node:sqlite (one instance), on λORM over SQLjs
// in memory (the queries of the system schema, without a server) and on PostgreSQL (DATA_GATEWAY_TEST_POSTGRES:
// postgres://user:pass@host:port/db, several replicas). Sessions, the state of the UI, the writes that wait, the roles,
// their changes and their version.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Approval } from '../../src/lib/domain/approval/approval'
import { Session } from '../../src/lib/domain/session/session'
import { approvalStoreOf, closeState, roleStoreOf, sessionStoreOf, StateSource, uiStateStoreOf } from '../../src/lib/infrastructure/output/state/stateStores'

const POSTGRES = process.env.DATA_GATEWAY_TEST_POSTGRES
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-state-'))
const SOURCES: [string, StateSource][] = [
	['node:sqlite', { kind: 'sqlite', file: path.join(dir, 'state.sqlite') }],
	['λORM on SQLjs', { kind: 'orm', dialect: 'SQLjs', connection: ':memory:' }],
	...(POSTGRES ? [['λORM on PostgreSQL', { kind: 'orm', dialect: 'PostgreSQL', connection: POSTGRES }] as [string, StateSource]] : [])
]

afterAll(async () => {
	for (const [, source] of SOURCES) await closeState(source)
	fs.rmSync(dir, { recursive: true, force: true })
})

const run = `${Date.now()}`
const session = (id: string, credential: string, at: string): Session => ({
	id, credential, permissions: ['read', 'schemaRead'], createdAt: at, lastSeenAt: at, expiresAt: '2999-01-01T00:00:00.000Z',
	context: { country: 'Germany' }, view: 'sales', roles: ['sales', 'support']
})

describe.each(SOURCES)('the state of the gateway on %s', (_name, source) => {
	test('sessions: created, found by its hash, touched, revoked once, connected, purged', async () => {
		const store = sessionStoreOf(source)
		const id = `s_${run}`
		await store.create(session(id, `ana${run}`, '2026-11-26T10:00:00.000Z'), `hash${run}`)
		const found = await store.byTokenHash(`hash${run}`)
		expect(found).toMatchObject({ id, credential: `ana${run}`, permissions: ['read', 'schemaRead'], context: { country: 'Germany' }, view: 'sales', roles: ['sales', 'support'] })
		expect(found?.revokedAt).toBeUndefined()
		await store.touch(id, '2026-11-26T10:05:00.000Z', '10.0.0.1')
		await store.setActivity(id, { schema: 'shop', tab: 'data' })
		expect(await store.byId(id)).toMatchObject({ lastSeenAt: '2026-11-26T10:05:00.000Z', ip: '10.0.0.1', activity: { schema: 'shop', tab: 'data' } })
		expect((await store.active(`ana${run}`)).map(s => s.id)).toEqual([id])
		await store.markConnected(`r${run}`, [id], '2026-11-26T10:05:00.000Z')
		expect((await store.connectedSince('2026-11-26T10:00:00.000Z')).has(id)).toBe(true)
		await store.revoke(id, 'admin', '2026-11-26T10:06:00.000Z')
		await store.revoke(id, 'other', '2026-11-26T10:07:00.000Z')
		expect(await store.byId(id)).toMatchObject({ revokedAt: '2026-11-26T10:06:00.000Z', revokedBy: 'admin' })
		expect(await store.active(`ana${run}`)).toEqual([])
		expect(await store.purge('2026-11-27T00:00:00.000Z')).toBeGreaterThanOrEqual(1)
		expect(await store.byId(id)).toBeUndefined()
	})

	test('the state of the UI: written, written again, removed', async () => {
		const store = uiStateStoreOf(source)!
		await store.write(`ana${run}`, { tabs: ['a'] }, '2026-11-26T10:00:00.000Z')
		await store.write(`ana${run}`, { tabs: ['a', 'b'] }, '2026-11-26T10:01:00.000Z')
		expect(await store.read(`ana${run}`)).toEqual({ state: { tabs: ['a', 'b'] }, updatedAt: '2026-11-26T10:01:00.000Z' })
		await store.remove(`ana${run}`)
		expect(await store.read(`ana${run}`)).toBeUndefined()
	})

	test('approvals: listed newest first, moved only once', async () => {
		const store = approvalStoreOf(source)
		const of = (id: string, at: string): Approval => ({ id, schema: `shop${run}`, status: 'pending', createdAt: at, expiresAt: '2999-01-01T00:00:00.000Z', transport: 'mcpHttp', requestedBy: 'agent', kind: 'execute', request: { query: 'Orders.delete()' } } as unknown as Approval)
		await store.create(of(`a1${run}`, '2026-11-26T10:00:00.000Z'))
		await store.create(of(`a2${run}`, '2026-11-26T10:01:00.000Z'))
		expect((await store.list(`shop${run}`, 'pending', 10)).map(a => a.id)).toEqual([`a2${run}`, `a1${run}`])
		expect((await store.list(`shop${run}`, undefined, 1)).map(a => a.id)).toEqual([`a2${run}`])
		const [first, second] = await Promise.all([
			store.transition(`a1${run}`, 'pending', { status: 'approved', approvedBy: 'bob' } as any),
			store.transition(`a1${run}`, 'pending', { status: 'rejected' } as any)
		])
		expect([first, second].filter(Boolean)).toHaveLength(1)
		expect((await store.get(`a1${run}`))?.status).toMatch(/approved|rejected/)
		expect(await store.list(`shop${run}`, 'pending', 10)).toHaveLength(1)
	})

	test('roles: saved global and of a schema, changed, removed; each change recorded and the version moved', async () => {
		const store = roleStoreOf(source)
		const before = await store.version()
		const change = (key: string, after?: unknown) => ({ id: `${key}-${Math.random()}`, area: 'roles' as const, key, after, by: 'admin', at: new Date().toISOString() })
		await store.put({ name: `support${run}`, config: { permissions: ['read'], views: ['support'] }, updatedAt: '2026-11-26T10:00:00.000Z', updatedBy: 'admin' }, change(`support${run}`))
		await store.put({ name: `support${run}`, schema: 'shop', config: { views: ['public'] }, updatedAt: '2026-11-26T10:00:00.000Z', updatedBy: 'admin' }, change(`support${run}@shop`))
		await store.put({ name: `support${run}`, config: { permissions: ['read'], views: ['support', 'public'] }, updatedAt: '2026-11-26T10:01:00.000Z', updatedBy: 'bob' }, change(`support${run}`, { views: ['support', 'public'] }))
		const mine = (await store.roles()).filter(r => r.name === `support${run}`)
		expect(mine).toEqual(expect.arrayContaining([
			{ name: `support${run}`, config: { permissions: ['read'], views: ['support', 'public'] }, updatedAt: '2026-11-26T10:01:00.000Z', updatedBy: 'bob' },
			{ name: `support${run}`, schema: 'shop', config: { views: ['public'] }, updatedAt: '2026-11-26T10:00:00.000Z', updatedBy: 'admin' }
		]))
		expect(mine).toHaveLength(2)
		expect(await store.remove(`support${run}`, 'shop', change(`support${run}@shop`))).toBe(true)
		expect(await store.remove(`support${run}`, 'shop', change(`support${run}@shop`))).toBe(false)
		expect(await store.version()).toBe(before + 4)
		const changes = await store.changes(100)
		expect(changes.filter(c => c.key.startsWith(`support${run}`))).toHaveLength(4)
		expect(changes.find(c => c.after !== undefined && c.key === `support${run}`)?.after).toEqual({ views: ['support', 'public'] })
	})
})
