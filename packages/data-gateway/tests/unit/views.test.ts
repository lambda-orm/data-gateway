// The view by identity (docs/VIEWS_BY_IDENTITY.md): the view of the roles of a key or a token, or of the schema; one
// the schema doesn't have refused; what λORM receives (the queries, their metadata, the domain), never the client's.
import { SignJWT } from 'jose'
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { JwtAuthenticator } from '../../src/lib/infrastructure/output/auth/jwtAuthenticator'
import { ApiKeyAuthenticator } from '../../src/lib/infrastructure/output/auth/authenticators'
import { ViewResolver } from '../../src/lib/application/usecases/viewResolver'
import { QueryUseCases } from '../../src/lib/application/usecases/queryUseCases'
import { SchemaUseCases } from '../../src/lib/application/usecases/schemaUseCases'
import { Auditor } from '../../src/lib/application/usecases/auditor'
import { principal } from '../../src/lib/domain/auth/principal'
import { effectiveSettings } from '../../src/lib/domain/runtime/schemas'
import { catalogOf } from '../helpers/roles'
import { FakeOrm, FixedClock, MemoryAudit, fakeGateway } from '../helpers/fakes'
import { DataGatewayMcpServer } from '../../src/lib/application/mcp/dataGatewayMcpServer'
import { ToolCatalog } from '../../src/lib/application/mcp/toolCatalog'
import { gatewayTools } from '../../src/lib/application/mcp/gatewayTools'

const minimal = { orm: { schemas: [{ path: 'shop', workspace: '/tmp/shop', view: 'public' }] }, transports: { http: { port: 9291 } } }

describe('configuration', () => {
	test('a view in a role and in a schema; the views of the roles are checked when the schema loads', () => {
		const reading = new ConfigReader().read({
			...minimal,
			authorization: { roles: { support: { permissions: ['read'], view: 'support' }, admin: ['read', 'write'], billing: { permissions: ['read'], views: ['billing'] } } },
			authentication: {
				methods: [
					{ adapter: 'jwt', issuer: 'https://x', principal: { permissions: { claim: 'roles' } } },
					{ adapter: 'local', type: 'apikey', keys: [{ name: 'billing', value: 'k', roles: ['billing'] }] }
				]
			}
		})
		expect(reading.issues).toEqual([])
		const config = reading.config!
		// view (one) is views (docs/ROLE_SCOPES.md)
		expect(config.authorization.roles).toEqual({ support: { permissions: ['read'], views: ['support'] }, admin: { permissions: ['read', 'write'] }, billing: { permissions: ['read'], views: ['billing'] } })
		expect(config.orm.schemas[0].view).toBe('public')
		expect(effectiveSettings(config, { path: 'shop', workspace: '/tmp/shop', origin: 'explicit', overrides: {} }).namedViews.sort()).toEqual(['billing', 'support'])
	})

	test('a view with the permissions of stage is said (those commands see everything); a key with its own view stops it', () => {
		const reading = new ConfigReader().read({ ...minimal, authorization: { roles: { ops: { permissions: ['read', 'stageImport'], views: ['support'] } } } })
		expect(reading.issues).toEqual([])
		expect(reading.warnings.join()).toContain('has a view and stageImport: the commands of stage see the whole schema')
		const own = new ConfigReader().read({ ...minimal, authentication: { adapter: 'local', type: 'apikey', keys: [{ name: 'ops', value: 'k', roles: ['ops'], view: 'support' }] } })
		expect(own.issues.join()).toContain('keys[0]: view go in a role of authorization.roles')
	})
})

describe('who has which view', () => {
	const SECRET = 'a-secret-of-at-least-32-bytes-long!'
	const roles = catalogOf({ support: { permissions: ['read'], views: ['support'] }, analyst: { permissions: ['read'], views: ['analytics'] }, admin: ['read', 'write'], billing: { permissions: ['read'], views: ['billing'] } })
	const jwt = new JwtAuthenticator({
		issuer: 'https://x', audience: [], secret: SECRET, algorithms: ['HS256'], clockToleranceSec: 0,
		principal: { name: 'sub', permissions: { claim: 'roles' } },
		context: {}
	}, roles)
	const token = (roles: string[]) => new SignJWT({ sub: 'ann', roles }).setProtectedHeader({ alg: 'HS256' }).setIssuer('https://x').setExpirationTime('1m').sign(new TextEncoder().encode(SECRET))
	const bearer = async (roles: string[]) => ({ authorization: `Bearer ${await token(roles)}` })

	test('the roles of the token it knows; the schema chooses the view with them (docs/ROLE_SCOPES.md)', async () => {
		expect((await jwt.authenticate(await bearer(['support', 'admin', 'unknown']))).principal).toMatchObject({ name: 'ann', roles: ['support', 'admin'] })
		expect((await jwt.authenticate(await bearer(['admin']))).principal?.view).toBeUndefined()
		// two views are no longer refused here: the request chooses one, or is told to (resolveScope)
		expect(await jwt.authenticate(await bearer(['support', 'analyst']))).toMatchObject({ valid: true, principal: { roles: ['support', 'analyst'] } })
	})

	test('a key: its roles (the schema chooses the view with them, as with a token)', async () => {
		const keys = new ApiKeyAuthenticator([{ name: 'billing', value: 'k', roles: ['billing'] }], roles)
		expect((await keys.authenticate({ 'x-api-key': 'k' })).principal).toMatchObject({ name: 'billing', roles: ['billing'] })
	})

	test('ViewResolver: its own, else the schema\'s, else none; one the schema doesn\'t have, 403', () => {
		const views = new ViewResolver(() => ['default', 'support', 'public'], 'public')
		expect(views.of({ ...principal('ann', ['read']), view: 'support' })).toBe('support')
		expect(views.of(principal('svc', ['read']))).toBe('public')
		expect(new ViewResolver(() => ['default']).of(principal('svc', ['read']))).toBeUndefined()
		expect(views.of({ ...principal('ann', ['read']), view: 'default' })).toBeUndefined()
		expect(() => views.of({ ...principal('ann', ['read']), view: 'suport' })).toThrow(expect.objectContaining({ status: 403, name: 'ViewError' }))
		expect(views.missing(['support', 'suport', 'default'])).toEqual(['suport'])
	})
})

