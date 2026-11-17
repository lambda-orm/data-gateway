// The runtime without threads: routes, schemas, effective settings, env, policies, router, dispatcher and supervisor.
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { DataGatewayConfig } from '../../src/lib/domain/config/dataGatewayConfig'
import { HeartbeatPolicy, RestartPolicy } from '../../src/lib/domain/runtime/policies'
import { schemaPathsIssues } from '../../src/lib/domain/runtime/schemaPath'
import { effectiveAuthentication, effectiveSettings, resolveSchemas, schemaEnv, threadpoolSize } from '../../src/lib/domain/runtime/schemas'
import { ChannelDispatcher } from '../../src/lib/application/runtime/channelDispatcher'
import { SchemaRouter } from '../../src/lib/application/runtime/schemaRouter'
import { Supervisor } from '../../src/lib/application/runtime/supervisor'
import { DataGatewayMcpServer } from '../../src/lib/application/mcp/dataGatewayMcpServer'
import { gatewayTools } from '../../src/lib/application/mcp/gatewayTools'
import { ToolCatalog } from '../../src/lib/application/mcp/toolCatalog'
import { NoneAuthenticator } from '../../src/lib/infrastructure/output/auth/authenticators'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { parseDotEnv } from '../../src/lib/infrastructure/output/discovery/dotEnvFileReader'
import { ALL, ctx, fakeGateway, FixedClock } from '../helpers/fakes'

const logger = new ConsoleLogger('error')
const config = (raw: Record<string, unknown>): DataGatewayConfig => {
	const reading = new ConfigReader().read({ transports: { http: { port: 1 }, mcpHttp: { port: 2 } }, ...raw })
	if (!reading.config) throw new Error(reading.issues.join('; '))
	return reading.config
}

describe('schema routes', () => {
	test('duplicated, prefix, root shared', () => {
		expect(schemaPathsIssues(['iot/v1', 'iot/v2', 'accounts/v1'])).toEqual([])
		expect(schemaPathsIssues(['iot/v1', 'iot/v1'])).toEqual(['schema path "iot/v1" is used by two schemas'])
		expect(schemaPathsIssues(['iot', 'iot/v1'])).toEqual(['schema path "iot" is a prefix of "iot/v1"'])
		expect(schemaPathsIssues(['', 'iot'])).toEqual(['a schema at the root must be the only schema (the others would be under its routes)'])
		expect(schemaPathsIssues(['iot', 'iotx'])).toEqual([])
	})
})

