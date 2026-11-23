// The code of an error: the same on every transport (the table of the conformance suite). No gateway.
import { errorCode } from '../../src/lib'

describe('error codes', () => {
	test.each([
		[400, undefined, 'invalid'], [422, undefined, 'invalid'], [401, undefined, 'unauthorized'], [403, undefined, 'forbidden'],
		[404, undefined, 'not_found'], [408, undefined, 'timeout'], [504, undefined, 'timeout'], [413, undefined, 'too_large'],
		[429, undefined, 'rate_limited'], [503, undefined, 'unavailable'], [500, undefined, 'internal'], [undefined, undefined, 'internal']
	])('status %s → %s', (status, dbCode, code) => {
		expect(errorCode(status as number | undefined, dbCode)).toBe(code)
	})

	test.each(['23505', 'ER_DUP_ENTRY', '1062', 'ORA-00001', '2627', '2601', '11000'])('409 with %s → unique', (dbCode) => {
		expect(errorCode(409, dbCode)).toBe('unique')
	})

	test.each(['23503', 'ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2', '1451', '1452', 'ORA-02291', 'ORA-02292', '547'])('409 with %s → foreign_key', (dbCode) => {
		expect(errorCode(409, dbCode)).toBe('foreign_key')
	})

	test('another 409 → conflict', () => {
		expect(errorCode(409, undefined)).toBe('conflict')
		expect(errorCode(409, '40001')).toBe('conflict')
	})
})
