// The OpenAPI document is loaded when the http transport starts: a YAML error would leave /doc without it.
import fs from 'fs'
import path from 'path'
const YAML = require('js-yaml')

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
