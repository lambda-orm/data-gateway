import { TransportName } from '../../../domain/config/dataGatewayConfig'
import { SchemaState } from '../../../domain/runtime/policies'
import { WorkspaceChange } from '../../../domain/runtime/workspaces'
import { AuthenticatorPort, QueueOutcome } from '../output/supportPorts'
import { DataGatewayPort } from './dataGatewayPort'
import { McpServerPort } from './mcpServerPort'

/** One schema as a transport sees it: its route, its ports and who may call it there */
export interface ServedSchema {
	path: string
	/** The folder of its workspace (the administration reads and writes its files) */
	workspace?: string
	gateway: DataGatewayPort
	mcp: McpServerPort
	/** Whether this transport exposes it (schemas[].transports) */
	exposedOn (transport: TransportName): boolean
	/** Its effective authentication on a transport: schema → transport → global */
	authenticator (transport: TransportName): AuthenticatorPort
	/** What a client (the UI) should offer: scripts.enabled of the schema */
	features: { scripts: boolean }
	/** The ends of its background executions (executeQueued) */
	onQueueOutcome (listener: (outcome: QueueOutcome) => void): () => void
}

export interface GatewayHealth {
	/** OK when every schema is ready; DEGRADED otherwise (the gateway itself is up) */
	message: 'OK' | 'DEGRADED'
	time: string
	uptime: number
	schemas: SchemaState[]
}

/**
 * The schemas a transport serves and the state of each one. The set changes when a workspace appears or goes
 * (orm.watch): a transport reads schemas() again on onSchemasChange.
 */
export interface SchemaDirectoryPort {
	schemas (): ServedSchema[]
	states (): SchemaState[]
	health (): Promise<GatewayHealth>
	version (): { version: string }
	/** A schema changed its state (WebSocket: schema.statusChanged) */
	onStateChange (listener: (state: SchemaState) => void): () => void
	/** A schema was added or removed: schemas() answers another set */
	onSchemasChange (listener: () => void): () => void
	/** Something changed in a workspace (WebSocket: workspace.changed) */
	onWorkspaceChange (listener: (change: WorkspaceChange) => void): () => void
}