describe('what λORM receives', () => {
	class ViewedOrm extends FakeOrm {
		public calls: { op: string, options?: unknown, view?: string }[] = []
		public async metadata (query: string, options?: unknown) { this.calls.push({ op: 'metadata', options }); return super.metadata(query) }
		public async model (_query: string, options?: unknown) { this.calls.push({ op: 'model', options }); return [] as any }
		public domain (view?: string) { this.calls.push({ op: 'domain', view }); return { entities: view ? [{ name: 'Customers' }] : [{ name: 'Customers' }, { name: 'Invoices' }], enums: [] } as any }
		public entities (view?: string) { this.calls.push({ op: 'entities', view }); return (view ? [{ name: 'Customers' }] : [{ name: 'Customers' }, { name: 'Invoices' }]) as any }
		public mappings () { return [{ name: 'default', entities: [{ name: 'Customers' }, { name: 'Invoices' }] }] as any }
		public views () { return ['default', 'support'] }
	}
	const support = { principal: { ...principal('ann', ['read']), view: 'support', context: { tenant: 't1' } }, transport: 'http' }

	test('the queries run in the view of who calls; the metadata of a query too; the client\'s view is dropped', async () => {
		const orm = new ViewedOrm()
		const queries = new QueryUseCases(orm, new Auditor(new MemoryAudit(), new FixedClock(), '', { enabled: false, includeData: false }), new ViewResolver(() => orm.views()))
		await queries.execute(support, { query: 'Customers', options: { view: 'default' } as any })
		expect(orm.executed[0].options).toEqual({ view: 'support', context: { tenant: 't1' } })
		await queries.model(support, { query: 'Customers' })
		expect(orm.calls.filter(c => c.op === 'model')[0].options).toEqual({ view: 'support' })
		// the classification of a query (its permission) is made in the view too: an excluded entity fails there
		expect(orm.calls.filter(c => c.op === 'metadata')[0].options).toEqual({ view: 'support' })
	})

	test('the schema: the domain, the entities, the mappings and the views are those of the view', async () => {
		const orm = new ViewedOrm()
		const schema = new SchemaUseCases(orm, new ViewResolver(() => orm.views()))
		expect((await schema.entities(support)).map(e => e.name)).toEqual(['Customers'])
		expect((await schema.mappings(support))[0].entities!.map(e => e.name)).toEqual(['Customers'])
		await expect(schema.entityMapping(support, 'default', 'Invoices')).rejects.toMatchObject({ status: 404 })
		expect(await schema.views(support)).toEqual(['support'])
		const all = { principal: principal('admin', ['read']), transport: 'http' }
		expect((await schema.entities(all)).map(e => e.name)).toEqual(['Customers', 'Invoices'])
		expect(await schema.views(all)).toEqual(['default', 'support'])
	})

	test('MCP: an agent with a view is told only of its entities (the tools and the resources)', async () => {
		const orm = new ViewedOrm()
		const mcp = new DataGatewayMcpServer(new ToolCatalog(gatewayTools(fakeGateway().gateway)), orm, { name: 'shop', version: '1', pageSize: 100, maxRows: 50 }, new ViewResolver(() => orm.views()))
		const describe = async (ctx: any) => (await mcp.listTools(ctx)).items.find(t => t.name === 'orm_execute')!.description
		expect(await describe(support)).toContain('Customers')
		expect(await describe(support)).not.toContain('Invoices')
		expect(await describe({ principal: principal('admin', ['read']), transport: 'mcpHttp' })).toContain('Invoices')
		expect((await mcp.readResource(support, 'lambdaorm://schema/domain')).text).not.toContain('Invoices')
	})
})
