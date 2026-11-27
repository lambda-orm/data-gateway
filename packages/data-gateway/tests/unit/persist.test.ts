// Where the state is kept, changed from the administration (docs/GATEWAY_STATE.md §2): persist.yaml over the YAML, the
// mapping of the lambdaORM.yaml of the state, and the copy of the state with λORM (push, export, import).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { stringify } from 'yaml'
import { mappingOfText, migrateState, PersistAdmin, persistFileOf, readPersist, withPersist } from '../../src/lib/infrastructure/build/persist'
import { systemSchema } from '../../src/lib/infrastructure/output/state/ormState'
import { SqliteRoleStore } from '../../src/lib/infrastructure/output/state/stateStores'
import { SqliteSessionStore } from '../../src/lib/infrastructure/output/session/sessionStores'
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { principal } from '../../src/lib/domain/auth/principal'

const silent = new ConsoleLogger('error')
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'persist-test-'))
const configOf = (workspacePath: string) => new ConfigReader().read({ orm: { workspacePath }, transports: { http: { port: 1 } } }).config!
const change = (n: number) => ({ id: `c${n}`, area: 'roles' as const, key: 'r', after: { permissions: ['read'] }, by: 'boss', at: '2026-11-27T00:00:00.000Z' })
const session = { id: 's1', credential: 'ana', permissions: ['read' as const], createdAt: '2026-11-27T00:00:00.000Z', lastSeenAt: '2026-11-27T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', roles: ['reader'], context: { username: 'ana' } }

describe('persist.yaml over the YAML', () => {
	test('its source and mapping replace state of the YAML, which stays to go back to it', () => {
		const dir = temporary()
		expect(withPersist(configOf(dir)).state.persisted).toBeUndefined()
		fs.mkdirSync(path.join(dir, '.data-gateway'), { recursive: true })
		fs.writeFileSync(persistFileOf(dir), stringify({ source: { dialect: 'PostgreSQL', connection: '$STATE_DB' }, mapping: { Roles: { table: 'gw_roles' } } }))
		const config = withPersist(configOf(dir), { STATE_DB: 'postgres://gw@db/state' })
		expect(config.state).toMatchObject({ source: { dialect: 'PostgreSQL', connection: 'postgres://gw@db/state' }, mapping: { Roles: { table: 'gw_roles' } }, persisted: true, yaml: { refreshMs: 30000 } })
		expect(readPersist(dir, {})?.source?.connection).toBeUndefined()
		fs.rmSync(dir, { recursive: true, force: true })
	})

	test('the mapping of an edited lambdaORM.yaml: only its tables and columns; its domain is the gateway\'s', () => {
		const doc = systemSchema('PostgreSQL', 'postgres://x', '/tmp')
		doc.infrastructure.mappings[0].entities[4] = { name: 'Roles', mapping: 'gw.roles', properties: [{ name: 'schemaPath', mapping: 'schema_path' }] }
		const mapping = mappingOfText(stringify(doc), 'PostgreSQL')
		expect(mapping.Roles).toEqual({ table: 'gw.roles', columns: { schemaPath: 'schema_path' } })
		// only what differs from dg_ and its names
		expect(mapping.Sessions).toBeUndefined()
		const domain = systemSchema('PostgreSQL', 'x', '/tmp')
		domain.domain.entities[0].properties.pop()
		expect(() => mappingOfText(stringify(domain), 'PostgreSQL')).toThrow(/only the mapping can change/)
		const bad = systemSchema('PostgreSQL', 'x', '/tmp')
		bad.infrastructure.mappings[0].entities[0].mapping = 'drop table x;'
		expect(() => mappingOfText(stringify(bad), 'PostgreSQL')).toThrow(/is not a table/)
	})
})

