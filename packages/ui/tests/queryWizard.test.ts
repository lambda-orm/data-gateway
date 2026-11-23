// The query wizard as logic: the tables joined by their relations (to one: columns; to many: include), the fields,
// the filter, the order and the page; what is empty is not applied.
import { describe, expect, test } from 'vitest'
import { columnsOf, emptyWizard, joinOf, queryOf, WizardState, wizardOf, withoutTable } from '../src/domain/queryWizard'
import { DomainInfo } from '../src/domain/diagram'

// λORM names a relation to one oneToMany (this entity has the key) and a relation to many manyToOne
const domain: DomainInfo = {
	entities: [
		{ name: 'Orders', properties: [{ name: 'id' }, { name: 'customerId' }, { name: 'orderDate' }],
			relations: [{ name: 'customer', type: 'oneToMany', from: 'customerId', entity: 'Customers', to: 'id' }, { name: 'details', type: 'manyToOne', from: 'id', entity: 'Orders.details', to: 'orderId' }] },
		{ name: 'Customers', properties: [{ name: 'id' }, { name: 'name' }, { name: 'country' }],
			relations: [{ name: 'orders', type: 'manyToOne', from: 'id', entity: 'Orders', to: 'customerId' }] },
		{ name: 'Orders.details', properties: [{ name: 'orderId' }, { name: 'productId' }, { name: 'quantity' }],
			relations: [{ name: 'product', type: 'oneToMany', from: 'productId', entity: 'Products', to: 'id' }] },
		{ name: 'Products', properties: [{ name: 'id' }, { name: 'name' }, { name: 'categoryId' }],
			relations: [{ name: 'category', type: 'oneToMany', from: 'categoryId', entity: 'Categories', to: 'id' }, { name: 'details', type: 'manyToOne', from: 'id', entity: 'Orders.details', to: 'productId' }] },
		{ name: 'Categories', properties: [{ name: 'id' }, { name: 'name' }], relations: [] }
	]
}

const add = (state: WizardState, entity: string): WizardState => {
	const join = joinOf(domain, state, entity)
	if (!join) throw new Error(`${entity} can't join`)
	return { ...state, tables: [...state.tables, join] }
}

describe('the query wizard', () => {
	test('only the entity: the query reads it all; what is empty is not applied', () => {
		expect(queryOf(emptyWizard('Orders'), domain)).toBe('Orders')
		expect(queryOf({ ...emptyWizard('Orders'), filter: '  ', page: { number: '2', size: '' } }, domain)).toBe('Orders')
	})

	test('fields, a filter, the order and the page', () => {
		const state: WizardState = { ...emptyWizard('Orders'), fields: { Orders: ['id', 'orderDate'] }, filter: 'p.orderDate > from',
			sort: [{ column: 'orderDate', desc: true }, { column: 'id', desc: false }], page: { number: '', size: '20' } }
		expect(queryOf(state, domain)).toBe([
			'Orders',
			'\t.filter(p => p.orderDate > from)',
			'\t.map(p => ({ id: p.id, orderDate: p.orderDate }))',
			'\t.sort(p => [desc(p.orderDate), p.id])',
			'\t.page(1, 20)'
		].join('\n'))
	})

	test('a relation to one: its fields as columns of the row, also two relations away', () => {
		let state = add(emptyWizard('Orders.details'), 'Products')
		state = add(state, 'Categories')
		state = { ...state, fields: { 'Orders.details': ['quantity'], Products: ['name'], Categories: ['name'] }, sort: [{ column: 'productCategoryName', desc: false }] }
		expect(columnsOf(state, domain).map(c => c.alias)).toEqual(['quantity', 'productName', 'productCategoryName'])
		expect(queryOf(state, domain)).toBe([
			'Orders.details',
			'\t.map(p => ({ quantity: p.quantity, productName: p.product.name, productCategoryName: p.product.category.name }))',
			'\t.sort(p => p.productCategoryName)'
		].join('\n'))
	})

	test('a relation to many: an include of its own, with its fields and its relations to one', () => {
		let state = add(emptyWizard('Orders'), 'Customers')
		state = add(state, 'Orders.details')
		state = add(state, 'Products')
		state = { ...state, fields: { Orders: ['id'], Customers: ['name'], 'Orders.details': ['quantity'], Products: ['name'] } }
		expect(state.tables.map(t => `${t.from}.${t.relation}`)).toEqual(['Orders.customer', 'Orders.details', 'Orders.details.product'])
		expect(queryOf(state, domain)).toBe([
			'Orders',
			'\t.include(p => p.details.map(q => ({ quantity: q.quantity, productName: q.product.name })))',
			'\t.map(p => ({ id: p.id, customerName: p.customer.name }))'
		].join('\n'))
	})

	test('a relation to many only from the root or from another one: not through a relation to one', () => {
		const state = add(emptyWizard('Orders.details'), 'Products')
		// Products.details is to many, but Products is reached by a relation to one: it would be no include of its own
		expect(joinOf(domain, { ...state, root: 'Orders.details' }, 'Orders')).toBeUndefined()
		expect(joinOf(domain, state, 'Products')).toBeUndefined()
	})

	test('a table taken out takes those reached from it, their fields and their order', () => {
		let state = add(emptyWizard('Orders.details'), 'Products')
		state = add(state, 'Categories')
		state = { ...state, fields: { 'Orders.details': ['quantity'], Products: ['name'], Categories: ['name'] }, sort: [{ column: 'quantity', desc: false }, { column: 'productName', desc: true }] }
		const out = withoutTable(state, 'Products')
		expect(out.tables).toEqual([])
		expect(out.fields).toEqual({ 'Orders.details': ['quantity'] })
		expect(out.sort).toEqual([{ column: 'quantity', desc: false }])
		expect(withoutTable(state, 'Orders.details')).toBe(state)
	})

	test('kept with a query and read back', () => {
		const state: WizardState = { ...emptyWizard('Orders'), fields: { Orders: ['id'] }, page: { number: '1', size: '10' } }
		expect(wizardOf(JSON.parse(JSON.stringify(state)))).toEqual(state)
		expect(wizardOf({ root: '' })).toBeUndefined()
		expect(wizardOf('nope')).toBeUndefined()
	})
})
