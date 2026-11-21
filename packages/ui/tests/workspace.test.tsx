import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { canMove, childrenOf, folderPaths, nameProblem, parseExport, SavedItem, subtreeOf, toExport } from '../src/domain/savedItems'
import { WorkspaceController, WorkspaceError } from '../src/application/workspaceController'
import { IndexedDbWorkspaceStore, MemoryWorkspaceStore } from '../src/infrastructure/workspaceStores'
import { Workspace } from '../src/components/Workspace'
import { DomainInfo } from '../src/domain/diagram'
import { FakeApi } from './fakes'

vi.mock('../src/infrastructure/monaco/monacoSetup', () => ({
	loadMonaco: () => Promise.reject(new Error('no browser')),
	setSchemaTypings: () => Promise.resolve()
}))

afterEach(cleanup)

// jsdom has no PointerEvent: without it the coordinates of a drag are lost
if (!(globalThis as any).PointerEvent) {
	(globalThis as any).PointerEvent = class extends MouseEvent {
		pointerId: number
		constructor (type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 }
	}
}

const at = '2026-11-18T10:00:00.000Z'
const folder = (id: string, name: string, parentId?: string, schema = 's'): SavedItem => ({ id, kind: 'folder', schema, parentId, name, createdAt: at, updatedAt: at })
const query = (id: string, name: string, parentId?: string): SavedItem => ({ id, kind: 'query', schema: 's', parentId, name, mode: 'query', query: 'A', script: '', data: '{}', options: '{}', createdAt: at, updatedAt: at })

const TREE: SavedItem[] = [folder('r', 'Reports'), folder('y', '2026', 'r'), query('q1', 'zeta', 'y'), query('q2', 'Alpha'), folder('b', 'Backlog'), folder('o', 'Other', undefined, 't')]

describe('saved items (domain)', () => {
	test('children (folders first, by name), subtree, folder paths', () => {
		expect(childrenOf(TREE, 's', undefined).map(i => i.name)).toEqual(['Backlog', 'Reports', 'Alpha'])
		expect(subtreeOf(TREE, 'r')).toEqual(['r', 'y', 'q1'])
		expect(folderPaths(TREE, 's')).toEqual([{ id: 'b', path: 'Backlog' }, { id: 'r', path: 'Reports' }, { id: 'y', path: 'Reports / 2026' }])
	})

	test('moves: never into itself, under itself, a query or another schema', () => {
		expect(canMove(TREE, 'r', 'b')).toBe(true)
		expect(canMove(TREE, 'r', 'y')).toBe(false)
		expect(canMove(TREE, 'r', 'r')).toBe(false)
		expect(canMove(TREE, 'q2', 'q1')).toBe(false)
		expect(canMove(TREE, 'q2', 'o')).toBe(false)
		expect(canMove(TREE, 'q1', undefined)).toBe(true)
	})

	test('names: required, not repeated by kind in a folder (case aside)', () => {
		expect(nameProblem(TREE, { kind: 'folder', schema: 's', name: '  ' })).toBe('required')
		expect(nameProblem(TREE, { kind: 'folder', schema: 's', name: 'reports' })).toBe('taken')
		expect(nameProblem(TREE, { kind: 'query', schema: 's', name: 'Reports' })).toBeUndefined()
		expect(nameProblem(TREE, { kind: 'folder', schema: 's', parentId: 'r', name: 'Reports' })).toBeUndefined()
		expect(nameProblem(TREE, { id: 'r', kind: 'folder', schema: 's', name: 'Reports' })).toBeUndefined()
	})

	test('export and import: the format is checked; an item without its folder goes to the top', () => {
		const text = JSON.stringify(toExport(TREE, new Date(at)))
		expect(parseExport(text)).toEqual(TREE)
		expect(parseExport('{"format":"other","items":[]}')).toBeUndefined()
		expect(parseExport('not json')).toBeUndefined()
		expect(parseExport(JSON.stringify({ format: 'lambdaorm-workspace', items: [{ id: 1 }] }))).toBeUndefined()
		const orphan = parseExport(JSON.stringify(toExport([query('q', 'n', 'gone')])))!
		expect(orphan[0].parentId).toBeUndefined()
	})
})

