import { QueryOptions } from '@lambdaorm/base'
import { AuditEntry, SessionAuditEntry } from '../../../domain/audit/auditEntry'
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
/** How a client sends the credential (for the OpenAPI document): none, a bearer token, an API key in a header, basic */
export interface CredentialScheme {
	type: 'none' | 'bearer' | 'apikey' | 'basic'
	/** The header of an API key */
	header?: string
}

export interface AuthenticatorPort {
	authenticate (headers: Headers): Promise<AuthenticationResult>
	/** How the credential is sent; without it, it is not described */
	scheme? (): CredentialScheme
}

/**
 * The trace of a request across the channel to a schema worker, as a W3C Trace Context carrier (traceparent,
 * tracestate). Without tracing it carries nothing.
 */
export interface TracingPort {
	/** the carrier of the active span, for a request to a worker */
	carrier (): Record<string, string> | undefined
	/** runs fn with the trace of a carrier as its parent */
	within<T> (carrier: Record<string, string> | undefined, fn: () => Promise<T>): Promise<T>
}

export const NO_TRACING: TracingPort = {
	carrier: () => undefined,
	within: (_carrier, fn) => fn()
}

export interface LoggerPort {
	info (message: string): void
	warn (message: string): void
	error (message: string | Error): void
}

/** One operation on a schema, whatever the transport (docs/DATA_GATEWAY.md §8) */
export interface OperationSample {
	transport: string
	schema: string
	method: string
	status: number
	credential: string
	seconds: number
}

/** A value read when the metrics are rendered (connections, states of the schemas…) */
export type GaugeReader = () => { labels: Record<string, string>, value: number }[]

export interface MetricsPort {
	readonly enabled: boolean
	/** Starts measuring an HTTP request; the returned function ends it with its labels (template: its route template) */
	startTimer (): (labels: Record<string, string | number>) => void
	operation (sample: OperationSample): void
	forbidden (credential: string, permission: string): void
	throttled (schema: string, transport: string): void
	gauge (name: string, help: string, labelNames: string[], read: GaugeReader): void
	/** Metrics of other workers (JSON of their registries), rendered with these */
	addSource (source: () => Promise<unknown[]>): void
	render (filter?: { schema?: string }): Promise<{ contentType: string, body: string }>
	/** This worker's metrics as JSON, for the edge to aggregate */
	snapshot (): Promise<unknown[]>
}

/** Where the audit entries go (stdout, a file, a topic, …). */
export interface AuditPort {
	write (entry: AuditEntry | SessionAuditEntry): void
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
