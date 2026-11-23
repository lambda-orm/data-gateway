import { chooseProtocol, headersFromProtocols, protocolsFor } from '../../src/lib/domain/auth/protocolCredential'

describe('the credential of a WebSocket in its subprotocols', () => {
	test('there and back: the headers of the credential, their names in lowercase', () => {
		const offered = protocolsFor({ 'X-Api-Key': 'k-ñ/+=1', Authorization: 'Bearer t' })
		expect(offered[0]).toBe('lambdaorm')
		// a token of a subprotocol: no separators (base64url, no padding)
		expect(offered[1]).toMatch(/^lambdaorm\.headers\.[A-Za-z0-9_-]+$/)
		expect(headersFromProtocols(offered.join(', '))).toEqual({ 'x-api-key': 'k-ñ/+=1', authorization: 'Bearer t' })
	})

	test('none, or what can\'t be read: no headers; lambdaorm chosen only when offered', () => {
		expect(headersFromProtocols(undefined)).toEqual({})
		expect(headersFromProtocols('mcp')).toEqual({})
		expect(headersFromProtocols('lambdaorm, lambdaorm.headers.!!!')).toEqual({})
		expect(headersFromProtocols('lambdaorm.headers.WzFd')).toEqual({})
		expect(chooseProtocol(new Set(['lambdaorm', 'x']))).toBe('lambdaorm')
		expect(chooseProtocol(new Set(['x']))).toBe(false)
	})
})
