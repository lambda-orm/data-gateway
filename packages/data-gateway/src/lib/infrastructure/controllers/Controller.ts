import { Request } from 'express'

/** What the service answers when a request fails: a status a client can map, and a JSON body. */
export interface HttpError {
	status: number
	body: { error: string, code?: string, message: string }
}

/**
 * Database error codes (Postgres SQLSTATE, MySQL errno) → HTTP status, so a client can tell "already exists" or
 * "references something missing" (409) and "invalid value" (400) from a failure of the service (500).
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

/** λORM errors caused by the request (a query, a model or values the service can't use) */
const CLIENT_ERRORS = ['ValidationError', 'SchemaError', 'SintaxisError', 'LanguageError']

export abstract class Controller {
	protected sendResponse (response:any, payload?:any) {
		if (payload === undefined) {
			response.status(204)
			response.end()
			return
		}
		// JSON for every value, also numbers (affected rows), 0, strings, booleans and null
		response.status(200).json(payload)
	}

	protected sendError (response:any, error:any) {
		const httpError = this.toHttpError(error)
		response.status(httpError.status).json(httpError.body)
	}

	protected toHttpError (error:any): HttpError {
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
		return { status, body: { error: name, code, message } }
	}

	protected collectRequestParams (request:Request):any {
		const requestParams:any = {}
		if (request.body && Object.keys(request.body).length > 0) {
			requestParams.body = request.body
		}
		if (request.params) {
			for (const name in request.params) {
				requestParams[name] = request.params[name]
			}
		}
		if (request.query) {
			for (const name in request.query) {
				requestParams[name] = request.query[name]
			}
		}
		if (request.headers) {
			for (const name in request.headers) {
				requestParams[name] = request.headers[name]
			}
		}
		return requestParams
	}

	protected async handleRequest (request:any, response:any, serviceOperation:any) {
		try {
			const params = this.collectRequestParams(request)
			const serviceResponse = await serviceOperation(params)
			this.sendResponse(response, serviceResponse)
		} catch (error) {
			this.sendError(response, error)
		}
	}
}
