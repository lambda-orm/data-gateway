// The components with Testing Library: Monaco doesn't load in jsdom, so the editors are their text areas.
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryWorkbench } from '../src/components/QueryWorkbench'
import { ResultViewer } from '../src/components/ResultViewer'
import { measure } from '../src/domain/results'
import { FakeApi, WHO_READS } from './fakes'

vi.mock('../src/infrastructure/monaco/monacoSetup', () => ({
	loadMonaco: () => Promise.reject(new Error('no browser')),
	setSchemaTypings: () => Promise.resolve()
}))

afterEach(cleanup)

const button = (name: string) => screen.getByRole('button', { name })

/** jsdom's Blob has no text() */
const read = (blob: Blob): Promise<string> => new Promise(resolve => {
	const reader = new FileReader()
	reader.onload = () => resolve(String(reader.result))
	reader.readAsText(blob)
})

describe('QueryWorkbench', () => {
	test('choose a schema, write, execute (Ctrl+Enter too) and see the table', async () => {
		const api = new FakeApi()
		const onResult = vi.fn()
		render(<QueryWorkbench api={api} history={false} onResult={onResult} />)
		const select = await screen.findByRole('combobox', { name: 'schema' })
		expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual(['choose…', 'northwind/v1'])
		fireEvent.change(select, { target: { value: 'northwind/v1' } })
		await screen.findByText(/backend ·/)
		expect((select as HTMLSelectElement).value).toBe('northwind/v1')
		fireEvent.change(screen.getByRole('textbox', { name: 'query' }), { target: { value: 'Products' } })
		fireEvent.click(button('execute'))
		await screen.findByText('3 rows')
		fireEvent.click(screen.getByRole('tab', { name: 'table' }))
		expect(screen.getByRole('table')).toBeTruthy()
		expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['id', 'name'])
		expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ operation: 'execute', ok: true }))
		fireEvent.keyDown(screen.getByRole('textbox', { name: 'query' }), { key: 'Enter', ctrlKey: true })
		await waitFor(() => expect(api.calls.filter(c => c.operation === 'execute')).toHaveLength(2))
	})

	test('actions the credential cannot use are disabled with the reason; parameters fills the data', async () => {
		const api = new FakeApi()
		api.who = WHO_READS
		render(<QueryWorkbench api={api} schema="northwind/v1" history={false} />)
		await screen.findByText(/agent ·/)
		expect((button('execute queued') as HTMLButtonElement).disabled).toBe(true)
		expect(button('execute queued').title).toBe('"agent" has no queue permission')
		expect((button('plan') as HTMLButtonElement).disabled).toBe(false)
		fireEvent.click(screen.getByRole('radio', { name: 'script' }))
		expect((button('execute script') as HTMLButtonElement).disabled).toBe(true)
		expect(button('execute script').title).toBe('scripts are disabled on this schema')
		fireEvent.click(screen.getByRole('radio', { name: 'query' }))
		fireEvent.change(screen.getByRole('textbox', { name: 'query' }), { target: { value: 'Products.filter(p => p.price > minPrice)' } })
		fireEvent.click(button('parameters'))
		await waitFor(() => expect(JSON.parse((screen.getByRole('textbox', { name: 'data' }) as HTMLTextAreaElement).value)).toEqual({ minPrice: 0, entity: { name: '' } }))
	})

	test('an error of λORM is shown with its name and status', async () => {
		render(<QueryWorkbench api={new FakeApi()} schema="northwind/v1" history={false} />)
		await screen.findByText(/backend ·/)
		fireEvent.change(screen.getByRole('textbox', { name: 'query' }), { target: { value: 'Nope' } })
		fireEvent.click(button('plan'))
		expect((await screen.findByRole('alert')).textContent).toBe('SchemaError: Entity Nope not found')
		expect(screen.getByRole('status').textContent).toMatch(/^400plan/)
	})
})

