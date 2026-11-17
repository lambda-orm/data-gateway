// The configuration file → DataGatewayConfig (docs/DATA_GATEWAY.md §2): defaults, ports, authentication, problems.
import { ConfigReader } from '../../src/lib/domain/config/configReader'

const read = (raw: unknown) => new ConfigReader().read(raw)
const base = { orm: { workspacePath: '/workspace' }, transports: { http: { port: 8080 } } }

describe('config reader', () => {
	test('defaults of a minimal configuration', () => {
		const { config, issues, warnings } = read(base)
		expect(issues).toEqual([])
		expect(warnings).toEqual([])
		expect(config).toMatchObject({
			orm: { workspacePath: '/workspace', schemas: [] },
			server: { timeout: 120000, requestBodySize: '14MB' },
			logger: { adapter: 'console', level: 'info' },
			metrics: { enabled: true },
			audit: { enabled: true, includeData: false },
			authentication: { adapter: 'none', credentials: [] },
			rateLimit: { windowMs: 30000, max: 30 },
			scripts: { enabled: false, maxLength: 20000, timeoutMs: 30000, maxIterations: 100000 },
			mcp: { name: 'data-gateway', tools: { include: [], exclude: [] }, pageSize: 50, maxRows: 500 },
			transports: { http: { port: 8080, host: '0.0.0.0', basePath: '', swagger: { enabled: true } } }
		})
	})

	test('values from environment variables come as strings', () => {
		const { config, issues } = read({ ...base, transports: { http: { port: '9000' } }, rateLimit: { max: '0' }, scripts: { enabled: 'true', timeoutMs: '1000' } })
		expect(issues).toEqual([])
		expect(config?.transports.http?.port).toBe(9000)
		expect(config?.rateLimit.max).toBe(0)
		expect(config?.scripts).toMatchObject({ enabled: true, timeoutMs: 1000 })
	})

	describe('ports', () => {
		test('a transport without port (or whose variable is not defined) is not exposed; none exposed stops', () => {
			const { config, issues, notes } = read({ ...base, transports: { http: { host: '0.0.0.0' } } })
			expect(config).toBeUndefined()
			expect(notes).toContain('http not exposed: no port configured')
			expect(issues).toContain('no transport exposed: configure transports.<name>.port')
			expect(read({ orm: base.orm }).issues).toContain('no transport exposed: configure transports.<name>.port')
		})

		test('an invalid port stops', () => {
			for (const port of ['abc', 0, 70000, 1.5]) {
				expect(read({ ...base, transports: { http: { port } } }).issues[0]).toMatch(/transports.http.port .* is not an integer between 1 and 65535/)
			}
		})

		test('MCP transports with their defaults; transports of later versions are warned; unknown ones stop', () => {
			const { config, warnings } = read({ ...base, transports: { http: { port: 1 }, mcpHttp: { port: 2 }, mcpWebSocket: { port: 3, maxConnections: '5' }, webSocket: { port: 4 } } })
			expect(Object.keys(config!.transports)).toEqual(['http', 'mcpHttp', 'mcpWebSocket'])
			expect(config!.transports.mcpHttp).toEqual({ port: 2, host: '0.0.0.0', basePath: '', legacySse: true, stateful: false, maxConnections: 100 })
			expect(config!.transports.mcpWebSocket).toEqual({ port: 3, host: '0.0.0.0', basePath: '', maxConnections: 5, asyncapi: { enabled: true } })
			expect(warnings).toContain('transports.webSocket is not available in this version: not exposed')
			expect(read({ ...base, transports: { http: { port: 1 }, mcpHttp: { port: 1 } } }).issues).toContain('transports.mcpHttp and transports.http use the same 0.0.0.0:1')
			expect(read({ ...base, transports: { ftp: { port: 1 } } }).issues).toContain('unknown transport "ftp"')
		})

		test('basePath must look like a path', () => {
			expect(read({ ...base, transports: { http: { port: 1, basePath: '/api/v1/' } } }).config?.transports.http?.basePath).toBe('/api/v1')
			expect(read({ ...base, transports: { http: { port: 1, basePath: 'no slash' } } }).issues[0]).toMatch(/basePath/)
		})
	})

	describe('authentication', () => {
		test('one credential: every permission', () => {
			const { config } = read({ ...base, authentication: { adapter: 'local', type: 'bearer', token: 's3cret' } })
			expect(config?.authentication).toEqual({
				adapter: 'local', type: 'bearer', header: undefined,
				credentials: [{ name: 'default', value: 's3cret', permissions: ['read', 'write', 'script', 'queue', 'stageImport'] }]
			})
		})

		test('a list of credentials with permissions', () => {
			const { config, issues } = read({
				...base,
				authentication: {
					adapter: 'local', type: 'apikey', header: 'X-Key',
					keys: [{ name: 'agent', value: 'a', permissions: ['read'] }, { name: 'backend', value: 'b' }]
				}
			})
			expect(issues).toEqual([])
			expect(config?.authentication.header).toBe('x-key')
			expect(config?.authentication.credentials).toEqual([
				{ name: 'agent', value: 'a', permissions: ['read'] },
				{ name: 'backend', value: 'b', permissions: ['read', 'write', 'script', 'queue', 'stageImport'] }
			])
		})

		test('basic users', () => {
			const { config } = read({ ...base, authentication: { adapter: 'local', type: 'basic', users: [{ username: 'ana', password: 'p', permissions: ['read'] }] } })
			expect(config?.authentication.credentials).toEqual([{ name: 'ana', username: 'ana', password: 'p', permissions: ['read'] }])
		})

		test('a local credential without its secret stops the process (never open by mistake)', () => {
			expect(read({ ...base, authentication: { adapter: 'local', type: 'bearer' } }).issues[0])
				.toMatch(/authentication: token is not defined/)
			expect(read({ ...base, authentication: { adapter: 'local', type: 'apikey', keys: [{ name: 'a' }] } }).issues[0])
				.toMatch(/authentication.keys\[0\]: value is not defined/)
		})

		test('invalid type, adapter, permissions and duplicated names', () => {
			expect(read({ ...base, authentication: { adapter: 'local', type: 'jwt', token: 'x' } }).issues).toContain('authentication.type must be bearer, apikey or basic')
			expect(read({ ...base, authentication: { adapter: 'oauth' } }).issues).toContain('authentication.adapter "oauth" is not none or local')
			expect(read({ ...base, authentication: { adapter: 'local', type: 'bearer', tokens: [{ name: 'a', value: 'x', permissions: ['admin'] }] } }).issues[0])
				.toMatch(/unknown permissions admin/)
			expect(read({ ...base, authentication: { adapter: 'local', type: 'bearer', tokens: [{ name: 'a', value: 'x' }, { name: 'a', value: 'y' }] } }).issues[0])
				.toMatch(/duplicated credential names a/)
		})

		test('a transport can have its own authentication', () => {
			const { config } = read({ ...base, transports: { http: { port: 1, authentication: { adapter: 'none' } } }, authentication: { adapter: 'local', type: 'bearer', token: 'x' } })
			expect(config?.transports.http?.authentication).toEqual({ adapter: 'none', credentials: [] })
			expect(config?.authentication.adapter).toBe('local')
		})
	})

	describe('orm', () => {
		test('a workspace is required', () => {
			expect(read({ transports: base.transports }).issues).toContain('orm.workspacePath (or an orm.schemas entry with workspace) is required')
		})

		test('one explicit schema at the root is accepted; several schemas arrive later', () => {
			expect(read({ ...base, orm: { schemas: [{ path: '', workspace: '/w' }] } }).issues).toEqual([])
			expect(read({ ...base, orm: { workspacePath: '/w', schemas: [{ path: 'iot/v1' }] } }).issues[0]).toMatch(/single schema at the root/)
		})
	})

	test('other problems are all listed at once', () => {
		const { issues } = read({ orm: { workspacePath: '/w' }, server: { timeout: 'soon' }, logger: { level: 'loud' }, scripts: { enabled: 'yes' }, transports: { http: { port: 1 } } })
		expect(issues).toEqual([
			'server.timeout "soon" must be an integer >= 1',
			'logger.level "loud" is not error, warn, info or debug',
			'scripts.enabled "yes" must be true or false'
		])
	})

	test('mcp: tools must be names of tools; maxRows 0 = no limit', () => {
		const { config } = read({ ...base, mcp: { tools: { exclude: ['orm_execute_script'] }, maxRows: '0', name: 'iot' } })
		expect(config?.mcp).toEqual({ name: 'iot', tools: { include: [], exclude: ['orm_execute_script'] }, pageSize: 50, maxRows: 0 })
		expect(read({ ...base, mcp: { tools: { include: ['orm_nope'] } } }).issues).toEqual(['mcp.tools.include: unknown tools orm_nope'])
	})

	test('unknown sections are warned; sections of later versions are accepted', () => {
		const { warnings } = read({ ...base, mcp: {}, runtime: {}, extra: 1 })
		expect(warnings).toEqual(['unknown section "extra" ignored'])
	})
})
