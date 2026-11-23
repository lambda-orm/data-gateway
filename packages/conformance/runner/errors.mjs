// The code of an error, the same on every transport and in every client (README.md, "Errors"): from the status the
// gateway answers and, for a conflict, the code of the database.
const UNIQUE = ['23505', 'ER_DUP_ENTRY', '1062', 'ORA-00001', '2627', '2601', '11000']
const FOREIGN_KEY = ['23503', 'ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2', '1451', '1452', 'ORA-02291', 'ORA-02292', '547']

export const errorCode = ({ status, dbCode }) => {
	const code = dbCode === undefined || dbCode === null ? undefined : String(dbCode)
	if (status === 409) {
		if (code && UNIQUE.includes(code)) return 'unique'
		if (code && FOREIGN_KEY.includes(code)) return 'foreign_key'
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
