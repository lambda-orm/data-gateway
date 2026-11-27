import { describe, expect, test } from 'vitest'
import { inheritanceOf, inheritedByBase } from '../src/domain/inheritance'

// as Ilusor's Cloud: LocatedCatalog → Located → Audited
const entities = [
	{ name: 'Audited', abstract: true, properties: [{ name: 'createdAt', type: 'dateTime' }, { name: 'updatedAt', type: 'dateTime' }] },
	{ name: 'Located', abstract: true, extends: 'Audited', properties: [{ name: 'locationId', length: 36, required: true }], relations: [{ name: 'location', from: 'locationId', entity: 'Locations', to: 'id', weak: true }] },
	{ name: 'LocatedCatalog', abstract: true, extends: 'Located', properties: [{ name: 'code', type: 'text', required: true }, { name: 'name', type: 'text' }] },
	{ name: 'Areas', extends: 'LocatedCatalog', properties: [{ name: 'areaTypeId', type: 'text' }, { name: 'name', type: 'text', required: true }], relations: [{ name: 'location', weak: true, target: 'areas' }] },
	{ name: 'Countries', properties: [{ name: 'code' }] },
	{ name: 'A', extends: 'B', properties: [{ name: 'a' }] },
	{ name: 'B', extends: 'A', properties: [{ name: 'b' }] },
	{ name: 'Orphan', extends: 'Missing', properties: [{ name: 'x' }] }
]

describe('inheritanceOf', () => {
	test('the chain, the nearest first; the own ones first, then the inherited ones by where they come from', () => {
		const inheritance = inheritanceOf(entities, 'Areas')
		expect(inheritance.bases).toEqual(['LocatedCatalog', 'Located', 'Audited'])
		expect(inheritance.properties.map(i => [i.row.name, i.from])).toEqual([
			['areaTypeId', 'Areas'], ['name', 'Areas'], ['code', 'LocatedCatalog'], ['locationId', 'Located'], ['createdAt', 'Audited'], ['updatedAt', 'Audited']
		])
	})
	test('an own one with the name of an inherited one redefines it, taking from it what it does not say', () => {
		const inheritance = inheritanceOf(entities, 'Areas')
		expect(inheritance.properties.find(i => i.row.name === 'name')).toEqual({ row: { name: 'name', type: 'text', required: true }, from: 'Areas', redefines: 'LocatedCatalog' })
		expect(inheritance.relations).toEqual([{ row: { name: 'location', from: 'locationId', entity: 'Locations', to: 'id', weak: true, target: 'areas' }, from: 'Areas', redefines: 'Located' }])
	})
	test('the inherited ones, by base: not the own ones nor the redefined ones', () => {
		const inheritance = inheritanceOf(entities, 'Areas')
		expect(inheritedByBase(inheritance, 'properties')).toEqual([
			['LocatedCatalog', [{ name: 'code', type: 'text', required: true }]],
			['Located', [{ name: 'locationId', length: 36, required: true }]],
			['Audited', [{ name: 'createdAt', type: 'dateTime' }, { name: 'updatedAt', type: 'dateTime' }]]
		])
		expect(inheritedByBase(inheritance, 'relations')).toEqual([])
	})
	test('without extends, a cycle, a base that does not exist or no entity: nothing inherited', () => {
		expect(inheritanceOf(entities, 'Countries').bases).toEqual([])
		expect(inheritanceOf(entities, 'A').bases).toEqual(['B'])
		expect(inheritanceOf(entities, 'A').properties.map(i => i.row.name)).toEqual(['a', 'b'])
		expect(inheritanceOf(entities, 'Orphan')).toEqual({ bases: [], properties: [{ row: { name: 'x' }, from: 'Orphan' }], relations: [] })
		expect(inheritanceOf(entities, 'Nope').bases).toEqual([])
		expect(inheritanceOf(undefined, 'Areas').bases).toEqual([])
	})
})
