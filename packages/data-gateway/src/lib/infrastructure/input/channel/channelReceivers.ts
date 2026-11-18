import net from 'net'
import fs from 'fs'
import { MessagePort } from 'worker_threads'
import { ChannelDispatcher } from '../../../application/runtime/channelDispatcher'
import { LoggerPort } from '../../../application/ports/output/supportPorts'
import { ChannelEvent, ChannelRequest } from '../../../domain/runtime/channelProtocol'
import { FrameDecoder, encodeFrame } from '../../shared/framing'

/** Sends an event to the edge(s) a channel serves */
export type EventSender = (event: ChannelEvent) => void

/** thread mode: answers the requests of one edge port; the result bytes are transferred, not copied */
export const receiveOnPort = (port: MessagePort, dispatcher: ChannelDispatcher): EventSender => {
	port.on('message', async (request: ChannelRequest) => {
		const response = await dispatcher.dispatch(request)
		if (!response) return
		try {
			port.postMessage(response, response.json ? [response.json.buffer as ArrayBuffer] : [])
		} catch {
			// the edge closed its end (it restarted): nobody waits for this answer
		}
	})
	return event => {
		try { port.postMessage(event) } catch { /* the edge is gone */ }
	}
}

/** process mode: a unix socket the edge connects to (again, after it restarts) */
export const receiveOnSocket = (socketPath: string, dispatcher: ChannelDispatcher, logger: LoggerPort): Promise<{ server: net.Server, send: EventSender }> => {
	if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath)
	const sockets = new Set<net.Socket>()
	const send: EventSender = event => {
		for (const socket of sockets) if (!socket.destroyed) socket.write(encodeFrame(event))
	}
	const server = net.createServer(socket => {
		sockets.add(socket)
		socket.on('close', () => sockets.delete(socket))
		const frames = new FrameDecoder(async (message: ChannelRequest) => {
			const response = await dispatcher.dispatch(message)
			if (response && !socket.destroyed) socket.write(encodeFrame(response))
		})
		socket.on('data', chunk => frames.push(chunk))
		socket.on('error', error => logger.warn(`[data-gateway] channel socket: ${error.message}`))
	})
	return new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(socketPath, () => {
			server.off('error', reject)
			resolve({ server, send })
		})
	})
}