describe('WorkspaceController', () => {
	test('create, rename, move, delete a folder with what it holds; export and import', async () => {
		const store = new MemoryWorkspaceStore([], true)
		const controller = new WorkspaceController(store, () => new Date(at))
		await controller.load()
		const reports = await controller.createFolder({ schema: 's', name: ' Reports ' })
		expect(reports.name).toBe('Reports')
		await expect(controller.createFolder({ schema: 's', name: 'reports' })).rejects.toThrow(WorkspaceError)
		const q = await controller.createQuery({ schema: 's', name: 'Open', description: 'the open ones' }, { mode: 'query', query: 'Cases', script: '', data: '{}', options: '{}' })
		await controller.move(q.id, reports.id)
		await expect(controller.move(reports.id, reports.id)).rejects.toThrow(WorkspaceError)
		await controller.update(q.id, { query: 'Cases.page(1, 3)' })
		expect((await store.all()).find(i => i.id === q.id)).toMatchObject({ parentId: reports.id, query: 'Cases.page(1, 3)', description: 'the open ones' })
		const exported = controller.exportText()
		expect(await controller.remove(reports.id)).toBe(2)
		expect(await store.all()).toEqual([])
		expect(await controller.importText(exported, 'merge')).toBe(2)
		expect(controller.getState().items).toHaveLength(2)
		await controller.createFolder({ schema: 's', name: 'Extra' })
		await controller.importText(exported, 'replace')
		expect((await store.all()).map(i => i.name).sort()).toEqual(['Open', 'Reports'])
		await expect(controller.importText('{}', 'merge')).rejects.toMatchObject({ problem: 'invalidFile' })
	})

	test('without IndexedDB the store keeps them in memory and says it is not durable', async () => {
		const store = new IndexedDbWorkspaceStore('k', undefined)
		await store.put([query('q', 'n')])
		expect(await store.all()).toHaveLength(1)
		expect(await store.durable()).toBe(false)
	})
})

const DOMAIN: DomainInfo = {
	entities: [
		{ name: 'Customers', primaryKey: ['id'], properties: [{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }], relations: [] },
		{ name: 'Orders', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }, { name: 'customerId', type: 'string' }], relations: [{ name: 'customer', type: 'oneToMany', from: 'customerId', entity: 'Customers', to: 'id' }] },
		{ name: 'Products', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }], relations: [] }
	]
}
class DomainApi extends FakeApi { async domain () { return DOMAIN } }

const row = (name: string) => screen.getAllByRole('treeitem').find(r => r.querySelector('.lw-tree-label')?.textContent === name)!
const action = (rowName: string, label: string) => within(row(rowName)).getByRole('button', { name: label })
/** The + of a row, then one of its items */
const add = (rowName: string, label: string) => { fireEvent.click(action(rowName, 'Agregar')); fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(label) })) }

