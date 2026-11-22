// What is saved in a workspace as files (docs/DATA_GATEWAY_ADMIN_PLAN.md §3.5), and the admin section of the config.
import { workbenchFileName, workbenchItemOf, workbenchKindOf, workbenchNameIssue, workbenchPlaces, WorkbenchItem } from '../../src/lib/domain/admin/workbench'
import { ConfigReader } from '../../src/lib/domain/config/configReader'

const item = (id: string, kind: WorkbenchItem['kind'], name: string, parentId?: string, extra: Partial<WorkbenchItem> = {}): WorkbenchItem => ({ id, kind, schema: 's', name, parentId, ...extra })

describe('workbench as files', () => {
	test('the file of each kind, and the kind of each file', () => {
		expect(workbenchFileName(item('1', 'query', 'sales'))).toBe('sales.query.yaml')
		expect(workbenchFileName(item('1', 'query', 'close', undefined, { mode: 'script' }))).toBe('close.script.yaml')
		expect(workbenchFileName(item('1', 'diagram', 'model'))).toBe('model.diagram.yaml')
		expect(workbenchKindOf('close.script.yaml')).toEqual({ kind: 'query', mode: 'script', name: 'close' })
		expect(workbenchKindOf('notes.txt')).toBeUndefined()
		expect(workbenchKindOf('.query.yaml')).toBeUndefined()
	})

	test('names a file can have', () => {
		expect(workbenchNameIssue('sales 2026')).toBeUndefined()
		for (const bad of ['', ' x', 'a/b', 'a\\b', '..', '.hidden', 'a:b', 'x'.repeat(121)]) expect(workbenchNameIssue(bad)).toBeDefined()
	})

	test('places by folder; a folder that is not there, a cycle and a repeated name are problems', () => {
		const { places, issues } = workbenchPlaces([item('f', 'folder', 'reports'), item('g', 'folder', '2026', 'f'), item('q', 'query', 'sales', 'g')])
		expect(issues).toEqual([])
		expect(places.get('q')).toBe('workbench/reports/2026/sales.query.yaml')
		expect(workbenchPlaces([item('q', 'query', 'sales', 'nope')]).issues[0]).toMatch(/folder that doesn't exist/)
		expect(workbenchPlaces([item('a', 'folder', 'a', 'b'), item('b', 'folder', 'b', 'a')]).issues.length).toBeGreaterThan(0)
		expect(workbenchPlaces([item('1', 'query', 'Sales'), item('2', 'query', 'sales')]).issues[0]).toMatch(/same name/)
		// a query and a diagram may share a name
		expect(workbenchPlaces([item('1', 'query', 'x'), item('2', 'diagram', 'x')]).issues).toEqual([])
	})

	test('a file written by hand: its place is its id, data as YAML becomes JSON text', () => {
		const read = workbenchItemOf('s', 'workbench/a.query.yaml', { query: 'A', data: { n: 1 } }, undefined, 'v', 'then')
		expect(read).toMatchObject({ id: 'file:workbench/a.query.yaml', kind: 'query', mode: 'query', query: 'A', data: '{"n":1}', options: '{}', createdAt: 'then' })
	})
})

describe('admin configuration', () => {
	const base = { orm: { workspacePath: '/w' }, transports: { http: { port: 8080 } } }
	test('off by default; on with authentication none it warns; admin permissions are never given by default', () => {
		const read = (raw: unknown) => new ConfigReader().read(raw)
		expect(read(base).config?.admin).toEqual({ enabled: false, allowAnonymous: false, maxFileBytes: 2 * 1024 ** 2 })
		expect(read({ ...base, admin: { enabled: true } }).warnings).toContainEqual(expect.stringMatching(/nobody can administer/))
		const keys = read({ ...base, authentication: { adapter: 'local', type: 'apikey', keys: [{ name: 'a', value: 'k' }, { name: 'b', value: 'j', permissions: ['schemaWrite'] }] } })
		expect(keys.config?.authentication.credentials.map(c => c.permissions)).toEqual([['read', 'write', 'script', 'queue', 'stageImport'], ['schemaWrite']])
	})
})
