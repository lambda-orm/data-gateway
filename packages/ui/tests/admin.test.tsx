// The administration of the workspaces in the UI (docs/DATA_GATEWAY_ADMIN_PLAN.md §3.1, §3.2): the lambdaORM.yaml
// editable with its version, validated while typed, the conflict when someone else saved, new and removed schemas,
// and what a credential without the permissions sees.
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Workspace } from '../src/components/Workspace'
import { AdminApiPort, AdminCapabilities, SchemaIssue } from '../src/application/ports'
import { MemoryWorkspaceStore } from '../src/infrastructure/workspaceStores'
import { RestAdminApi } from '../src/infrastructure/restAdminApi'
import { FakeApi } from './fakes'

vi.mock('../src/infrastructure/monaco/monacoSetup', () => ({
	loadMonaco: () => Promise.reject(new Error('no browser')),
	setSchemaTypings: () => Promise.resolve()
}))

afterEach(cleanup)

const ALL: AdminCapabilities = { schemaRead: true, schemaWrite: true, schemaAdmin: true, workbenchRead: true, workbenchWrite: true }
const status = (code: number, message: string, details?: unknown) => Object.assign(new Error(message), { status: code, details })

class FakeAdmin implements AdminApiPort {
	public text = 'domain:\n  entities: []\n'
	public version = 'v1'
	public calls: string[] = []
	constructor (public can: AdminCapabilities | undefined = ALL) {}
	async capabilities () { return this.can }
	async readSchema (schema: string) { this.calls.push(`read ${schema}`); return { text: this.text, version: this.version } }
	async writeSchema (schema: string, text: string, version: string) {
		this.calls.push(`write ${schema} ${version}`)
		if (version !== this.version) throw status(412, 'changed', { text: this.text, version: this.version })
		this.text = text
		this.version = `v${Number(this.version.slice(1)) + 1}`
		return { version: this.version, issues: [] }
	}
	async expressionLanguage () {
		return { functions: [{ name: 'in', params: [{ name: 'value' }, { name: 'list' }], returnType: 'boolean' }], operators: [], constants: ['true', 'false'],
			contexts: { stageSource: [{ name: 'entity', type: 'string', description: '' }, { name: 'read', type: 'boolean', description: '' }] } }
	}

	async stageRouting (_schema: string, stage: string) {
		return { stage, sources: [{ name: 'main', dialect: 'PostgreSQL', entities: [{ entity: 'Products', table: 'Products' }] }], unrouted: [] }
	}

	async checkExpression (expression: string) {
		return expression.includes('foo') ? { valid: false, variables: ['entity', 'foo'], unknown: ['foo'] } : { valid: true, variables: ['entity'], unknown: [] }
	}

	public patches: any[] = []
	public conflictOnce = false
	async patchSchema (_schema: string, patch: any): Promise<any> {
		if (this.conflictOnce) {
			this.conflictOnce = false
			throw status(412, 'changed', { current: { name: 'Products', properties: [{ name: 'id', type: 'integer' }, { name: 'price', type: 'decimal' }] } })
		}
		this.patches.push(patch)
		return { version: 'v9', references: [], added: 1, removed: 0 }
	}

	public env: Record<string, string> = {}
	async variables () { return { variables: [{ name: 'SHOP_CNX', defined: 'SHOP_CNX' in this.env, usedBy: ['main'], used: true }] } }
	async setVariables (_schema: string, change: { set?: Record<string, string>, remove?: string[] }) {
		Object.assign(this.env, change.set ?? {})
		for (const name of change.remove ?? []) delete this.env[name]
		return this.variables()
	}

	async build (_schema?: string, language = 'node', parts: any = {}) { this.calls.push(`build ${language}${parts.model === false ? ' -r' : parts.repositories === false ? ' -m' : ''}`); return { language: 'node', files: [{ path: 'src/domain/model.ts', written: 'created', bytes: 10 }, { path: 'src/domain/repositoryProduct.ts', written: 'kept', bytes: 5 }] } }
	async buildZip () { return new Blob(['zip']) }

	async files (_schema: string, dir?: string) {
		const roots = { data: 'data', src: 'src', model: 'src/domain' }
		// the code of two languages, each in its folder of src/
		if (dir === 'src') return { roots, files: [{ path: 'src/domain', dir: true, modified: 'now' }, { path: 'src/domain/model.ts', dir: false, modified: 'now' }, { path: 'src/kotlin', dir: true, modified: 'now' }, { path: 'src/kotlin/Model.kt', dir: false, modified: 'now' }, { path: 'src/node', dir: true, modified: 'now' }, { path: 'src/node/domain', dir: true, modified: 'now' }, { path: 'src/node/domain/model.ts', dir: false, modified: 'now' }] }
		return { roots, files: [{ path: 'data/seed.sql', dir: false, modified: 'now' }] }
	}
	async removeCode (schema: string, dir: string) { this.calls.push(`remove code ${schema} ${dir}`); return { removed: dir } }
	async folderZip (schema: string, dir: string) { this.calls.push(`zip ${schema} ${dir}`); return new Blob(['zip']) }
	async fileContent (_schema: string, path: string) { return { path, text: 'INSERT INTO x VALUES (1);', version: 'f1' } }

	async references (_schema: string, at: string[]) { return { references: at.includes('States') ? ['domain/entities/Products/properties/state'] : [] } }

	async validate (text: string): Promise<{ valid: boolean, issues: SchemaIssue[] }> {
		return text.includes('nope') ? { valid: false, issues: [{ severity: 'error', message: 'bad indentation', line: 2, column: 3 }] } : { valid: true, issues: [] }
	}
	async createWorkspace (path: string, copyOf?: string, about: { name?: string, description?: string } = {}) { this.calls.push(`create ${path} ${copyOf ?? ''}${about.name ? ` name=${about.name}` : ''}${about.description ? ` description=${about.description}` : ''}`.trim()); if (path === 'admin') throw status(400, 'segment "admin" is reserved'); return { path, version: 'v1' } }
	async removeWorkspace (path: string) { this.calls.push(`remove ${path}`); return { trash: `.trash/${path}` } }
	async workbench (_version?: string): Promise<{ version: string, items: any[] } | undefined> { return { version: '0', items: [] } }
	async putItems (_items: any[]): Promise<{ items: { id: string, version: string }[] }> { return { items: [] } }
	async removeItems (_ids: string[]): Promise<{ removed: string[] }> { return { removed: [] } }
	public jobList: any[] = []
	async commands () { return { stages: ['default', 'test'], can: { version: true, fetch: true, export: true, push: true, drop: true, import: true, pull: true, introspect: true, incorporate: true, migrations: true, migrate: true, seed: true } } }
	async previewCommand (_schema: string, command: any, body: any): Promise<any> {
		this.calls.push(`preview ${command} ${body.stage}`)
		if (command === 'pull') return { previewId: 'p-pull', command, stage: 'default', expiresAt: 'later', diff: { added: 2, removed: 0, hunks: [{ oldStart: 3, newStart: 3, lines: [{ op: ' ', text: '  entities:' }, { op: '+', text: '  - name: Suppliers' }, { op: '+', text: '    primaryKey: [id]' }] }] } }
		if (command === 'seed') return { previewId: 'p-seed', command, stage: 'default', expiresAt: 'later', files: ['data/categories.json'] }
		if (command === 'migrate') {
			return { previewId: 'p-migrate', command, stage: 'default', expiresAt: 'later', version: body.version, sentences: [{ source: 'main', version: '261125120000', sentences: ['ALTER TABLE Categories DROP COLUMN code'] }], destructive: [] }
		}
		// on test, push narrows a column: it can lose data
		const destructive = command === 'push' && body.stage === 'test' ? [{ source: 'main', sentence: 'ALTER TABLE Categories ALTER COLUMN name TYPE VARCHAR(40)', reason: 'Categories.name: length 80 to 40' }] : []
		return { previewId: `p-${command}`, command, stage: body.stage ?? 'default', expiresAt: 'later', destructive, sentences: command === 'push' ? [{ source: 'main', sentences: ['CREATE TABLE Categories (id INTEGER)'] }] : ['DROP TABLE Categories'] }
	}

	async runCommand (_schema: string, command: any, body: any): Promise<any> {
		this.calls.push(`run ${command} ${body.stage} ${body.previewId ?? ''} ${body.force ? 'force' : ''} ${body.allowDestructive ? 'allowDestructive' : ''}`.trim().replace(/ +/g, ' '))
		const migrations = [
			{ version: '261125120000', source: 'main', status: 'applied', time: '2026-11-25T12:00:00Z', actor: { credential: 'admin' } },
			{ version: '261124090000', source: 'main', status: 'applied', time: '2026-11-24T09:00:00Z' }
		]
		const result = command === 'fetch' ? [{ name: 'default', entities: [] }] : command === 'migrations' ? migrations : []
		const job = { id: `j${this.jobList.length + 1}`, schema: 'northwind/v1', command, stage: body.stage, status: 'done', credential: 'admin', startedAt: new Date().toISOString(), result }
		this.jobList.unshift(job)
		return job
	}

	async jobs () { return this.jobList.map(({ result, ...j }) => j) }
	async job (_schema: string, id: string) { return this.jobList.find(j => j.id === id) }
}

