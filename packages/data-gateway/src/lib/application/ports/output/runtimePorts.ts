import { WorkspaceChange } from '../../../domain/runtime/workspaces'
import { ChannelEvent, ChannelRequest } from '../../../domain/runtime/channelProtocol'
import { SchemaState } from '../../../domain/runtime/policies'
import { SchemaDescriptor, SchemaSettings } from '../../../domain/runtime/schemas'
import { McpServerInfo } from '../input/mcpServerPort'

/** The edge's end of the channel to one schema worker */
export interface SchemaChannelPort {
	/** Sends one operation; resolves with its result (already parsed) or rejects with a GatewayError */
	request (request: Omit<ChannelRequest, 'type' | 'id'>): Promise<unknown>
	/** Events the worker sends unasked */
	onEvent (listener: (event: ChannelEvent) => void): void
	close (): void
}

/** What a worker tells the supervisor */
export interface WorkerEvents {
	/** started (a schema worker: λORM loaded, with its MCP info) */
	ready (info?: McpServerInfo): void
	/** couldn't start (bad lambdaORM.yaml, database down, missing variable): it exits */
	failed (reason: string): void
	/** ended without being asked (exception, out of memory, killed) */
	exited (reason: string): void
	pong (): void
	/** the edge: the observability of the state changed (docs/DATA_GATEWAY.md §8.2), with what the state says now */
	observability? (override: Record<string, any> | undefined): void
	/** the edge: where the state is kept changed (.data-gateway/persist.yaml): the gateway restarts with it */
	persist? (): void
}

/** A running worker, as the supervisor sees it. What it carries to build channels is the runtime's business. */
export interface WorkerHandle {
	readonly kind: 'schema' | 'edge'
	ping (): void
	/** Asks it to finish (in-flight operations, connections) and waits; kills it after graceMs */
	stop (graceMs: number): Promise<void>
	/** Kills it now (hung) */
	terminate (): Promise<void>
}

export interface SchemaWorkerSpec {
	descriptor: SchemaDescriptor
	settings: SchemaSettings
	/** Its environment, already resolved and filtered */
	env: Record<string, string>
}

/** Starts schema workers in threads or processes (by settings.runtime.mode) */
export interface SchemaRuntimePort {
	start (spec: SchemaWorkerSpec, events: WorkerEvents): WorkerHandle
}

/** Starts the edge worker (every transport) and talks to it */
export interface EdgeRuntimePort {
	/** With the schemas served at that moment (a restarted edge gets the ones added since) */
	start (events: WorkerEvents, schemas: SchemaWorkerSpec[]): EdgeHandle
}

export interface EdgeHandle extends WorkerHandle {
	/** Opens a channel from the edge to that schema worker (a new one each time either restarts) */
	connect (path: string, worker: WorkerHandle, info: McpServerInfo): void
	state (state: SchemaState): void
	/** A schema that appeared (starting until it connects) / went */
	add (spec: SchemaWorkerSpec): void
	remove (path: string): void
	/** Something changed in a workspace: the edge notifies it (WebSocket workspace.changed) */
	workspace (change: WorkspaceChange): void
}