describe('schemas and their settings', () => {
	const c = config({
		orm: {
			workspacePath: '/w',
			schemas: [
				{ path: 'iot/v1', env: { DB: 'one' }, server: { maxConcurrent: 4 }, mcp: { tools: { exclude: ['orm_execute_script'] } }, transports: ['mcpHttp'] },
				{ path: 'accounts/v1', workspace: '/mnt/accounts', runtime: { mode: 'process', maxMemoryMb: 256 }, authentication: { adapter: 'local', type: 'bearer', token: 's' } }
			]
		},
		scripts: { enabled: true },
		server: { timeout: 5000 },
		authentication: { adapter: 'local', type: 'apikey', value: 'k' }
	})
	const discovered = [{ path: 'iot/v1', workspace: '/w/iot/v1' }, { path: 'iot/v2', workspace: '/w/iot/v2' }]

	test('discovered + explicit, adjustments applied', () => {
		const { schemas, issues } = resolveSchemas(c, discovered)
		expect(issues).toEqual([])
		expect(schemas.map(s => [s.path, s.workspace, s.origin])).toEqual([['iot/v1', '/w/iot/v1', 'discovered'], ['iot/v2', '/w/iot/v2', 'discovered'], ['accounts/v1', '/mnt/accounts', 'explicit']])
		expect(schemas[0].overrides.env).toEqual({ DB: 'one' })
	})

	test('an adjustment of nothing, nothing at all, a duplicated route', () => {
		expect(resolveSchemas(c, [{ path: 'iot/v2', workspace: '/w/iot/v2' }]).issues[0]).toMatch(/orm.schemas "iot\/v1" has no workspace and adjusts no discovered schema/)
		expect(resolveSchemas(config({ orm: { workspacePath: '/empty' } }), []).issues).toEqual(['no schema found: /empty has no lambdaORM.yaml'])
		expect(resolveSchemas(c, [...discovered, { path: 'accounts/v1', workspace: '/w/accounts/v1' }]).issues).toContain('schema path "accounts/v1" is used by two schemas')
	})

	test('schema → transport → global; the most specific replaces', () => {
		const [iot1, iot2, accounts] = resolveSchemas(c, discovered).schemas
		expect(effectiveSettings(c, iot1)).toEqual({
			transports: ['mcpHttp'],
			scripts: { enabled: true, maxLength: 20000, timeoutMs: 30000, maxIterations: 100000 },
			mcp: { maxRows: 500, tools: { include: [], exclude: ['orm_execute_script'] } },
			server: { timeout: 5000, maxConcurrent: 4, maxResponseBytes: 268435456 },
			runtime: { mode: 'thread', maxMemoryMb: 512, checkConnections: true }
		})
		expect(effectiveSettings(c, iot2).transports).toEqual(['http', 'mcpHttp'])
		expect(effectiveSettings(c, accounts).runtime).toEqual({ mode: 'process', maxMemoryMb: 256, checkConnections: true })
		expect(effectiveAuthentication(c, accounts, 'http')).toMatchObject({ type: 'bearer' })
		expect(effectiveAuthentication(c, iot2, 'http')).toMatchObject({ type: 'apikey' })
	})

	test('env of a schema: base variables, .env, then schemas[].env; nothing else of the gateway', () => {
		const [iot1] = resolveSchemas(c, discovered).schemas
		const gateway = { PATH: '/bin', TZ: 'UTC', NODE_OPTIONS: '-x', IOT_V2_DB: 'secret', DATA_GATEWAY_TOKEN: 'secret', KAFKA: 'k' }
		expect(schemaEnv(gateway, { DB: 'from-dotenv', OTHER: 'o' }, iot1, { isolate: true, passthrough: ['KAFKA'] }))
			.toEqual({ PATH: '/bin', TZ: 'UTC', NODE_OPTIONS: '-x', KAFKA: 'k', DB: 'one', OTHER: 'o' })
		expect(schemaEnv(gateway, {}, iot1, { isolate: false, passthrough: [] })).toMatchObject({ IOT_V2_DB: 'secret', DB: 'one' })
		expect(parseDotEnv('# c\nA=1\nexport B="two words"\nC=x # note\nbad line\n')).toEqual({ A: '1', B: 'two words', C: 'x' })
	})

	test('threadpool and policies', () => {
		expect(threadpoolSize(undefined, 1)).toBe(4)
		expect(threadpoolSize(undefined, 10)).toBe(20)
		expect(threadpoolSize(undefined, 100)).toBe(64)
		expect(threadpoolSize(8, 100)).toBe(8)
		const restart = new RestartPolicy(1000, 5000)
		expect([0, 1, 2, 3, 40].map(a => restart.delay(a))).toEqual([1000, 2000, 4000, 5000, 5000])
		const heartbeat = new HeartbeatPolicy(100, 300)
		expect([heartbeat.isHung(1000, 1300), heartbeat.isHung(1000, 1301)]).toEqual([false, true])
	})
})

