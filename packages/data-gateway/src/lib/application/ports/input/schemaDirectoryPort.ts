import { TransportName } from '../../../domain/config/dataGatewayConfig'
import { SchemaState } from '../../../domain/runtime/policies'
import { AuthenticatorPort } from '../output/supportPorts'
import { DataGatewayPort } from './dataGatewayPort'
import { McpServerPort } from './mcpServerPort'

/** One schema as a transport sees it: its route, its ports and who may call it there */
export interface ServedSchema {
	path: string
	gateway: DataGatewayPort
	mcp: McpServerPort
	/** Whether this transport exposes it (schemas[].transports) */
	exposedOn (transport: TransportName): boolean
	/** Its effective authentication on a transport: schema → transport → global */
	authenticator (transport: TransportName): AuthenticatorPort
	/** What a client (the UI) should offer: scripts.enabled of the schema */
	features: { scripts: boolean }
}

export interface GatewayHealth {
	/** OK when every schema is ready; DEGRADED otherwise (the gateway itself is up) */
	message: 'OK' | 'DEGRADED'
	time: string
	uptime: number
	schemas: SchemaState[]
}

/** The schemas a transport serves, fixed at start (no hot reload), and the state of each one */
export interface SchemaDirectoryPort {
	schemas (): ServedSchema[]
	states (): SchemaState[]
	health (): Promise<GatewayHealth>
	version (): { version: string }
}