const findRow = (name: string) => screen.queryAllByRole('treeitem').find(r => r.querySelector('.lw-tree-label')?.textContent === name)
/** a row of the tree; config, domain, data… are inside the Metadata of the schema: unfolded when the row is not there */
const row = (name: string) => {
	const found = findRow(name)
	if (found || name === 'Metadata' || name === 'Metadatos') return found!
	for (const meta of screen.queryAllByRole('treeitem').filter(r => ['Metadata', 'Metadatos'].includes(r.querySelector('.lw-tree-label')?.textContent ?? '') && r.getAttribute('aria-expanded') !== 'true')) fireEvent.click(meta)
	return findRow(name)!
}
/** A row of the tree once it is there */
const rowSoon = (name: string) => waitFor(() => { const found = row(name); expect(found).toBeTruthy(); return found })
const show = (admin: FakeAdmin) => render(<Workspace api={new FakeApi()} admin={admin} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)

describe('the schema as YAML, editable', () => {
	test('opened from the explorer, saved with the version it read; while typed, the issues show', async () => {
		const admin = new FakeAdmin()
		show(admin)
		await waitFor(() => expect(row('config')).toBeTruthy())
		fireEvent.click(row('config'))
		const reading = await screen.findByLabelText('Schema (lambdaORM.yaml)', { selector: 'textarea' }) as HTMLTextAreaElement
		expect(reading.value).toBe(admin.text)
		expect(reading.readOnly).toBe(true)
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
		const editor = screen.getByLabelText('Schema (lambdaORM.yaml)', { selector: 'textarea' }) as HTMLTextAreaElement
		expect(editor.readOnly).toBe(false)
		fireEvent.change(editor, { target: { value: 'domain:\n  nope: 1\n' } })
		await waitFor(() => expect(screen.getByText('2: bad indentation')).toBeTruthy(), { timeout: 2000 })
		expect(screen.getByText('1 errors')).toBeTruthy()
		fireEvent.change(editor, { target: { value: 'domain:\n  entities: [ { name: A } ]\n' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(admin.calls).toContain('write northwind/v1 v1'))
		await screen.findByText('Saved: the gateway reloads the schema')
		expect(admin.text).toBe('domain:\n  entities: [ { name: A } ]\n')
		// saved, it is read only again
		expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
	})

	test('someone else saved meanwhile: both side by side, and either is taken', async () => {
		const admin = new FakeAdmin()
		show(admin)
		await waitFor(() => expect(row('config')).toBeTruthy())
		fireEvent.click(row('config'))
		fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
		const editor = screen.getByLabelText('Schema (lambdaORM.yaml)', { selector: 'textarea' }) as HTMLTextAreaElement
		// another person saves version 2
		admin.text = 'domain:\n  entities: [ { name: Theirs } ]\n'
		admin.version = 'v2'
		fireEvent.change(editor, { target: { value: 'domain:\n  entities: [ { name: Mine } ]\n' } })
		fireEvent.keyDown(editor, { key: 's', ctrlKey: true })
		await screen.findByText('Someone else saved a new version while you were editing')
		expect((screen.getByLabelText('On the gateway', { selector: 'textarea' }) as HTMLTextAreaElement).value).toContain('Theirs')
		expect((screen.getByLabelText('Yours', { selector: 'textarea' }) as HTMLTextAreaElement).value).toContain('Mine')
		fireEvent.click(screen.getByRole('button', { name: 'Save mine over it' }))
		await waitFor(() => expect(admin.calls).toContain('write northwind/v1 v2'))
		expect(admin.text).toContain('Mine')
	})

	test('without schemaWrite it is read only; without schemaRead there is no file to open', async () => {
		const reader = new FakeAdmin({ ...ALL, schemaWrite: false, schemaAdmin: false })
		show(reader)
		await waitFor(() => expect(row('config')).toBeTruthy())
		expect(screen.queryByRole('button', { name: 'New schema' })).toBeNull()
		fireEvent.click(row('config'))
		await screen.findByText('Read only: this credential can’t change the schema')
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
		cleanup()
		const none = new FakeAdmin()
		none.can = undefined
		show(none)
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		expect(screen.queryByText('config')).toBeNull()
	})

	test('a schema that did not start can be opened to fix it', async () => {
		show(new FakeAdmin())
		await waitFor(() => expect(row('northwind/v2 (error)')).toBeTruthy())
		fireEvent.click(row('northwind/v2 (error)'))
		expect(screen.getAllByText('config').length).toBeGreaterThan(0)
	})
})

describe('new and removed schemas', () => {
	test('a new schema: its route and what it starts from; a refused route says why', async () => {
		const admin = new FakeAdmin()
		show(admin)
		fireEvent.click(await screen.findByRole('button', { name: 'New schema' }))
		const dialog = screen.getByRole('dialog')
		fireEvent.change(within(dialog).getByLabelText('route'), { target: { value: 'admin' } })
		fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
		await within(dialog).findByText('segment "admin" is reserved')
		fireEvent.change(within(dialog).getByLabelText('route'), { target: { value: 'sales/v1' } })
		fireEvent.change(within(dialog).getByLabelText('start from'), { target: { value: 'northwind/v1' } })
		fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Sales' } })
		fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Orders and invoices' } })
		fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
		await screen.findByText('Schema sales/v1 created: it starts in a moment')
		expect(admin.calls).toContain('create sales/v1 northwind/v1 name=Sales description=Orders and invoices')
	})

	test('with a schema at the root, a new one is not offered to be created: the dialog says why', async () => {
		class RootApi extends FakeApi { async schemas () { return [{ path: '', status: 'ready' }] as any } }
		render(<Workspace api={new RootApi()} admin={new FakeAdmin()} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		fireEvent.click(await screen.findByRole('button', { name: 'New schema' }))
		const dialog = screen.getByRole('dialog')
		fireEvent.change(within(dialog).getByLabelText('route'), { target: { value: 'sales' } })
		expect(within(dialog).getByText(/move it to a folder of the workspace/)).toBeTruthy()
		expect((within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)
	})

	test('removed only once its route is typed again', async () => {
		const admin = new FakeAdmin()
		show(admin)
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		// its Remove is in its view, next to Edit
		fireEvent.doubleClick(row('northwind/v1'))
		fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
		const dialog = screen.getByRole('dialog')
		const remove = within(dialog).getByRole('button', { name: 'Remove' }) as HTMLButtonElement
		expect(remove.disabled).toBe(true)
		fireEvent.change(within(dialog).getByLabelText('confirm route'), { target: { value: 'northwind/v1' } })
		expect(remove.disabled).toBe(false)
		fireEvent.click(remove)
		await screen.findByText('Schema northwind/v1 removed (its workspace is in .trash)')
		expect(admin.calls).toContain('remove northwind/v1')
	})
})

describe('the REST adapter of the administration', () => {
	test('the route in one segment, the version as If-Match, the details of an error', async () => {
		const seen: { url: string, init: any }[] = []
		const fetcher = (async (url: string, init: any) => {
			seen.push({ url, init })
			if (init.method === 'PUT') return new Response(JSON.stringify({ error: 'PreconditionFailedError', message: 'changed', details: { version: 'b', text: 'x' } }), { status: 412 })
			if (url.endsWith('/admin')) return new Response('{"error":"NotFoundError","message":"no"}', { status: 404 })
			return new Response(JSON.stringify({ text: 't', version: 'a' }), { status: 200 })
		}) as unknown as typeof fetch
		const api = new RestAdminApi('http://g/', () => ({ 'X-Api-Key': 'k' }), fetcher)
		expect(await api.capabilities()).toBeUndefined()
		await api.readSchema('iot/v1')
		expect(seen[1].url).toBe('http://g/admin/workspaces/iot%2Fv1/schema')
		await expect(api.writeSchema('', 'x', 'a')).rejects.toMatchObject({ status: 412, details: { version: 'b' } })
		expect(seen[2]).toMatchObject({ url: 'http://g/admin/workspaces/~/schema', init: { method: 'PUT', headers: { 'If-Match': '"a"', 'X-Api-Key': 'k' } } })
	})
})

describe('what is saved, in the workspaces of the gateway', () => {
	class SharedAdmin extends FakeAdmin {
		public items: any[] = [{ id: 'f1', kind: 'folder', schema: 'northwind/v1', name: 'shared reports', createdAt: 'a', updatedAt: 'a', version: 'x1' }]
		public puts: any[][] = []
		public reject = false
		async workbench (version?: string) {
			const all = `${this.items.length}:${this.items.map(i => i.version).join(',')}`
			return version === all ? undefined : { version: all, items: this.items }
		}

		async putItems (items: any[]) {
			this.puts.push(items)
			if (this.reject) throw status(412, '"x" changed since they were read', { ids: [items[0].id] })
			for (const item of items) this.items = [...this.items.filter(i => i.id !== item.id), { ...item, version: `v-${item.id}` }]
			return { items: items.map(i => ({ id: i.id, version: `v-${i.id}` })) }
		}

		async removeItems (ids: string[]) { this.items = this.items.filter(i => !ids.includes(i.id)); return { removed: ids } }
	}

	test('with workbenchWrite: the items of the gateway, and each change sent with the version it read', async () => {
		const { GatewayWorkspaceStore } = await import('../src/infrastructure/gatewayWorkspaceStore')
		const admin = new SharedAdmin()
		const store = new GatewayWorkspaceStore(admin)
		const items = await store.all()
		expect(items).toEqual([expect.objectContaining({ id: 'f1', name: 'shared reports' })])
		expect((items[0] as any).version).toBeUndefined()
		expect(await store.changed()).toBe(false)
		await store.put([{ ...items[0], name: 'renamed' } as any])
		expect(admin.puts[0][0]).toMatchObject({ id: 'f1', name: 'renamed', version: 'x1' })
		admin.items = [...admin.items, { id: 'other', kind: 'folder', schema: 'northwind/v1', name: 'by someone else', version: 'o1' }]
		expect(await store.changed()).toBe(true)
		admin.reject = true
		await expect(store.put([{ ...items[0], name: 'again' } as any])).rejects.toMatchObject({ status: 412, message: expect.stringMatching(/someone else changed it/) })
		await expect(store.clear()).rejects.toThrow(/shared/)
	})

	test('the explorer shows what is saved in the workspace and saves there', async () => {
		const admin = new SharedAdmin()
		render(<Workspace api={new FakeApi()} admin={admin} history={false} locale="en" refreshMs={0} />)
		// what is saved lives in the projects of the schema: a project is a folder at its top
		await waitFor(() => expect(row('Workbench')).toBeTruthy())
		fireEvent.click(row('Workbench'))
		await waitFor(() => expect(row('shared reports')).toBeTruthy())
		fireEvent.click(within(row('Workbench')).getByRole('button', { name: 'Add' }))
		fireEvent.click(screen.getByRole('menuitem', { name: /New project/ }))
		// its dialog says what it creates: a project, not a folder
		expect(screen.getByRole('dialog', { name: 'New project' })).toBeTruthy()
		fireEvent.change(screen.getByLabelText('name'), { target: { value: 'mine' } })
		fireEvent.click(screen.getByRole('button', { name: 'Create' }))
		await waitFor(() => expect(admin.puts.some(p => p[0].name === 'mine' && p[0].version === undefined)).toBe(true))
		await waitFor(() => expect(row('mine')).toBeTruthy())
	})

	test('without workbenchWrite what is saved stays in this browser', async () => {
		const admin = new SharedAdmin({ ...ALL, workbenchWrite: false })
		render(<Workspace api={new FakeApi()} admin={admin} history={false} locale="en" refreshMs={0} />)
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		expect(screen.queryByText('shared reports')).toBeNull()
	})
})

describe('the commands of a workspace', () => {
	const openCommands = async (admin: FakeAdmin) => {
		show(admin)
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		fireEvent.doubleClick(row('northwind/v1'))
		return screen.findByRole('region', { name: /Commands — northwind\/v1/ }).catch(() => screen.findByLabelText('Commands — northwind/v1'))
	}

	test('fetch runs at once; the result says the databases are in step', async () => {
		const admin = new FakeAdmin()
		await openCommands(admin)
		fireEvent.click(await screen.findByRole('button', { name: 'fetch' }))
		await screen.findByText('No differences: the databases are in step with the model')
		expect(admin.calls).toContain('run fetch default')
		expect(screen.getAllByText('done').length).toBeGreaterThan(0)
	})

	test('push shows its sentences first and runs that preview, on the chosen stage', async () => {
		const admin = new FakeAdmin()
		await openCommands(admin)
		fireEvent.change(await screen.findByLabelText('stage'), { target: { value: 'test' } })
		fireEvent.click(screen.getByRole('button', { name: 'push…' }))
		await screen.findByText(/CREATE TABLE Categories/)
		expect(screen.getByText('What push will run on stage test')).toBeTruthy()
		fireEvent.click(screen.getByLabelText(/tryAllCan/))
		// on test it can lose data: it runs only once that is allowed
		expect(screen.getByText('These changes can lose data:')).toBeTruthy()
		expect(screen.getByText('Categories.name: length 80 to 40')).toBeTruthy()
		const run = screen.getByRole('button', { name: 'Run push' }) as HTMLButtonElement
		expect(run.disabled).toBe(true)
		fireEvent.click(screen.getByLabelText('apply also the changes that can lose data'))
		fireEvent.click(run)
		await waitFor(() => expect(admin.calls).toContain('run push test p-push force allowDestructive'))
	})

	test('migrations lists the history; migrate goes back to a version from it, after its preview', async () => {
		const admin = new FakeAdmin()
		await openCommands(admin)
		fireEvent.click(await screen.findByRole('button', { name: 'migrations' }))
		const table = await screen.findByRole('table', { name: 'migrations' })
		expect(table.textContent).toContain('261125120000')
		// only the older one can be gone back to
		const back = screen.getAllByRole('button', { name: 'go back here' })
		expect(back).toHaveLength(1)
		fireEvent.click(back[0])
		await screen.findByText(/DROP COLUMN code/)
		expect(admin.calls).toContain('preview migrate default')
		expect(screen.getByText('main · 261125120000')).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Run migrate' }))
		await waitFor(() => expect(admin.calls).toContain('run migrate default p-migrate'))
	})

	test('seed shows its files and runs that', async () => {
		const admin = new FakeAdmin()
		await openCommands(admin)
		fireEvent.click(await screen.findByRole('button', { name: 'seed…' }))
		expect(await screen.findByText('data/categories.json')).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Run seed' }))
		await waitFor(() => expect(admin.calls).toContain('run seed default p-seed'))
	})

	test('drop runs only once its stage is typed again', async () => {
		const admin = new FakeAdmin()
		await openCommands(admin)
		fireEvent.click(await screen.findByRole('button', { name: 'drop…' }))
		await screen.findByText(/DROP TABLE Categories/)
		const run = screen.getByRole('button', { name: 'Run drop' }) as HTMLButtonElement
		expect(run.disabled).toBe(true)
		fireEvent.change(screen.getByLabelText('confirm stage'), { target: { value: 'default' } })
		expect(run.disabled).toBe(false)
		fireEvent.click(run)
		await waitFor(() => expect(admin.calls).toContain('run drop default p-drop'))
	})
})

describe('commands that change the schema', () => {
	test('pull shows what changes in the lambdaORM.yaml and runs that', async () => {
		const admin = new FakeAdmin()
		show(admin)
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		fireEvent.doubleClick(row('northwind/v1'))
		fireEvent.click(await screen.findByRole('button', { name: 'pull…' }))
		await screen.findByText('What pull will change in lambdaORM.yaml (stage default)')
		expect(screen.getByText('+2 −0 lines; the rest of the file (and its comments) stays as it is')).toBeTruthy()
		const added = [...document.querySelectorAll('.lw-diff span')].find(s => s.textContent === '+  - name: Suppliers')!
		expect(added.className).toBe('lw-diff-add')
		expect(screen.queryByLabelText(/tryAllCan/)).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Run pull' }))
		await waitFor(() => expect(admin.calls).toContain('run pull default p-pull'))
	})

	test('introspect and incorporate wait for the data and its entity', async () => {
		show(new FakeAdmin())
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		fireEvent.doubleClick(row('northwind/v1'))
		// a command that needs a file opens its form; its preview waits for the file and the entity
		fireEvent.click(await screen.findByRole('button', { name: 'introspect…' }))
		const dialog = await screen.findByRole('dialog')
		const preview = within(dialog).getByRole('button', { name: 'See what it will do' }) as HTMLButtonElement
		expect(preview.disabled).toBe(true)
		fireEvent.change(within(dialog).getByLabelText('Entity of the data'), { target: { value: 'Brands' } })
		expect(preview.disabled).toBe(true)
		fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	test('the commands are a toolbar of icons: the name is read, the description shows on hover', async () => {
		show(new FakeAdmin())
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		fireEvent.doubleClick(row('northwind/v1'))
		const toolbar = await screen.findByRole('toolbar', { name: 'Commands' })
		const push = within(toolbar).getByRole('button', { name: 'push…' })
		expect(push.getAttribute('title')).toBe('push… — apply the model to the databases')
		expect(push.textContent).toBe('')
	})
})

describe('the schema as forms', () => {
	const FORMS_SCHEMA = 'domain:\n  entities:\n    - name: Products\n      primaryKey: [id]\n      properties:\n        - { name: id, type: integer }\n  enums:\n    - name: States\n      values: [{ name: on, value: 1 }]\ninfrastructure:\n  sources:\n    - { name: main, dialect: PostgreSQL }\n  stages:\n    - name: default\n      sources: [{ name: main }]\n'
	class FormsApi extends FakeApi {
		async domain () { return { entities: [{ name: 'Products', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }], relations: [] }], enums: [{ name: 'States', values: [] }] } as any }
	}
	const openForms = async (admin: FakeAdmin) => {
		admin.text = FORMS_SCHEMA
		render(<Workspace api={new FormsApi()} admin={admin} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		await waitFor(() => expect(row('domain')).toBeTruthy())
	}
	/** an entity of the tree, opened, and the Edit of its view: its form opens in edit (Cancel, Save) */
	const editEntity = async (name: string) => {
		fireEvent.click(row('domain'))
		fireEvent.click(await rowSoon('Entities'))
		fireEvent.click(await rowSoon(name))
		const view = await waitFor(() => { const v = document.querySelector('[role=tabpanel]:not([hidden]) .lw-entity-view'); expect(v).toBeTruthy(); return v as HTMLElement })
		fireEvent.click(await within(view).findByRole('button', { name: 'Edit' }))
		await screen.findByRole('button', { name: 'Save' })
	}

	test('a click on an entity opens it as before (properties, relations, keys, data, diagram); its Edit opens its form', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		fireEvent.click(row('domain'))
		fireEvent.click(await rowSoon('Entities'))
		fireEvent.click(await rowSoon('Products'))
		const tabs = await screen.findByRole('tablist', { name: 'Products' })
		expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual(['Properties (1)', 'Relations (0)', 'Keys and indexes', 'Constraints (0)', 'Data', 'Diagram'])
		fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
		// its form, in a tab of its own, already in edit: Cancel and Save
		const form = await waitFor(() => { const found = document.querySelector('[role=tabpanel]:not([hidden]) .lw-schema-forms'); expect(found).toBeTruthy(); return found as HTMLElement })
		expect(within(form).getByRole('button', { name: 'Cancel' })).toBeTruthy()
		expect(within(form).getByRole('button', { name: 'Save' })).toBeTruthy()
		expect(within(form).queryByRole('button', { name: 'Edit' })).toBeNull()
		// its parts in tabs
		expect(within(form).getAllByRole('tab').map(t => t.textContent)).toEqual(['Properties (1)', 'Relations (0)', 'Keys and indexes', 'Constraints (0)'])
		expect(screen.getAllByRole('tab').filter(t => t.textContent?.trim() === 'Products')).toHaveLength(2)
	})

	test('a property with expressions: ƒ Expression in its row, and under the table its expressions in colors', async () => {
		class ExpressionsApi extends FakeApi {
			async domain () { return { entities: [{ name: 'Products', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }, { name: 'code', readValue: 'decrypt(code,"k")', writeValue: 'encrypt(code,"k")' }], relations: [] }], enums: [] } as any }
		}
		const admin = new FakeAdmin()
		admin.text = FORMS_SCHEMA
		render(<Workspace api={new ExpressionsApi()} admin={admin} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		await waitFor(() => expect(row('domain')).toBeTruthy())
		fireEvent.click(row('domain'))
		fireEvent.click(await rowSoon('Entities'))
		fireEvent.click(await rowSoon('Products'))
		const toggles = await screen.findAllByRole('button', { name: 'ƒ Expression' })
		expect(toggles).toHaveLength(1)
		expect(toggles[0].getAttribute('title')).toBe('readValue, writeValue')
		fireEvent.click(toggles[0])
		const detail = screen.getByRole('region', { name: 'Expressions of code' })
		// each one: its name and what it does, and under it the expression
		const labels = [...detail.querySelectorAll('.lw-expression-label')].map(d => d.textContent)
		expect(labels.map(l => l?.split(':')[0])).toEqual(['readValue', 'writeValue'])
		expect(labels[0]).toMatch(/^readValue: Transforms each value after reading it/)
		expect(detail.querySelector('.lw-expression-item .lw-expression-view')).toBeTruthy()
		expect(detail.querySelector('.lw-expression-item .lw-tok-variable')?.textContent).toBe('code')
		fireEvent.click(toggles[0])
		expect(screen.queryByRole('region', { name: 'Expressions of code' })).toBeNull()
	})

	test('the validations: their own tab, and under a property those whose condition uses it', async () => {
		class ValidationsApi extends FakeApi {
			async domain () {
				return { entities: [{ name: 'Products', primaryKey: ['id'], relations: [],
					properties: [{ name: 'id', type: 'integer' }, { name: 'price', type: 'decimal' }, { name: 'cost', type: 'decimal' }],
					constraints: [{ message: 'price is not negative', condition: 'isNull(price) || price >= 0' }, { message: 'cost is not over price', condition: 'cost <= price' }] }], enums: [] } as any
			}
		}
		const admin = new FakeAdmin()
		admin.text = FORMS_SCHEMA
		render(<Workspace api={new ValidationsApi()} admin={admin} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		await waitFor(() => expect(row('domain')).toBeTruthy())
		fireEvent.click(row('domain'))
		fireEvent.click(await rowSoon('Entities'))
		fireEvent.click(await rowSoon('Products'))
		// a property with validations has its button, though it has no expressions; id has none
		const toggles = await screen.findAllByRole('button', { name: 'ƒ Expression' })
		expect(toggles.map(b => b.getAttribute('title'))).toEqual(['Constraints (2)', 'Constraints (1)'])
		fireEvent.click(toggles[1])
		const detail = screen.getByRole('region', { name: 'Expressions of cost' })
		expect([...detail.querySelectorAll('.lw-validations .lw-constraint-message')].map(d => d.textContent)).toEqual(['cost is not over price'])
		// the tab: each validation, its condition in colors and the properties it uses
		fireEvent.click(screen.getByRole('tab', { name: 'Constraints (2)' }))
		const table = screen.getByRole('table', { name: 'Constraints' })
		const rows = within(table).getAllByRole('row').slice(1)
		expect(rows.map(r => r.querySelectorAll('td')[1].textContent)).toEqual(['price is not negative', 'cost is not over price'])
		expect([...rows[1].querySelectorAll('.lw-uses')].map(c => c.textContent)).toEqual(['cost', 'price'])
		expect(rows[1].querySelector('.lw-tok-variable')?.textContent).toBe('cost')
	})

	test('a validation of the form: its message in the row, its condition in an editor under the table', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		await editEntity('Products')
		fireEvent.click(await screen.findByRole('tab', { name: 'Constraints (0)' }))
		const constraints = await screen.findByRole('table', { name: 'constraints' })
		fireEvent.click(within(constraints).getByRole('button', { name: 'Add' }))
		fireEvent.change(within(constraints).getByLabelText('0 message'), { target: { value: 'id is positive' } })
		fireEvent.click(within(constraints).getByRole('button', { name: '0 condition' }))
		const detail = await screen.findByRole('region', { name: 'id is positive' })
		fireEvent.change(within(detail).getByLabelText('id is positive condition', { selector: 'textarea' }), { target: { value: 'id > 0' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(admin.patches).toHaveLength(1))
		expect(admin.patches[0].value.constraints).toEqual([{ message: 'id is positive', condition: 'id > 0' }])
	})

	test('opened by Edit, its Cancel and its Save go back to the view of the entity', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		fireEvent.click(row('domain'))
		fireEvent.click(await rowSoon('Entities'))
		fireEvent.click(await rowSoon('Products'))
		const activeView = () => document.querySelector('[role=tabpanel]:not([hidden])') as HTMLElement
		const edit = async () => {
			fireEvent.click(await within(activeView()).findByRole('button', { name: 'Edit' }))
			await waitFor(() => expect(activeView().querySelector('.lw-schema-forms')).toBeTruthy())
		}
		await edit()
		fireEvent.click(within(activeView()).getByRole('button', { name: 'Cancel' }))
		// the form closed: the view of the entity, its tabs
		await waitFor(() => expect(within(activeView()).getByRole('tablist', { name: 'Products' })).toBeTruthy())
		expect(document.querySelectorAll('.lw-schema-forms')).toHaveLength(0)
		await edit()
		// the keys are with the indexes, as in the view of the entity
		fireEvent.click(within(activeView()).getByRole('tab', { name: 'Keys and indexes' }))
		fireEvent.change(within(activeView()).getByLabelText('primaryKey'), { target: { value: 'id, code' } })
		fireEvent.click(within(activeView()).getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(admin.patches).toHaveLength(1))
		await waitFor(() => expect(within(activeView()).getByRole('tablist', { name: 'Products' })).toBeTruthy())
		expect(document.querySelectorAll('.lw-schema-forms')).toHaveLength(0)
	})

	test('an entity is removed from its view: what uses it, the confirmation, and its tabs close', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		fireEvent.click(row('domain'))
		fireEvent.click(await rowSoon('Entities'))
		// its row has no actions: they are in its view
		expect(within(await rowSoon('Products')).queryAllByRole('button')).toHaveLength(0)
		fireEvent.click(row('Products'))
		const view = await waitFor(() => { const v = document.querySelector('[role=tabpanel]:not([hidden]) .lw-entity-view'); expect(v).toBeTruthy(); return v as HTMLElement })
		fireEvent.click(await within(view).findByRole('button', { name: 'Remove' }))
		// its form asks to confirm (and says what uses it)
		const confirm = await screen.findByRole('alert')
		fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
		await waitFor(() => expect(admin.patches).toHaveLength(1))
		expect(admin.patches[0]).toMatchObject({ op: 'remove', at: ['domain', 'entities', 'Products'] })
		// the form and the view of the entity closed
		await waitFor(() => expect(screen.queryAllByRole('tab').filter(t => t.textContent?.trim() === 'Products')).toHaveLength(0))
	})

	test('an entity: a property added and saved as one change, with the entity as it was read', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		await editEntity('Products')
		const properties = await screen.findByRole('table', { name: 'properties' })
		fireEvent.click(within(properties).getByRole('button', { name: 'Add' }))
		fireEvent.change(within(properties).getByLabelText('1 name'), { target: { value: 'price' } })
		fireEvent.change(within(properties).getByLabelText('price type'), { target: { value: 'decimal' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(admin.patches).toHaveLength(1))
		expect(admin.patches[0]).toEqual({
			op: 'set',
			at: ['domain', 'entities', 'Products'],
			value: { name: 'Products', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }, { name: 'price', type: 'decimal' }] },
			expected: { name: 'Products', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }] }
		})
	})

	test('a property: its expressions under the table, written in an editor and saved with it', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		await editEntity('Products')
		const properties = await screen.findByRole('table', { name: 'properties' })
		// no type: string, as λORM takes it
		expect((within(properties).getByLabelText('id type') as HTMLSelectElement).selectedOptions[0].textContent).toBe('integer')
		fireEvent.click(within(properties).getByRole('button', { name: 'id expressions' }))
		const detail = await screen.findByRole('region', { name: 'Expressions of id' })
		const writeValue = within(detail).getByLabelText('id writeValue', { selector: 'textarea' })
		fireEvent.change(writeValue, { target: { value: 'encrypt(id,"${KEY}")' } })
		expect(within(properties).getByRole('button', { name: 'id expressions' }).textContent).toContain('ƒ 1')
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(admin.patches).toHaveLength(1))
		expect(admin.patches[0].value.properties).toEqual([{ name: 'id', type: 'integer', writeValue: 'encrypt(id,"${KEY}")' }])
	})

	test('someone else changed the same element: the form shows what it has now', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		await editEntity('Products')
		fireEvent.click(await screen.findByRole('tab', { name: 'Keys and indexes' }))
		fireEvent.change(await screen.findByLabelText('primaryKey'), { target: { value: 'id, code' } })
		admin.conflictOnce = true
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await screen.findByText('Someone else changed it meanwhile: this is what it has now')
		fireEvent.click(screen.getByRole('tab', { name: /^Properties/ }))
		expect((screen.getByLabelText('price name') as HTMLInputElement).value).toBe('price')
	})

	test('a stage: its sources with their conditions in colors; a condition written in its own form, checked; the order kept', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		admin.text = FORMS_SCHEMA.replace('    - { name: main, dialect: PostgreSQL }\n', '    - { name: main, dialect: PostgreSQL }\n    - { name: replica, dialect: MySQL }\n')
		fireEvent.click(row('infrastructure'))
		fireEvent.click(await rowSoon('Stages'))
		fireEvent.click(await rowSoon('default'))
		// read: the source and its condition (none: the rest)
		expect((await screen.findByLabelText('source 1')).textContent).toBe('main')
		expect(screen.getByLabelText('Condition 1').textContent).toBe('no condition: the rest')
		// its edit button opens the form of the condition (and the stage goes to edit)
		fireEvent.click(screen.getByRole('button', { name: 'Edit the condition of main' }))
		const dialog = await screen.findByRole('dialog', { name: 'Condition of main' })
		expect(within(dialog).getByRole('complementary', { name: 'Variables of the sentence' }).textContent).toContain('entity')
		const editor = within(dialog).getByLabelText('Condition', { selector: 'textarea' })
		fireEvent.change(editor, { target: { value: 'entity.in(["Products"]) && foo' } })
		expect(await within(dialog).findByText('foo: not a variable of a sentence (entity, read)')).toBeTruthy()
		fireEvent.change(editor, { target: { value: 'entity.in(["Products"]) && ' } })
		// a variable of the panel goes into the expression
		fireEvent.click(within(dialog).getByRole('button', { name: 'read' }))
		expect((editor as HTMLTextAreaElement).value).toBe('entity.in(["Products"]) && read')
		await waitFor(() => expect(within(dialog).queryByText(/not a variable/)).toBeNull())
		fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
		// shown in colors: the variables, the function, the string
		const condition = screen.getByLabelText('Condition 1')
		expect(condition.textContent).toBe('entity.in(["Products"]) && read')
		expect([...condition.querySelectorAll('.lw-tok-variable')].map(e => e.textContent)).toEqual(['entity', 'read'])
		expect(condition.querySelector('.lw-tok-function')?.textContent).toBe('in')
		expect(condition.querySelector('.lw-tok-string')?.textContent).toBe('"Products"')
		fireEvent.click(screen.getByRole('button', { name: 'Add source' }))
		expect((screen.getByLabelText('source 2') as HTMLSelectElement).value).toBe('replica')
		expect((screen.getByRole('button', { name: 'Add source' }) as HTMLButtonElement).disabled).toBe(true)
		fireEvent.click(screen.getByRole('button', { name: 'Move up 2' }))
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(admin.patches).toHaveLength(1))
		expect(admin.patches[0]).toEqual({
			op: 'set',
			at: ['infrastructure', 'stages', 'default'],
			value: { name: 'default', sources: [{ name: 'replica' }, { name: 'main', condition: 'entity.in(["Products"]) && read' }] },
			expected: { name: 'default', sources: [{ name: 'main' }] }
		})
	})

	test('a new source, a rename, and a remove that first says who uses the element', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		fireEvent.click(row('infrastructure'))
		fireEvent.click(within(await rowSoon('Sources')).getByRole('button', { name: 'New in Sources' }))
		fireEvent.change(screen.getByLabelText('name'), { target: { value: 'replica' } })
		fireEvent.change(screen.getByLabelText('dialect'), { target: { value: 'MySQL' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(admin.patches[0]).toEqual({ op: 'add', at: ['infrastructure', 'sources'], value: { name: 'replica', dialect: 'MySQL' } }))
		fireEvent.click(row('domain'))
		fireEvent.click(await rowSoon('Enums'))
		fireEvent.click(await rowSoon('States'))
		fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
		fireEvent.change(screen.getByLabelText('Rename'), { target: { value: 'Status' } })
		fireEvent.click(screen.getAllByRole('button', { name: 'Rename' }).at(-1)!)
		await waitFor(() => expect(admin.patches.at(-1)).toMatchObject({ op: 'rename', at: ['domain', 'enums', 'States'], to: 'Status' }))
		fireEvent.click(row('States'))
		fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
		await screen.findByText('domain/entities/Products/properties/state')
		fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!)
		await waitFor(() => expect(admin.patches.at(-1)).toMatchObject({ op: 'remove', at: ['domain', 'enums', 'States'] }))
	})
})

