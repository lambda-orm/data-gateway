import net from 'net'
import { MessagePort } from 'worker_threads'
import { SchemaChannelPort } from '../../../application/ports/output/runtimePorts'
import { GatewayError, unavailable } from '../../../domain/errors/gatewayError'
import { ChannelEvent, ChannelRequest, ChannelResponse, WireError } from '../../../domain/runtime/channelProtocol'
import { FrameDecoder, encodeFrame } from '../../shared/framing'

const decoder = new TextDecoder()

/** The error again, as the transports know it: a GatewayError when it had a status, else with its code and value */
const fromWire = (wire: WireError): Error => {
	const error: any = wire.status !== undefined
		? new GatewayError(wire.status, wire.name, wire.message, wire.code)
		: Object.assign(new Error(wire.message), { name: wire.name, code: wire.code })
	if (wire.value) error.value = wire.value
	if (wire.suggestions) error.suggestions = wire.suggestions
	return error
}

/** Requests waiting for their response, by id; a closed channel fails them all with 503 */
abstract class PendingChannel implements SchemaChannelPort {
	private nextId = 1
	private readonly pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
	protected closed = false
	private eventListener: ((event: ChannelEvent) => void) | undefined

	public onEvent (listener: (event: ChannelEvent) => void): void {
		this.eventListener = listener
	}

	protected abstract send (request: ChannelRequest): void
	protected abstract dispose (): void

	public request (request: Omit<ChannelRequest, 'type' | 'id'>): Promise<unknown> {
		if (this.closed) return Promise.reject(unavailable('SchemaUnavailableError', 'the schema worker is not connected'))
		const id = this.nextId++
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject })
			try {
				this.send({ type: 'request', id, ...request })
			} catch (error) {
				this.pending.delete(id)
				reject(error)
			}
		})
	}

	/** A response that arrives after the edge stopped waiting finds nobody and is dropped */
	protected receive (message: ChannelResponse | ChannelEvent): void {
		if (message.type === 'event') {
			this.eventListener?.(message)
			return
		}
		const response = message
		const waiting = this.pending.get(response.id)
		if (!waiting) return
		this.pending.delete(response.id)
		if (response.error) {
			waiting.reject(fromWire(response.error))
			return
		}
		waiting.resolve(response.json ? JSON.parse(decoder.decode(response.json)) : undefined)
	}

	public close (): void {
		if (this.closed) return
		this.closed = true
		this.dispose()
		for (const waiting of this.pending.values()) waiting.reject(unavailable('SchemaUnavailableError', 'the schema worker went away'))
		this.pending.clear()
	}
}

/** thread mode: a MessagePort of a MessageChannel whose other end is in the schema worker */
export class MessagePortChannel extends PendingChannel {
	constructor (private readonly port: MessagePort) {
		super()
		port.on('message', (message: ChannelResponse | ChannelEvent) => this.receive(message))
		port.on('close', () => this.close())
	}

	protected send (request: ChannelRequest): void {
		this.port.postMessage(request)
	}

	protected dispose (): void {
		this.port.close()
	}
}

/** process mode: the unix socket the schema process listens on */
export class SocketChannel extends PendingChannel {
	private constructor (private readonly socket: net.Socket) {
		super()
		const frames = new FrameDecoder((message: ChannelResponse | ChannelEvent) => this.receive(message))
		socket.on('data', chunk => frames.push(chunk))
		socket.on('close', () => this.close())
		socket.on('error', () => this.close())
	}

	public static connect (socketPath: string): Promise<SocketChannel> {
		return new Promise((resolve, reject) => {
			const socket = net.createConnection(socketPath)
			socket.once('error', reject)
			socket.once('connect', () => {
				socket.off('error', reject)
				resolve(new SocketChannel(socket))
			})
		})
	}

	protected send (request: ChannelRequest): void {
		this.socket.write(encodeFrame(request))
	}

	protected dispose (): void {
		this.socket.destroy()
	}
}
