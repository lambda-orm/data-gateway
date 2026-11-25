// Answers of a failed request (docs/LAMBDAORM_PENDING.md L5, L30): an HTTP status a client can map, and a JSON body.
import { toHttpError } from '../../src/lib/infrastructure/input/http/httpErrors'
import { forbidden } from '../../src/lib/domain/errors/gatewayError'

const dbError = (code: string) => Object.assign(new Error('db'), { name: 'ExecutionError', code })

describe('http errors', () => {
	test('database codes map to client statuses', () => {
		expect(toHttpError(dbError('23505')).status).toBe(409)
		expect(toHttpError(dbError('23503')).status).toBe(409)
		expect(toHttpError(dbError('23502')).status).toBe(400)
		expect(toHttpError(dbError('22001')).status).toBe(400)
		expect(toHttpError(dbError('ER_DUP_ENTRY')).status).toBe(409)
		expect(toHttpError(dbError('23505')).body).toEqual({ error: 'ExecutionError', code: '23505', message: 'db' })
	})

	test('the errors of λORM ≥ 3.10: their status and what a client can use of them', () => {
		const { ContextError, ViewError, CrossSourceError, DestructiveChangeError } = require('@lambdaorm/base')
		expect(toHttpError(new ContextError('tenant', 'the filter of the view support'))).toMatchObject({
			status: 400, body: { error: 'ContextError', details: { variable: 'tenant', where: 'the filter of the view support' } }
		})
		expect(toHttpError(new ViewError('support', 'Orders', 'the row of Orders is out of the filter of the view support'))).toMatchObject({
			status: 403, body: { error: 'ViewError', details: { view: 'support', entity: 'Orders' } }
		})
		expect(toHttpError(new CrossSourceError('Orders brings more than 1000 rows'))).toMatchObject({ status: 422, body: { error: 'CrossSourceError' } })
		expect(toHttpError(new CrossSourceError('x')).body.details).toBeUndefined()
		expect(toHttpError(new DestructiveChangeError(['Products.name: varchar(80) → varchar(40)']))).toMatchObject({
			status: 409, body: { error: 'DestructiveChangeError', details: { changes: ['Products.name: varchar(80) → varchar(40)'] } }
		})
	})

	test('a string code that is not an HTTP status never becomes one (it used to crash Express)', () => {
		const error = toHttpError(Object.assign(new Error('x'), { code: 'ERR_INVALID_ARG_TYPE' }))
		expect(error.status).toBe(500)
		expect(error.body.code).toBe('ERR_INVALID_ARG_TYPE')
	})

	test('an explicit status (gateway errors), and a script throw { status, message }', () => {
		expect(toHttpError(forbidden('agent', 'write'))).toEqual({
			status: 403, body: { error: 'ForbiddenError', code: undefined, message: 'the credential "agent" does not have the "write" permission' }
		})
		const thrown = Object.assign(new Error('{"status":404,"message":"quote not found"}'), { value: { status: 404, message: 'quote not found' } })
		expect(toHttpError(thrown)).toMatchObject({ status: 404, body: { message: 'quote not found' } })
	})

	test('λORM request errors answer 400, anything else 500', () => {
		expect(toHttpError(Object.assign(new Error('bad'), { name: 'SchemaError' })).status).toBe(400)
		expect(toHttpError(new Error('boom')).status).toBe(500)
	})
})
