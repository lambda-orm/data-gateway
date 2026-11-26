// The roles with their views and stages (docs/ROLE_SCOPES.md): the configuration, the choice of a request, the
// permissions of the roles that allow it, the levels of a role (YAML, schema, state) and their administration.
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { resolveScope, RoleGrant } from '../../src/lib/domain/auth/roles'
import { principal } from '../../src/lib/domain/auth/principal'
import { RoleCatalog } from '../../src/lib/application/auth/roleCatalog'
import { RoleAdmin } from '../../src/lib/application/auth/roleAdmin'
import { ScopeResolver, askedOf } from '../../src/lib/application/auth/scopedSchema'
import { requestOptions } from '../../src/lib/application/usecases/requestOptions'
import { MemoryRoleStore } from '../../src/lib/infrastructure/output/state/stateStores'
import { ApiKeyAuthenticator } from '../../src/lib/infrastructure/output/auth/authenticators'
import { FixedClock } from '../helpers/fakes'

const silent = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } as any
const minimal = { transports: { http: { port: 8080 } }, orm: { workspacePath: '/w' } }
const read = (raw: object) => new ConfigReader().read({ ...minimal, ...raw })

describe('the configuration of the roles', () => {
	test('authorization.roles: permissions, views, stages, maxRows, approval, scope, locked; of a schema, what it adds', () => {
		const { config, issues } = read({
			authorization: {
				roles: {
					support: { permissions: ['read'], views: ['support'] },
					analyst: { permissions: ['read'], views: ['analytics', 'support'], stages: ['default', 'reporting'], maxRows: 5000 },
					admin: { permissions: ['read', 'roles'], locked: true },
					agent: { permissions: ['read', 'write'], approval: 'writes', scope: 'any' }
				}
			},
			orm: { schemas: [{ path: 'shop', workspace: '/w', stage: 'default', roles: { support: { views: ['public'] } } }] },
			authentication: { adapter: 'local', type: 'apikey', keys: [{ name: 'billing', value: 'k', roles: ['support'] }] }
		})
		expect(issues).toEqual([])
		expect(config!.authorization.roles.analyst).toEqual({ permissions: ['read'], views: ['analytics', 'support'], stages: ['default', 'reporting'], maxRows: 5000 })
		expect(config!.authorization.roles.admin.locked).toBe(true)
		expect(config!.authorization.roles.agent).toMatchObject({ approval: 'writes', scope: 'any' })
		expect(config!.orm.schemas[0]).toMatchObject({ stage: 'default', roles: { support: { views: ['public'] } } })
		expect(config!.authentication.credentials[0]).toMatchObject({ name: 'billing', roles: ['support'], permissions: [] })
		expect(config!.authorization.stages).toBe('restricted')
	})

	test('what stops it: a role in two places, roles and permissions in a key, a bad state', () => {
		const twice = read({
			authorization: { roles: { support: ['read'] } },
			authentication: { adapter: 'jwt', issuer: 'https://x', principal: { permissions: { claim: 'roles', roles: { support: ['read'] } } } }
		})
		expect(twice.issues).toContain('the role "support" is in authorization.roles and in a method jwt: keep it in one')
		expect(read({ authentication: { adapter: 'local', type: 'apikey', keys: [{ name: 'k', value: 'k', roles: ['a'], permissions: ['read'] }] } }).issues.join()).toContain('roles or its own permissions and view, not both')
		expect(read({ state: { source: { dialect: 'SQLjs', connection: ':memory:' } } }).issues.join()).toContain('SQLjs keeps the database in memory')
		expect(read({ state: { source: { dialect: 'Mongo', connection: 'x' } } }).issues.join()).toContain('state.source.dialect must be one of')
		expect(read({ state: { source: { dialect: 'PostgreSQL', connection: 'postgres://db/g' }, refresh: '10s' } }).config!.state).toEqual({ source: { dialect: 'PostgreSQL', connection: 'postgres://db/g' }, refreshMs: 10000, required: false })
		// a method jwt with only its claim: its roles in authorization.roles
		expect(read({ authorization: { roles: { r: ['read'] } }, authentication: { adapter: 'jwt', issuer: 'https://x', principal: { permissions: { claim: 'roles' } } } }).issues).toEqual([])
	})
})

