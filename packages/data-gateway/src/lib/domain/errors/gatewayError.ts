/**
 * An error the gateway answers with a known HTTP status (REST), JSON-RPC data (WebSocket) or isError (MCP).
 * `name` is part of the contract: clients branch on it.
 */
export class GatewayError extends Error {
	constructor (public readonly status: number, name: string, message: string, public readonly code?: string) {
		super(message)
		this.name = name
	}
}

export const unauthorized = (message = 'a valid credential is required'): GatewayError =>
	new GatewayError(401, 'UnauthorizedError', message)

export const forbidden = (credential: string, permission: string): GatewayError =>
	new GatewayError(403, 'ForbiddenError', `the credential "${credential}" does not have the "${permission}" permission`)

export const notFound = (message: string): GatewayError => new GatewayError(404, 'NotFoundError', message)

export const badRequest = (name: string, message: string): GatewayError => new GatewayError(400, name, message)

export const timeout = (ms: number): GatewayError =>
	new GatewayError(504, 'TimeoutError', `the operation did not finish within ${ms} ms (server.timeout)`)

export const unavailable = (name: string, message: string): GatewayError => new GatewayError(503, name, message)

/** The configuration can't be used: the process doesn't start. Every problem found is listed, not only the first. */
export class ConfigError extends Error {
	constructor (public readonly issues: string[]) {
		super(`invalid configuration:\n  - ${issues.join('\n  - ')}`)
		this.name = 'ConfigError'
	}
}
