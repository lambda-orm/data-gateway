import { describe, expect, test } from 'vitest'
import { chainBefore, functionsOf, kindOfProperty, lambdaCompletions } from '../src/domain/lambdaCompletion'
import { QUERYABLE_DECLARATIONS } from '../src/infrastructure/monaco/queryableDeclarations.generated'

const DOMAIN = {
	entities: [
		{ name: 'DeviceModels', primaryKey: ['code'], properties: [{ name: 'code', type: 'string' }, { name: 'deviceTypeCode', type: 'string' }, { name: 'virtualCount', type: 'integer' }, { name: 'createdAt', type: 'dateTime' }, { name: 'copier', type: 'json' }, { name: 'enabled', type: 'boolean' }],
			relations: [{ name: 'deviceType', type: 'oneToMany', from: 'deviceTypeCode', entity: 'DeviceTypes', to: 'code' }, { name: 'prices', type: 'manyToOne', from: 'code', entity: 'DeviceModelPrices', to: 'deviceModelId' }] },
		{ name: 'DeviceTypes', primaryKey: ['code'], properties: [{ name: 'code', type: 'string' }, { name: 'name', type: 'string' }], relations: [] },
		{ name: 'DeviceModelPrices', properties: [{ name: 'deviceModelId', type: 'string' }, { name: 'amount', type: 'decimal' }, { name: 'validFrom', type: 'date' }], relations: [] }
	]
}
const FNS = functionsOf(QUERYABLE_DECLARATIONS)
const at = (text: string) => lambdaCompletions(text, DOMAIN, FNS)
const kinds = (text: string) => Object.fromEntries(at(text).map(s => [s.label, s.kind]))

describe('the suggestions of a query', () => {
	test('the functions of λORM read from its declarations, each with the type of what it works on', () => {
		const upper = FNS.find(f => f.name === 'upper')!
		expect(upper).toMatchObject({ params: [{ name: 'value', type: 'string' }], returnType: 'string' })
		expect(FNS.find(f => f.name === 'year')).toMatchObject({ params: [{ type: 'Date' }], returnType: 'number' })
		expect(FNS.find(f => f.name === 'abs')!.description).toBe('Get the absolute value')
	})

	test('the chain before a dot skips the calls: the root and the properties walked', () => {
		const text = 'DeviceModels.include(p => p.prices.filter(q => q.amount > 1).map'
		expect(chainBefore(text, text.length - 4)).toEqual(['p', 'prices'])
		expect(chainBefore('DeviceModels.filter(p => p.code == "x").', 39)).toEqual(['DeviceModels'])
	})

	test('after an entity or a clause: the clauses', () => {
		expect(at('DeviceModels.').map(s => s.label).slice(0, 4)).toEqual(['filter', 'include', 'map', 'first'])
		expect(at('DeviceModels.filter(p => p.enabled).').every(s => s.kind === 'clause')).toBe(true)
	})

	test('a row of a lambda: its properties by their type and its relations (one, or a list)', () => {
		expect(kinds('DeviceModels.map(p => p.')).toMatchObject({
			code: 'string', virtualCount: 'number', createdAt: 'date', copier: 'json', enabled: 'boolean', deviceType: 'relation', prices: 'relations'
		})
		expect(at('DeviceModels.map(p => p.').find(s => s.label === 'deviceType')!.detail).toBe('→ DeviceTypes (deviceTypeCode → code)')
		// through a relation: one entity, or a list with its clauses
		expect(kinds('DeviceModels.map(p => p.deviceType.')).toEqual({ code: 'string', name: 'string' })
		expect(kinds('DeviceModels.include(p => p.prices.')).toMatchObject({ map: 'clause', filter: 'clause', amount: 'number', validFrom: 'date' })
		// a lambda inside a relation: its parameter is a row of the relation
		expect(kinds('DeviceModels.include(p => p.prices.filter(q => q.')).toEqual({ deviceModelId: 'string', amount: 'number', validFrom: 'date' })
	})

	test('a property: the functions of its type, as its methods', () => {
		const ofText = at('DeviceModels.filter(p => p.code.')
		expect(ofText.map(s => s.label)).toEqual(expect.arrayContaining(['upper', 'lower', 'like', 'startsWith']))
		expect(ofText.map(s => s.label)).not.toContain('year')
		expect(ofText.find(s => s.label === 'lpad')).toMatchObject({ kind: 'fn-string', insertText: 'lpad(${1:len}, ${2:pad})', detail: 'lpad(len: number, pad: string): string' })
		const ofDate = at('DeviceModels.filter(p => p.createdAt.')
		expect(ofDate.map(s => s.label)).toEqual(expect.arrayContaining(['year', 'month', 'addDay']))
		expect(ofDate.map(s => s.label)).not.toContain('upper')
	})

	test('not after a dot: the parameters of the lambdas, the entities and every function', () => {
		const inside = at('DeviceModels.map(p => [p.code, ')
		expect(inside[0]).toMatchObject({ label: 'p', kind: 'parameter', detail: 'DeviceModels' })
		expect(inside.find(s => s.label === 'DeviceTypes')).toMatchObject({ kind: 'entity' })
		expect(inside.find(s => s.label === 'year')).toMatchObject({ kind: 'fn-date' })
		expect(inside.find(s => s.label === 'count')).toMatchObject({ kind: 'fn-any' })
	})

	test('the kind of a property of λORM', () => {
		expect([kindOfProperty({ type: 'text' }), kindOfProperty({ type: 'uuid' }), kindOfProperty({ type: 'string', enum: 'States' }), kindOfProperty({})]).toEqual(['string', 'uuid', 'enum', 'string'])
	})
})