describe('the scope of a request', () => {
	const schema = { view: 'public', stage: 'default', stages: ['default', 'reporting', 'staging'] }
	const support: RoleGrant = { role: 'support', permissions: ['read'], views: ['support'] }
	const backend: RoleGrant = { role: 'backend', permissions: ['read', 'write'] }
	const analyst: RoleGrant = { role: 'analyst', permissions: ['read'], views: ['analytics', 'support'], stages: ['default', 'reporting'], maxRows: 5000 }
	const operator: RoleGrant = { role: 'operator', permissions: ['read', 'ddl', 'destructive'], stages: ['default', 'staging'] }

	test('the view and the stage asked for only among those of its roles; else theirs by default', () => {
		expect(resolveScope('ana', [analyst], {}, schema)).toMatchObject({ view: 'analytics', stage: 'default', maxRows: 5000 })
		expect(resolveScope('ana', [analyst], { view: 'support', stage: 'reporting' }, schema)).toMatchObject({ view: 'support', stage: 'reporting', permissions: ['read'] })
		expect(() => resolveScope('ana', [analyst], { view: 'public' }, schema)).toThrow(expect.objectContaining({ status: 403, message: expect.stringContaining('may not use the view "public" (analytics, support)') }))
		expect(() => resolveScope('ana', [analyst], { stage: 'staging' }, schema)).toThrow(expect.objectContaining({ status: 403 }))
		// a role without views: the one of the schema; without stages: the one of the schema
		expect(resolveScope('bob', [backend], {}, schema)).toMatchObject({ view: 'public', stage: 'default' })
		expect(() => resolveScope('bob', [backend], { stage: 'reporting' }, schema)).toThrow(expect.objectContaining({ status: 403 }))
	})

	test('roles with other defaults: the one of the schema if allowed, else it must choose', () => {
		expect(resolveScope('carla', [support, backend], {}, schema)).toMatchObject({ view: 'public' })
		expect(() => resolveScope('dan', [support, { ...analyst, views: ['analytics'] }], {}, schema)).toThrow(expect.objectContaining({ status: 403, message: expect.stringContaining('must choose a view: support, analytics') }))
	})

	test('the permissions of the roles that allow both, not the sum: nobody writes in a view given to read', () => {
		expect(resolveScope('carla', [support, backend], { view: 'support' }, schema).permissions).toEqual(['read'])
		expect(resolveScope('carla', [support, backend], {}, schema).permissions.sort()).toEqual(['read', 'write'])
		// the commands of a stage in the stages of their role, whatever the view
		expect(resolveScope('eve', [analyst, operator], { stage: 'staging' }, schema).permissions.sort()).toEqual(['ddl', 'destructive', 'read'])
		expect(resolveScope('eve', [analyst, operator], { stage: 'reporting' }, schema).permissions).toEqual(['read'])
		// the administration whatever was chosen; scope any as before
		expect(resolveScope('fay', [support, { role: 'admin', permissions: ['schemaRead', 'roles'] }], { view: 'support' }, schema).permissions.sort()).toEqual(['read', 'roles', 'schemaRead'])
		expect(resolveScope('gus', [support, { role: 'agent', permissions: ['write'], scope: 'any', approval: 'writes' }], { view: 'support' }, schema)).toMatchObject({ permissions: ['read', 'write'], approval: 'writes' })
	})

	test('authorization.stages open: a role without stages takes any (as before 4.4)', () => {
		expect(resolveScope('bob', [backend], { stage: 'reporting' }, { ...schema, openStages: true })).toMatchObject({ stage: 'reporting' })
	})

	test('the facade: what an operation asks for; the principal of the request with its scope; the options of λORM', () => {
		expect(askedOf('execute', [{ query: 'x', options: { view: 'support', stage: 'reporting' } }])).toEqual({ view: 'support', stage: 'reporting' })
		expect(askedOf('execute', [{ query: 'x', options: '{"stage":"reporting"}' }])).toEqual({ stage: 'reporting' })
		expect(askedOf('stageExport', ['staging'])).toEqual({ stage: 'staging' })
		expect(askedOf('query', ['byName', { options: { view: 'support' } }])).toEqual({ view: 'support' })
		const scopes = new ScopeResolver(() => schema)
		const who = { ...principal('ana', ['read', 'write']), grants: [analyst] }
		const scoped = scopes.principal(who, { stage: 'reporting' })
		expect(scoped).toMatchObject({ view: 'analytics', stage: 'reporting', maxRows: 5000 })
		expect([...scoped.permissions]).toEqual(['read'])
		// idempotent: a scoped principal keeps its grants
		expect(scopes.principal(scoped, {}).stage).toBe('default')
		// a key of before (its own permissions and view): its own grant
		expect(scopes.principal({ ...principal('legacy', ['read', 'write']), view: 'support' }, {})).toMatchObject({ view: 'support', stage: 'default' })
		const options = requestOptions({ stage: 'staging', view: 'x', allowDestructive: true, maxRows: 9000 }, { principal: scoped, transport: 'http' }, 'analytics')
		expect(options).toMatchObject({ stage: 'reporting', view: 'analytics', maxRows: 5000 })
		expect(options).not.toHaveProperty('allowDestructive')
		expect(requestOptions({ maxRows: 10 }, { principal: scoped, transport: 'http' })).toMatchObject({ maxRows: 10 })
	})
})

