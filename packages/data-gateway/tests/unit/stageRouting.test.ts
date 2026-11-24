// Where the entities of a stage go (the stage diagram of the UI), routed as λORM routes a sentence: the first source of
// the stage whose condition is true, a last one without condition for the rest.
import { expressions } from '3xpr'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { stageRoutingOf } from '../../src/lib/domain/admin/stageRouting'

const evaluate = (expression: string, data: any) => expressions.eval(expression, data)

const schema = {
	domain: {
		entities: [
			{ name: 'Base', abstract: true },
			{ name: 'Products' },
			{ name: 'Orders' },
			{ name: 'Customers' },
			{ name: 'Sales', view: true }
		]
	},
	infrastructure: {
		mappings: [
			{ name: 'base', entities: [{ name: 'Products', mapping: 'TBL_PRODUCTS' }] },
			{ name: 'docs', extends: 'base', entities: [{ name: 'Orders', mapping: 'orders' }] }
		],
		sources: [
			{ name: 'documents', dialect: 'MongoDB', mapping: 'docs' },
			{ name: 'replica', dialect: 'PostgreSQL', mapping: 'base' },
			{ name: 'main', dialect: 'PostgreSQL', mapping: 'base' }
		],
		stages: [
			{
				name: 'default',
				sources: [
					{ name: 'documents', condition: 'entity.in(["Orders","Products"])' },
					{ name: 'replica', condition: 'read && entity == "Customers"' },
					{ name: 'main' }
				]
			},
			{ name: 'strict', sources: [{ name: 'main', condition: 'entity == "Orders"' }, { name: 'replica', condition: 'entity.in([' }] }
		]
	}
}

describe('the routing of a stage', () => {
	test('each source in its order with its condition, the entities living in it with their table by its mapping', () => {
		const routing = stageRoutingOf(schema, 'default', evaluate)!
		expect(routing.sources.map(s => [s.name, s.dialect, s.mapping, s.condition])).toEqual([
			['documents', 'MongoDB', 'docs', 'entity.in(["Orders","Products"])'],
			['replica', 'PostgreSQL', 'base', 'read && entity == "Customers"'],
			['main', 'PostgreSQL', 'base', undefined]
		])
		// the mapping of documents extends base: Products takes its table from there; the abstract entity has none
		expect(routing.sources[0].entities).toEqual([{ entity: 'Products', table: 'TBL_PRODUCTS' }, { entity: 'Orders', table: 'orders' }])
		// replica takes only the reads of Customers: Customers lives in main, and its reads go to replica
		expect(routing.sources[1].entities).toEqual([])
		expect(routing.sources[2].entities).toEqual([{ entity: 'Customers', table: 'Customers', read: 'replica' }, { entity: 'Sales', table: 'Sales', view: true }])
		expect(routing.unrouted).toEqual([])
	})

	test('a condition that does not evaluate is false and said; what no source takes, told', () => {
		const routing = stageRoutingOf(schema, 'strict', evaluate)!
		expect(routing.sources[0].entities.map(e => e.entity)).toEqual(['Orders'])
		expect(routing.sources[1].error).toEqual(expect.any(String))
		expect(routing.unrouted).toEqual(['Products', 'Customers', 'Sales'])
	})

	test('a stage that is not in the schema', () => {
		expect(stageRoutingOf(schema, 'nowhere', evaluate)).toBeUndefined()
		expect(stageRoutingOf({}, 'default', evaluate)).toBeUndefined()
	})

	test('the stage of Ilusor: every entity in the source its list names', () => {
		const ilusor: any = yaml.load(fs.readFileSync(path.join(__dirname, '../fixtures/ilusor/lambdaORM.yaml'), 'utf8'))
		const routing = stageRoutingOf(ilusor, 'default', evaluate)!
		expect(routing.sources.every(s => !s.error)).toBe(true)
		const common = routing.sources.find(s => s.name === 'common')!
		expect(common.entities.map(e => e.entity).sort()).toEqual(['Countries', 'Currencies', 'DocumentTypes', 'Languages'])
		const routed = routing.sources.flatMap(s => s.entities.map(e => e.entity))
		expect(new Set(routed).size).toBe(routed.length)
	})
})
