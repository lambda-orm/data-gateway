// What is saved in a workspace as files (docs/DATA_GATEWAY_ADMIN_PLAN.md §3.5), and the admin section of the config.
import { workbenchContent, workbenchFileName, workbenchItemOf, workbenchKindOf, workbenchNameIssue, workbenchPlaces, WorkbenchItem } from '../../src/lib/domain/admin/workbench'
import { ConfigReader } from '../../src/lib/domain/config/configReader'

const item = (id: string, kind: WorkbenchItem['kind'], name: string, parentId?: string, extra: Partial<WorkbenchItem> = {}): WorkbenchItem => ({ id, kind, schema: 's', name, parentId, ...extra })

describe('workbench as files', () => {
	test('the file of each kind, and the kind of each file', () => {
		expect(workbenchFileName(item('1', 'query', 'sales'))).toBe('sales.query.yaml')
		expect(workbenchFileName(item('1', 'query', 'close', undefined, { mode: 'script' }))).toBe('close.script.yaml')
		expect(workbenchFileName(item('1', 'diagram', 'model'))).toBe('model.diagram.yaml')
		// a panel (docs/FILES_AND_PANELS.md §2): its cards and its refresh, there and back
		expect(workbenchFileName(item('1', 'panel', 'sales'))).toBe('sales.panel.yaml')
		expect(workbenchKindOf('sales.panel.yaml')).toEqual({ kind: 'panel', name: 'sales' })
		const cards = [{ id: 'c', title: 'Orders', query: 'Orders.map(p => ({ n: count(1) }))', form: 'number' }]
		const content = workbenchContent({ ...item('p1', 'panel', 'sales'), cards, refresh: 60 })
		expect(content).toMatchObject({ id: 'p1', cards, refresh: 60 })
		expect(workbenchItemOf('s', 'workbench/sales.panel.yaml', content, undefined, 'v', 'then')).toMatchObject({ id: 'p1', kind: 'panel', name: 'sales', cards, refresh: 60 })
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

	test('the wizard that wrote a query is kept as it comes, in its file and back', () => {
		const wizard = { root: 'Orders', tables: [], fields: { Orders: ['id'] }, filter: '', sort: [], page: { number: '', size: '10' } }
		const item: WorkbenchItem = { id: 'q1', kind: 'query', schema: 's', name: 'q', mode: 'query', query: 'Orders', wizard }
		const content = workbenchContent(item)
		expect(content.wizard).toEqual(wizard)
		expect(workbenchItemOf('s', 'workbench/q.query.yaml', content, undefined, 'v', 'then')?.wizard).toEqual(wizard)
		// a query without it, or with something that is not an object, has none
		expect(workbenchContent({ ...item, wizard: undefined })).not.toHaveProperty('wizard')
		expect(workbenchItemOf('s', 'workbench/q.query.yaml', { query: 'A', wizard: 'x' }, undefined, 'v', 'then')).not.toHaveProperty('wizard')
	})

	test('a diagram of a stage keeps its stage and how it is shown, in its file and back', () => {
		const stageView = { orientation: 'left', detail: 'names', positions: { main: { x: 10, y: 20 } } }
		const item: WorkbenchItem = { id: 'd1', kind: 'diagram', schema: 's', name: 'Stage default', entities: [], stage: 'default', stageView }
		const content = workbenchContent(item)
		expect(content).toMatchObject({ stage: 'default', stageView })
		expect(workbenchItemOf('s', 'workbench/Stage default.diagram.yaml', content, undefined, 'v', 'then')).toMatchObject({ kind: 'diagram', stage: 'default', stageView })
		// a diagram of entities has neither
		expect(workbenchItemOf('s', 'workbench/m.diagram.yaml', { entities: ['A'] }, undefined, 'v', 'then')).not.toHaveProperty('stage')
	})
})

describe('admin configuration', () => {
	const base = { orm: { workspacePath: '/w' }, transports: { http: { port: 8080 } } }
	test('on with transports.management; with authentication none it warns; admin permissions are never given by default', () => {
		const read = (raw: unknown) => new ConfigReader().read(raw)
		expect(read(base).config?.admin).toEqual({ enabled: false, allowAnonymous: false, maxFileBytes: 2 * 1024 ** 2, commandTimeoutMs: 600000 })
		const management = (raw: any) => ({ ...raw, transports: { ...raw.transports, management: { port: 8081 } } })
		expect(read(management(base)).config?.admin.enabled).toBe(true)
		expect(read(management(base)).config?.transports.management).toMatchObject({ port: 8081, host: '0.0.0.0', basePath: '' })
		expect(read(management(base)).warnings).toContainEqual(expect.stringMatching(/nobody can administer/))
		// 3.x: admin.enabled and transports.http.ui are warned about and ignored
		const old = read({ ...base, admin: { enabled: true }, transports: { http: { port: 8080, ui: { enabled: true } } } })
		expect(old.config?.admin.enabled).toBe(false)
		expect(old.warnings).toContainEqual(expect.stringMatching(/admin.enabled was removed in 4.0.0/))
		expect(old.warnings).toContainEqual(expect.stringMatching(/transports.http.ui was removed in 4.0.0/))
		// a key has what its roles say; one without roles stops the gateway (it never gets every permission)
		const keys = read({ ...base, authorization: { roles: { modeler: ['schemaWrite'] } }, authentication: { adapter: 'local', type: 'apikey', keys: [{ name: 'a', value: 'k' }, { name: 'b', value: 'j', roles: ['modeler'] }] } })
		expect(keys.issues).toEqual(['authentication.keys[0].roles must be a non empty list of the names of roles of authorization.roles'])
	})
})