describe('the diagram of a stage', () => {
	const SCHEMA = 'domain:\n  entities:\n    - name: Products\n      primaryKey: [id]\n      properties:\n        - { name: id, type: integer }\ninfrastructure:\n  sources:\n    - { name: main, dialect: PostgreSQL }\n  stages:\n    - name: default\n      sources: [{ name: main }]\n'
	const shown = (name: string) => screen.getAllByRole('button', { name }).find(b => !b.closest('[hidden]'))!

	test('opened from its stage, turned and saved with a name in a project; its stage opens the one saved, as it was left', async () => {
		const admin = new FakeAdmin()
		admin.text = SCHEMA
		render(<Workspace api={new FakeApi()} admin={admin} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		await waitFor(() => expect(row('infrastructure')).toBeTruthy())
		fireEvent.click(row('infrastructure'))
		fireEvent.click(await rowSoon('Stages'))
		fireEvent.click(within(await rowSoon('default')).getByRole('button', { name: 'Diagram of the stage: default' }))
		expect(await screen.findByRole('img', { name: 'Stage default' })).toBeTruthy()
		// not saved yet, and not changed: no mark
		expect(screen.getByRole('tab', { name: /Stage default/ }).textContent).not.toContain('•')
		fireEvent.click(shown('the gateway on the left, the sources on the right'))
		await waitFor(() => expect(screen.getByRole('tab', { name: /Stage default/ }).textContent).toContain('•'))
		fireEvent.click(shown('Save'))
		const dialog = await screen.findByRole('dialog', { name: 'Diagram of the stage' })
		expect((within(dialog).getByRole('textbox', { name: 'name' }) as HTMLInputElement).value).toBe('Stage default')
		fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
		await waitFor(() => expect(screen.getByRole('tab', { name: /Stage default/ }).textContent).not.toContain('•'))
		expect(screen.getAllByText('saved').length).toBeGreaterThan(0)
		// closed, and opened again from its stage: the one saved, turned as it was left
		fireEvent.click(screen.getByRole('button', { name: 'close Stage default' }))
		await waitFor(() => expect(screen.queryByRole('img', { name: 'Stage default' })).toBeNull())
		fireEvent.click(within(row('default')!).getByRole('button', { name: 'Diagram of the stage: default' }))
		await screen.findByRole('img', { name: 'Stage default' })
		expect(shown('the gateway on the left, the sources on the right').getAttribute('aria-pressed')).toBe('true')
	})
})

describe('the variables of the connections and the code of the domain', () => {
	test('a variable is set without ever being shown', async () => {
		const admin = new FakeAdmin()
		admin.text = 'domain: {}\ninfrastructure:\n  sources:\n    - { name: main, connection: ${SHOP_CNX} }\n'
		show(admin)
		await waitFor(() => expect(row('infrastructure')).toBeTruthy())
		fireEvent.click(row('infrastructure'))
		fireEvent.click(await rowSoon('Variables (.env)'))
		await screen.findByText('not in .env')
		// each column says what it is
		expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['variable', 'state', 'used in', 'value', ''])
		fireEvent.change(screen.getByLabelText('SHOP_CNX New value (not shown again)'), { target: { value: '{"host":"db"}' } })
		fireEvent.click(screen.getByRole('button', { name: 'Set' }))
		await screen.findByText('defined')
		expect(admin.env).toEqual({ SHOP_CNX: '{"host":"db"}' })
		expect((screen.getByLabelText('SHOP_CNX New value (not shown again)') as HTMLInputElement).value).toBe('')
		expect(screen.queryByText('{"host":"db"}')).toBeNull()
	})

	test('build writes the code in src/ and says what stayed', async () => {
		const admin = new FakeAdmin({ ...ALL, build: true })
		show(admin)
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		fireEvent.doubleClick(row('northwind/v1'))
		fireEvent.click(await screen.findByRole('button', { name: 'build…' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Write in src/ of the workspace' }))
		await screen.findByText('src/domain/model.ts')
		expect(screen.getByText(/created and updated: 1/)).toBeTruthy()
	})
})

describe('the explorer as the workspace is', () => {
	test('the state (its data) and the source code (a folder for each language, its zip) by the metadata; a file opens read only; application as YAML; the schema opens its commands', async () => {
		const admin = new FakeAdmin({ ...ALL, build: true })
		admin.text = 'domain: {}\napplication:\n  start: []\n'
		globalThis.URL.createObjectURL ??= (() => 'blob:zip') as any
		globalThis.URL.revokeObjectURL ??= (() => undefined) as any
		render(<Workspace api={new FakeApi()} admin={admin} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		await waitFor(() => expect(row('State')).toBeTruthy())
		const level = (n: number) => screen.getAllByRole('treeitem').filter(r => r.getAttribute('aria-level') === String(n)).map(r => r.querySelector('.lw-tree-label')?.textContent)
		// under the node Schemas, the schema: its metadata, its state, its source code and its projects
		expect(level(3)).toEqual(['Metadata', 'State', 'Source code', 'Workbench'])
		if (!row('config')) fireEvent.click(row('Metadata'))
		await waitFor(() => expect(level(4)).toEqual(['config', 'domain', 'application', 'infrastructure']))
		fireEvent.click(row('State'))
		fireEvent.click(await rowSoon('data'))
		fireEvent.click(await rowSoon('seed.sql'))
		const file = await screen.findByLabelText('data/seed.sql', { selector: 'textarea' }) as HTMLTextAreaElement
		expect(file.value).toBe('INSERT INTO x VALUES (1);')
		expect(file.readOnly).toBe(true)
		// the source code: a node for each code, named by its language (and its build: node, client-node); its files; its zip
		fireEvent.click(row('Source code'))
		await rowSoon('TypeScript · node')
		expect(row('Kotlin')).toBeTruthy()
		// code written before each language had its folder: by its language
		expect(row('TypeScript')).toBeTruthy()
		fireEvent.click(row('TypeScript · node'))
		expect(await rowSoon('domain/model.ts')).toBeTruthy()
		fireEvent.click(within(row('Kotlin')!).getByRole('button', { name: 'Download Kotlin as .zip' }))
		await waitFor(() => expect(admin.calls).toContain('zip northwind/v1 src/kotlin'))
		// built again (a build of the gateway: node), or deleted after asking; the code written before has no build again
		expect(within(row('TypeScript')!).queryByRole('button', { name: 'Build TypeScript again' })).toBeNull()
		fireEvent.click(within(row('TypeScript · node')!).getByRole('button', { name: 'Build TypeScript · node again' }))
		// its dialog, on its language: only the model (-m)
		const again = await screen.findByRole('dialog', { name: 'Code (build)' })
		expect((within(again).getByLabelText('language') as HTMLSelectElement).value).toBe('node')
		fireEvent.click(within(again).getByRole('checkbox', { name: /repositories/ }))
		// at least one: the model can't be left out now
		expect((within(again).getByRole('checkbox', { name: /model/ }) as HTMLInputElement).disabled).toBe(true)
		fireEvent.click(within(again).getByRole('button', { name: 'Write in src/ of the workspace' }))
		await waitFor(() => expect(admin.calls).toContain('build node -m'))
		expect(await screen.findByText('TypeScript · node built again: 1 files written (the repositories already there stay)')).toBeTruthy()
		fireEvent.click(within(row('Kotlin')!).getByRole('button', { name: 'Delete Kotlin' }))
		const confirm = await screen.findByRole('dialog', { name: 'Delete Kotlin' })
		expect(confirm.textContent).toContain('the repositories written by hand too')
		fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
		await waitFor(() => expect(admin.calls).toContain('remove code northwind/v1 src/kotlin'))
		// its build, from the source code too
		fireEvent.click(within(row('Source code')!).getByRole('button', { name: 'Code (build): northwind/v1' }))
		expect(await screen.findByRole('dialog', { name: 'Code (build)' })).toBeTruthy()
		fireEvent.click(within(screen.getByRole('dialog', { name: 'Code (build)' })).getByRole('button', { name: 'Cancel' }))
		fireEvent.click(row('application'))
		const app = await screen.findByLabelText('application', { selector: 'textarea' }) as HTMLTextAreaElement
		expect(app.value).toContain('start: []')
		expect(app.readOnly).toBe(true)
		// selecting the schema (folded) opens its tab, with the commands
		fireEvent.click(row('northwind/v1'))
		fireEvent.click(row('northwind/v1'))
		expect(await screen.findByRole('button', { name: 'fetch' })).toBeTruthy()
		expect(screen.getAllByText('Schema northwind/v1').length).toBe(2) // its tab and its heading
	})
})

describe('what the schema is, and the tabs', () => {
	test('name, description and version: read first, then each change saved as one set, an emptied one removed', async () => {
		const admin = new FakeAdmin()
		admin.text = 'name: Shop\nversion: 1.0.0\ndomain: {}\n'
		show(admin)
		// what the schema is: in its tab, under the toolbar of its commands
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		fireEvent.doubleClick(row('northwind/v1'))
		await screen.findByRole('toolbar', { name: 'Commands' })
		const name = await screen.findByLabelText('Name') as HTMLInputElement
		await waitFor(() => expect(name.value).toBe('Shop'))
		expect(name.readOnly).toBe(true)
		fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } })
		fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'The shop' } })
		fireEvent.change(screen.getByLabelText('Version'), { target: { value: '1.1.0' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(admin.patches).toHaveLength(3))
		expect(admin.patches).toEqual([
			{ op: 'remove', at: ['name'], expected: 'Shop' },
			{ op: 'set', at: ['description'], value: 'The shop', expected: undefined },
			{ op: 'set', at: ['version'], value: '1.1.0', expected: '1.0.0' }
		])
	})

	test('a tab closes, the others close, all close', async () => {
		show(new FakeAdmin())
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		fireEvent.doubleClick(row('northwind/v1'))
		await screen.findByRole('toolbar', { name: 'Commands' })
		fireEvent.click(screen.getByRole('button', { name: 'new tab' }))
		const tabs = () => screen.getAllByRole('tab').map(t => t.textContent)
		expect(tabs()).toHaveLength(3)
		// the menu of the second tab: close the others
		fireEvent.contextMenu(screen.getAllByRole('tab')[1].parentElement!)
		fireEvent.click(screen.getByRole('menuitem', { name: 'Close others' }))
		expect(tabs()).toHaveLength(1)
		expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true')
		fireEvent.click(screen.getByRole('button', { name: 'new tab' }))
		fireEvent.click(screen.getByRole('button', { name: 'tab actions' }))
		fireEvent.click(screen.getByRole('menuitem', { name: 'Close all' }))
		expect(screen.queryAllByRole('tab')).toHaveLength(0)
	})
})

