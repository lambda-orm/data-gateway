import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DomainInfo, edgesOf, foreignKeysOf, hubOf, neighbourhood, typeText, boxSize, routeOrthogonal } from '../src/domain/diagram'
import { elkLayout, LayoutPort } from '../src/infrastructure/elkLayout'
import { DomainDiagram } from '../src/components/DomainDiagram'
import { QueryTabs } from '../src/components/QueryTabs'
import { FakeApi } from './fakes'

vi.mock('../src/infrastructure/monaco/monacoSetup', () => ({
	loadMonaco: () => Promise.reject(new Error('no browser')),
	setSchemaTypings: () => Promise.resolve()
}))

afterEach(cleanup)

// Northwind-like: Orders has details (manyToOne, a list) and a customer (oneToMany, one row); the details point back
const DOMAIN: DomainInfo = {
	entities: [
		{ name: 'Customers', primaryKey: ['id'], properties: [{ name: 'id', type: 'string', required: true }, { name: 'name', type: 'string', length: 80 }], relations: [] },
		{
			name: 'Orders', primaryKey: ['id'],
			properties: [{ name: 'id', type: 'integer', autoIncrement: true, required: true }, { name: 'customerId', type: 'string' }],
			relations: [
				{ name: 'customer', type: 'oneToMany', from: 'customerId', entity: 'Customers', to: 'id' },
				{ name: 'details', type: 'manyToOne', from: 'id', entity: 'OrderDetails', to: 'orderId' }
			]
		},
		{
			name: 'OrderDetails', primaryKey: ['orderId', 'productId'],
			properties: [{ name: 'orderId', type: 'integer' }, { name: 'productId', type: 'integer' }],
			relations: [
				{ name: 'order', type: 'oneToMany', from: 'orderId', entity: 'Orders', to: 'id' },
				{ name: 'product', type: 'oneToMany', from: 'productId', entity: 'Products', to: 'id' }
			]
		},
		{ name: 'Products', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }], relations: [] },
		{ name: 'Lonely', properties: [{ name: 'x', type: 'boolean' }] },
		{ name: 'Base', abstract: true, properties: [{ name: 'created', type: 'dateTime' }] },
		{ name: 'Extended', extends: 'Base', properties: [{ name: 'y', type: 'integer' }] }
	]
}

describe('diagram (domain)', () => {
	test('one line per relation, both sides together; foreign keys; inheritance', () => {
		const edges = edgesOf(DOMAIN)
		expect(edges.map(e => e.id).sort()).toEqual([
			'extends:Base>Extended',
			'rel:Customers.id>Orders.customerId',
			'rel:Orders.id>OrderDetails.orderId',
			'rel:Products.id>OrderDetails.productId'
		])
		expect(edges.find(e => e.id === 'rel:Orders.id>OrderDetails.orderId')?.names).toEqual(['Orders.details', 'OrderDetails.order'])
		expect(edges.find(e => e.id === 'rel:Customers.id>Orders.customerId')?.childCardinality).toBe('N')
		expect([...foreignKeysOf(edges).get('OrderDetails')!]).toEqual(['orderId', 'productId'])
	})

	test('neighbours, hub, type text and box size', () => {
		const edges = edgesOf(DOMAIN)
		expect(hubOf(DOMAIN, edges)).toBe('OrderDetails')
		expect([...neighbourhood(DOMAIN, edges, 'Customers', 1)].sort()).toEqual(['Customers', 'Orders'])
		expect([...neighbourhood(DOMAIN, edges, 'Customers', 2)].sort()).toEqual(['Customers', 'OrderDetails', 'Orders'])
		expect(neighbourhood(DOMAIN, edges, 'Customers', 'all').size).toBe(7)
		expect(typeText({ name: 'id', type: 'integer', autoIncrement: true })).toBe('integer · auto')
		expect(typeText({ name: 'name', type: 'string', length: 80 })).toBe('string(80)')
		expect(boxSize(DOMAIN.entities[0], true).height).toBeLessThan(boxSize(DOMAIN.entities[0], false).height)
	})

	test('lines between boxes placed by hand: at the rows of the fields, and where a line was moved to', () => {
		const edges = edgesOf(DOMAIN).filter(e => e.id === 'rel:Customers.id>Orders.customerId')
		const entities = new Map(DOMAIN.entities.map(e => [e.name, e]))
		const boxes = new Map([['Customers', { x: 0, y: 0, width: 150, height: 70 }], ['Orders', { x: 300, y: 100, width: 150, height: 70 }]])
		// from the right of Customers at its row "id" (1st) to the left of Orders at "customerId" (2nd)
		expect(routeOrthogonal(edges, boxes, entities, false).get(edges[0].id)).toEqual([{ x: 150, y: 39 }, { x: 225, y: 39 }, { x: 225, y: 157 }, { x: 300, y: 157 }])
		// moved to x 500: it leaves Customers by the right and enters Orders by the right
		expect(routeOrthogonal(edges, boxes, entities, false, { [edges[0].id]: 500 }).get(edges[0].id)).toEqual([{ x: 150, y: 39 }, { x: 500, y: 39 }, { x: 500, y: 157 }, { x: 450, y: 157 }])
	})

	test('ELK places every box and routes every line', async () => {
		const edges = edgesOf(DOMAIN)
		const result = await elkLayout({
			nodes: DOMAIN.entities.map(e => ({ id: e.name, ...boxSize(e, false) })),
			edges: edges.map(e => ({ id: e.id, source: e.parent, target: e.child }))
		})
		expect(result.nodes.size).toBe(7)
		expect(result.edges.get('rel:Customers.id>Orders.customerId')!.length).toBeGreaterThanOrEqual(2)
		// parents on the left
		expect(result.nodes.get('Customers')!.x).toBeLessThan(result.nodes.get('Orders')!.x)
	}, 20000)
})

