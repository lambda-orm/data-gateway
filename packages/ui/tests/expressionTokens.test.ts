import { describe, expect, test } from 'vitest'
import { expressionTokens } from '../src/domain/expressionTokens'

const kinds = (expression: string) => expressionTokens(expression, ['entity', 'action', 'read']).filter(t => t.kind !== 'space').map(t => `${t.kind}:${t.text}`)

describe('the colors of an expression', () => {
	test('the variables of its context, the functions, the strings, the numbers, the constants and the operators', () => {
		expect(kinds('entity.in(["Products","Orders"]) && read')).toEqual([
			'variable:entity', 'operator:.', 'function:in', 'operator:(', 'operator:[', 'string:"Products"', 'operator:,', 'string:"Orders"', 'operator:]', 'operator:)', 'operator:&&', 'variable:read'
		])
		expect(kinds('action == "select" || count > 10 && !false')).toEqual(['variable:action', 'operator:==', 'string:"select"', 'operator:||', 'name:count', 'operator:>', 'number:10', 'operator:&&', 'operator:!', 'constant:false'])
	})

	test('a word after a dot is not a variable; an unfinished string still is one; the text is kept whole', () => {
		expect(kinds('x.entity')).toEqual(['name:x', 'operator:.', 'name:entity'])
		expect(kinds('entity == "Prod')).toEqual(['variable:entity', 'operator:==', 'string:"Prod'])
		const text = '  entity.in( [ "A" ] )  && read '
		expect(expressionTokens(text, ['entity']).map(t => t.text).join('')).toBe(text)
	})
})
