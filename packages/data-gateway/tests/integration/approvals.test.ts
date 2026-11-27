// The writes that wait for a person (docs/MUTATION_APPROVAL.md), with λORM on SQLite (sql.js): a write of an agent by
// MCP waits (nothing changes), approval_status says so; who asked can't approve it; another credential with approve
// does, and it runs as who asked (its view) and is audited with who approved it; a rejected or expired one never runs.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Orm } from '@lambdaorm/lib'
import { composeSchema, ComposedSchema } from '../../src/lib/infrastructure/build/schemaComposer'
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { effectiveSettings } from '../../src/lib/domain/runtime/schemas'
import { principal } from '../../src/lib/domain/auth/principal'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { RequestContext } from '../../src/lib/application/ports/input/dataGatewayPort'
import { ClockPort } from '../../src/lib/application/ports/output/supportPorts'
import { MemoryAudit } from '../helpers/fakes'
import { HttpTransport } from '../../src/lib/infrastructure/input/http/httpTransport'
import { BearerAuthenticator } from '../../src/lib/infrastructure/output/auth/authenticators'
import { NoMetrics } from '../../src/lib/infrastructure/output/metrics/promClientMetrics'
import { InlineSchemaDirectory } from '../../src/lib/application/runtime/inlineSchemaDirectory'
import { FixedClock } from '../helpers/fakes'
import { call } from '../helpers/net'
import { ownRoles, withGrants } from '../helpers/roles'

class MovableClock implements ClockPort {
	public time = Date.parse('2026-11-26T12:00:00.000Z')
	public now () { return new Date(this.time) }
	public uptimeSeconds () { return 1 }
}

let dir: string
let schema: ComposedSchema
const audit = new MemoryAudit()
const clock = new MovableClock()

const agent: RequestContext = { principal: principal('agent', ['read', 'write', 'script']), transport: 'mcpHttp' }
const agentByRest: RequestContext = { principal: agent.principal, transport: 'http' }
const ops: RequestContext = { principal: principal('ops', ['read', 'approve']), transport: 'admin' }
const backend: RequestContext = { principal: { ...principal('backend', ['read', 'write']), approval: 'writes' }, transport: 'http' }
const nameOf = async (id: number) => ((await schema.gateway.execute(ops, { query: 'Categories.filter(p => p.id == i).map(p => p.name)', data: { i: id } })) as any[])[0]?.name

beforeAll(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-approvals-'))
	const workspace = path.join(dir, 'shop')
	fs.mkdirSync(workspace)
	fs.writeFileSync(path.join(workspace, 'lambdaORM.yaml'), `domain:
  entities:
    - name: Categories
      primaryKey: [id]
      properties:
        - { name: id, type: integer, required: true }
        - { name: name, type: string, length: 80, required: true }
infrastructure:
  mappings:
    - name: default
  sources:
    - { name: main, dialect: SQLjs, mapping: default, connection: ':memory:' }
  stages:
    - name: default
      sources:
        - name: main
`)
	const { config } = new ConfigReader().read({
		orm: { workspacePath: dir },
		scripts: { enabled: true },
		mcp: { approval: 'writes', approvalExpires: '1h' },
		transports: { http: { port: 8080 } }
	})
	const settings = effectiveSettings(config!, { path: 'shop', workspace, overrides: {} } as any)
	expect(settings.mcp.approval).toBe('writes')
	expect(settings.stateFile).toBe(`${dir}/.data-gateway/state.sqlite`)
	schema = await composeSchema({ path: 'shop', workspace, settings, audit: { enabled: true, includeData: false }, mcpName: 'dg', pageSize: 50, version: '9.9.9', checkConnections: false },
		{ logger: new ConsoleLogger('error'), audit, clock })
	// the tables and a first row, through the gateway (an import, which never waits)
	const orm = (schema.gateway as any).orm as { orm: Orm }
	await orm.orm.stage.push({ stage: 'default' }).execute()
	await schema.gateway.execute({ principal: principal('setup', ['read', 'write']), transport: 'http' }, { query: 'Categories.insert()', data: { id: 1, name: 'Beverages' } })
}, 60000)
afterAll(async () => {
	await schema?.stop()
	fs.rmSync(dir, { recursive: true, force: true })
})

