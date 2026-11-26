import { Actor } from '@lambdaorm/base'
import { Permission } from '../auth/permission'

/** Who asks, as it crosses the channel (a Set doesn't) */
export interface WirePrincipal {
	name: string
	permissions: Permission[]
	actor?: Actor
	/** the context of λORM of who calls (from its identity: the claims of its token) */
	context?: Record<string, unknown>
	/** the view of λORM of who calls (its key or its roles) */
	view?: string
	/** its writes wait for a person (docs/MUTATION_APPROVAL.md) */
	approval?: 'writes'
}

/** edge → schema worker: one operation of DataGatewayPort ('gateway') or McpServerPort ('mcp') */
export interface ChannelRequest {
	type: 'request'
	id: number
	/** runtime: the worker itself (its metrics); commands: the commands of the workspace (admin) */
	target: 'gateway' | 'mcp' | 'runtime' | 'commands'
	op: string
	args: unknown[]
	principal?: WirePrincipal
	transport: string
	/** epoch ms after which the edge stopped waiting: the worker may skip it */
	deadline: number
	/** W3C Trace Context of the request in the edge (traceparent, tracestate): the spans of the worker are its children */
	trace?: Record<string, string>
}

/**
 * An error as it crosses the channel, with what the transports map it by: status only when the error carries one,
 * the database code (23505, ER_DUP_ENTRY…) and what a script threw ({ status, message, code }).
 */
export interface WireError {
	name: string
	message: string
	status?: number
	code?: string
	value?: { status?: number, message?: string, code?: string }
	/** names of the query that don't exist, with the closest ones (λORM L41) */
	suggestions?: { name: string, didYouMean: string[] }[]
}

/**
 * schema worker → edge. `json` is the result already serialized (JSON text as bytes, transferred without a copy
 * between threads); undefined results have neither json nor error.
 */
export interface ChannelResponse {
	type: 'response'
	id: number
	json?: Uint8Array
	error?: WireError
}

/** schema worker → edge, unasked: a background execution ended (the edge forwards it to the connection that asked) */
/** A write of λORM after its commit, as it travels to the edge (docs/SUBSCRIPTIONS.md): never the data written */
export interface DataChangeSummary {
	entity: string
	action: string
	/** the primary keys of the rows, when they are known */
	keys?: Record<string, unknown>[]
	count?: number
}

export type ChannelEvent =
	| { type: 'event', event: 'queue', outcome: { queueId: string, ok: boolean, rows?: number, error?: string } }
	/** the writes of one commit of the schema (a DataChange of λORM each), for the subscriptions of the edge */
	| { type: 'event', event: 'data', changes: DataChangeSummary[] }

export type ChannelMessage = ChannelRequest | ChannelResponse | ChannelEvent

/** Operations a schema worker answers: anything else is refused (the channel is not an eval) */
export const GATEWAY_OPERATIONS = [
	'version', 'health', 'ping', 'plan', 'metadata', 'model', 'parameters', 'constraints', 'execute', 'executeScript',
	'executeQueued', 'queries', 'query', 'approval', 'schema', 'schemaVersion', 'domain', 'sources', 'source', 'entities', 'entity', 'enums', 'enum',
	'mappings', 'mapping', 'entityMapping', 'stages', 'stage', 'views', 'typings', 'search', 'describe', 'stageExists', 'stageExport', 'stageImport'
] as const

/** Operations without a RequestContext (the first argument of the others) */
export const CONTEXT_FREE_OPERATIONS = ['version', 'health', 'ping']

/** info() is synchronous on the port: the worker sends it once, with `ready` */
export const MCP_OPERATIONS = ['listTools', 'callTool', 'listResources', 'listResourceTemplates', 'readResource'] as const

/**
 * The commands of a workspace that run in its schema worker, with its λORM and its connections
 * (docs/DATA_GATEWAY_ADMIN_PLAN.md §4): the ones that read (fetch, export) and the ones that change the databases, each
 * with the sentences it would run first (push, drop).
 */
export const COMMAND_OPERATIONS = [
	'stages', 'fetch', 'pushSentences', 'push', 'dropSentences', 'drop', 'export', 'import', 'pullSchema', 'pull', 'introspectSchema',
	'migrations', 'migrateSentences', 'migrate', 'seedFiles', 'seed',
	'outboxList', 'outboxRetry',
	// the writes that wait for a person (docs/MUTATION_APPROVAL.md §4): authorized by approve in the worker
	'approvalsList', 'approve', 'reject'
] as const
export type CommandOperation = typeof COMMAND_OPERATIONS[number]