/** A layout without ELK: a row of boxes, straight lines */
const rowLayout: LayoutPort = async ({ nodes, edges }) => {
	const at = new Map(nodes.map((n, i) => [n.id, { x: i * 300, y: 0 }]))
	return { nodes: at, edges: new Map(edges.map(e => [e.id, [at.get(e.source)!, at.get(e.target)!]])), width: nodes.length * 300, height: 200 }
}

class DomainApi extends FakeApi {
	async domain () { return DOMAIN }
}

describe('DomainDiagram', () => {
	test('the outline: hidden at first; its button shows the whole drawing small with a frame on what the view shows, and hides it', async () => {
		const { container } = render(<DomainDiagram api={new DomainApi()} schema="northwind/v1" layout={rowLayout} />)
		await waitFor(() => expect(container.querySelectorAll('.lw-entity').length).toBeGreaterThan(0))
		expect(container.querySelector('.lw-outline')).toBeNull()
		const button = screen.getByRole('button', { name: 'outline: the whole diagram' })
		fireEvent.click(button)
		expect(button.getAttribute('aria-pressed')).toBe('true')
		const outline = container.querySelector('.lw-outline')!
		expect(outline.querySelectorAll('.lw-entity').length).toBe(container.querySelectorAll('.lw-diagram-svg .lw-entity').length)
		expect(outline.querySelector('.lw-outline-frame')).toBeTruthy()
		fireEvent.click(button)
		expect(container.querySelector('.lw-outline')).toBeNull()
	})

	test('starts on the hub and its neighbours; a click moves the focus, a double click queries', async () => {
		const onQuery = vi.fn()
		const { container } = render(<DomainDiagram api={new DomainApi()} schema="northwind/v1" layout={rowLayout} onQuery={onQuery} />)
		await waitFor(() => expect(container.querySelectorAll('[data-entity]')).toHaveLength(3))
		expect([...container.querySelectorAll('[data-entity]')].map(e => e.getAttribute('data-entity')).sort()).toEqual(['OrderDetails', 'Orders', 'Products'])
		expect(screen.getByText('entities: 3 · relations: 2')).toBeTruthy()
		expect(container.querySelector('[data-entity=Orders]')!.textContent).toContain('FKcustomerId')
		fireEvent.click(container.querySelector('[data-entity=Orders]')!)
		await waitFor(() => expect(container.querySelector('[data-entity=Customers]')).toBeTruthy())
		fireEvent.doubleClick(container.querySelector('[data-entity=Customers]')!)
		expect(onQuery).toHaveBeenCalledWith('northwind/v1', 'Customers')
		fireEvent.change(screen.getByRole('combobox', { name: 'depth' }), { target: { value: 'all' } })
		await waitFor(() => expect(container.querySelectorAll('[data-entity]')).toHaveLength(7))
		expect(container.querySelectorAll('[data-edge]')).toHaveLength(4)
	})

	test('the options of the diagram of an entity, several at once: relation names, related entities, extended entities', async () => {
		// as Ilusor: the completed domain without extends nor abstracts; the lambdaORM.yaml with Areas → Located → Audited
		const completed: DomainInfo = {
			entities: [
				{ name: 'Locations', primaryKey: ['id'], properties: [{ name: 'id', type: 'string' }], relations: [] },
				{ name: 'Areas', primaryKey: ['locationId', 'code'], properties: [{ name: 'code', type: 'string' }, { name: 'locationId', type: 'string' }, { name: 'createdAt', type: 'dateTime' }],
					relations: [{ name: 'location', type: 'oneToMany', from: 'locationId', entity: 'Locations', to: 'id' }] },
				{ name: 'Zones', primaryKey: ['locationId', 'code'], properties: [{ name: 'code', type: 'string' }, { name: 'locationId', type: 'string' }, { name: 'createdAt', type: 'dateTime' }],
					relations: [{ name: 'location', type: 'oneToMany', from: 'locationId', entity: 'Locations', to: 'id' }] }
			]
		}
		const source = [
			{ name: 'Audited', abstract: true, properties: [{ name: 'createdAt', type: 'dateTime' }] },
			{ name: 'Located', abstract: true, extends: 'Audited', properties: [{ name: 'locationId' }], relations: [{ name: 'location', type: 'oneToMany', from: 'locationId', entity: 'Locations', to: 'id' }] },
			{ name: 'Areas', extends: 'Located', properties: [{ name: 'code' }] },
			{ name: 'Zones', extends: 'Located', properties: [{ name: 'code' }] },
			{ name: 'Locations', properties: [{ name: 'id' }] }
		]
		class IlusorApi extends FakeApi { async domain () { return completed } }
		const { container } = render(<DomainDiagram api={new IlusorApi()} schema="ilusor" layout={rowLayout} focus="Areas" options source={source as any} />)
		const shown = () => [...container.querySelectorAll('.lw-diagram-svg [data-entity]')].map(e => e.getAttribute('data-entity')).sort()
		await waitFor(() => expect(shown()).toEqual(['Areas', 'Locations']))
		// one list of choices, several at once; the check of the names is in it
		const group = screen.getByRole('group', { name: 'options' })
		const option = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement
		expect([...group.querySelectorAll('label')].map(l => l.textContent?.trim())).toEqual(['relation names', 'related entities', 'extended entities'])
		expect([option('relation names').checked, option('related entities').checked, option('extended entities').checked]).toEqual([false, true, false])
		// the entities it extends, up its chain (not the other entities of the same base: Zones)
		fireEvent.click(option('extended entities'))
		await waitFor(() => expect(shown()).toEqual(['Areas', 'Audited', 'Located', 'Locations']))
		expect([...container.querySelectorAll('[data-edge^="extends:"]')].map(e => e.getAttribute('data-edge')).sort()).toEqual(['extends:Audited>Located', 'extends:Located>Areas'])
		expect(container.querySelector('[data-entity=Located]')!.textContent).toContain('Located : Audited')
		// without its related ones: the entity and what it extends
		fireEvent.click(option('related entities'))
		await waitFor(() => expect(shown()).toEqual(['Areas', 'Audited', 'Located']))
		fireEvent.click(option('related entities'))
		fireEvent.click(option('relation names'))
		await waitFor(() => expect(container.querySelector('.lw-line-name')?.textContent).toBe('location'))
		expect(screen.getByText('(3)')).toBeTruthy()
		// open, it closes on a click outside it
		const list = container.querySelector('details.lw-multi-select') as HTMLDetailsElement
		list.open = true
		fireEvent.pointerDown(document.body)
		expect(list.open).toBe(false)
	})

	test('in Spanish; an api without domain says so', async () => {
		const api = new FakeApi()
		render(<DomainDiagram api={api} schema="northwind/v1" layout={rowLayout} locale="es" />)
		expect((await screen.findByRole('alert')).textContent).toBe('este gateway no da el dominio')
		expect(screen.getByRole('option', { name: 'todo el modelo' })).toBeTruthy()
	})
})

describe('QueryTabs with the diagram', () => {
	test('the Model tab is first and fixed; a double click opens a tab querying the entity', async () => {
		const { container } = render(<QueryTabs api={new DomainApi()} history={false} diagram />)
		expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Model', 'Query 1'])
		fireEvent.click(screen.getByRole('tab', { name: 'Model' }))
		await waitFor(() => expect(container.querySelector('[data-entity=Orders]')).toBeTruthy(), { timeout: 20000 })
		fireEvent.doubleClick(container.querySelector('[data-entity=Orders]')!)
		expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Model', 'Query 1', 'Orders'])
		const panel = screen.getByRole('tabpanel', { name: 'Orders' })
		expect((panel.querySelector('textarea[aria-label=query]') as HTMLTextAreaElement).value).toBe('Orders.page(1, 10)')
		await waitFor(() => expect((panel.querySelector('select[aria-label=schema]') as HTMLSelectElement).value).toBe('northwind/v1'))
	}, 30000)
})
