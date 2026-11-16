// Service token (docs/LAMBDAORM_PENDING.md L12): "Authorization: Bearer <token>" required, health paths open.
import { serviceToken } from '../src/lib/infrastructure/middleware/serviceTokenMiddleware'

const call = (path: string, authorization?: string) => {
	const res: any = { code: 200, status (code: number) { this.code = code; return this }, json () { return this } }
	let passed = false
	serviceToken('s3cret', ['/ping'])({ path, headers: authorization ? { authorization } : {} }, res, () => { passed = true })
	return passed ? 'next' : res.code
}

describe('service token', () => {
	test('the right token passes, a missing or wrong one answers 401', () => {
		expect(call('/execute', 'Bearer s3cret')).toBe('next')
		expect(call('/execute')).toBe(401)
		expect(call('/execute', 'Bearer wrong')).toBe(401)
		expect(call('/execute', 's3cret')).toBe(401)
	})

	test('open paths need no token', () => {
		expect(call('/ping')).toBe('next')
	})
})