describe('the catalog of the roles', () => {
	const config = read({
		authorization: { roles: { support: { permissions: ['read'], views: ['support'] }, admin: { permissions: ['read', 'roles', 'schemaRead'], locked: true } } },
		orm: { schemas: [{ path: 'shop', workspace: '/w', roles: { support: { stages: ['default', 'reporting'] } } }] }
	}).config!

	test('the YAML, extended by the schema and by the state (global and of the schema); a locked one not; a new one', () => {
		const catalog = new RoleCatalog(config)
		expect(catalog.grantOf('support', 'shop')).toEqual({ role: 'support', permissions: ['read'], views: ['support'], stages: ['default', 'reporting', '@schema'] })
		catalog.load([
			{ name: 'support', config: { views: ['public'], maxRows: 100 }, updatedAt: 'x', updatedBy: 'x' },
			{ name: 'support', schema: 'shop', config: { permissions: ['write'] }, updatedAt: 'x', updatedBy: 'x' },
			{ name: 'admin', config: { permissions: ['write'] }, updatedAt: 'x', updatedBy: 'x' },
			{ name: 'auditor', config: { permissions: ['read'], views: ['audit'] }, updatedAt: 'x', updatedBy: 'x' }
		])
		expect(catalog.grantOf('support', 'shop')).toMatchObject({ permissions: ['read', 'write'], views: ['public', 'support'], maxRows: 100 })
		expect(catalog.grantOf('support', 'other')).toMatchObject({ permissions: ['read'], views: ['public', 'support'] })
		expect(catalog.grantOf('admin')?.permissions).toEqual(['read', 'roles', 'schemaRead'])
		expect(catalog.grantOf('auditor')).toEqual({ role: 'auditor', permissions: ['read'], views: ['audit'] })
		expect(catalog.permissionsOf(['auditor', 'admin']).sort()).toEqual(['read', 'roles', 'schemaRead'])
		expect(catalog.grantsOf({ ...principal('x', []), roles: ['auditor', 'nobody'] }, 'shop').map(g => g.role)).toEqual(['auditor'])
	})

	test('a key with roles: their names, and before a schema the permissions of them all', async () => {
		const catalog = new RoleCatalog(config)
		const keys = new ApiKeyAuthenticator([{ name: 'billing', value: 'k', permissions: [], roles: ['support', 'admin'] }], 'x-api-key', catalog)
		const who = (await keys.authenticate({ 'x-api-key': 'k' })).principal!
		expect(who.roles).toEqual(['support', 'admin'])
		expect([...who.permissions].sort()).toEqual(['read', 'roles', 'schemaRead'])
	})

	test('the administration: with roles; nobody gives what it doesn\'t have; a locked one not; each change recorded', async () => {
		const catalog = new RoleCatalog(config)
		const store = new MemoryRoleStore()
		let n = 0
		const admin = new RoleAdmin(store, catalog, new FixedClock(), () => `c${++n}`, silent)
		const boss = principal('boss', ['read', 'write', 'roles'])
		await expect(admin.list(principal('nobody', ['read']))).rejects.toMatchObject({ status: 403 })
		await admin.put(boss, 'support', 'shop', { permissions: ['write'], views: ['public'] }, 'the team writes now')
		expect(catalog.grantOf('support', 'shop')).toMatchObject({ permissions: ['read', 'write'], views: ['public', 'support'] })
		await expect(admin.put(boss, 'support', undefined, { permissions: ['ddl'] })).rejects.toMatchObject({ status: 403, message: expect.stringContaining('ddl') })
		await expect(admin.put(boss, 'admin', undefined, { views: ['x'] })).rejects.toMatchObject({ status: 403, message: expect.stringContaining('locked') })
		await expect(admin.put(boss, 'support', undefined, { locked: true })).rejects.toMatchObject({ status: 400 })
		expect((await admin.list(boss)).map(r => `${r.source}:${r.name}${r.schema ? `@${r.schema}` : ''}`)).toEqual(['yaml:support', 'yaml:admin', 'yaml:support@shop', 'state:support@shop'])
		await admin.remove(boss, 'support', 'shop')
		await expect(admin.remove(boss, 'support', 'shop')).rejects.toMatchObject({ status: 404 })
		expect(catalog.grantOf('support', 'shop')?.permissions).toEqual(['read'])
		const changes = await admin.changes(boss, 10)
		expect(changes.map(c => [c.key, c.by, c.reason])).toEqual([['support@shop', 'boss', undefined], ['support@shop', 'boss', 'the team writes now']])
		expect(changes[0].before).toEqual({ permissions: ['write'], views: ['public'] })
	})
})
