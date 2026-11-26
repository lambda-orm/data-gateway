// The data of an entity as a backoffice (docs/BACKOFFICE.md): sorted and filtered, editable with write (a cell only
// while it has what was read), rows added and deleted, the page or everything exported.
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DataTable } from '../src/components/DataTable'
import { FakeApi } from './fakes'

afterEach(cleanup)

const PRODUCTS = { name: 'Products', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer', required: true }, { name: 'name', type: 'string', required: true }, { name: 'price', type: 'decimal' }] }

class DataApi extends FakeApi {
	public executed: { query: string, data?: unknown }[] = []
	public answer: (query: string) => unknown = () => [{ id: 1, name: 'Chai', price: 18 }, { id: 2, name: 'Chang', price: 19 }]
	async execute (_schema: string, query: string, data?: unknown) { this.executed.push({ query, data }); return this.answer(query) as any }
}

const table = () => screen.getByRole('table', { name: 'Products' })
const stores = () => screen.getByRole('table', { name: 'Stores' })

describe('the data table', () => {
	test('its rows; a column sorts it (asc, desc, none); a filter narrows it', async () => {
		const api = new DataApi()
		render(<DataTable api={api} schema="shop" entity={PRODUCTS as any} canWrite={false} locale="en" />)
		await waitFor(() => expect(within(table()).getAllByRole('row')).toHaveLength(3))
		expect(api.executed[0].query).toBe('Products.page(1, 50)')
		fireEvent.click(screen.getByRole('button', { name: 'sort by name' }))
		await waitFor(() => expect(api.executed.at(-1)!.query).toBe('Products.sort(p => p.name).page(1, 50)'))
		fireEvent.click(screen.getByRole('button', { name: /sort by name/ }))
		await waitFor(() => expect(api.executed.at(-1)!.query).toBe('Products.sort(p => desc(p.name)).page(1, 50)'))
		fireEvent.change(screen.getByLabelText('filter (on p)'), { target: { value: 'p.price > 18' } })
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
		await waitFor(() => expect(api.executed.at(-1)!.query).toBe('Products.filter(p => p.price > 18).sort(p => desc(p.name)).page(1, 50)'))
		// without write: read only
		expect(screen.queryByRole('button', { name: /Add a row/ })).toBeNull()
		expect(screen.getByText('Read only: rows are not changed here.')).toBeTruthy()
	})

	test('with write: a cell changed only while it has what was read; if someone changed it, the table says so', async () => {
		const api = new DataApi()
		render(<DataTable api={api} schema="shop" entity={PRODUCTS as any} canWrite={true} locale="en" />)
		await waitFor(() => expect(within(table()).getAllByRole('row')).toHaveLength(3))
		// the key is not editable
		fireEvent.doubleClick(within(table()).getByText('1'))
		expect(screen.queryByLabelText('id value')).toBeNull()
		fireEvent.doubleClick(within(table()).getByText('18'))
		fireEvent.change(screen.getByLabelText('price value'), { target: { value: '20.5' } })
		api.answer = query => query.includes('update') ? 1 : [{ id: 1, name: 'Chai', price: 20.5 }]
		fireEvent.keyDown(screen.getByLabelText('price value'), { key: 'Enter' })
		await waitFor(() => expect(api.executed.some(e => e.query.includes('update'))).toBe(true))
		expect(api.executed.find(e => e.query.includes('update'))).toEqual({
			query: 'Products.update(p => ({ price: v_new })).filter(p => p.id == k_id && p.price == v_old)', data: { v_new: 20.5, v_old: 18, k_id: 1 }
		})
		await waitFor(() => expect(within(table()).getByText('20.5')).toBeTruthy())
		api.answer = query => query.includes('update') ? 0 : [{ id: 1, name: 'Chai', price: 21 }]
		fireEvent.doubleClick(within(table()).getByText('Chai'))
		fireEvent.change(screen.getByLabelText('name value'), { target: { value: 'Chai tea' } })
		fireEvent.keyDown(screen.getByLabelText('name value'), { key: 'Enter' })
		expect(await screen.findByText('Someone changed it meanwhile: the table shows it now.')).toBeTruthy()
		// a value that is not of its type is not sent
		fireEvent.doubleClick(within(table()).getByText('21'))
		fireEvent.change(screen.getByLabelText('price value'), { target: { value: 'x' } })
		const before = api.executed.length
		fireEvent.keyDown(screen.getByLabelText('price value'), { key: 'Enter' })
		expect(await screen.findByText('price: a number')).toBeTruthy()
		expect(api.executed).toHaveLength(before)
	})

	test('a row added with its properties typed; a row deleted after its confirmation', async () => {
		const api = new DataApi()
		render(<DataTable api={api} schema="shop" entity={PRODUCTS as any} canWrite={true} locale="en" />)
		await waitFor(() => expect(within(table()).getAllByRole('row')).toHaveLength(3))
		fireEvent.click(screen.getByRole('button', { name: '+ Add a row' }))
		const dialog = await screen.findByRole('dialog')
		fireEvent.change(within(dialog).getByLabelText('id'), { target: { value: '3' } })
		fireEvent.change(within(dialog).getByLabelText('name'), { target: { value: 'Aniseed Syrup' } })
		fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
		await waitFor(() => expect(api.executed.some(e => e.query === 'Products.insert()')).toBe(true))
		expect(api.executed.find(e => e.query === 'Products.insert()')!.data).toEqual({ id: 3, name: 'Aniseed Syrup' })
		fireEvent.click(screen.getByRole('button', { name: 'Delete the row 2' }))
		const confirm = await screen.findByRole('dialog')
		expect(confirm.textContent).toContain('{"id":2}')
		fireEvent.click(within(confirm).getByRole('button', { name: 'Delete the row' }))
		await waitFor(() => expect(api.executed.some(e => e.query === 'Products.delete().filter(p => p.id == k_id)')).toBe(true))
		expect(api.executed.find(e => e.query.startsWith('Products.delete'))!.data).toEqual({ k_id: 2 })
	})

	test('export: the page as it is; everything page by page', async () => {
		const saved: { name: string, type: string }[] = []
		const create = vi.fn(() => 'blob:x')
		Object.assign(URL, { createObjectURL: create, revokeObjectURL: () => undefined })
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved.push({ name: this.download, type: '' }) })
		const api = new DataApi()
		render(<DataTable api={api} schema="shop" entity={PRODUCTS as any} canWrite={false} locale="en" />)
		await waitFor(() => expect(within(table()).getAllByRole('row')).toHaveLength(3))
		fireEvent.click(screen.getByRole('button', { name: 'Export the page xlsx' }))
		await waitFor(() => expect(saved.at(-1)?.name).toBe('Products-page-1.xlsx'))
		expect((create.mock.calls.at(-1) as any)[0].type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
		// everything: pages of 1000 until a short one
		api.answer = query => query.endsWith('.page(1, 1000)') ? Array.from({ length: 1000 }, (_, i) => ({ id: i })) : query.endsWith('.page(2, 1000)') ? [{ id: 1000 }] : []
		fireEvent.click(screen.getByRole('button', { name: 'Export all csv' }))
		await waitFor(() => expect(saved.at(-1)?.name).toBe('Products.csv'))
		expect(api.executed.filter(e => e.query.includes('1000)')).map(e => e.query)).toEqual(['Products.page(1, 1000)', 'Products.page(2, 1000)'])
		vi.restoreAllMocks()
	})

	test('a point: shown with its map, edited as longitude and latitude; a vector: summarized, only in the form of a row', async () => {
		const STORES = { name: 'Stores', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer', required: true }, { name: 'location', type: 'point' }, { name: 'embedding', type: 'vector', length: 3 }] }
		const api = new DataApi()
		api.answer = () => [{ id: 1, location: { type: 'Point', coordinates: [-58.38, -34.6] }, embedding: [0.1, 0.2, 0.3] }]
		render(<DataTable api={api} schema="shop" entity={STORES as any} canWrite={true} locale="en" />)
		await waitFor(() => expect(within(stores()).getAllByRole('row')).toHaveLength(2))
		expect(within(stores()).getByText('[0.1, 0.2, 0.3] (3)')).toBeTruthy()
		expect((screen.getByRole('link', { name: 'location See it on a map' }) as HTMLAnchorElement).href).toContain('mlat=-34.6&mlon=-58.38')
		// a vector is not edited in its cell
		fireEvent.doubleClick(within(stores()).getByText('[0.1, 0.2, 0.3] (3)'))
		expect(screen.queryByLabelText('embedding value')).toBeNull()
		// a point: its longitude and latitude
		fireEvent.doubleClick(within(stores()).getByText('-58.38, -34.6'))
		expect((screen.getByLabelText('location Longitude') as HTMLInputElement).value).toBe('-58.38')
		fireEvent.change(screen.getByLabelText('location Latitude'), { target: { value: '-34.7' } })
		api.answer = query => query.includes('update') ? 1 : []
		fireEvent.keyDown(screen.getByLabelText('location Latitude'), { key: 'Enter' })
		await waitFor(() => expect(api.executed.some(e => e.query.includes('update'))).toBe(true))
		expect(api.executed.find(e => e.query.includes('update'))!.data).toEqual({ v_new: { type: 'Point', coordinates: [-58.38, -34.7] }, v_old: { type: 'Point', coordinates: [-58.38, -34.6] }, k_id: 1 })
		// a new row: the point by its two fields, the vector as JSON checked against its dimensions
		fireEvent.click(screen.getByRole('button', { name: '+ Add a row' }))
		const dialog = await screen.findByRole('dialog')
		fireEvent.change(within(dialog).getByLabelText('id'), { target: { value: '2' } })
		fireEvent.change(within(dialog).getByLabelText('location Longitude'), { target: { value: '2.35' } })
		fireEvent.change(within(dialog).getByLabelText('location Latitude'), { target: { value: '48.85' } })
		fireEvent.change(within(dialog).getByLabelText('embedding'), { target: { value: '[1, 2]' } })
		fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
		expect(await screen.findByText('embedding: 3 numbers (it has 2)')).toBeTruthy()
		fireEvent.change(within(dialog).getByLabelText('embedding'), { target: { value: '[1, 2, 3]' } })
		fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
		await waitFor(() => expect(api.executed.some(e => e.query === 'Stores.insert()')).toBe(true))
		expect(api.executed.find(e => e.query === 'Stores.insert()')!.data).toEqual({ id: 2, location: { type: 'Point', coordinates: [2.35, 48.85] }, embedding: [1, 2, 3] })
	})

	test('a property that keeps files: its name opens it (a signed URL); upload to the storage, then its key in the row; remove', async () => {
		const DOCS = { name: 'Docs', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer', required: true }, { name: 'photo', type: 'string' }] }
		const api = new DataApi() as any
		api.answer = (query: string) => query.includes('update') ? 1 : [{ id: 1, photo: 'shop/Docs/photo/a.png' }]
		api.files = async () => [{ entity: 'Docs', property: 'photo', storage: 'images', maxBytes: 1024, types: ['image/png'] }]
		api.fileUrl = vi.fn(async () => ({ url: 'https://s3/a.png?sig', expiresAt: 'x' }))
		api.fileUpload = vi.fn(async () => ({ key: 'shop/Docs/photo/b.png', url: 'https://s3/b.png?sig', method: 'PUT', headers: { 'Content-Type': 'image/png' }, expiresAt: 'x' }))
		const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
		const put = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 200 }))
		render(<DataTable api={api} schema="shop" entity={DOCS as any} canWrite={true} locale="en" />)
		const button = await screen.findByRole('button', { name: 'photo Open' })
		expect(button.textContent).toContain('a.png')
		fireEvent.click(button)
		await waitFor(() => expect(opened).toHaveBeenCalledWith('https://s3/a.png?sig', '_blank', 'noopener,noreferrer'))
		expect(api.fileUrl).toHaveBeenCalledWith('shop', 'Docs', 'photo', 'shop/Docs/photo/a.png')
		const file = new File([new Uint8Array([1, 2, 3])], 'b.png', { type: 'image/png' })
		fireEvent.change(screen.getByLabelText('photo Upload'), { target: { files: [file] } })
		await waitFor(() => expect(api.executed.some((e: any) => e.query.includes('update'))).toBe(true))
		expect(api.fileUpload).toHaveBeenCalledWith('shop', 'Docs', 'photo', { name: 'b.png', type: 'image/png', size: 3 })
		expect(put).toHaveBeenCalledWith('https://s3/b.png?sig', { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: file })
		expect(api.executed.find((e: any) => e.query.includes('update')).data).toEqual({ v_new: 'shop/Docs/photo/b.png', v_old: 'shop/Docs/photo/a.png', k_id: 1 })
		fireEvent.click(screen.getByRole('button', { name: 'photo Remove the file' }))
		await waitFor(() => expect(api.executed.filter((e: any) => e.query.includes('update'))).toHaveLength(2))
		expect(api.executed.filter((e: any) => e.query.includes('update'))[1].data.v_new).toBeNull()
		vi.restoreAllMocks()
	})
})
