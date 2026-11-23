/**
 * The code of an error, the same on every transport and in every client of the Data Gateway (the table of the
 * conformance suite: packages/conformance/README.md, "Errors").
 */
export type GatewayErrorCode =
	| 'invalid' | 'unauthorized' | 'forbidden' | 'not_found' | 'unique' | 'foreign_key' | 'conflict' | 'timeout'
	| 'too_large' | 'rate_limited' | 'unavailable' | 'internal' | 'truncated' | 'unsupported' | 'transport'

/** The transport of a connection: the scheme of its URL */
export type TransportName = 'http' | 'ws' | 'mcp+http' | 'mcp+sse' | 'mcp+ws'

export interface GatewayErrorInfo {
	code: GatewayErrorCode
	/** the name the gateway gave the error: SchemaError, ValidationError, ForbiddenError, NotFoundError, … */
	errorName?: string
	/** the HTTP status the gateway answers it with (also on WebSocket and MCP) */
	status?: number
	/** the code of the database, for an error of the database (Postgres 23505, MySQL ER_DUP_ENTRY, …) */
	dbCode?: string
	message: string
	/** names of the query that don't exist, with the closest ones: `[{ name: 'nme', didYouMean: ['name'] }]` */
	suggestions?: { name: string, didYouMean: string[] }[]
	transport?: TransportName
	operation?: string
}

/** An operation that failed, on any transport: branch on `code` */
export class GatewayError extends Error implements GatewayErrorInfo {
	public readonly code: GatewayErrorCode
	public readonly errorName?: string
	public readonly status?: number
	public readonly dbCode?: string
	public readonly suggestions?: { name: string, didYouMean: string[] }[]
	public readonly transport?: TransportName
	public readonly operation?: string

	constructor (info: GatewayErrorInfo) {
		super(info.message)
		this.name = 'GatewayError'
		this.code = info.code
		this.errorName = info.errorName
		this.status = info.status
		this.dbCode = info.dbCode
		if (info.suggestions && info.suggestions.length > 0) this.suggestions = info.suggestions
		this.transport = info.transport
		this.operation = info.operation
	}
}

const UNIQUE = ['23505', 'ER_DUP_ENTRY', '1062', 'ORA-00001', '2627', '2601', '11000']
const FOREIGN_KEY = ['23503', 'ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2', '1451', '1452', 'ORA-02291', 'ORA-02292', '547']

/** The code of an error from the status the gateway answers and, for a conflict, the code of the database */
export const errorCode = (status?: number, dbCode?: string): GatewayErrorCode => {
	if (status === 409) {
		if (dbCode !== undefined && UNIQUE.includes(dbCode)) return 'unique'
		if (dbCode !== undefined && FOREIGN_KEY.includes(dbCode)) return 'foreign_key'
		return 'conflict'
	}
	switch (status) {
	case 400: case 422: return 'invalid'
	case 401: return 'unauthorized'
	case 403: return 'forbidden'
	case 404: return 'not_found'
	case 408: case 504: return 'timeout'
	case 413: return 'too_large'
	case 429: return 'rate_limited'
	case 503: return 'unavailable'
	default: return 'internal'
	}
}

/** An error the gateway answered, with its status, name and database code */
export const gatewayError = (
	transport: TransportName,
	answer: { status?: number, errorName?: string, dbCode?: unknown, message: string, suggestions?: { name: string, didYouMean: string[] }[] }
): GatewayError => {
	const dbCode = answer.dbCode === undefined || answer.dbCode === null ? undefined : String(answer.dbCode)
	return new GatewayError({
		code: errorCode(answer.status, dbCode),
		errorName: answer.errorName,
		status: answer.status,
		dbCode,
		message: answer.message,
		suggestions: Array.isArray(answer.suggestions) ? answer.suggestions : undefined,
		transport
	})
}

/** The connection failed: refused, closed, a handshake rejected */
export const transportError = (transport: TransportName, message: string): GatewayError =>
	new GatewayError({ code: 'transport', message, transport })

export const unsupported = (transport: TransportName, operation: string, where: string): GatewayError =>
	new GatewayError({ code: 'unsupported', message: `${operation} is not available on ${transport}: ${where}`, transport, operation })