describe('ResultViewer', () => {
	test('views (tree, json, yaml), a limit of rows with notice, downloads of everything', async () => {
		const rows = Array.from({ length: 5 }, (_, id) => ({ id, name: `p${id}` }))
		const created: Blob[] = []
		URL.createObjectURL = vi.fn((blob: Blob) => { created.push(blob); return 'blob:x' }) as any
		URL.revokeObjectURL = vi.fn()
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
		render(<ResultViewer result={measure('execute', rows, 3)} maxRows={2} fileName="products" />)
		expect(screen.getByText('Showing 2 of 5 rows: the downloads have all of them.')).toBeTruthy()
		fireEvent.click(screen.getByRole('tab', { name: 'yaml' }))
		expect(screen.getByText(/- id: 0/).textContent).toContain('name: p4')
		fireEvent.click(screen.getByRole('tab', { name: 'json' }))
		expect(screen.getByText(/"id": 4/)).toBeTruthy()
		const exportAs = (name: string) => {
			fireEvent.click(button('export ▾'))
			fireEvent.click(screen.getByRole('menuitem', { name }))
			expect(screen.queryByRole('menu')).toBeNull()
		}
		exportAs('JSON')
		exportAs('YAML')
		exportAs('TXT (tab-separated)')
		expect(click).toHaveBeenCalledTimes(3)
		expect(JSON.parse(await read(created[0]))).toHaveLength(5)
		expect(await read(created[1])).toMatch(/- id: 4\n {2}name: p4/)
		expect(await read(created[2])).toBe('id\tname\n0\tp0\n1\tp1\n2\tp2\n3\tp3\n4\tp4\n')
		fireEvent.click(button('export ▾'))
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(screen.queryByRole('menu')).toBeNull()
		click.mockRestore()
	})

	test('no result yet; a scalar has no table', () => {
		const { rerender } = render(<ResultViewer />)
		expect(screen.getByText('Run an action to see its result.')).toBeTruthy()
		rerender(<ResultViewer result={measure('executeScript', 7, 1)} />)
		expect(screen.queryByRole('tab', { name: 'table' })).toBeNull()
		expect(screen.getByText('7')).toBeTruthy()
	})
})

describe('QueryTabs', () => {
	test('several queries in tabs: each keeps its own text; add, rename, close (the last one stays)', async () => {
		const { QueryTabs } = await import('../src/components/QueryTabs')
		render(<QueryTabs api={new FakeApi()} schema="northwind/v1" history={false} maxTabs={3} />)
		await screen.findByText(/backend ·/)
		const query = () => screen.getAllByRole('textbox', { name: 'query' }).find(e => !e.closest('[hidden]')) as HTMLTextAreaElement
		fireEvent.change(query(), { target: { value: 'Products' } })
		fireEvent.click(button('new tab'))
		expect(screen.getByRole('tab', { name: 'Query 2' }).getAttribute('aria-selected')).toBe('true')
		await waitFor(() => expect(screen.getAllByText(/backend ·/)).toHaveLength(2))
		expect(query().value).toBe('')
		fireEvent.change(query(), { target: { value: 'Orders' } })
		fireEvent.click(screen.getByRole('tab', { name: 'Query 1' }))
		expect(query().value).toBe('Products')
		fireEvent.doubleClick(screen.getByRole('tab', { name: 'Query 1' }))
		const name = screen.getByRole('textbox', { name: 'tab name' })
		fireEvent.change(name, { target: { value: 'products' } })
		fireEvent.keyDown(name, { key: 'Enter' })
		expect(screen.getByRole('tab', { name: 'products' })).toBeTruthy()
		fireEvent.click(button('new tab'))
		expect((button('new tab') as HTMLButtonElement).disabled).toBe(true)
		fireEvent.click(button('close Query 3'))
		fireEvent.click(button('close Query 2'))
		expect(screen.getAllByRole('tab')).toHaveLength(1)
		expect(screen.queryByRole('button', { name: 'close products' })).toBeNull()
	})
})

describe('locale', () => {
	test('the labels and the reasons in Spanish; the actions keep their names', async () => {
		const api = new FakeApi()
		api.who = WHO_READS
		render(<QueryWorkbench api={api} schema="northwind/v1" history={false} locale="es" />)
		await screen.findByText(/agent ·/)
		expect(screen.getByRole('radio', { name: 'consulta' })).toBeTruthy()
		expect(screen.getByText('datos')).toBeTruthy()
		expect(screen.getByText('Ejecutá una acción para ver su resultado.')).toBeTruthy()
		expect(button('execute queued').title).toBe('"agent" no tiene el permiso queue')
	})

	test('an unknown locale is English', async () => {
		const { messagesOf, localize } = await import('../src/domain/i18n')
		expect(messagesOf('xx').query).toBe('query')
		expect(messagesOf('pt-BR').query).toBe('consulta')
		expect(localize('something else', messagesOf('fr'))).toBe('something else')
	})
})

describe('copy', () => {
	test('the icon copies the view and says so', async () => {
		const writeText = vi.fn(() => Promise.resolve())
		Object.assign(navigator, { clipboard: { writeText } })
		render(<ResultViewer result={measure('execute', [{ id: 1, name: 'a\tb' }], 3)} />)
		fireEvent.click(screen.getByRole('tab', { name: 'table' }))
		fireEvent.click(button('copy'))
		expect(writeText).toHaveBeenCalledWith('id\tname\n1\ta b\n')
		await screen.findByRole('button', { name: 'copied' })
	})
})
