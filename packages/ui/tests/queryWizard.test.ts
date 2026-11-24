// The query wizard as logic: the tables joined by their relations (to one: columns; to many: include), the fields,
// the filter, the order and the page; what is empty is not applied.
import { describe, expect, test } from 'vitest'
import { columnsOf, emptyWizard, joinOf, queryOf, WizardState, wizardFromQuery, wizardOf, withoutTable } from '../src/domain/queryWizard'
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

	test('a relation to one: an include of its own with its fields, also two relations away; the map of the root, its fields', () => {
		let state = add(emptyWizard('Orders.details'), 'Products')
		state = add(state, 'Categories')
		state = { ...state, fields: { 'Orders.details': ['quantity'], Products: ['name'], Categories: ['name'] }, sort: [{ column: 'quantity', desc: false }] }
		expect(columnsOf(state, domain).map(c => c.alias)).toEqual(['quantity'])
		expect(queryOf(state, domain)).toBe([
			'Orders.details',
			'\t.include(p => p.product.include(q => q.category.map(r => ({ name: r.name }))).map(q => ({ name: q.name })))',
			'\t.map(p => ({ quantity: p.quantity }))',
			'\t.sort(p => p.quantity)'
		].join('\n'))
	})

	test('relations to one and to many: an include each, in one list', () => {
		let state = add(emptyWizard('Orders'), 'Customers')
		state = add(state, 'Orders.details')
		state = add(state, 'Products')
		state = { ...state, fields: { Orders: ['id'], Customers: ['name'], 'Orders.details': ['quantity'], Products: ['name'] } }
		expect(state.tables.map(t => `${t.from}.${t.relation}`)).toEqual(['Orders.customer', 'Orders.details', 'Orders.details.product'])
		expect(queryOf(state, domain)).toBe([
			'Orders',
			'\t.include(p => [p.customer.map(q => ({ name: q.name })), p.details.include(q => q.product.map(r => ({ name: r.name }))).map(q => ({ quantity: q.quantity }))])',
			'\t.map(p => ({ id: p.id }))'
		].join('\n'))
	})

	test('a table joins by a relation of any table of the wizard (to one or to many); without one, it can\'t', () => {
		// Categories has no relations: nothing joins it
		expect(joinOf(domain, emptyWizard('Categories'), 'Products')).toBeUndefined()
		let state = add(emptyWizard('Customers'), 'Orders')
		state = add(state, 'Orders.details')
		state = add(state, 'Products')
		state = add(state, 'Categories')
		expect(state.tables.map(t => `${t.from}.${t.relation}`)).toEqual(['Customers.orders', 'Orders.details', 'Orders.details.product', 'Products.category'])
		expect(queryOf({ ...state, fields: { Categories: ['name'] } }, domain)).toBe(
			'Customers\n\t.include(p => p.orders.include(q => q.details.include(r => r.product.include(s => s.category.map(t => ({ name: t.name }))))))')
	})

	test('a table taken out takes those reached from it and their fields; the order of the root stays', () => {
		let state = add(emptyWizard('Orders.details'), 'Products')
		state = add(state, 'Categories')
		state = { ...state, fields: { 'Orders.details': ['quantity'], Products: ['name'], Categories: ['name'] }, sort: [{ column: 'quantity', desc: false }] }
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

	test('a query it wrote is read back as the same wizard', () => {
		let state = add(emptyWizard('Orders'), 'Customers')
		state = add(state, 'Orders.details')
		state = add(state, 'Products')
		state = { ...state, fields: { Orders: ['id', 'orderDate'], Customers: ['name'], Products: ['name'] }, filter: 'p.orderDate > from && p.customer.country == "AR"',
			sort: [{ column: 'orderDate', desc: true }, { column: 'id', desc: false }], page: { number: '2', size: '20' } }
		const reading = wizardFromQuery(queryOf(state, domain), domain)
		expect(reading?.unread).toEqual([])
		expect(reading?.state).toEqual(state)
	})

	test('a query written by hand: other variables, one line, asc and desc as methods', () => {
		const reading = wizardFromQuery('Orders.details.include(x => x.product.map(y => ({ name: y.name }))).filter(o => o.quantity > 5 && o.product.name.startsWith("Ch")).map(d => ({ productId: d.productId, quantity: d.quantity })).sort(d => [d.quantity.desc(), asc(d.productId)]).page(1,10)', domain)
		expect(reading?.unread).toEqual([])
		expect(reading?.state).toEqual({
			root: 'Orders.details', tables: [{ entity: 'Products', from: 'Orders.details', relation: 'product' }],
			fields: { Products: ['name'], 'Orders.details': ['productId', 'quantity'] }, filter: 'p.quantity > 5 && p.product.name.startsWith("Ch")',
			sort: [{ column: 'quantity', desc: true }, { column: 'productId', desc: false }], page: { number: '1', size: '10' }
		})
	})

	test('what the wizard can\'t show is told, and the rest is read', () => {
		const reading = wizardFromQuery('Orders.include(p => [p.customer.filter(q => q.country == "AR"), p.details]).map(p => ({ id: p.id, customerName: p.customer.name })).sort(p => p.total).groupBy(p => p.id)', domain)
		expect(reading?.state.tables.map(t => t.entity)).toEqual(['Customers', 'Orders.details'])
		expect(reading?.state.fields).toEqual({ Orders: ['id'] })
		expect(reading?.unread).toEqual(['p.customer.filter(q => q.country == "AR")', '.map(p => ({ customerName: p.customer.name }))', '.groupBy(p => p.id)', '.sort(p => p.total)'])
	})

	test('the query of the issue: the fields of a relation in the map of the root are told, the rest is read', () => {
		const devices: DomainInfo = { entities: [
			{ name: 'DeviceModels', properties: [{ name: 'id' }, { name: 'brand' }, { name: 'model' }, { name: 'deviceTypeId' }],
				relations: [{ name: 'devices', type: 'manyToOne', from: 'id', entity: 'Devices', to: 'deviceModelId' }, { name: 'deviceType', type: 'oneToMany', from: 'deviceTypeId', entity: 'DeviceTypes', to: 'id' }] },
			{ name: 'Devices', properties: [{ name: 'id' }, { name: 'name' }, { name: 'serialNumber' }, { name: 'deviceModelId' }], relations: [] },
			{ name: 'DeviceTypes', properties: [{ name: 'id' }, { name: 'name' }], relations: [] }
		] }
		const reading = wizardFromQuery('DeviceModels\n\t.include(p => p.devices.map(q => ({ name: q.name, serialNumber: q.serialNumber })))\n\t.map(p => ({ brand: p.brand, model: p.model, deviceTypeName: p.deviceType.name }))', devices)
		expect(reading?.state.tables).toEqual([{ entity: 'Devices', from: 'DeviceModels', relation: 'devices' }])
		expect(reading?.state.fields).toEqual({ Devices: ['name', 'serialNumber'], DeviceModels: ['brand', 'model'] })
		expect(reading?.unread).toEqual(['.map(p => ({ deviceTypeName: p.deviceType.name }))'])
	})

	test('a query that doesn\'t start from an entity is not read', () => {
		expect(wizardFromQuery('Unknown.map(p => p.id)', domain)).toBeUndefined()
		expect(wizardFromQuery('', domain)).toBeUndefined()
		expect(wizardFromQuery('Orders', domain)).toEqual({ state: emptyWizard('Orders'), unread: [] })
	})
})
