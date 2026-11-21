/** What the gateway answers when a request fails, on every transport: a status a client can map, the name and the code. */
export interface HttpError {
	status: number
	/** suggestions: names of the query that don't exist and the closest ones, for a client to offer (L41) */
	body: { error: string, code?: string, message: string, suggestions?: { name: string, didYouMean: string[] }[] }
}

/**
 * Database error codes (Postgres SQLSTATE, MySQL errno) → HTTP status, so a client can tell "already exists" or
 * "references something missing" (409) and "invalid value" (400) from a failure of the gateway (500).
 */
const DB_CODES: { [code: string]: number } = {
	23505: 409, // Postgres unique_violation
	23503: 409, // Postgres foreign_key_violation
	23502: 400, // Postgres not_null_violation
	23514: 400, // Postgres check_violation
	ER_DUP_ENTRY: 409, // MySQL
	ER_NO_REFERENCED_ROW_2: 409, // MySQL
	ER_ROW_IS_REFERENCED_2: 409, // MySQL
	ER_BAD_NULL_ERROR: 400 // MySQL
}

/** λORM errors caused by the request (a query, a model or values the gateway can't use) */
const CLIENT_ERRORS = ['ValidationError', 'SchemaError', 'SintaxisError', 'LanguageError']

export const toHttpError = (error: any): HttpError => {
	// a script can choose the answer: throw { status: 404, message: "quote not found" } (3xpr keeps it in error.value)
	const thrown = error && error.value && typeof error.value === 'object' ? error.value : undefined
	const name = (error && error.name) || 'Error'
	const message = (thrown && thrown.message) || (error && error.message) || String(error)
	const rawCode = thrown && thrown.code !== undefined ? thrown.code : error && error.code
	const code = rawCode !== undefined && rawCode !== null ? String(rawCode) : undefined
	let status = 500
	const explicit = (thrown && thrown.status) ?? (error && (error.status ?? error.statusCode))
	if (Number.isInteger(explicit) && explicit >= 400 && explicit <= 599) {
		status = explicit
	} else if (code !== undefined && DB_CODES[code] !== undefined) {
		status = DB_CODES[code]
	} else if (code !== undefined && /^22[0-9A-Z]{3}$/.test(code)) {
		status = 400 // Postgres data_exception class (invalid text, value too long, …)
	} else if (CLIENT_ERRORS.includes(name)) {
		status = 400
	}
	// a source the gateway can't reach or whose connection is not set (λORM L43): the service is unavailable, not the
	// request wrong
	if (status === 500 && name === 'ConnectionError') status = 503
	const body: HttpError['body'] = { error: name, code, message }
	if (Array.isArray(error?.suggestions) && error.suggestions.length > 0) body.suggestions = error.suggestions
	return { status, body }
}