test('a write of an agent by MCP waits; nothing changes; who asked can see it, not approve it', async () => {
	const pending = await schema.gateway.execute(agent, { query: 'Categories.update(p => ({ name: n })).filter(p => p.id == 1)', data: { n: 'Drinks' } })
	expect(pending).toMatchObject({ status: 'pending', expiresAt: '2026-11-26T13:00:00.000Z' })
	expect(pending.message).toContain('waits for a person')
	expect(await nameOf(1)).toBe('Beverages')
	// a read never waits
	expect(await schema.gateway.execute(agent, { query: 'Categories.map(p => p.name)' })).toEqual([{ name: 'Beverages' }])
	const status = await schema.gateway.approval(agent, pending.approval)
	expect(status).toMatchObject({ status: 'pending', operation: 'execute', requester: { name: 'agent', transport: 'mcpHttp' } })
	expect(JSON.stringify(status.plan)).toContain('UPDATE')
	// approval_status, the tool of the agent
	const tool = await schema.mcp.callTool(agent, 'approval_status', { id: pending.approval })
	expect(JSON.stringify(tool)).toContain('pending')
	// who asked can't approve it
	await expect(schema.commands.run({ principal: principal('agent', ['read', 'write', 'approve']), transport: 'admin' }, 'approve', [pending.approval])).rejects.toMatchObject({ name: 'ApprovalOwnError', status: 403 })
	// without approve, neither list nor approve
	await expect(schema.commands.run({ principal: principal('reader', ['read']), transport: 'admin' }, 'approvalsList', [])).rejects.toMatchObject({ status: 403 })
	// another credential with approve: it runs as who asked, audited with who approved it
	const listed = await schema.commands.run(ops, 'approvalsList', ['pending']) as any[]
	expect(listed.map(a => a.id)).toContain(pending.approval)
	const done = await schema.commands.run(ops, 'approve', [pending.approval]) as any
	expect(done).toMatchObject({ status: 'done', result: 1, decidedBy: 'ops' })
	expect(await nameOf(1)).toBe('Drinks')
	expect(audit.entries.find(e => e.credential === 'agent' && e.operation === 'execute')).toMatchObject({ approvedBy: 'ops', result: 'ok' })
	// once: a second approval is refused
	await expect(schema.commands.run(ops, 'approve', [pending.approval])).rejects.toMatchObject({ name: 'ApprovalDecidedError', status: 409 })
	expect(await schema.gateway.approval(agent, pending.approval)).toMatchObject({ status: 'done', result: 1 })
	// another credential that is not who asked, without approve, doesn't see it
	await expect(schema.gateway.approval({ principal: principal('stranger', ['read']), transport: 'http' }, pending.approval)).rejects.toMatchObject({ status: 404 })
	// the same agent by REST: only MCP waits (mcp.approval)
	expect(await schema.gateway.execute(agentByRest, { query: 'Categories.insert()', data: { id: 9, name: 'Direct' } })).not.toHaveProperty('approval')
	expect(await nameOf(9)).toBe('Direct')
})

test('a credential with approval writes waits on any transport; a rejected write never runs; an expired one neither', async () => {
	const pending = await schema.gateway.execute(backend, { query: 'Categories.insert()', data: { id: 2, name: 'Condiments' } })
	expect(pending.status).toBe('pending')
	const rejected = await schema.commands.run(ops, 'reject', [pending.approval, 'not today']) as any
	expect(rejected).toMatchObject({ status: 'rejected', reason: 'not today', decidedBy: 'ops' })
	expect(await nameOf(2)).toBeUndefined()
	await expect(schema.commands.run(ops, 'approve', [pending.approval])).rejects.toMatchObject({ status: 409 })
	const late = await schema.gateway.execute(backend, { query: 'Categories.insert()', data: { id: 3, name: 'Confections' } })
	clock.time += 2 * 3600 * 1000
	expect(await schema.gateway.approval(backend, late.approval)).toMatchObject({ status: 'expired' })
	await expect(schema.commands.run(ops, 'approve', [late.approval])).rejects.toMatchObject({ name: 'ApprovalExpiredError', status: 410 })
	expect(await nameOf(3)).toBeUndefined()
})

test('a script of an agent always waits (it may write); a queued write can\'t wait', async () => {
	const pending = await schema.gateway.executeScript(agent, { script: 'orm.execute("Categories.insert()", { id: 4, name: "Dairy" })' })
	expect(pending).toMatchObject({ status: 'pending' })
	expect((await schema.gateway.approval(agent, pending.approval)).operation).toBe('executeScript')
	await schema.commands.run(ops, 'approve', [pending.approval])
	expect(await nameOf(4)).toBe('Dairy')
	await expect(schema.gateway.executeQueued({ principal: principal('agent', ['read', 'write', 'queue']), transport: 'mcpHttp' }, { topic: 't', query: 'Categories.insert()', data: { id: 5, name: 'x' } })).rejects.toMatchObject({ name: 'ApprovalRequiredError', status: 403 })
})

test('by REST: a write that waits answers 202 with its approval; GET /approvals/{id} its state', async () => {
	const backend = ownRoles([{ name: 'backend', value: 'backend-token', permissions: ['read', 'write'], approval: 'writes' }])
	const transport = new HttpTransport({ port: 0, host: '127.0.0.1', basePath: '', requestBodySize: '1mb', rateLimit: { windowMs: 1000, max: 0 }, swaggerEnabled: false }, {
		directory: withGrants(new InlineSchemaDirectory([{
			path: 'shop', gateway: schema.gateway, mcp: schema.mcp, transports: ['http'],
			authenticators: { http: new BearerAuthenticator(backend.credentials, backend.roles) }
		}], new FixedClock(), '9.9.9'), backend.roles),
		metrics: new NoMetrics(),
		logger: new ConsoleLogger('error')
	})
	await transport.start()
	try {
		const base = `http://127.0.0.1:${transport.address!.port}/shop`
		const auth = { Authorization: 'Bearer backend-token' }
		const res = await call(base, '/execute', { body: { query: 'Categories.insert()', data: { id: 7, name: 'Produce' } }, headers: auth })
		expect(res.status).toBe(202)
		expect(res.body).toMatchObject({ status: 'pending' })
		const state = await call(base, `/approvals/${res.body.approval}`, { headers: auth })
		expect(state.status).toBe(200)
		expect(state.body).toMatchObject({ status: 'pending', requester: { name: 'backend', transport: 'http' } })
		expect((await call(base, '/approvals/nope', { headers: auth })).status).toBe(404)
		expect(await nameOf(7)).toBeUndefined()
	} finally {
		await transport.stop()
	}
})
