// The view by identity (docs/VIEWS_BY_IDENTITY.md): the view of a key, of the roles of a token or of the schema; one
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
import { viewsOf } from '../../src/lib/domain/runtime/schemas'
import { FakeOrm, FixedClock, MemoryAudit, fakeGateway } from '../helpers/fakes'
import { DataGatewayMcpServer } from '../../src/lib/application/mcp/dataGatewayMcpServer'
import { ToolCatalog } from '../../src/lib/application/mcp/toolCatalog'
import { gatewayTools } from '../../src/lib/application/mcp/gatewayTools'

const minimal = { orm: { schemas: [{ path: 'shop', workspace: '/tmp/shop', view: 'public' }] }, transports: { http: { port: 9291 } } }

describe('configuration', () => {
	test('a view in a key, in a role (with its permissions) and in a schema', () => {
		const reading = new ConfigReader().read({
			...minimal,
			authentication: {
				methods: [
					{ adapter: 'jwt', issuer: 'https://x', principal: { permissions: { claim: 'roles', roles: { support: { permissions: ['read'], view: 'support' }, admin: ['read', 'write'] } } } },
					{ adapter: 'local', type: 'apikey', keys: [{ name: 'billing', value: 'k', permissions: ['read'], view: 'billing' }] }
				]
			}
		})
		expect(reading.issues).toEqual([])
		const auth = reading.config!.authentication
		expect(auth.methods![0].jwt!.principal.permissions!.roles).toEqual({ support: { permissions: ['read'], view: 'support' }, admin: { permissions: ['read', 'write'] } })
		expect(auth.methods![1].credentials[0]).toMatchObject({ name: 'billing', view: 'billing' })
		expect(reading.config!.orm.schemas[0].view).toBe('public')
		expect(viewsOf(auth).sort()).toEqual(['billing', 'support'])
	})

	test('a view with the permissions of stage is said (those commands see everything); a bad name stops it', () => {
		const reading = new ConfigReader().read({ ...minimal, authentication: { adapter: 'local', type: 'apikey', keys: [{ name: 'ops', value: 'k', permissions: ['read', 'stageImport'], view: 'support' }] } })
		expect(reading.issues).toEqual([])
		expect(reading.warnings.join()).toContain('has a view and stageImport: the commands of stage see the whole schema')
		const bad = new ConfigReader().read({ ...minimal, authentication: { adapter: 'local', type: 'apikey', keys: [{ name: 'ops', value: 'k', view: 'a view' }] } })
		expect(bad.issues.join()).toContain('view must be the name of a view of the schema')
	})
})

describe('who has which view', () => {
	const SECRET = 'a-secret-of-at-least-32-bytes-long!'
	const jwt = new JwtAuthenticator({
		issuer: 'https://x', audience: [], secret: SECRET, algorithms: ['HS256'], clockToleranceSec: 0,
		principal: { name: 'sub', permissions: { claim: 'roles', roles: { support: { permissions: ['read'], view: 'support' }, analyst: { permissions: ['read'], view: 'analytics' }, admin: { permissions: ['read', 'write'] } } } },
		context: {}
	})
	const token = (roles: string[]) => new SignJWT({ sub: 'ann', roles }).setProtectedHeader({ alg: 'HS256' }).setIssuer('https://x').setExpirationTime('1m').sign(new TextEncoder().encode(SECRET))
	const bearer = async (roles: string[]) => ({ authorization: `Bearer ${await token(roles)}` })

	test('the view of its role; a role without one, none; two views, 403 (never guessed)', async () => {
		expect((await jwt.authenticate(await bearer(['support', 'admin']))).principal).toMatchObject({ name: 'ann', view: 'support' })
		expect((await jwt.authenticate(await bearer(['admin']))).principal?.view).toBeUndefined()
		expect(await jwt.authenticate(await bearer(['support', 'analyst']))).toMatchObject({ valid: false, status: 403, reason: expect.stringContaining('several views (support, analytics)') })
	})

	test('the view of a key', async () => {
		const keys = new ApiKeyAuthenticator([{ name: 'billing', value: 'k', permissions: ['read'], view: 'billing' }])
		expect((await keys.authenticate({ 'x-api-key': 'k' })).principal).toMatchObject({ name: 'billing', view: 'billing' })
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
