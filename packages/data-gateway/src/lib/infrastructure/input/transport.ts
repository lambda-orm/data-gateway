/** A way of reaching the gateway (REST, MCP, WebSocket), listening on its own port. */
export interface Transport {
	readonly name: string
	start (): Promise<void>
	stop (): Promise<void>
	/** host:port it listens on, once started */
	readonly address: { host: string, port: number } | undefined
	/** Open connections (WebSocket, SSE, stateful sessions), for data_gateway_connections */
	readonly connections?: number
}
