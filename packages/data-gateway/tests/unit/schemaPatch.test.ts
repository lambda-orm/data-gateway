// One change of one element of a schema, as the forms of the UI send it (docs/DATA_GATEWAY_ADMIN_PLAN.md §2.3).
import { applyPatch, elementAt, PatchError, referencesOf } from '../../src/lib/domain/admin/schemaPatch'

const SCHEMA = {
	domain: {
		entities: [
			{ name: 'Categories', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }, { name: 'name' }], relations: [{ name: 'products', type: 'manyToOne', from: 'id', entity: 'Products', to: 'categoryId', target: 'category' }] },
			{ name: 'Products', primaryKey: ['id'], uniqueKey: ['name'], indexes: [{ name: 'byCategory', fields: ['categoryId'] }], properties: [{ name: 'id' }, { name: 'name' }, { name: 'categoryId' }, { name: 'state', enum: 'States' }], relations: [{ name: 'category', from: 'categoryId', entity: 'Categories', to: 'id', target: 'products' }] }
		],
		enums: [{ name: 'States', values: [{ name: 'on', value: 1 }] }]
	},
	infrastructure: {
		mappings: [{ name: 'default', entities: [{ name: 'Products', mapping: 'products', properties: [{ name: 'categoryId', mapping: 'category_id' }] }] }],
		sources: [{ name: 'main', dialect: 'PostgreSQL', mapping: 'default' }],
		stages: [{ name: 'default', sources: [{ name: 'main' }] }]
	}
}

describe('one change of one element', () => {
	test('elements by names; set keeps the name', () => {
		expect(elementAt(SCHEMA, ['domain', 'entities', 'Products', 'properties', 'state'])?.value).toEqual({ name: 'state', enum: 'States' })
		const { schema } = applyPatch(SCHEMA, { op: 'set', at: ['domain', 'entities', 'Products', 'properties', 'name'], value: { name: 'name', length: 120 }, expected: { name: 'name' } })
		expect(elementAt(schema, ['domain', 'entities', 'Products', 'properties', 'name'])?.value).toEqual({ name: 'name', length: 120 })
		expect(elementAt(SCHEMA, ['domain', 'entities', 'Products', 'properties', 'name'])?.value).toEqual({ name: 'name' })
		expect(() => applyPatch(SCHEMA, { op: 'set', at: ['domain', 'entities', 'Products', 'properties', 'name'], value: { name: 'title' } })).toThrow(/rename/)
	})

	test('another value than the one read is a conflict, with what there is now', () => {
		try {
			applyPatch(SCHEMA, { op: 'set', at: ['domain', 'entities', 'Products', 'properties', 'name'], value: { name: 'name' }, expected: { name: 'name', length: 10 } })
			throw new Error('no conflict')
		} catch (error) {
			expect(error).toBeInstanceOf(PatchError)
			expect(error).toMatchObject({ kind: 'conflict', current: { name: 'name' } })
		}
	})

	test("add: a new item, a list created when it isn't there, a name taken refused", () => {
		const { schema } = applyPatch(SCHEMA, { op: 'add', at: ['domain', 'entities', 'Categories', 'indexes'], value: { name: 'byName', fields: ['name'] } })
		expect(elementAt(schema, ['domain', 'entities', 'Categories', 'indexes', 'byName'])).toBeDefined()
		expect(() => applyPatch(SCHEMA, { op: 'add', at: ['domain', 'entities'], value: { name: 'Products' } })).toThrow(/already has "Products"/)
		expect(() => applyPatch(SCHEMA, { op: 'add', at: ['domain', 'nope', 'x', 'y'], value: { name: 'z' } })).toThrow(PatchError)
		expect(applyPatch({ domain: {} }, { op: 'set', at: ['application'], value: { start: [] } }).schema.application).toEqual({ start: [] })
		expect(applyPatch({ domain: { enums: null } }, { op: 'add', at: ['domain', 'enums'], value: { name: 'E' } }).schema.domain.enums).toEqual([{ name: 'E' }])
	})

	test('rename an entity: relations, mappings', () => {
		const { schema, references } = applyPatch(SCHEMA, { op: 'rename', at: ['domain', 'entities', 'Products'], to: 'Items' })
		expect(schema.domain.entities.map((e: any) => e.name)).toEqual(['Categories', 'Items'])
		expect(schema.domain.entities[0].relations[0].entity).toBe('Items')
		expect(schema.infrastructure.mappings[0].entities[0].name).toBe('Items')
		expect(references).toEqual(['domain/entities/Categories/relations/products', 'infrastructure/mappings/default/entities/Products'])
	})

	test('rename a property: keys, indexes, relations of both sides, mappings', () => {
		const { schema } = applyPatch(SCHEMA, { op: 'rename', at: ['domain', 'entities', 'Products', 'properties', 'categoryId'], to: 'kindId' })
		const products = schema.domain.entities[1]
		expect(products.indexes[0].fields).toEqual(['kindId'])
		expect(products.relations[0].from).toBe('kindId')
		expect(schema.domain.entities[0].relations[0].to).toBe('kindId')
		expect(schema.infrastructure.mappings[0].entities[0].properties[0].name).toBe('kindId')
	})

	test('rename a relation (its target on the other side), an enum, a source, a mapping', () => {
		expect(applyPatch(SCHEMA, { op: 'rename', at: ['domain', 'entities', 'Products', 'relations', 'category'], to: 'kind' }).schema.domain.entities[0].relations[0].target).toBe('kind')
		expect(applyPatch(SCHEMA, { op: 'rename', at: ['domain', 'enums', 'States'], to: 'Status' }).schema.domain.entities[1].properties[3].enum).toBe('Status')
		expect(applyPatch(SCHEMA, { op: 'rename', at: ['infrastructure', 'sources', 'main'], to: 'db' }).schema.infrastructure.stages[0].sources[0].name).toBe('db')
		expect(applyPatch(SCHEMA, { op: 'rename', at: ['infrastructure', 'mappings', 'default'], to: 'pg' }).schema.infrastructure.sources[0].mapping).toBe('pg')
		expect(() => applyPatch(SCHEMA, { op: 'rename', at: ['domain', 'entities', 'Products'], to: 'Categories' })).toThrow(/taken/)
	})

	test('remove says who pointed to it', () => {
		expect(referencesOf(SCHEMA, ['domain', 'enums', 'States'])).toEqual(['domain/entities/Products/properties/state'])
		const { schema, references } = applyPatch(SCHEMA, { op: 'remove', at: ['infrastructure', 'sources', 'main'] })
		expect(schema.infrastructure.sources).toEqual([])
		expect(references).toEqual(['infrastructure/stages/default'])
		expect(() => applyPatch(SCHEMA, { op: 'remove', at: ['domain', 'entities', 'Nope'] })).toThrow(/not in the schema/)
	})

	test('what the schema is: its name, description and version, keys of the top', () => {
		const named = applyPatch(SCHEMA, { op: 'set', at: ['name'], value: 'Shop' }).schema
		expect(named.name).toBe('Shop')
		const described = applyPatch(named, { op: 'set', at: ['description'], value: 'The shop', expected: undefined }).schema
		expect(described.description).toBe('The shop')
		expect(() => applyPatch(described, { op: 'set', at: ['name'], value: 'Store', expected: 'Other' })).toThrow(/changed since/)
		expect(applyPatch(described, { op: 'remove', at: ['name'], expected: 'Shop' }).schema.name).toBeUndefined()
	})
})