describe('where the workspace was', () => {
	class MemorySession {
		public saved: any[] = []
		constructor (private readonly kept: unknown) {}
		async load () { return this.kept }
		async save (session: unknown) { this.saved.push(session) }
	}

	test('a reload starts where it was: its tabs (the text of a query as it was typed), the active one, what was unfolded', async () => {
		const session = new MemorySession({
			version: 1,
			tabs: [{ kind: 'query', title: 'Prices', schema: 'northwind/v1', initial: { mode: 'query', query: 'Products.map(p => p.price)', data: '{}', options: '{}' } }, { kind: 'schema', title: 'Schema northwind/v1', schema: 'northwind/v1' }],
			active: 1,
			expanded: ['s:northwind/v1', 'md:northwind/v1'],
			collapsed: false
		})
		render(<Workspace api={new FakeApi()} admin={new FakeAdmin()} session={session} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		await waitFor(() => expect(screen.getAllByRole('tab').map(t => t.textContent?.trim())).toEqual(['Prices', 'Schema northwind/v1']))
		expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true')
		await screen.findByRole('toolbar', { name: 'Commands' })
		// the metadata of the schema, unfolded as it was
		expect(findRow('config')).toBeTruthy()
		fireEvent.click(screen.getAllByRole('tab')[0])
		expect((screen.getAllByLabelText('query', { selector: 'textarea' })[0] as HTMLTextAreaElement).value).toBe('Products.map(p => p.price)')
		// and it is kept as it changes
		await waitFor(() => expect(session.saved.at(-1)?.active).toBe(0), { timeout: 2000 })
		expect(session.saved.at(-1)).toMatchObject({ version: 1, expanded: expect.arrayContaining(['md:northwind/v1']), tabs: [{ kind: 'query', initial: { query: 'Products.map(p => p.price)' } }, { kind: 'schema' }] })
	})

	test('the schema opens by a click: its tab, with its commands; its row has only its Refresh', async () => {
		show(new FakeAdmin())
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		expect(within(row('northwind/v1')).queryAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['Refresh northwind/v1: read again what changed elsewhere'])
		fireEvent.doubleClick(row('northwind/v1'))
		expect(await screen.findByRole('toolbar', { name: 'Commands' })).toBeTruthy()
	})
})


describe('the pages of the application', () => {
	test('a page opens in a tab, asked again shows the same one; a restored page tab stays only if the application has it', async () => {
		const pages = { account: { title: 'Account', render: () => <p>the account of modeler</p> } }
		const session = { saved: [] as any[], load: async () => ({ version: 1, tabs: [{ kind: 'page', title: 'Old', page: 'gone' }, { kind: 'query', title: 'Q' }], active: 0, expanded: [], collapsed: false }), save: async (s: any) => { session.saved.push(s) } }
		const { rerender } = render(<Workspace api={new FakeApi()} admin={new FakeAdmin()} session={session} pages={pages} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		await waitFor(() => expect(screen.getAllByRole('tab').map(t => t.textContent?.trim())).toEqual(['Q']))
		rerender(<Workspace api={new FakeApi()} admin={new FakeAdmin()} session={session} pages={pages} openPage={{ key: 'account', at: 1 }} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		expect(await screen.findByText('the account of modeler')).toBeTruthy()
		expect(screen.getAllByRole('tab').map(t => t.textContent?.trim())).toEqual(['Q', 'Account'])
		fireEvent.click(screen.getAllByRole('tab')[0])
		rerender(<Workspace api={new FakeApi()} admin={new FakeAdmin()} session={session} pages={pages} openPage={{ key: 'account', at: 2 }} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		await waitFor(() => expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true'))
		expect(screen.getAllByRole('tab')).toHaveLength(2)
	})
})

describe('several data-gateways', () => {
	test('Refresh: the connection, a schema or all of them read again what changed elsewhere (another IDE, another user)', async () => {
		let reads = 0
		class CountingApi extends FakeApi { async domain (schema: string) { reads++; return super.domain(schema) } }
		const a = { id: 'a', name: 'local', api: new CountingApi(), admin: false as const, store: new MemoryWorkspaceStore([], true) }
		render(<Workspace locale="en" refreshMs={0} history={false} connections={[a]} connectionsHeading={{ title: 'Connections' }} />)
		await waitFor(() => expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0))
		fireEvent.click(row('Metadata'))
		fireEvent.click(await rowSoon('domain'))
		fireEvent.click(await rowSoon('Entities'))
		await waitFor(() => expect(reads).toBeGreaterThan(0))
		let before = reads
		const readAgain = async () => { await waitFor(() => expect(reads).toBeGreaterThan(before)); before = reads }
		// the connection
		fireEvent.click(screen.getByRole('button', { name: 'Refresh local: read again what changed elsewhere' }))
		await readAgain()
		// a schema, on its row
		fireEvent.click(screen.getAllByRole('button').find(b => b.getAttribute('aria-label')?.startsWith('Refresh ') && !b.getAttribute('aria-label')?.includes('local') && !b.getAttribute('aria-label')?.includes('Connections'))!)
		await readAgain()
		// all the connections
		fireEvent.click(screen.getByRole('button', { name: 'Refresh Connections: read again what changed elsewhere' }))
		await readAgain()
	})

	test('its key entered after it opened: what the credential may do and its domains are read again', async () => {
		// without its key the gateway refuses; with it (the same admin, the same fetch) it answers
		const key = { entered: false }
		class KeyedAdmin extends FakeAdmin { async capabilities () { if (!key.entered) throw new Error('401'); return super.capabilities() } }
		class KeyedApi extends FakeApi { async domain () { if (!key.entered) throw new Error('Its key'); return { entities: [{ name: 'Products', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }], relations: [] }], enums: [] } as any } }
		const admin = new KeyedAdmin()
		const api = new KeyedApi()
		const of = (problem?: string) => ({ id: 'a', name: 'local', api, admin, store: new MemoryWorkspaceStore([], true), ...(problem ? { problem } : {}) })
		const { rerender } = render(<Workspace locale="en" refreshMs={0} history={false} connections={[of('Its key: open the connection to enter it')]} />)
		fireEvent.click(await rowSoon('Metadata'))
		fireEvent.click(await rowSoon('domain'))
		fireEvent.click(await rowSoon('Entities'))
		await rowSoon('Its key')
		expect(row('config')).toBeFalsy()
		key.entered = true
		rerender(<Workspace locale="en" refreshMs={0} history={false} connections={[of()]} />)
		await rowSoon('config')
		await rowSoon('Products')
		expect(row('Its key')).toBeFalsy()
	})

	test('a connection opens its page by a click on its name (its edit and remove are there)', async () => {
		let opened = 0
		const a = { id: 'a', name: 'local', description: 'http://localhost:8097/data-gateway', api: new FakeApi(), admin: false as const, store: new MemoryWorkspaceStore([], true), onOpen: () => { opened++ } }
		const b = { id: 'b', name: 'staging', api: new FakeApi(), admin: false as const, store: new MemoryWorkspaceStore([], true) }
		render(<Workspace locale="en" refreshMs={0} history={false} connections={[a, b]} />)
		fireEvent.click(await screen.findByRole('button', { name: 'local' }))
		expect(opened).toBe(1)
		// without onOpen, its name is not a button
		expect(screen.queryByRole('button', { name: 'staging' })).toBeNull()
	})

	test('each connection with its heading and its schemas; a tab of the second runs on its gateway and says which', async () => {
		class SalesApi extends FakeApi { async schemas () { return [{ path: 'sales', status: 'ready' }] as any } }
		const first = new FakeApi()
		const second = new SalesApi()
		const session = { saved: [] as any[], load: async () => ({ version: 1, tabs: [{ kind: 'query', title: 'Orders', schema: 'sales', connection: 'b', initial: { mode: 'query', query: 'Orders.page(1, 2)', data: '{}', options: '{}' } }], active: 0, expanded: ['b␟s:sales'], collapsed: false }), save: async (s: any) => { session.saved.push(s) } }
		const a = { id: 'a', name: 'local', description: 'http://localhost:8097/data-gateway', api: first, admin: false as const, store: new MemoryWorkspaceStore([], true) }
		const b = { id: 'b', name: 'staging', description: 'https://staging/data-gateway', api: second, admin: false as const, store: new MemoryWorkspaceStore([], true) }
		const { rerender } = render(<Workspace locale="en" refreshMs={0} history={false} session={session} connections={[a, b]} />)
		// a heading per connection, its schemas under it
		const local = await screen.findByRole('region', { name: 'local' })
		const staging = screen.getByRole('region', { name: 'staging' })
		expect(within(local).getByText('http://localhost:8097/data-gateway')).toBeTruthy()
		await waitFor(() => expect(within(local).getAllByRole('treeitem').map(r => r.querySelector('.lw-tree-label')?.textContent)).toContain('northwind/v1'))
		await waitFor(() => expect(within(staging).getAllByRole('treeitem').map(r => r.querySelector('.lw-tree-label')?.textContent)).toContain('sales'))
		// the restored tab is of staging: it says so, and runs there
		await waitFor(() => expect(screen.getAllByRole('tab').map(t => t.textContent?.trim().replace(' •', ''))).toEqual(['Orders · staging']))
		fireEvent.click(await screen.findByRole('button', { name: 'execute' }))
		await waitFor(() => expect(second.calls.some(c => c.operation === 'execute' && c.args[0] === 'sales')).toBe(true))
		expect(first.calls.some(c => c.operation === 'execute')).toBe(false)
		// a connection folds
		fireEvent.click(within(staging).getByRole('button', { name: /staging$/ }))
		expect(within(staging).queryAllByRole('treeitem')).toHaveLength(0)
		// a connection removed: its section and its tabs go
		rerender(<Workspace locale="en" refreshMs={0} history={false} session={session} connections={[a]} />)
		await waitFor(() => expect(screen.queryAllByRole('tab')).toHaveLength(0))
		expect(screen.queryByRole('region', { name: 'staging' })).toBeNull()
	})
})

describe('what an entity inherits from the abstract one it extends', () => {
	// Customers extends Audited: createdAt comes from it, createdBy is redefined (required); the completed domain no
	// longer says extends, the lambdaORM.yaml does
	const SCHEMA = 'domain:\n  entities:\n    - name: Audited\n      abstract: true\n      properties:\n        - { name: createdAt, type: dateTime }\n        - { name: createdBy, length: 128 }\n    - name: Customers\n      extends: Audited\n      primaryKey: [id]\n      properties:\n        - { name: id, type: integer }\n        - { name: createdBy, required: true }\n'
	class InheritedApi extends FakeApi {
		async domain () {
			return { entities: [{ name: 'Customers', primaryKey: ['id'], relations: [],
				properties: [{ name: 'id', type: 'integer' }, { name: 'createdBy', length: 128, required: true }, { name: 'createdAt', type: 'dateTime' }] }], enums: [] } as any
		}
	}
	const openCustomers = async () => {
		const admin = new FakeAdmin()
		admin.text = SCHEMA
		render(<Workspace api={new InheritedApi()} admin={admin} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		await waitFor(() => expect(row('domain')).toBeTruthy())
		fireEvent.click(row('domain'))
		fireEvent.click(await rowSoon('Entities'))
		fireEvent.click(await rowSoon('Customers'))
		return waitFor(() => { const v = document.querySelector('[role=tabpanel]:not([hidden]) .lw-entity-view'); expect(v).toBeTruthy(); return v as HTMLElement })
	}

	test('its view: extends Audited, and where each property comes from', async () => {
		const view = await openCustomers()
		await within(view).findByText('extends Audited')
		const table = view.querySelector('.lw-form-table') as HTMLElement
		expect([...table.querySelectorAll('th')].map(th => th.textContent).at(-1)).toBe('Inherited')
		const origin = (name: string) => [...table.querySelectorAll('tbody tr')].find(tr => tr.children[1]?.textContent === name)?.lastElementChild?.textContent
		expect(origin('id')).toBe('')
		expect(origin('createdBy')).toBe('redefines Audited')
		expect(origin('createdAt')).toBe('Audited')
	})

	test('its form: the inherited ones read only, apart; the own ones editable, the redefined one says so', async () => {
		const view = await openCustomers()
		fireEvent.click(await within(view).findByRole('button', { name: 'Edit' }))
		const form = await waitFor(() => { const f = document.querySelector('[role=tabpanel]:not([hidden]) .lw-schema-forms'); expect(f).toBeTruthy(); return f as HTMLElement })
		await within(form).findByRole('button', { name: 'Save' })
		expect(within(form).getAllByRole('tab').map(t => t.textContent)[0]).toBe('Properties (2 + 1)')
		const inherited = within(form).getByRole('group', { name: 'properties Inherited from Audited' })
		expect(inherited.textContent).toContain('Read only here: it is changed in Audited.')
		const name = within(inherited).getByRole('textbox', { name: 'createdAt name' }) as HTMLInputElement
		expect(name.readOnly).toBe(true)
		expect(within(inherited).queryByRole('button', { name: /^remove/ })).toBeNull()
		expect(within(inherited).queryByRole('button', { name: 'Add' })).toBeNull()
		// the own ones: editable, the redefined one with its note
		const own = within(form).getByRole('table', { name: 'properties' })
		expect((within(own).getByRole('textbox', { name: 'id name' }) as HTMLInputElement).readOnly).toBe(false)
		expect(within(own).getByText('redefines Audited')).toBeTruthy()
		expect(within(own).queryByRole('textbox', { name: 'createdAt name' })).toBeNull()
	})

	// the abstract isn't in the completed domain: its view is made from the lambdaORM.yaml, as an entity's
	const viewOf = (name: string) => waitFor(() => {
		const v = document.querySelector('[role=tabpanel]:not([hidden]) .lw-entity-view')
		expect(v?.querySelector('.lw-entity-title')?.textContent).toBe(name)
		return v as HTMLElement
	})
	const formOf = (name: string) => waitFor(() => {
		const f = document.querySelector('[role=tabpanel]:not([hidden]) .lw-schema-forms')
		expect(f?.textContent).toContain(`Entities / ${name}`)
		return f as HTMLElement
	})

	test('its view opens the view of the abstract it extends: the same, without data nor diagram; Edit as an entity', async () => {
		const view = await openCustomers()
		fireEvent.click(await within(view).findByRole('button', { name: 'extends Audited' }))
		const abstract = await viewOf('Audited')
		expect(within(abstract).getByText('abstract')).toBeTruthy()
		expect(within(abstract).getAllByRole('tab').map(t => t.textContent)).toEqual(['Properties (2)', 'Relations (0)', 'Keys and indexes', 'Constraints (0)', 'Extended by (1)'])
		expect(within(abstract).queryByRole('button', { name: 'Query' })).toBeNull()
		const table = abstract.querySelector('.lw-form-table') as HTMLElement
		expect([...table.querySelectorAll('tbody tr')].map(tr => [tr.children[1]?.textContent, tr.children[2]?.textContent])).toEqual([['createdAt', 'dateTime'], ['createdBy', 'string']])
		fireEvent.click(within(abstract).getByRole('button', { name: 'Edit' }))
		const form = await formOf('Audited')
		await within(form).findByRole('button', { name: 'Save' })
		expect((within(form).getByRole('checkbox', { name: 'abstract' }) as HTMLInputElement).checked).toBe(true)
	})

	test('its form opens the form of the abstract in a tab of its own, keeping what is being edited', async () => {
		const view = await openCustomers()
		fireEvent.click(await within(view).findByRole('button', { name: 'Edit' }))
		const form = await formOf('Customers')
		fireEvent.click(within(within(form).getByRole('group', { name: 'properties Inherited from Audited' })).getByRole('button', { name: 'Open Audited' }))
		await formOf('Audited')
		expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Customers'), expect.stringContaining('Audited')]))
	})

	const openDomain = async () => {
		const admin = new FakeAdmin()
		admin.text = SCHEMA
		render(<Workspace api={new InheritedApi()} admin={admin} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)
		await waitFor(() => expect(row('domain')).toBeTruthy())
		fireEvent.click(row('domain'))
		return admin
	}

	test('the domain lists its abstracts apart, from the lambdaORM.yaml, by name', async () => {
		const admin = await openDomain()
		admin.text = 'domain:\n  entities:\n    - { name: Located, abstract: true, extends: Audited }\n    - { name: Customers, extends: Catalog }\n    - { name: Audited, abstract: true }\n    - { name: Catalog, abstract: true, extends: Audited }\n'
		fireEvent.click(await rowSoon('Abstracts'))
		await rowSoon('Located')
		const names = screen.getAllByRole('treeitem').map(r => r.querySelector('.lw-tree-label')?.textContent)
		// in the domain the abstract ones go first: the entities extend them
		const sections = names.filter(n => ['Abstracts', 'Entities', 'Enums'].includes(n ?? ''))
		expect(sections).toEqual(['Abstracts', 'Entities', 'Enums'])
		const at = names.indexOf('Abstracts')
		expect(names.slice(at + 1, at + 4)).toEqual(['Audited', 'Catalog', 'Located'])
	})

	test('the domain lists its abstracts apart, as its entities: each opens its view, unfolded its properties', async () => {
		await openDomain()
		fireEvent.click(await rowSoon('Entities'))
		await rowSoon('Customers')
		expect(row('Audited')).toBeFalsy()
		fireEvent.click(await rowSoon('Abstracts'))
		fireEvent.click(await rowSoon('Audited'))
		await viewOf('Audited')
		fireEvent.click(await rowSoon('Properties (2)'))
		// each with its type, as an entity's
		await waitFor(() => expect(screen.getAllByRole('treeitem').map(r => r.querySelector('.lw-tree-label')?.textContent)).toEqual(expect.arrayContaining(['createdAtdateTime', 'createdBystring(128)'])))
	})

	test('an abstract one lists the entities that extend it, also through another abstract one; each opens its view', async () => {
		const admin = await openDomain()
		admin.text = 'domain:\n  entities:\n    - { name: Audited, abstract: true, properties: [{ name: createdAt, type: dateTime }] }\n    - { name: Located, abstract: true, extends: Audited, properties: [{ name: locationId }] }\n    - { name: Zones, extends: Located, properties: [{ name: code }] }\n    - { name: Customers, extends: Audited, properties: [{ name: id }] }\n    - { name: Areas, extends: Located, properties: [{ name: code }] }\n    - { name: Notes, properties: [{ name: id }] }\n'
		fireEvent.click(await rowSoon('Abstracts'))
		fireEvent.click(await rowSoon('Audited'))
		const view = await viewOf('Audited')
		fireEvent.click(within(view).getByRole('tab', { name: 'Extended by (4)' }))
		const table = within(view).getByRole('table', { name: 'Extended by' })
		expect([...table.querySelectorAll('tbody tr')].map(tr => [tr.children[1].textContent, tr.children[2].textContent])).toEqual([
			['Areas', 'Located'], ['Customers', 'Audited'], ['Located abstract', 'Audited'], ['Zones', 'Located']
		])
		fireEvent.click(within(table).getAllByRole('button', { name: 'Located' })[0])
		await viewOf('Located')
	})

	test('a new abstract starts abstract', async () => {
		const admin = await openDomain()
		fireEvent.click(within(await rowSoon('Abstracts')).getByRole('button', { name: 'New in Abstracts' }))
		const form = await waitFor(() => { const f = document.querySelector('[role=tabpanel]:not([hidden]) .lw-schema-forms'); expect(f).toBeTruthy(); return f as HTMLElement })
		expect((within(form).getByRole('checkbox', { name: 'abstract' }) as HTMLInputElement).checked).toBe(true)
		fireEvent.change(within(form).getByLabelText('name'), { target: { value: 'Located' } })
		fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(admin.patches[0]).toMatchObject({ op: 'add', at: ['domain', 'entities'], value: { name: 'Located', abstract: true } }))
	})
})
