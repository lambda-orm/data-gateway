// Answers of the service (docs/LAMBDAORM_PENDING.md L5, L30): JSON for every value, an HTTP status a client can map.
import { Controller } from '../src/lib/infrastructure/controllers/Controller'
import { QueryService } from '../src/lib/application/services/queryService'

class TestController extends Controller {
	public answer (payload: any) { const res = new FakeResponse(); this.sendResponse(res, payload); return res }
	public fail (error: any) { const res = new FakeResponse(); this.sendError(res, error); return res }
}
class FakeResponse {
	public code?: number
	public body?: any
	public ended = false
	status (code: number) { if (!Number.isInteger(code)) throw new Error('Invalid status code'); this.code = code; return this }
	json (body: any) { this.body = body; return this }
	end () { this.ended = true; return this }
}
const controller = new TestController()

describe('responses', () => {
	test('numbers (affected rows), 0, strings, booleans, null and objects answer 200 with JSON', () => {
		for (const value of [1, 0, 'id-1', false, null, { a: 1 }, [1]]) {
			const res = controller.answer(value)
			expect(res.code).toBe(200)
			expect(res.body).toEqual(value)
		}
	})

	test('undefined answers 204 without body', () => {
		const res = controller.answer(undefined)
		expect(res.code).toBe(204)
		expect(res.ended).toBe(true)
	})
})

describe('errors', () => {
	const dbError = (code: string) => Object.assign(new Error('db'), { name: 'ExecutionError', code })

	test('database codes map to client statuses', () => {
		expect(controller.fail(dbError('23505')).code).toBe(409)
		expect(controller.fail(dbError('23503')).code).toBe(409)
		expect(controller.fail(dbError('23502')).code).toBe(400)
		expect(controller.fail(dbError('22001')).code).toBe(400)
		expect(controller.fail(dbError('ER_DUP_ENTRY')).code).toBe(409)
		expect(controller.fail(dbError('23505')).body).toEqual({ error: 'ExecutionError', code: '23505', message: 'db' })
	})

	test('a string code that is not an HTTP status never becomes one (it used to crash Express)', () => {
		const res = controller.fail(Object.assign(new Error('x'), { code: 'ERR_INVALID_ARG_TYPE' }))
		expect(res.code).toBe(500)
		expect(res.body.code).toBe('ERR_INVALID_ARG_TYPE')
	})

	test('an explicit status, and a script throw { status, message }', () => {
		expect(controller.fail(Object.assign(new Error('nope'), { status: 403 })).code).toBe(403)
		const thrown = Object.assign(new Error('{"status":404,"message":"quote not found"}'), { value: { status: 404, message: 'quote not found' } })
		const res = controller.fail(thrown)
		expect(res.code).toBe(404)
		expect(res.body.message).toBe('quote not found')
	})

	test('λORM request errors answer 400, anything else 500', () => {
		expect(controller.fail(Object.assign(new Error('bad'), { name: 'SchemaError' })).code).toBe(400)
		expect(controller.fail(new Error('boom')).code).toBe(500)
	})
})

describe('/script', () => {
	const orm: any = { executeScript: jest.fn(async () => 7) }
	test('disabled by default: 403', async () => {
		await expect(new QueryService(orm).script({ body: { script: '1' } })).rejects.toMatchObject({ status: 403 })
	})
	test('enabled: runs with the timeout; too long → 413; empty → 400; undefined result → null', async () => {
		const service = new QueryService(orm, { enabled: true, maxLength: 10, timeoutMs: 1234 })
		expect(await service.script({ body: { script: 'a = 1; a', data: { x: 1 }, options: { stage: 'default' } } })).toBe(7)
		expect(orm.executeScript).toHaveBeenCalledWith('a = 1; a', { x: 1 }, { stage: 'default' }, { timeout: 1234 })
		await expect(service.script({ body: { script: 'x'.repeat(11) } })).rejects.toMatchObject({ status: 413 })
		await expect(service.script({ body: { script: ' ' } })).rejects.toMatchObject({ status: 400 })
		orm.executeScript.mockResolvedValueOnce(undefined)
		expect(await service.script({ body: { script: 'x' } })).toBeNull()
	})
})
