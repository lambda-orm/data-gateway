import { ConnectionTarget } from '../connection'
import { gatewayError, GatewayError, transportError, unsupported } from '../errors'
import { Args, clean, Operation, RPC, WHERE } from '../operations'
import { RpcSocket } from './rpcSocket'
import { NotificationEvent, NotificationListener, Transport, withTimeout } from './transport'

/** The JSON-RPC 2.0 API of the gateway over WebSocket, with its notifications */
export class WebSocketTransport implements Transport {
	public readonly name = 'ws' as const
	private readonly socket: RpcSocket

	constructor (private readonly target: ConnectionTarget) {
		this.socket = new RpcSocket(target.url, target.headers)
	}

	public async open (): Promise<void> {
		try {
			await withTimeout(this.socket.open(), this.target.timeout, () => new Error(`no answer from ${this.target.url} in ${this.target.timeout} ms`))
		} catch (error: any) {
			throw transportError(this.name, error.message)
		}
	}

	public async close (): Promise<void> { this.socket.close() }

	public async call (operation: Operation, args: Args): Promise<unknown> {
		const route = RPC[operation]
		if (!route) throw unsupported(this.name, operation, WHERE[operation] ?? 'not on this transport')
		const [method, params] = route(args)
		const message = await withTimeout(this.socket.request(method, clean(params)), this.target.timeout,
			() => new GatewayError({ code: 'timeout', message: `${operation} took longer than ${this.target.timeout} ms`, transport: this.name, operation }))
		if (message.error) {
			const data = message.error.data ?? {}
			if (message.error.code === -32603 && data.status === undefined) throw transportError(this.name, message.error.message)
			// a JSON-RPC error of its own (an unknown method, invalid params) has no status: the gateway's codes say which
			const status = data.status ?? (message.error.code === -32601 ? 404 : message.error.code === -32602 ? 400 : 500)
			throw gatewayError(this.name, { status, errorName: data.name, dbCode: data.code, suggestions: data.suggestions, message: message.error.message })
		}
		return message.result ?? null
	}

	public on (event: NotificationEvent, listener: NotificationListener): () => void {
		return this.socket.on(event, listener)
	}
}
