import { describe, expect, test } from 'vitest'
import { expressionCompletions } from '../src/domain/expressionCompletion'

const LANGUAGE = {
	functions: [
		{ name: 'in', params: [{ name: 'value' }, { name: 'list', multiple: true }], returnType: 'boolean', description: 'In' },
		{ name: 'now', params: [], returnType: 'dateTime' }
	],
	operators: [],
	constants: ['true', 'false'],
	contexts: { stageSource: [{ name: 'entity', type: 'string', description: 'the entity' }, { name: 'action', type: 'string', description: 'the action' }] }
}
const at = (line: string) => expressionCompletions(LANGUAGE, 'stageSource', ['Products', 'Orders'], line, line.length + 1)

describe('the suggestions of an expression', () => {
	test('a word: the variables, the functions and the constants', () => {
		const labels = at('ent').map(s => `${s.kind}:${s.label}`)
		expect(labels).toEqual(['variable:entity', 'variable:action', 'function:in', 'function:now', 'constant:true', 'constant:false'])
		expect(at('')[2]).toMatchObject({ insertText: 'in($1)', snippet: true, detail: 'in(value, ...list): boolean' })
	})

	test('after a dot: the functions as methods, without their first parameter', () => {
		expect(at('entity.')).toEqual([expect.objectContaining({ label: 'in', detail: 'in(...list): boolean', insertText: 'in($1)' })])
	})

	test('inside quotes: the entities, or the values of what the string is compared with', () => {
		expect(at('entity.in(["').map(s => s.label)).toEqual(['Products', 'Orders'])
		expect(at('entity == "Products" && action == "').map(s => s.label)).toContain('createEntity')
		expect(at('action.in(["select", "').map(s => s.label)).toContain('insert')
	})
})
