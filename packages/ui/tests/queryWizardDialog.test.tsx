// The query wizard as a dialog: the fields chosen with a click, a table added with the + of another one, a filter, an
// order and a page; the query as it is written, given to whoever opened it. A query edited by hand says it is replaced.
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryWizard } from '../src/components/QueryWizard'
import { DomainInfo } from '../src/domain/diagram'
import { emptyWizard, wizardFromQuery, WizardState } from '../src/domain/queryWizard'
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
	test('fields, a table of a relation (an include), a filter, an order and a page: the query, accepted', async () => {
		const accepted: { state: WizardState, query: string }[] = []
		render(<QueryWizard api={new DomainApi()} schema="northwind/v1" domain={DOMAIN} initial={undefined} layout={rowLayout}
			onClose={() => undefined} onAccept={(state, query) => accepted.push({ state, query })} />)
		const dialog = await screen.findByRole('dialog', { name: 'Query wizard' })
		expect((within(dialog).getByLabelText('start from') as HTMLSelectElement).value).toBe('Customers')
		fireEvent.change(within(dialog).getByLabelText('start from'), { target: { value: 'Orders' } })
		// no map: every field ticked, and the check of its title
		expect((await screen.findByRole('checkbox', { name: 'Orders.orderDate' })).getAttribute('aria-checked')).toBe('true')
		expect(screen.getByRole('checkbox', { name: 'Orders: all properties' }).getAttribute('aria-checked')).toBe('true')
		// the check of the title off: only its primary key; then a click on a field ticks it
		fireEvent.click(screen.getByRole('checkbox', { name: 'Orders: all properties' }))
		expect(screen.getByRole('checkbox', { name: 'Orders.customerId' }).getAttribute('aria-checked')).toBe('false')
		fireEvent.click(screen.getByRole('checkbox', { name: 'Orders.orderDate' }))
		expect(screen.getByRole('checkbox', { name: 'Orders.id' }).getAttribute('aria-checked')).toBe('true')
		expect(screen.getByRole('checkbox', { name: 'Orders: all properties' }).getAttribute('aria-checked')).toBe('false')
		// the + of Orders adds Customers (its relation to one)
		fireEvent.click(screen.getByRole('button', { name: /Orders$/ }))
		const related = await screen.findByRole('dialog', { name: /Orders/ })
		fireEvent.click(within(related).getByRole('checkbox', { name: /Customers/ }))
		fireEvent.click(within(related).getByRole('button', { name: /\(1\)/ }))
		// all of Customers ticked: unticking id leaves name; the last one stays
		fireEvent.click(await screen.findByRole('checkbox', { name: 'Customers.id' }))
		fireEvent.click(screen.getByRole('checkbox', { name: 'Customers.name' }))
		expect(screen.getByRole('checkbox', { name: 'Customers.name' }).getAttribute('aria-checked')).toBe('true')
		fireEvent.change(screen.getByRole('textbox', { name: 'filter' }), { target: { value: 'p.orderDate > from' } })
		fireEvent.click(screen.getByRole('button', { name: '+ add an order' }))
		fireEvent.change(screen.getByLabelText('order 1'), { target: { value: 'orderDate' } })
		fireEvent.change(screen.getByLabelText('order 1 · descending'), { target: { value: 'desc' } })
		fireEvent.change(screen.getByLabelText('rows per page'), { target: { value: '20' } })
		const query = [
			'Orders',
			'\t.filter(p => p.orderDate > from)',
			'\t.include(p => p.customer.map(q => ({ name: q.name })))',
			'\t.map(p => ({ id: p.id, orderDate: p.orderDate }))',
			'\t.sort(p => desc(p.orderDate))',
			'\t.page(1, 20)'
		].join('\n')
		expect((screen.getByRole('textbox', { name: 'the query' }) as HTMLTextAreaElement).value).toBe(query)
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
		expect((screen.getByRole('textbox', { name: 'the query' }) as HTMLTextAreaElement).value).toBe('Orders\n\t.map(p => ({ id: p.id }))')
		expect(screen.getByRole('button', { name: 'update the query' })).toBeTruthy()
	})

	test('a query written by hand: its tables, fields, filter, order and page; what it can\'t show, told', async () => {
		const reading = wizardFromQuery('Orders.filter(o => o.orderDate > from).include(o => o.customer.map(c => ({ name: c.name }))).map(o => ({ id: o.id, orderDate: o.orderDate, total: o.id * 2 })).sort(o => o.orderDate.desc()).page(2, 10)', DOMAIN)
		const accepted: string[] = []
		render(<QueryWizard api={new DomainApi()} schema="northwind/v1" domain={DOMAIN} reading={reading} start="Orders" layout={rowLayout}
			onClose={() => undefined} onAccept={(_, query) => accepted.push(query)} />)
		expect((await screen.findByRole('checkbox', { name: 'Customers.name' })).getAttribute('aria-checked')).toBe('true')
		expect(screen.getByRole('checkbox', { name: 'Orders.orderDate' }).getAttribute('aria-checked')).toBe('true')
		expect((screen.getByLabelText('order 1') as HTMLSelectElement).value).toBe('orderDate')
		expect((screen.getByLabelText('rows per page') as HTMLInputElement).value).toBe('10')
		expect(screen.getByRole('status').textContent).toContain('.map(o => ({ total: o.id * 2 }))')
		// it writes a new query: create, not update
		fireEvent.click(screen.getByRole('button', { name: 'create the query' }))
		expect(accepted[0]).toBe([
			'Orders',
			'\t.filter(p => p.orderDate > from)',
			'\t.include(p => p.customer.map(q => ({ name: q.name })))',
			'\t.map(p => ({ id: p.id, orderDate: p.orderDate }))',
			'\t.sort(p => desc(p.orderDate))',
			'\t.page(2, 10)'
		].join('\n'))
		// another entity to start from: what wasn't read is no longer told
		fireEvent.change(screen.getByLabelText('start from'), { target: { value: 'Customers' } })
		expect(screen.queryByText(/can’t show/)).toBeNull()
	})

	test('a query it wrote, edited by hand: read again from the tab, it updates that query', async () => {
		const initial: WizardState = { ...emptyWizard('Orders'), fields: { Orders: ['id'] } }
		const current = 'Orders.map(p => ({ id: p.id, orderDate: p.orderDate })).page(1, 5)'
		render(<QueryWizard api={new DomainApi()} schema="northwind/v1" domain={DOMAIN} initial={initial} reading={wizardFromQuery(current, DOMAIN)} current={current} layout={rowLayout}
			onClose={() => undefined} onAccept={() => undefined} />)
		expect((await screen.findByRole('checkbox', { name: 'Orders.orderDate' })).getAttribute('aria-checked')).toBe('true')
		expect((screen.getByLabelText('rows per page') as HTMLInputElement).value).toBe('5')
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.getByRole('button', { name: 'update the query' })).toBeTruthy()
	})
})
