import net from 'net'
import fs from 'fs'
import { MessagePort } from 'worker_threads'
import { ChannelDispatcher } from '../../../application/runtime/channelDispatcher'
import { LoggerPort } from '../../../application/ports/output/supportPorts'
import { ChannelRequest } from '../../../domain/runtime/channelProtocol'
import { FrameDecoder, encodeFrame } from '../../shared/framing'

/** thread mode: answers the requests of one edge port; the result bytes are transferred, not copied */
export const receiveOnPort = (port: MessagePort, dispatcher: ChannelDispatcher): void => {
	port.on('message', async (request: ChannelRequest) => {
		const response = await dispatcher.dispatch(request)
		if (!response) return
		try {
			port.postMessage(response, response.json ? [response.json.buffer as ArrayBuffer] : [])
		} catch {
			// the edge closed its end (it restarted): nobody waits for this answer
		}
	})
}

/** process mode: a unix socket the edge connects to (again, after it restarts) */
export const receiveOnSocket = (socketPath: string, dispatcher: ChannelDispatcher, logger: LoggerPort): Promise<net.Server> => {
	if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath)
	const server = net.createServer(socket => {
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
			resolve(server)
		})
	})
}
