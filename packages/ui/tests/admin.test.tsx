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

	async references (_schema: string, at: string[]) { return { references: at.includes('States') ? ['domain/entities/Products/properties/state'] : [] } }

	async validate (text: string): Promise<{ valid: boolean, issues: SchemaIssue[] }> {
		return text.includes('nope') ? { valid: false, issues: [{ severity: 'error', message: 'bad indentation', line: 2, column: 3 }] } : { valid: true, issues: [] }
	}
	async createWorkspace (path: string, copyOf?: string) { this.calls.push(`create ${path} ${copyOf ?? ''}`.trim()); if (path === 'admin') throw status(400, 'segment "admin" is reserved'); return { path, version: 'v1' } }
	async removeWorkspace (path: string) { this.calls.push(`remove ${path}`); return { trash: `.trash/${path}` } }
	async workbench (_version?: string): Promise<{ version: string, items: any[] } | undefined> { return { version: '0', items: [] } }
	async putItems (_items: any[]): Promise<{ items: { id: string, version: string }[] }> { return { items: [] } }
	async removeItems (_ids: string[]): Promise<{ removed: string[] }> { return { removed: [] } }
	public jobList: any[] = []
	async commands () { return { stages: ['default', 'test'], can: { version: true, fetch: true, export: true, push: true, drop: true, import: true, pull: true, introspect: true, incorporate: true } } }
	async previewCommand (_schema: string, command: any, body: any): Promise<any> {
		this.calls.push(`preview ${command} ${body.stage}`)
		if (command === 'pull') return { previewId: 'p-pull', command, stage: 'default', expiresAt: 'later', diff: { added: 2, removed: 0, hunks: [{ oldStart: 3, newStart: 3, lines: [{ op: ' ', text: '  entities:' }, { op: '+', text: '  - name: Suppliers' }, { op: '+', text: '    primaryKey: [id]' }] }] } }
		return { previewId: `p-${command}`, command, stage: body.stage ?? 'default', expiresAt: 'later', sentences: command === 'push' ? [{ source: 'main', sentences: ['CREATE TABLE Categories (id INTEGER)'] }] : ['DROP TABLE Categories'] }
	}

	async runCommand (_schema: string, command: any, body: any): Promise<any> {
		this.calls.push(`run ${command} ${body.stage} ${body.previewId ?? ''} ${body.force ? 'force' : ''}`.trim())
		const job = { id: `j${this.jobList.length + 1}`, schema: 'northwind/v1', command, stage: body.stage, status: 'done', credential: 'admin', startedAt: new Date().toISOString(), result: command === 'fetch' ? [{ name: 'default', entities: [] }] : [] }
		this.jobList.unshift(job)
		return job
	}

	async jobs () { return this.jobList.map(({ result, ...j }) => j) }
	async job (_schema: string, id: string) { return this.jobList.find(j => j.id === id) }
}