describe('Workspace', () => {
	test('a schema that did not start: shown apart with its reason, nothing to create in it', async () => {
		class WithError extends DomainApi {
			async schemas () { return [...await super.schemas(), { path: 'iot', status: 'error', reason: 'source salesDocuments needs ORM_SALES_DOCUMENTS_CNX, which is not set' }] }
		}
		render(<Workspace api={new WithError()} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" />)
		await waitFor(() => expect(row('iot (error)')).toBeTruthy())
		expect(row('iot (error)').getAttribute('title')).toContain('ORM_SALES_DOCUMENTS_CNX')
		expect(within(row('iot (error)')).queryByRole('button')).toBeNull()
		fireEvent.click(row('iot (error)'))
		expect(screen.getByRole('note').textContent).toBe('source salesDocuments needs ORM_SALES_DOCUMENTS_CNX, which is not set')
		// the ready schema works as before
		expect(row('northwind/v1')).toBeTruthy()
	})

	test('the explorer: its width by the keyboard, kept in the browser', async () => {
		window.localStorage.removeItem('lambdaorm-ui.explorerWidth')
		const first = render(<Workspace api={new DomainApi()} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" />)
		const border = await screen.findByRole('separator', { name: /Drag to resize/ })
		expect(border.getAttribute('aria-valuenow')).toBe('280')
		fireEvent.keyDown(border, { key: 'ArrowRight' })
		fireEvent.keyDown(border, { key: 'ArrowRight', shiftKey: true })
		expect(border.getAttribute('aria-valuenow')).toBe('360')
		for (let i = 0; i < 30; i++) fireEvent.keyDown(border, { key: 'ArrowLeft' })
		expect(border.getAttribute('aria-valuenow')).toBe('180')
		fireEvent.keyDown(border, { key: 'ArrowRight', shiftKey: true })
		first.unmount()
		render(<Workspace api={new DomainApi()} store={new MemoryWorkspaceStore([], true)} history={false} locale="en" />)
		expect((await screen.findByRole('separator', { name: /Drag to resize/ })).getAttribute('aria-valuenow')).toBe('240')
		window.localStorage.removeItem('lambdaorm-ui.explorerWidth')
	})

	test('the entities of a large domain narrowed by a filter: by name, by a property or relation, and Entity.field', async () => {
		render(<Workspace api={new DomainApi()} store={new MemoryWorkspaceStore([], true)} history={false} locale="es" />)
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		fireEvent.click(row('Entidades'))
		await waitFor(() => expect(row('Orders')).toBeTruthy())
		const filter = screen.getByRole('searchbox', { name: /Filtrar/ })
		const labels = () => screen.getAllByRole('treeitem').map(r => r.querySelector('.lw-tree-label')?.textContent ?? '').filter(Boolean)
		/** the rows from an entity on, n of them */
		const from = (name: string, n: number) => labels().slice(labels().indexOf(name), labels().indexOf(name) + n)

		fireEvent.change(filter, { target: { value: 'prod' } })
		expect(labels()).toContain('Products')
		expect(labels()).not.toContain('Orders')
		expect(screen.getByRole('status').textContent).toBe('1 de 3')

		// a property: the entity with the property under it, without opening it
		fireEvent.change(filter, { target: { value: 'customerid' } })
		expect(from('Orders', 2)).toEqual(['Orders', 'customerIdstring'])
		expect(labels()).not.toContain('Customers')

		fireEvent.change(filter, { target: { value: 'Orders.cust' } })
		expect(from('Orders', 3)).toEqual(['Orders', 'customerIdstring', 'customer→ Customers · N — 1'])

		fireEvent.change(filter, { target: { value: 'zzz' } })
		expect(labels()).toContain('Nada coincide')
		// Escape clears it
		fireEvent.keyDown(filter, { key: 'Escape' })
		expect(labels()).toEqual(expect.arrayContaining(['Customers', 'Orders', 'Products']))
	})

	test('folders, a query saved into one, its changes and Ctrl+S; entities and the domain as YAML', async () => {
		const store = new MemoryWorkspaceStore([], true)
		render(<Workspace api={new DomainApi()} store={store} history={false} locale="es" />)
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		await screen.findByText('Todavía no hay nada guardado')

		add('northwind/v1', 'Nueva carpeta')
		fireEvent.change(screen.getByRole('textbox', { name: 'name' }), { target: { value: 'Reportes' } })
		fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
		await waitFor(() => expect(row('Reportes')).toBeTruthy())

		// a new query in the folder: typed, unsaved (•), saved with a name and a description
		add('Reportes', 'Nueva consulta')
		const panel = () => screen.getAllByRole('tabpanel').find(p => !p.hidden)!
		await waitFor(() => expect((within(panel()).getByRole('combobox', { name: 'schema' }) as HTMLSelectElement).value).toBe('northwind/v1'))
		fireEvent.change(within(panel()).getByRole('textbox', { name: 'query' }), { target: { value: 'Products' } })
		await waitFor(() => expect(screen.getByRole('tab', { selected: true }).textContent).toContain('•'))
		fireEvent.click(within(panel()).getByRole('button', { name: 'Guardar' }))
		const dialog = await screen.findByRole('dialog')
		expect((within(dialog).getByRole('combobox', { name: 'folder' }) as HTMLSelectElement).value).not.toBe('')
		fireEvent.change(within(dialog).getByRole('textbox', { name: 'name' }), { target: { value: 'Productos' } })
		fireEvent.change(within(dialog).getByRole('textbox', { name: 'description' }), { target: { value: 'todos' } })
		fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
		await waitFor(() => expect(screen.getByRole('tab', { selected: true }).textContent).toBe(' Productos'))
		expect(row('Productos').getAttribute('aria-level')).toBe('3')
		expect((await store.all()).find(i => i.name === 'Productos')).toMatchObject({ kind: 'query', query: 'Products', description: 'todos', schema: 'northwind/v1' })

		fireEvent.change(within(panel()).getByRole('textbox', { name: 'query' }), { target: { value: 'Products.page(1, 2)' } })
		await waitFor(() => expect(screen.getByRole('tab', { selected: true }).textContent).toContain('•'))
		fireEvent.keyDown(within(panel()).getByRole('textbox', { name: 'query' }), { key: 's', ctrlKey: true })
		await waitFor(async () => expect((await store.all()).find(i => i.name === 'Productos')).toMatchObject({ query: 'Products.page(1, 2)' }))
		await waitFor(() => expect(screen.getByRole('tab', { selected: true }).textContent).not.toContain('•'))

		// the same name again in the folder is refused
		fireEvent.click(within(panel()).getByRole('button', { name: 'Guardar como…' }))
		fireEvent.change(within(await screen.findByRole('dialog')).getByRole('textbox', { name: 'name' }), { target: { value: 'productos' } })
		fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'folder' }), { target: { value: (await store.all()).find(i => i.name === 'Reportes')!.id } })
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }))
		expect((await screen.findByRole('alert')).textContent).toBe('Ya hay uno con ese nombre acá.')
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))

		// entities: their properties and relations; a double click opens the form, which queries it
		fireEvent.click(row('Entidades'))
		await waitFor(() => expect(row('Orders')).toBeTruthy())
		fireEvent.click(row('Orders'))
		fireEvent.click(row('Propiedades (2)'))
		expect(screen.getByText('customerId')).toBeTruthy()
		fireEvent.click(row('Relaciones (1)'))
		expect(screen.getAllByRole('treeitem').some(r => r.textContent === 'customer→ Customers · N — 1')).toBe(true)
		// the Open action of the row (as a double click does)
		fireEvent.click(action('Orders', 'Abrir'))
		await waitFor(() => expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Orders'))
		expect(within(panel()).getByRole('heading', { name: 'Orders' })).toBeTruthy()
		expect(within(panel()).getAllByRole('row').map(r => r.textContent)).toContain('2customerIdstringCustomers.id')
		fireEvent.click(within(panel()).getByRole('tab', { name: 'Relaciones (1)' }))
		expect(within(panel()).getByRole('button', { name: 'Customers' })).toBeTruthy()
		fireEvent.click(within(panel()).getByRole('tab', { name: 'Datos' }))
		await waitFor(() => expect(within(panel()).getByRole('status').textContent).toContain('3 filas'))
		// the relation takes to the other entity's form
		fireEvent.click(within(panel()).getByRole('tab', { name: 'Relaciones (1)' }))
		fireEvent.click(within(panel()).getByRole('button', { name: 'Customers' }))
		await waitFor(() => expect(within(panel()).getByRole('heading', { name: 'Customers' })).toBeTruthy())
		expect(within(panel()).getByRole('tab', { name: 'Relaciones (1)' })).toBeTruthy()
		fireEvent.click(within(panel()).getByRole('button', { name: 'Consultar' }))
		await waitFor(() => expect((within(panel()).getByRole('textbox', { name: 'query' }) as HTMLTextAreaElement).value).toBe('Customers.page(1, 10)'))

		// the domain as YAML, read only
		fireEvent.click(row('Dominio (YAML)'))
		const yaml = await waitFor(() => within(panel()).getByRole('textbox', { name: 'domain' }) as HTMLTextAreaElement)
		expect(yaml.readOnly).toBe(true)
		expect(yaml.value).toContain('entities:')
		expect(yaml.value).toContain('name: Orders')

		// deleting the folder takes the query; the open tab stays, unsaved
		fireEvent.click(action('Reportes', 'Eliminar'))
		expect(screen.getByRole('dialog').textContent).toContain('los 1 elementos')
		fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }))
		await waitFor(async () => expect(await store.all()).toEqual([]))
	}, 30000)
})

