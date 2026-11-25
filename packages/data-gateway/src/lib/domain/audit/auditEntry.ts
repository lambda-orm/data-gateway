/** One write (or possible write) through the gateway: who, where, what and how it ended (docs/DATA_GATEWAY.md §8.1). */
export interface AuditEntry {
	type: 'audit'
	time: string
	schema: string
	transport: string
	credential: string
	operation: 'execute' | 'executeScript' | 'executeQueued' | 'stageImport' | 'stagePush' | 'stageDrop' | 'stageMigrate' | 'stageSeed'
	actions?: string[]
	entities?: string[]
	query?: string
	/** a query of application.queries run by its name (docs/NAMED_QUERIES.md) */
	name?: string
	stage?: string
	/** Only with audit.includeData: the data can hold personal information */
	data?: unknown
	rows?: number
	durationMs: number
	result: 'ok' | 'error'
	error?: string
}

/** A login, logout, expiry or revocation of a session of management (docs/DATA_GATEWAY_SESSIONS_PLAN.md §7) */
export interface SessionAuditEntry {
	type: 'audit'
	time: string
	transport: 'management'
	credential: string
	operation: 'login' | 'logout' | 'sessionExpired' | 'sessionRevoked' | 'loginRejected'
	/** the id of the session (never its token) */
	session?: string
	ip?: string
	/** who revoked it: a credential, or "limit" (maxPerCredential) */
	by?: string
	/** why a login was rejected, or a session expired (idle, lifetime) */
	reason?: string
	result: 'ok' | 'error'
}
