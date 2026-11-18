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
		fireEvent.click(button('.json'))
		fireEvent.click(button('.yaml'))
		expect(click).toHaveBeenCalledTimes(2)
		expect(JSON.parse(await read(created[0]))).toHaveLength(5)
		expect(await read(created[1])).toMatch(/- id: 4\n {2}name: p4/)
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