describe('channel dispatcher (schema worker side)', () => {
	const fixture = fakeGateway()
	const mcp = new DataGatewayMcpServer(new ToolCatalog(gatewayTools(fixture.gateway)), fixture.orm, { name: 'x', version: '1', pageSize: 50, maxRows: 500 })
	const principal = { name: 'agent', permissions: ['read' as const] }
	const request = (op: string, args: unknown[], extra: Record<string, unknown> = {}) =>
		({ type: 'request' as const, id: 1, target: 'gateway' as const, op, args, principal, transport: 'http', deadline: Date.now() + 1000, ...extra })
	const decode = (json?: Uint8Array) => JSON.parse(new TextDecoder().decode(json))

	test('runs an operation with the principal of the request; the result as bytes', async () => {
		const response = await new ChannelDispatcher(fixture.gateway, mcp, 0, logger).dispatch(request('execute', [{ query: 'Products' }]))
		expect(decode(response!.json)).toEqual([{ id: 1 }])
		const denied = await new ChannelDispatcher(fixture.gateway, mcp, 0, logger).dispatch(request('execute', [{ query: 'Products.insert()' }]))
		expect(denied!.error).toMatchObject({ name: 'ForbiddenError', status: 403 })
	})

	test('MCP operations, unknown operations, late requests, results too large', async () => {
		const dispatcher = new ChannelDispatcher(fixture.gateway, mcp, 0, logger)
		const tools = await dispatcher.dispatch(request('listTools', [], { target: 'mcp' }))
		expect(decode(tools!.json).items.map((t: any) => t.name)).toContain('orm_execute')
		expect((await dispatcher.dispatch(request('constructor', [])))!.error).toMatchObject({ status: 400, name: 'ChannelError' })
		// what the transports map an error by crosses the channel: a database code, what a script threw
		fixture.orm.executeResult = Object.assign(new Error('duplicate key'), { code: '23505' })
		expect((await dispatcher.dispatch(request('execute', [{ query: 'Products' }])))!.error).toEqual({ name: 'Error', message: 'duplicate key', code: '23505' })
		fixture.orm.executeResult = [{ id: 1 }]
		fixture.orm.scriptResult = Promise.reject(Object.assign(new Error('thrown'), { value: { status: 404, message: 'quote not found', other: {} } }))
		expect((await dispatcher.dispatch(request('executeScript', [{ script: 'x' }], { principal: { name: 'b', permissions: ['script'] } })))!.error)
			.toEqual({ name: 'Error', message: 'thrown', value: { status: 404, message: 'quote not found' } })
		fixture.orm.scriptResult = 7
		expect((await dispatcher.dispatch(request('execute', [{ query: 'x' }], { target: 'mcp' })))!.error).toMatchObject({ status: 400 })
		expect(await dispatcher.dispatch(request('execute', [{ query: 'Products' }], { deadline: Date.now() - 1 }))).toBeUndefined()
		fixture.orm.executeResult = Array.from({ length: 100 }, (_, id) => ({ id }))
		const large = await new ChannelDispatcher(fixture.gateway, mcp, 100, logger).dispatch(request('execute', [{ query: 'Products' }]))
		expect(large!.error).toMatchObject({ status: 413, name: 'ResponseTooLargeError' })
		fixture.orm.executeResult = [{ id: 1 }]
		expect((await dispatcher.dispatch(request('version', [], { principal: undefined })))!.json).toBeDefined()
	})
})

describe('schema router (edge side)', () => {
	const router = (maxConcurrent = 0, timeout = 1000) => new SchemaRouter([
		{ path: 'iot/v1', transports: ['http'], maxConcurrent, timeout, authenticators: { http: new NoneAuthenticator() } },
		{ path: 'iot/v2', transports: ['http', 'mcpHttp'], maxConcurrent, timeout, authenticators: { http: new NoneAuthenticator() } }
	], new FixedClock(), '3.0.0')
	const channel = (answer: (request: any) => Promise<unknown>) => ({ request: answer, close: jest.fn(), onEvent: jest.fn() })
	const ready = (path: string) => ({ path, status: 'ready' as const, since: 'now', restarts: 0 })
	const info = { name: 'n', version: '1', instructions: 'i' }

	test('503 until ready; then each call goes through the channel with the principal', async () => {
		const r = router()
		const [v1, v2] = r.schemas()
		await expect(v1.gateway.execute(ctx(['read']), { query: 'Products' })).rejects.toMatchObject({ status: 503, name: 'SchemaUnavailableError', message: 'schema "iot/v1" is starting' })
		const seen: any[] = []
		r.connect('iot/v1', channel(async request => { seen.push(request); return [{ id: 1 }] }), info)
		r.setState(ready('iot/v1'))
		expect(await v1.gateway.execute(ctx(['read'], 'agent', 'http'), { query: 'Products' })).toEqual([{ id: 1 }])
		expect(seen[0]).toMatchObject({ target: 'gateway', op: 'execute', args: [{ query: 'Products' }], principal: { name: 'agent', permissions: ['read'] }, transport: 'http' })
		expect(v1.mcp.info()).toEqual(info)
		expect([v1.exposedOn('mcpHttp'), v2.exposedOn('mcpHttp')]).toEqual([false, true])
		await expect(v2.gateway.version()).rejects.toMatchObject({ status: 503 })
		expect((await r.health()).message).toBe('DEGRADED')
		r.setState({ ...ready('iot/v1'), status: 'restarting', reason: 'exit code 1' })
		await expect(v1.gateway.version()).rejects.toMatchObject({ status: 503, message: 'schema "iot/v1" is restarting: exit code 1' })
	})

	test('over maxConcurrent: 429 (isError in MCP); the other schema is not affected', async () => {
		const r = router(2)
		let release!: () => void
		const gate = new Promise<void>(resolve => { release = resolve })
		r.connect('iot/v1', channel(async () => { await gate; return 1 }), info)
		r.connect('iot/v2', channel(async () => 2), info)
		r.setState(ready('iot/v1'))
		r.setState(ready('iot/v2'))
		const [v1, v2] = r.schemas()
		const running = [v1.gateway.version(), v1.gateway.version()]
		await expect(v1.gateway.version()).rejects.toMatchObject({ status: 429, name: 'TooManyRequestsError' })
		expect(await v1.mcp.callTool(ctx(ALL), 'orm_plan', { query: 'x' })).toMatchObject({ isError: true })
		expect(await v2.gateway.version()).toBe(2)
		release()
		expect(await Promise.all(running)).toEqual([1, 1])
		expect(await v1.gateway.version()).toBe(1)
	})

	test('a worker that does not answer: 504 after timeout', async () => {
		const r = router(0, 10)
		r.connect('iot/v1', channel(() => new Promise(() => undefined)), info)
		r.setState(ready('iot/v1'))
		await expect(r.call('iot/v1', 'gateway', 'version', [], undefined)).rejects.toMatchObject({ status: 504 })
	}, 5000)
})