const row = (name: string) => screen.getAllByRole('treeitem').find(r => r.querySelector('.lw-tree-label')?.textContent === name)!
const show = (admin: FakeAdmin) => render(<Workspace api={new FakeApi()} admin={admin} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" refreshMs={0} />)

describe('the schema as YAML, editable', () => {
	test('opened from the explorer, saved with the version it read; while typed, the issues show', async () => {
		const admin = new FakeAdmin()
		show(admin)
		await waitFor(() => expect(row('Schema (lambdaORM.yaml)')).toBeTruthy())
		fireEvent.click(row('Schema (lambdaORM.yaml)'))
		const editor = await screen.findByLabelText('Schema (lambdaORM.yaml)', { selector: 'textarea' }) as HTMLTextAreaElement
		expect(editor.value).toBe(admin.text)
		fireEvent.change(editor, { target: { value: 'domain:\n  nope: 1\n' } })
		await waitFor(() => expect(screen.getByText('2: bad indentation')).toBeTruthy(), { timeout: 2000 })
		expect(screen.getByText('1 errors')).toBeTruthy()
		fireEvent.change(editor, { target: { value: 'domain:\n  entities: [ { name: A } ]\n' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(admin.calls).toContain('write northwind/v1 v1'))
		await screen.findByText('Saved: the gateway reloads the schema')
		expect(admin.text).toBe('domain:\n  entities: [ { name: A } ]\n')
	})

	test('someone else saved meanwhile: both side by side, and either is taken', async () => {
		const admin = new FakeAdmin()
		show(admin)
		await waitFor(() => expect(row('Schema (lambdaORM.yaml)')).toBeTruthy())
		fireEvent.click(row('Schema (lambdaORM.yaml)'))
		const editor = await screen.findByLabelText('Schema (lambdaORM.yaml)', { selector: 'textarea' }) as HTMLTextAreaElement
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
		await waitFor(() => expect(row('Schema (lambdaORM.yaml)')).toBeTruthy())
		expect(screen.queryByRole('button', { name: 'New schema' })).toBeNull()
		fireEvent.click(row('Schema (lambdaORM.yaml)'))
		await screen.findByText('Read only: this credential can’t change the schema')
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
		cleanup()
		const none = new FakeAdmin()
		none.can = undefined
		show(none)
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		expect(screen.queryByText('Schema (lambdaORM.yaml)')).toBeNull()
	})

	test('a schema that did not start can be opened to fix it', async () => {
		show(new FakeAdmin())
		await waitFor(() => expect(row('northwind/v2 (error)')).toBeTruthy())
		fireEvent.click(row('northwind/v2 (error)'))
		expect(screen.getAllByText('Schema (lambdaORM.yaml)').length).toBeGreaterThan(0)
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
		fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
		await screen.findByText('Schema sales/v1 created: it starts in a moment')
		expect(admin.calls).toContain('create sales/v1 northwind/v1')
	})

	test('removed only once its route is typed again', async () => {
		const admin = new FakeAdmin()
		show(admin)
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		fireEvent.click(within(row('northwind/v1')).getByRole('button', { name: 'Remove the schema northwind/v1' }))
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
		await waitFor(() => expect(row('shared reports')).toBeTruthy())
		fireEvent.click(within(row('northwind/v1')).getByRole('button', { name: 'Add' }))
		fireEvent.click(screen.getByRole('menuitem', { name: /New folder/ }))
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
		await waitFor(() => expect(row('Commands')).toBeTruthy())
		fireEvent.click(row('Commands'))
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
		fireEvent.click(screen.getByRole('button', { name: 'Run push' }))
		await waitFor(() => expect(admin.calls).toContain('run push test p-push force'))
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
		await waitFor(() => expect(row('Commands')).toBeTruthy())
		fireEvent.click(row('Commands'))
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
		await waitFor(() => expect(row('Commands')).toBeTruthy())
		fireEvent.click(row('Commands'))
		const introspect = await screen.findByRole('button', { name: 'introspect…' }) as HTMLButtonElement
		expect(introspect.disabled).toBe(true)
		fireEvent.change(screen.getByLabelText('Entity of the data'), { target: { value: 'Brands' } })
		expect(introspect.disabled).toBe(true)
	})
})

describe('the schema as forms', () => {
	const FORMS_SCHEMA = 'domain:\n  entities:\n    - name: Products\n      primaryKey: [id]\n      properties:\n        - { name: id, type: integer }\n  enums:\n    - name: States\n      values: [{ name: on, value: 1 }]\ninfrastructure:\n  sources:\n    - { name: main, dialect: PostgreSQL }\n  stages:\n    - name: default\n      sources: [{ name: main }]\n'
	const openForms = async (admin: FakeAdmin) => {
		admin.text = FORMS_SCHEMA
		show(admin)
		await waitFor(() => expect(row('Schema (forms)')).toBeTruthy())
		fireEvent.click(row('Schema (forms)'))
		await screen.findByRole('button', { name: 'Products' })
	}

	test('an entity: a property added and saved as one change, with the entity as it was read', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		fireEvent.click(screen.getByRole('button', { name: 'Products' }))
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

	test('someone else changed the same element: the form shows what it has now', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		fireEvent.click(screen.getByRole('button', { name: 'Products' }))
		fireEvent.change(await screen.findByLabelText('primaryKey'), { target: { value: 'id, code' } })
		admin.conflictOnce = true
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await screen.findByText('Someone else changed it meanwhile: this is what it has now')
		expect((screen.getByLabelText('price name') as HTMLInputElement).value).toBe('price')
	})

	test('a new source, a rename, and a remove that first says who uses the element', async () => {
		const admin = new FakeAdmin()
		await openForms(admin)
		fireEvent.click(screen.getByRole('button', { name: 'New in Sources' }))
		fireEvent.change(screen.getByLabelText('name'), { target: { value: 'replica' } })
		fireEvent.change(screen.getByLabelText('dialect'), { target: { value: 'MySQL' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(admin.patches[0]).toEqual({ op: 'add', at: ['infrastructure', 'sources'], value: { name: 'replica', dialect: 'MySQL' } }))
		fireEvent.click(screen.getByRole('button', { name: 'States' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
		fireEvent.change(screen.getByLabelText('Rename'), { target: { value: 'Status' } })
		fireEvent.click(screen.getAllByRole('button', { name: 'Rename' }).at(-1)!)
		await waitFor(() => expect(admin.patches.at(-1)).toMatchObject({ op: 'rename', at: ['domain', 'enums', 'States'], to: 'Status' }))
		fireEvent.click(screen.getByRole('button', { name: 'States' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
		await screen.findByText('domain/entities/Products/properties/state')
		fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!)
		await waitFor(() => expect(admin.patches.at(-1)).toMatchObject({ op: 'remove', at: ['domain', 'enums', 'States'] }))
	})
})
