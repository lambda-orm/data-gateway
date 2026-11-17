/** One write (or possible write) through the gateway: who, where, what and how it ended (docs/DATA_GATEWAY.md §8.1). */
export interface AuditEntry {
	type: 'audit'
	time: string
	schema: string
	transport: string
	credential: string
	operation: 'execute' | 'executeScript' | 'executeQueued' | 'stageImport'
	actions?: string[]
	entities?: string[]
	query?: string
	stage?: string
	/** Only with audit.includeData: the data can hold personal information */
	data?: unknown
	rows?: number
	durationMs: number
	result: 'ok' | 'error'
	error?: string
}
