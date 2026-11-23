import { TransportName } from '../errors'
import { Args, Operation } from '../operations'

export type NotificationEvent = 'queue.completed' | 'queue.failed' | 'schema.statusChanged'
export type NotificationListener = (params: any) => void

/** One of the five transports: an operation of the common API in, its result (or a GatewayError) out */
export interface Transport {
	readonly name: TransportName
	open (): Promise<void>
	close (): Promise<void>
	call (operation: Operation, args: Args): Promise<unknown>
	/** notifications of the gateway; only the WebSocket (JSON-RPC) transport has them */
	on? (event: NotificationEvent, listener: NotificationListener): () => void
}

/** A promise that fails with `onTimeout()` after `ms` */
export const withTimeout = <T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> => {
	let timer: NodeJS.Timeout | undefined
	const expired = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(onTimeout()), ms) })
	return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}
