import { Permission } from '../auth/permission'

/** Who asks, as it crosses the channel (a Set doesn't) */
export interface WirePrincipal {
	name: string
	permissions: Permission[]
}

/** edge → schema worker: one operation of DataGatewayPort ('gateway') or McpServerPort ('mcp') */
export interface ChannelRequest {
	type: 'request'
	id: number
	/** runtime: the worker itself (its metrics) */
	target: 'gateway' | 'mcp' | 'runtime'
	op: string
	args: unknown[]
	principal?: WirePrincipal
	transport: string
	/** epoch ms after which the edge stopped waiting: the worker may skip it */
	deadline: number
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
export interface ChannelEvent {
	type: 'event'
	event: 'queue'
	outcome: { queueId: string, ok: boolean, rows?: number, error?: string }
}

export type ChannelMessage = ChannelRequest | ChannelResponse | ChannelEvent

/** Operations a schema worker answers: anything else is refused (the channel is not an eval) */
export const GATEWAY_OPERATIONS = [
	'version', 'health', 'ping', 'plan', 'metadata', 'model', 'parameters', 'constraints', 'execute', 'executeScript',
	'executeQueued', 'schema', 'schemaVersion', 'domain', 'sources', 'source', 'entities', 'entity', 'enums', 'enum',
	'mappings', 'mapping', 'entityMapping', 'stages', 'stage', 'views', 'typings', 'search', 'describe', 'stageExists', 'stageExport', 'stageImport'
] as const

/** Operations without a RequestContext (the first argument of the others) */
export const CONTEXT_FREE_OPERATIONS = ['version', 'health', 'ping']

/** info() is synchronous on the port: the worker sends it once, with `ready` */
export const MCP_OPERATIONS = ['listTools', 'callTool', 'listResources', 'listResourceTemplates', 'readResource'] as const
