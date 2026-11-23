import { describe, expect, test } from 'vitest'
import { diagramQuery, formatQuery } from '../src/domain/queryFormat'

const DOMAIN = {
	entities: [
		{ name: 'DeviceModels', properties: [], relations: [{ name: 'deviceType', type: 'oneToMany', from: 'deviceTypeCode', entity: 'DeviceTypes', to: 'code' }, { name: 'prices', type: 'manyToOne', from: 'code', entity: 'DeviceModelPrices', to: 'deviceModelId' }, { name: 'virtuals', type: 'manyToOne', from: 'code', entity: 'DeviceModelVirtuals', to: 'deviceModelId' }] },
		{ name: 'DeviceTypes', properties: [], relations: [{ name: 'category', type: 'oneToMany', from: 'categoryId', entity: 'Categories', to: 'id' }, { name: 'deviceModels', type: 'manyToOne', from: 'code', entity: 'DeviceModels', to: 'deviceTypeCode' }] },
		{ name: 'DeviceModelPrices', properties: [], relations: [{ name: 'deviceModel', type: 'oneToMany', from: 'deviceModelId', entity: 'DeviceModels', to: 'code' }] },
		{ name: 'DeviceModelVirtuals', properties: [], relations: [] },
		{ name: 'Categories', properties: [], relations: [] },
		{ name: 'Alone', properties: [], relations: [] }
	]
}

describe('the query of a diagram', () => {
	test('its root (the most connected) with the others included through their relations, nested, each once', () => {
		expect(diagramQuery(DOMAIN, ['DeviceTypes', 'DeviceModels', 'DeviceModelPrices', 'Categories'])).toBe(
			'DeviceModels\n\t.include(p => [p.deviceType.include(q => q.category), p.prices])')
		// the box chosen is the root
		expect(diagramQuery(DOMAIN, ['DeviceTypes', 'DeviceModels'], 'DeviceTypes')).toBe('DeviceTypes\n\t.include(p => p.deviceModels)')
		expect(diagramQuery(DOMAIN, ['Alone'])).toBe('Alone')
	})
})

describe('a query written to be read', () => {
	test('each clause on its line; a list that does not fit, one item per line; the strings kept', () => {
		expect(formatQuery('Products.filter(p=>p.price>10&&p.name=="a, b").map(p=>[p.id,p.name]).page(1,10)')).toBe(
			'Products\n\t.filter(p => p.price > 10 && p.name == "a, b")\n\t.map(p => [p.id, p.name])\n\t.page(1, 10)')
		const long = 'Orders.include(p=>[p.customer.include(q=>q.country),p.details.include(q=>q.product.map(r=>[r.name,r.price]))])'
		const once = formatQuery(long)
		expect(once).toBe('Orders\n\t.include(p => [\n\t\tp.customer.include(q => q.country),\n\t\tp.details.include(q => q.product.map(r => [r.name, r.price]))\n\t])')
		// twice, the same
		expect(formatQuery(once)).toBe(once)
		expect(formatQuery('  ')).toBe('')
	})
})
