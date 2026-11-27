// Where the gateway keeps its state, as the administration shows it (Persist, Config): never a secret.
import { describeStateOf, maskConnection } from '../../src/lib/infrastructure/build/stateBuilder'
import { ConfigReader } from '../../src/lib/domain/config/configReader'

const config = (state?: unknown) => new ConfigReader().read({ orm: { workspacePath: '/w' }, transports: { http: { port: 1 } }, ...(state ? { state } : {}) }).config!

describe('the state, described', () => {
	test('a connection without its secrets', () => {
		expect(maskConnection('postgres://gw:s3cret@db:5432/gateway')).toBe('postgres://gw:***@db:5432/gateway')
		expect(maskConnection('Server=db;User Id=gw;Password=s3cret;')).toBe('Server=db;User Id=gw;Password=***;')
		expect(maskConnection({ host: 'db', user: 'gw', password: 's3cret', ssl: { key: 'k' } })).toEqual({ host: 'db', user: 'gw', password: '***', ssl: { key: '***' } })
	})

	test('the SQLite of the volume: used directly, its schema as λORM sees it', () => {
		const d = describeStateOf({ kind: 'sqlite', file: '/w/.data-gateway/state.sqlite' }, config(), true)
		expect(d).toMatchObject({ kind: 'sqlite', dialect: 'SQLite', file: '/w/.data-gateway/state.sqlite', managedBy: 'node:sqlite', configured: false, refreshMs: 30000, required: false, available: true })
		expect(d.schema).toContain('name: Roles')
		expect(d.schema).toContain('name: Settings')
	})

	test('a database through λORM: its connection masked, in the schema too', () => {
		const d = describeStateOf({ kind: 'orm', dialect: 'PostgreSQL', connection: 'postgres://gw:s3cret@db/gateway' }, config({ source: { dialect: 'PostgreSQL', connection: 'postgres://gw:s3cret@db/gateway' }, refresh: '10s', required: true }), false)
		expect(d).toMatchObject({ kind: 'orm', dialect: 'PostgreSQL', managedBy: 'lambdaORM', configured: true, refreshMs: 10000, required: true, available: false })
		expect(JSON.stringify(d)).not.toContain('s3cret')
		expect(d.schema).toContain('dialect: PostgreSQL')
	})

	test('memory: no schema', () => {
		expect(describeStateOf({ kind: 'memory' }, config(), true)).toEqual({ kind: 'memory', where: 'memory', managedBy: 'memory', configured: false, refreshMs: 30000, required: false, available: true })
	})
})
