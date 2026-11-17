// Service settings whose environment variable is not defined fall back to the defaults (the service used to fail).
import { withoutUnresolved } from '../src/lib/infrastructure/server'

describe('service settings', () => {
	test('unresolved $VAR / ${VAR} values are dropped, the rest kept', () => {
		expect(withoutUnresolved({ requestBodySize: '$REQUEST_BODY_SIZE', port: '${PORT}', host: 'http://0.0.0.0', rateLimitMax: 0, token: 'a$b' }))
			.toEqual({ host: 'http://0.0.0.0', rateLimitMax: 0, token: 'a$b' })
	})
})
