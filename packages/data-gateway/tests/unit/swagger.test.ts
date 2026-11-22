// The OpenAPI document is loaded when the http transport starts: a YAML error would leave /doc without it.
import fs from 'fs'
import path from 'path'
const YAML = require('js-yaml')
import { withSecurity } from '../../src/lib/infrastructure/input/http/openApi'

describe('swagger.yaml', () => {
	const swagger = YAML.load(fs.readFileSync(path.join(__dirname, '../../src/lib/infrastructure/input/http/swagger.yaml'), 'utf8'))
	test('parses, declares the bearer token and leaves the health routes open', () => {
		expect(swagger.openapi).toBe('3.0.0')
		expect(swagger.components.securitySchemes.bearerAuth).toEqual(expect.objectContaining({ type: 'http', scheme: 'bearer' }))
		for (const route of ['/ping', '/health', '/metrics']) {
			expect(swagger.paths[route].get.security).toEqual([])
		}
		expect(swagger.paths['/script']).toBeDefined()
	})
})

describe('asyncapi.yaml', () => {
	test('parses: the channel of the MCP WebSocket and its messages', () => {
		const asyncapi = YAML.load(fs.readFileSync(path.join(__dirname, '../../src/lib/infrastructure/input/mcp/asyncapi.yaml'), 'utf8'))
		expect(asyncapi.asyncapi).toBe('3.0.0')
		expect(Object.keys(asyncapi.channels.mcp.messages)).toEqual(['request', 'response', 'notification'])
		expect(asyncapi.components.messages.request.examples[0].payload.params.name).toBe('orm_execute')
	})
})

describe('websocket asyncapi.yaml', () => {
	test('parses: requests, responses and the notifications', () => {
		const asyncapi = YAML.load(fs.readFileSync(path.join(__dirname, '../../src/lib/infrastructure/input/websocket/asyncapi.yaml'), 'utf8'))
		expect(asyncapi.components.messages.notification.payload.properties.method.enum).toEqual(['queue.completed', 'queue.failed', 'schema.statusChanged', 'workspace.changed'])
		expect(Object.keys(asyncapi.operations)).toEqual(['call', 'notify'])
	})
})

describe('the security of the document, as the schemas are configured', () => {
	const doc = { components: { schemas: { A: {} }, securitySchemes: { bearerAuth: {} } }, security: [{ bearerAuth: [] }, {}] }
	test('an API key in its header: Authorize asks for it, every operation needs it', () => {
		const result = withSecurity(doc, [{ type: 'apikey', header: 'x-api-key' }])
		expect(result.components.securitySchemes).toEqual({ apiKeyAuth: expect.objectContaining({ type: 'apiKey', in: 'header', name: 'x-api-key' }) })
		expect(result.security).toEqual([{ apiKeyAuth: [] }])
		expect(result.components.schemas).toEqual({ A: {} })
	})
	test('several schemas: each scheme once, one per API key header; an open schema adds the empty requirement', () => {
		const result = withSecurity(doc, [{ type: 'bearer' }, { type: 'apikey', header: 'x-api-key' }, { type: 'apikey', header: 'x-key' }, { type: 'bearer' }, { type: 'basic' }, { type: 'none' }])
		expect(Object.keys(result.components.securitySchemes)).toEqual(['bearerAuth', 'apiKeyAuth', 'apiKeyAuth_x-key', 'basicAuth'])
		expect(result.components.securitySchemes['apiKeyAuth_x-key']).toMatchObject({ name: 'x-key' })
		expect(result.security).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }, { 'apiKeyAuth_x-key': [] }, { basicAuth: [] }, {}])
	})
	test('no authentication: nothing to authorize', () => {
		expect(withSecurity(doc, [{ type: 'none' }])).toMatchObject({ components: { securitySchemes: {} }, security: [{}] })
	})
})
