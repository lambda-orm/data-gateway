// A panel of the IDE (docs/FILES_AND_PANELS.md §2): its cards run their queries and show a number, a table or a chart;
// a card is added, edited and removed; the panel is saved as a whole; its cards are checked when they come from a file.
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PanelView } from '../src/components/PanelView'
import { chartOf, niceMax, numberOf } from '../src/domain/panels'
import { cardsOf, parseExport } from '../src/domain/savedItems'
import { FakeApi } from './fakes'

afterEach(cleanup)

describe('the data of a card', () => {
	test('a number: the first value; a chart: the labels of a column and the numeric others', () => {
		expect(numberOf([{ total: 830 }])).toBe(830)
		expect(numberOf(42)).toBe(42)
		const rows = [{ country: 'Germany', orders: 122, freight: '10.5' }, { country: 'France', orders: 77, freight: null }]
		expect(chartOf(rows)).toEqual({ labels: ['Germany', 'France'], series: [{ name: 'orders', values: [122, 77] }, { name: 'freight', values: [10.5, 0] }] })
		expect(chartOf(rows, 'country', ['orders'])).toEqual({ labels: ['Germany', 'France'], series: [{ name: 'orders', values: [122, 77] }] })
		expect([niceMax(122), niceMax(0.3), niceMax(0), niceMax(1000)]).toEqual([200, 0.5, 1, 1000])
	})

	test('cards from a file are checked: an unknown form is a table; one without a query is dropped', () => {
		expect(cardsOf([{ id: 'a', title: 'Orders', query: 'Orders.map(p => ({ n: count(1) }))', form: 'number' }, { id: 'b', query: 'x', form: 'radar', width: 2 }, { id: 'c' }]))
			.toEqual([{ id: 'a', title: 'Orders', query: 'Orders.map(p => ({ n: count(1) }))', form: 'number' }, { id: 'b', title: '', query: 'x', form: 'table', width: 2 }])
		const items = parseExport(JSON.stringify({ format: 'lambdaorm-workspace', version: 1, items: [{ id: 'p', kind: 'panel', schema: 's', name: 'Sales', cards: [{ id: 'a', query: 'q', form: 'bar' }], refresh: 60 }] }))
		expect(items).toMatchObject([{ kind: 'panel', name: 'Sales', refresh: 60, cards: [{ id: 'a', form: 'bar' }] }])
	})
})

describe('the panel', () => {
	const results: Record<string, unknown> = {
		'Orders.map(p => ({ total: count(1) }))': [{ total: 830 }],
		'Customers.map(p => ({ country: p.country, n: count(1) }))': [{ country: 'Germany', n: 11 }, { country: 'France', n: 11 }, { country: 'Brazil', n: 9 }]
	}
	class PanelApi extends FakeApi {
		public ran: string[] = []
		async execute (_schema: string, query: string) { this.ran.push(query); if (!(query in results)) throw new Error('Nope is not an entity'); return results[query] as any }
	}

	test('its cards: a number, a chart with its bars; a card that fails says why', async () => {
		const api = new PanelApi()
		render(<PanelView api={api} schema="shop" locale="en" culture="en-US" onSave={async () => undefined} content={{
			cards: [
				{ id: '1', title: 'Orders', query: 'Orders.map(p => ({ total: count(1) }))', form: 'number' },
				{ id: '2', title: 'By country', query: 'Customers.map(p => ({ country: p.country, n: count(1) }))', form: 'bar' },
				{ id: '3', title: 'Broken', query: 'Nope', form: 'table' }
			]
		}} />)
		const orders = screen.getByRole('region', { name: 'Orders' })
		await waitFor(() => expect(orders.textContent).toContain('830'))
		const chart = await screen.findByRole('img', { name: 'By country' })
		expect(chart.querySelectorAll('rect')).toHaveLength(3)
		expect(within(screen.getByRole('region', { name: 'Broken' })).getByRole('alert').textContent).toBe('Nope is not an entity')
		// refresh: every card runs again
		fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
		await waitFor(() => expect(api.ran.filter(q => q.startsWith('Orders'))).toHaveLength(2))
	})

	test('a card added, edited and shown; the panel saved as a whole', async () => {
		const api = new PanelApi()
		const saved = vi.fn(async () => undefined)
		render(<PanelView api={api} schema="shop" locale="en" onSave={saved} content={{ cards: [] }} />)
		expect(screen.getByText('No cards yet: add one with a query and how to show it.')).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: '+ Card' }))
		const card = screen.getByRole('region', { name: 'Title 1' })
		fireEvent.change(within(card).getByLabelText('Title'), { target: { value: 'Orders' } })
		fireEvent.change(within(card).getByLabelText('Query'), { target: { value: 'Orders.map(p => ({ total: count(1) }))' } })
		fireEvent.change(within(card).getByLabelText('Shown as'), { target: { value: 'number' } })
		fireEvent.click(within(card).getByRole('button', { name: 'Done' }))
		await waitFor(() => expect(screen.getByRole('region', { name: 'Orders' }).textContent).toContain('830'))
		fireEvent.change(screen.getByLabelText('Auto-refresh'), { target: { value: '60' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save' }))
		await waitFor(() => expect(saved).toHaveBeenCalled())
		expect(saved.mock.calls[0]).toEqual([{ refresh: 60, cards: [expect.objectContaining({ title: 'Orders', query: 'Orders.map(p => ({ total: count(1) }))', form: 'number' })] }])
	})
})
