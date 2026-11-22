import { describe, expect, test } from 'vitest'
import { pathAt, schemaCompletions } from '../src/domain/schemaCompletion'

const TEXT = `domain:
  entities:
    - name: Products
      primaryKey: [id]
      properties:
        - name: id
          type: 
        - name: price
      relations:
        - name: category
          entity: 
  enums:
    - name: States
infrastructure:
  sources:
    - name: main
      dialect: 
`

describe('completion of a lambdaORM.yaml', () => {
	const lines = TEXT.split('\n')
	test('the path of keys of a line', () => {
		expect(pathAt(lines, 6, 11)).toEqual(['domain', 'entities', '*', 'properties', '*'])
		expect(pathAt(lines, 3, 7)).toEqual(['domain', 'entities', '*'])
		expect(pathAt(lines, 16, 7)).toEqual(['infrastructure', 'sources', '*'])
	})

	test('values: the types of a property, the entities of a relation, the dialects', () => {
		expect(schemaCompletions(TEXT, 7, 17).map(c => c.label)).toContain('decimal')
		expect(schemaCompletions(TEXT, 11, 19).map(c => c.label)).toEqual(['Products'])
		expect(schemaCompletions(TEXT, 17, 16).map(c => c.label)).toContain('PostgreSQL')
	})

	test('keys: those of the place, not the ones already written', () => {
		const text = TEXT.replace('        - name: price\n', '        - name: price\n          \n')
		const keys = schemaCompletions(text, 9, 11).map(c => c.label)
		expect(keys).toContain('type')
		expect(keys).toContain('required')
		expect(keys).not.toContain('name')
		expect(schemaCompletions('', 1, 1).map(c => c.label)).toEqual(['domain', 'infrastructure', 'application'])
	})

	test('lists written in the column of their key (`stages:` then `- name:`)', () => {
		const text = 'infrastructure:\n  sources:\n  - name: main\n    dialect: \n  stages:\n  - name: default\n    \n'
		expect(pathAt(text.split('\n'), 3, 5)).toEqual(['infrastructure', 'sources', '*'])
		expect(schemaCompletions(text, 4, 14).map(c => c.label)).toContain('MySQL')
		expect(schemaCompletions(text, 7, 5).map(c => c.label)).toEqual(['sources'])
	})
})