describe('the state copied with λORM', () => {
	test('from the SQLite of the volume to another database (its own mapping) and to another SQLite: every row', async () => {
		const dir = temporary()
		const volume = path.join(dir, 'state.sqlite')
		const roles = new SqliteRoleStore(volume)
		await roles.put({ name: 'support', config: { permissions: ['read'] }, updatedAt: 'x', updatedBy: 'boss' }, change(1))
		await roles.putSetting({ key: 'observability', value: { traces: { enabled: false } }, updatedAt: 'x', updatedBy: 'boss' }, { ...change(2), area: 'observability' })
		const sessions = new SqliteSessionStore(volume)
		await sessions.create(session as any, 'hash-1')
		// another database through λORM, with its own tables (SQLjs stands for it here)
		const other = { kind: 'orm' as const, dialect: 'SQLjs', connection: { file: path.join(dir, 'other.sqlite') }, mapping: { Roles: { table: 'gw_roles' } } }
		expect((await migrateState({ kind: 'sqlite', file: volume }, other, silent)).rows).toBe(7)
		// its own tables: gw_roles, not dg_roles
		expect(fs.existsSync(other.connection.file)).toBe(true)
		// and back, to a new SQLite of a volume: the gateway reads it as its own
		const back = path.join(dir, 'back', 'state.sqlite')
		expect((await migrateState(other, { kind: 'sqlite', file: back }, silent)).rows).toBe(7)
		const backRoles = new SqliteRoleStore(back)
		expect((await backRoles.roles()).map(r => r.name)).toEqual(['support'])
		expect((await backRoles.setting('observability'))?.value).toEqual({ traces: { enabled: false } })
		expect(await backRoles.areaVersion('observability')).toBe(1)
		expect((await backRoles.changes(10)).map(c => c.id).sort()).toEqual(['c1', 'c2'])
		backRoles.close()
		expect((await new SqliteSessionStore(back).active()).map(s => s.context)).toEqual([{ username: 'ana' }])
		// a SQLite with a state is kept aside (.bak-) and the state copied in a new one
		expect((await migrateState(other, { kind: 'sqlite', file: back }, silent)).rows).toBe(7)
		expect(fs.readdirSync(path.dirname(back)).filter(f => f.startsWith('state.sqlite.bak-') && !f.endsWith('-wal') && !f.endsWith('-shm'))).toHaveLength(1)
		fs.rmSync(dir, { recursive: true, force: true })
	}, 60000)
})

describe('Persist from the administration', () => {
	test('with the permission persist: another connection is copied and written in persist.yaml; back to the YAML', async () => {
		const dir = temporary()
		const moved: unknown[] = []
		let applied = 0
		const admin = new PersistAdmin(configOf(dir), silent, () => { applied++ }, async (from, to) => { moved.push([from.kind, (to as any).dialect ?? to.kind]); return { rows: 3 } })
		const boss = principal('boss', ['persist'])
		await expect(admin.connection(principal('ana', ['roles']), { dialect: 'PostgreSQL', connection: 'postgres://x' })).rejects.toMatchObject({ status: 403 })
		await expect(admin.connection(boss, { dialect: 'Mongo', connection: 'x' })).rejects.toMatchObject({ status: 400 })
		await expect(admin.schema(boss, 'x')).rejects.toMatchObject({ status: 409 })
		expect(await admin.connection(boss, { dialect: 'PostgreSQL', connection: 'postgres://gw@db/state' }, 'to Postgres')).toEqual({ rows: 3, where: 'PostgreSQL (λORM)' })
		expect(moved).toEqual([['sqlite', 'PostgreSQL']])
		expect(applied).toBe(1)
		expect(readPersist(dir)).toMatchObject({ source: { dialect: 'PostgreSQL', connection: 'postgres://gw@db/state' }, updatedBy: 'boss' })
		// the gateway restarted with it: back to the YAML copies it back
		const now = new PersistAdmin(withPersist(configOf(dir)), silent, () => { applied++ }, async (from, to) => { moved.push([(from as any).dialect, to.kind]); return { rows: 3 } })
		await now.reset(boss)
		expect(moved[1]).toEqual(['PostgreSQL', 'sqlite'])
		expect(fs.existsSync(persistFileOf(dir))).toBe(false)
		await expect(now.reset(boss)).rejects.toMatchObject({ status: 404 })
		fs.rmSync(dir, { recursive: true, force: true })
	})
})