describe('saved diagrams', () => {
	test('created from the explorer with the chosen entities; a box moved by hand is saved with its place', async () => {
		const store = new MemoryWorkspaceStore([], true)
		const { container } = render(<Workspace api={new DomainApi()} store={store} history={false} locale="es" />)
		await waitFor(() => expect(row('northwind/v1')).toBeTruthy())
		add('northwind/v1', 'Nuevo diagrama')
		const dialog = await screen.findByRole('dialog')
		fireEvent.change(within(dialog).getByRole('textbox', { name: 'name' }), { target: { value: 'Ventas' } })
		fireEvent.click(within(dialog).getByRole('button', { name: 'Crear' }))
		expect((await within(dialog).findByRole('alert')).textContent).toBe('Elegí al menos una entidad.')
		await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: 'Orders' })).toBeTruthy())
		fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Orders' }))
		fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar sus vecinas' }))
		expect((within(dialog).getByRole('checkbox', { name: 'Customers' }) as HTMLInputElement).checked).toBe(true)
		expect((within(dialog).getByRole('checkbox', { name: 'Products' }) as HTMLInputElement).checked).toBe(false)
		fireEvent.click(within(dialog).getByRole('button', { name: 'Crear' }))
		await waitFor(() => expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Ventas'))
		expect(row('Ventas')).toBeTruthy()
		expect((await store.all()).find(i => i.name === 'Ventas')).toMatchObject({ kind: 'diagram', entities: ['Customers', 'Orders'] })
		await waitFor(() => expect(container.querySelectorAll('[role=tabpanel]:not([hidden]) [data-entity]')).toHaveLength(2), { timeout: 20000 })

		// drag Orders 120 px to the right
		const box = container.querySelector('[role=tabpanel]:not([hidden]) [data-entity=Orders]')!
		const before = box.getAttribute('transform')
		fireEvent.pointerDown(box, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 })
		fireEvent.pointerMove(box, { clientX: 220, clientY: 100, buttons: 1, pointerId: 1 })
		fireEvent.pointerUp(box, { clientX: 220, clientY: 100, pointerId: 1 })
		await waitFor(() => expect(container.querySelector('[role=tabpanel]:not([hidden]) [data-entity=Orders]')!.getAttribute('transform')).not.toBe(before))
		await waitFor(() => expect(screen.getByRole('tab', { selected: true }).textContent).toContain('•'))
		fireEvent.click(within(screen.getAllByRole('tabpanel').find(p => !p.hidden)!).getByRole('button', { name: 'Guardar' }))
		await waitFor(async () => expect((await store.all()).find(i => i.name === 'Ventas')).toMatchObject({ positions: { Orders: expect.any(Object), Customers: expect.any(Object) } }))
		await waitFor(() => expect(screen.getByRole('tab', { selected: true }).textContent).not.toContain('•'))

		// the line sideways, and the names of the relations: saved with the diagram
		const handle = container.querySelector('[role=tabpanel]:not([hidden]) [data-edge] .lw-line-handle')!
		fireEvent.pointerDown(handle, { clientX: 50, clientY: 50, button: 0, buttons: 1, pointerId: 2 })
		fireEvent.pointerMove(handle, { clientX: 777, clientY: 60, buttons: 1, pointerId: 2 })
		fireEvent.pointerUp(handle, { clientX: 777, clientY: 60, pointerId: 2 })
		await waitFor(() => expect(container.querySelector('[role=tabpanel]:not([hidden]) [data-edge] path')!.getAttribute('d')).toContain('777'))
		const visible = () => within(screen.getAllByRole('tabpanel').find(p => !p.hidden)!)
		fireEvent.click(visible().getByRole('checkbox', { name: 'nombres de relaciones' }))
		expect(container.querySelector('[role=tabpanel]:not([hidden]) .lw-line-name')!.textContent).toBe('customer')
		fireEvent.click(visible().getByRole('button', { name: 'Guardar' }))
		await waitFor(async () => expect((await store.all()).find(i => i.name === 'Ventas')).toMatchObject({ relationNames: true, bends: { 'rel:Customers.id>Orders.customerId': 777 } }))
		// a double click puts the line back
		fireEvent.doubleClick(container.querySelector('[role=tabpanel]:not([hidden]) [data-edge] .lw-line-handle')!)
		await waitFor(() => expect(container.querySelector('[role=tabpanel]:not([hidden]) [data-edge] path')!.getAttribute('d')).not.toContain('777'))

		// the × of a box takes it out (with its line); the last one stays
		fireEvent.click(visible().getByRole('button', { name: 'quitar del diagrama Customers' }))
		await waitFor(() => expect(container.querySelectorAll('[role=tabpanel]:not([hidden]) [data-entity]')).toHaveLength(1))
		expect(container.querySelectorAll('[role=tabpanel]:not([hidden]) [data-edge]')).toHaveLength(0)
		expect(visible().queryByRole('button', { name: 'quitar del diagrama Orders' })).toBeNull()
		fireEvent.click(visible().getByRole('button', { name: 'Guardar' }))
		await waitFor(async () => expect((await store.all()).find(i => i.name === 'Ventas')).toMatchObject({ entities: ['Orders'], bends: undefined }))
		expect(Object.keys((await store.all()).find(i => i.name === 'Ventas')!.kind === 'diagram' ? ((await store.all()).find(i => i.name === 'Ventas') as any).positions : {})).toEqual(['Orders'])
	}, 30000)
})
