import { ResolvedObservability } from '@lambdaorm/base'
import { parentPort, workerData, TransferListItem } from 'worker_threads'
import { DataGatewayConfig } from '../../domain/config/dataGatewayConfig'
import { SchemaDescriptor, SchemaSettings } from '../../domain/runtime/schemas'
import { McpServerInfo } from '../../application/ports/input/mcpServerPort'
import { SchemaState } from '../../domain/runtime/policies'
import { WorkspaceChange } from '../../domain/runtime/workspaces'

/** supervisor → worker */
export type ControlRequest =
	| { type: 'ping' }
	| { type: 'stop' }
	/** thread mode: a port of a new channel with the edge */
	| { type: 'attach', port: unknown }
	/** edge: a channel to a schema worker (a port in thread mode, a unix socket in process mode) */
	| { type: 'connect', path: string, port?: unknown, socketPath?: string, info: McpServerInfo }
	| { type: 'state', state: SchemaState }
	/** edge: a schema that appeared (its env left out) / went / something changed in a workspace */
	| { type: 'add', schema: { descriptor: SchemaDescriptor, settings: SchemaSettings } }
	| { type: 'remove', path: string }
	| { type: 'workspace', change: WorkspaceChange }

/** worker → supervisor */
export type ControlEvent =
	| { type: 'pong' }
	| { type: 'ready', info?: McpServerInfo, socketPath?: string }
	| { type: 'failed', reason: string }
	/** edge: the observability of the state changed (saved here or in another replica) */
	| { type: 'observability', override?: Record<string, any> }
	/** edge: where the state is kept changed (persist.yaml written): the gateway restarts with it */
	| { type: 'persist' }

/** What a schema worker gets: no secrets of the gateway or of other schemas (its env is apart) */
export interface SchemaWorkerData {
	entry: string
	descriptor: SchemaDescriptor
	settings: SchemaSettings
	logger: DataGatewayConfig['logger']
	audit: DataGatewayConfig['audit']
	mcp: { name: string, pageSize: number }
	version: string
	socketDir: string
	metricsEnabled: boolean
	/** transports.management: the read-only administration tools in its MCP server */
	admin?: boolean
	/** the observability of the gateway, resolved in the main thread (with the OTEL_* of the gateway) */
	observability?: ResolvedObservability
}

/** What the edge gets: the configuration (credentials included: it authenticates) and the schemas, without their env */
export interface EdgeWorkerData {
	entry: string
	config: DataGatewayConfig
	schemas: { descriptor: SchemaDescriptor, settings: SchemaSettings }[]
	version: string
	observability?: ResolvedObservability
	/** what the administration changed of the observability: the explore it serves comes with it */
	observabilityOverride?: Record<string, any>
}

export interface Control {
	send (event: ControlEvent): void
	on (listener: (request: ControlRequest) => void): void
	/** The data the worker was started with */
	data<T> (): T
}

/** The channel with the supervisor: parentPort in a thread, IPC in a process */
export const control = (): Control => {
	if (parentPort) {
		const port = parentPort
		return {
			send: (event, transfer?: TransferListItem[]) => port.postMessage(event, transfer),
			on: listener => port.on('message', listener),
			data: <T>() => workerData as T
		}
	}
	if (!process.send) throw new Error('a worker runs in a worker thread or a forked process')
	const data = JSON.parse(process.argv[3] ?? '{}')
	return {
		send: event => { process.send?.(event) },
		on: listener => process.on('message', listener as (message: unknown) => void),
		data: <T>() => data as T
	}
}