describe('supervisor', () => {
	const policies = { restart: new RestartPolicy(10, 40), heartbeat: new HeartbeatPolicy(20, 60), graceMs: 50 }

	class FakeWorker {
		public pings = 0
		public stopped = false
		public terminated = false
		constructor (public readonly kind: 'schema' | 'edge', public readonly events: any) {}
		ping () { this.pings++ }
		async stop () { this.stopped = true }
		async terminate () { this.terminated = true; this.events.exited('terminated') }
	}
	class FakeEdge extends FakeWorker {
		public connections: string[] = []
		public states: string[] = []
		connect (path: string) { this.connections.push(path) }
		state (state: any) { this.states.push(`${state.path}:${state.status}`) }
	}

	const setup = () => {
		const workers: FakeWorker[] = []
		const edges: FakeEdge[] = []
		const specs = ['a', 'b'].map(path => ({ descriptor: { path, workspace: `/w/${path}`, origin: 'discovered' as const, overrides: {} }, settings: {} as any, env: {} }))
		const supervisor = new Supervisor(specs,
			{ start: (spec, events) => { const w = new FakeWorker('schema', events); (w as any).path = spec.descriptor.path; workers.push(w); return w } },
			{ start: events => { const e = new FakeEdge('edge', events); edges.push(e); return e as any } },
			policies, { now: () => new Date(), uptimeSeconds: () => 0 }, logger)
		return { supervisor, workers, edges }
	}
	const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

	test('ready schemas get a channel from the edge; one that fails is retried alone with a growing wait', async () => {
		const { supervisor, workers, edges } = setup()
		supervisor.start()
		const [a, b] = workers
		a.events.ready({ name: 'a' })
		b.events.failed('database down')
		expect(edges[0].connections).toEqual(['a'])
		expect(supervisor.states().map(s => [s.path, s.status, s.reason])).toEqual([['a', 'ready', undefined], ['b', 'error', 'database down']])
		await wait(25)
		expect(workers).toHaveLength(3)
		workers[2].events.ready({ name: 'b' })
		expect(supervisor.states()[1].status).toBe('ready')
		expect(edges[0].connections).toEqual(['a', 'b'])
		await supervisor.stop()
	})

	test('a schema worker that exits is restarted; a hung one is terminated; the edge that falls is restarted and reconnected', async () => {
		const { supervisor, workers, edges } = setup()
		supervisor.start()
		workers[0].events.ready({ name: 'a' })
		workers[1].events.ready({ name: 'b' })
		workers[1].events.exited('out of memory')
		expect(supervisor.states()[1]).toMatchObject({ status: 'restarting', reason: 'out of memory', restarts: 1 })
		expect(edges[0].states).toContain('b:restarting')
		await wait(25)
		expect(workers).toHaveLength(3)
		workers[2].events.ready({ name: 'b' })
		// a answers its pings, the new b doesn't: b is terminated and restarted
		const answering = setInterval(() => { workers[0].events.pong(); edges.at(-1)!.events.pong() }, 10)
		await wait(120)
		expect(workers[2].terminated).toBe(true)
		expect(workers[0].terminated).toBe(false)
		edges[0].events.exited('crash')
		await wait(30)
		expect(edges).toHaveLength(2)
		expect(edges[1].connections).toEqual(expect.arrayContaining(['a']))
		clearInterval(answering)
		await supervisor.stop()
		expect(edges[1].stopped).toBe(true)
	})
})
