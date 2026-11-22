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
	async validate (text: string): Promise<{ valid: boolean, issues: SchemaIssue[] }> {
		return text.includes('nope') ? { valid: false, issues: [{ severity: 'error', message: 'bad indentation', line: 2, column: 3 }] } : { valid: true, issues: [] }
	}
	async createWorkspace (path: string, copyOf?: string) { this.calls.push(`create ${path} ${copyOf ?? ''}`.trim()); if (path === 'admin') throw status(400, 'segment "admin" is reserved'); return { path, version: 'v1' } }
	async removeWorkspace (path: string) { this.calls.push(`remove ${path}`); return { trash: `.trash/${path}` } }
	async workbench () { return { version: '0', items: [] } }
	async putItems () { return { items: [] } }
	async removeItems () { return { removed: [] } }
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
