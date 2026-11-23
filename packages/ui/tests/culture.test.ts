import { describe, expect, test } from 'vitest'
import { culturePreview, formatValue } from '../src/domain/culture'

describe('the values of a result in the format of a culture', () => {
	test('numbers and dates as the culture writes them; a date alone keeps its day; anything else as it came', () => {
		expect(formatValue(1234567.5, 'de-DE')).toBe('1.234.567,5')
		expect(formatValue(1234567.5, 'en-US')).toBe('1,234,567.5')
		expect(formatValue('2026-11-23', 'es-AR')).toBe('23 nov 2026')
		expect(formatValue('2026-11-23', 'en-US')).toBe('Nov 23, 2026')
		expect(formatValue('2026-10-29T16:31:42.971Z', 'en-US')).toMatch(/^Oct 29, 2026, \d{1,2}:31:42\s?[AP]M$/)
		expect(formatValue('amazfit', 'es-AR')).toBeUndefined()
		expect(formatValue(true, 'es-AR')).toBeUndefined()
		// without a culture (or one the browser doesn't know): as it came
		expect(formatValue(1234.5, undefined)).toBeUndefined()
		expect(formatValue(1234.5, 'xx-not-a-culture-!!')).toBeUndefined()
		expect(culturePreview('es-AR')).toMatch(/^1\.234\.567,891 · 23 nov 2026/)
	})
})
