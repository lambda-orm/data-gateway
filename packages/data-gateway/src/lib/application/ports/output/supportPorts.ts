import { QueryOptions } from '@lambdaorm/base'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import { AuthenticationResult } from '../../../domain/auth/principal'

export interface QueueExecuteArgs {
	topic: string
	query: string
	data?: unknown
	chunk?: number
	options?: QueryOptions
	/** Called when the background execution ends (sent or failed) */
	onDone?: (outcome: QueueOutcome) => void
}

/** How a background execution ended: what queue.completed / queue.failed notify */
export interface QueueOutcome {
	queueId: string
	ok: boolean
	/** Rows sent to the topic */
	rows?: number
	error?: string
}

/** Where the ends of the background executions of a schema go (the edge forwards them to who asked) */
export interface QueueEventsPort {
	completed (outcome: QueueOutcome): void
}

/** Background execution: runs a query and sends its result to a topic in chunks. */
export interface QueuePort {
	/** False when the schema has no queue configured */
	readonly available: boolean
	/** Starts the execution and returns its id at once */
	execute (args: QueueExecuteArgs): string
}

export type Headers = Record<string, string | string[] | undefined>

/** Validates the credential of a request. Never throws for a bad credential: answers valid: false with a reason. */
export interface AuthenticatorPort {
	authenticate (headers: Headers): Promise<AuthenticationResult>
}

export interface LoggerPort {
	info (message: string): void
	warn (message: string): void
	error (message: string | Error): void
}

export interface MetricsPort {
	readonly enabled: boolean
	/** Starts measuring a request; the returned function ends it with its labels */
	startTimer (): (labels: Record<string, string | number>) => void
	render (): Promise<{ contentType: string, body: string }>
}

/** Where the audit entries go (stdout, a file, a topic, …). */
export interface AuditPort {
	write (entry: AuditEntry): void
}

export interface ClockPort {
	now (): Date
	uptimeSeconds (): number
}

/** The configuration file, parsed and with its environment variables resolved. */
export interface ConfigSourcePort {
	load (): Promise<unknown>
	readonly location: string
}
