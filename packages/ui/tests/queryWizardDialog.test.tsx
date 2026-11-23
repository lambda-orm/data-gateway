// The query wizard as a dialog: the fields chosen with a click, a table added with the + of another one, a filter, an
// order and a page; the query as it is written, given to whoever opened it. A query edited by hand says it is replaced.
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryWizard } from '../src/components/QueryWizard'
import { DomainInfo } from '../src/domain/diagram'
import { emptyWizard, WizardState } from '../src/domain/queryWizard'
import type { LayoutPort } from '../src/infrastructure/elkLayout'
import { FakeApi } from './fakes'

vi.mock('../src/infrastructure/monaco/monacoSetup', () => ({
	loadMonaco: () => Promise.reject(new Error('no browser')),
	setSchemaTypings: () => Promise.resolve()
}))

afterEach(cleanup)

const DOMAIN: DomainInfo = {
	entities: [
		{ name: 'Orders', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }, { name: 'customerId', type: 'string' }, { name: 'orderDate', type: 'date' }],
			relations: [{ name: 'customer', type: 'oneToMany', from: 'customerId', entity: 'Customers', to: 'id' }] },
		{ name: 'Customers', primaryKey: ['id'], properties: [{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }],
			relations: [{ name: 'orders', type: 'manyToOne', from: 'id', entity: 'Orders', to: 'customerId' }] }
	]
}

class DomainApi extends FakeApi { async domain () { return DOMAIN } }

const rowLayout: LayoutPort = async ({ nodes, edges }) => {
	const at = new Map(nodes.map((n, i) => [n.id, { x: i * 300, y: 0 }]))
	return { nodes: at, edges: new Map(edges.map(e => [e.id, [at.get(e.source)!, at.get(e.target)!]])), width: nodes.length * 300, height: 200 }
}

describe('QueryWizard', () => {
	test('fields, a table of a relation to one, a filter, an order and a page: the query, accepted', async () => {
		const accepted: { state: WizardState, query: string }[] = []
		render(<QueryWizard api={new DomainApi()} schema="northwind/v1" domain={DOMAIN} initial={undefined} layout={rowLayout}
			onClose={() => undefined} onAccept={(state, query) => accepted.push({ state, query })} />)
		const dialog = await screen.findByRole('dialog', { name: 'Query wizard' })
		expect((within(dialog).getByLabelText('start from') as HTMLSelectElement).value).toBe('Customers')
		fireEvent.change(within(dialog).getByLabelText('start from'), { target: { value: 'Orders' } })
		// a click on a field chooses it
		fireEvent.click(await screen.findByRole('checkbox', { name: 'Orders.orderDate' }))
		fireEvent.click(screen.getByRole('checkbox', { name: 'Orders.id' }))
		expect(screen.getByRole('checkbox', { name: 'Orders.id' }).getAttribute('aria-checked')).toBe('true')
		// the + of Orders adds Customers (its relation to one)
		fireEvent.click(screen.getByRole('button', { name: /Orders$/ }))
		const related = await screen.findByRole('dialog', { name: /Orders/ })
		fireEvent.click(within(related).getByRole('checkbox', { name: /Customers/ }))
		fireEvent.click(within(related).getByRole('button', { name: /\(1\)/ }))
		fireEvent.click(await screen.findByRole('checkbox', { name: 'Customers.name' }))
		fireEvent.change(screen.getByRole('textbox', { name: 'filter' }), { target: { value: 'p.orderDate > from' } })
		fireEvent.click(screen.getByRole('button', { name: '+ add an order' }))
		fireEvent.change(screen.getByLabelText('order 1'), { target: { value: 'customerName' } })
		fireEvent.change(screen.getByLabelText('order 1 · descending'), { target: { value: 'desc' } })
		fireEvent.change(screen.getByLabelText('rows per page'), { target: { value: '20' } })
		const query = [
			'Orders',
			'\t.filter(p => p.orderDate > from)',
			'\t.map(p => ({ id: p.id, orderDate: p.orderDate, customerName: p.customer.name }))',
			'\t.sort(p => desc(p.customerName))',
			'\t.page(1, 20)'
		].join('\n')
		expect(screen.getByLabelText('the query').textContent).toBe(query)
		fireEvent.click(screen.getByRole('button', { name: 'create the query' }))
		expect(accepted[0].query).toBe(query)
		expect(accepted[0].state.tables).toEqual([{ entity: 'Customers', from: 'Orders', relation: 'customer' }])
	})

	test('a field left takes its order; the start can\'t be taken out', async () => {
		const initial: WizardState = { ...emptyWizard('Orders'), fields: { Orders: ['id', 'orderDate'] }, sort: [{ column: 'orderDate', desc: false }] }
		render(<QueryWizard api={new DomainApi()} schema="northwind/v1" domain={DOMAIN} initial={initial} current="Orders" layout={rowLayout}
			onClose={() => undefined} onAccept={() => undefined} />)
		await screen.findByRole('checkbox', { name: 'Orders.orderDate' })
		// the query of the tab is not the one the wizard wrote: updating it replaces it
		expect(screen.getByRole('alert').textContent).toMatch(/edited by hand/)
		expect(screen.queryByRole('button', { name: /remove Orders|take out Orders/i })).toBeNull()
		fireEvent.click(screen.getByRole('checkbox', { name: 'Orders.orderDate' }))
		await waitFor(() => expect(screen.queryByLabelText('order 1')).toBeNull())
		expect(screen.getByLabelText('the query').textContent).toBe('Orders\n\t.map(p => ({ id: p.id }))')
		expect(screen.getByRole('button', { name: 'update the query' })).toBeTruthy()
	})
})
