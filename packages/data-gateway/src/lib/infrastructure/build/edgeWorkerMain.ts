// Composition root of the edge worker: every transport, the authentication and the router to the schema workers.
// It runs no queries and no code of the user; if it falls, the supervisor restarts it and the schemas keep running.
import { MessagePort } from 'worker_threads'
import { SchemaRouter } from '../../application/runtime/schemaRouter'
import { MessagePortChannel, SocketChannel } from '../output/channel/channelClients'
import { SystemClock } from '../output/clock/systemClock'
import { NoMetrics, PromClientMetrics } from '../output/metrics/promClientMetrics'
import { buildLogger, schemaAuthenticators } from './dataGatewayBuilder'
import { AuthenticatorRegistry, TransportRegistry } from './registries'
import { control, EdgeWorkerData } from './workerControl'

const run = async (): Promise<void> => {
	const ctl = control()
	const data = ctl.data<EdgeWorkerData>()
	const { config } = data
	const logger = buildLogger(config)
	const registry = new AuthenticatorRegistry()
	const router = new SchemaRouter(data.schemas.map(({ descriptor, settings }) => ({
		path: descriptor.path,
		transports: settings.transports,
		maxConcurrent: settings.server.maxConcurrent,
		timeout: settings.server.timeout,
		scriptsEnabled: settings.scripts.enabled,
		authenticators: schemaAuthenticators(config, descriptor, settings, registry)
	})), new SystemClock(), data.version)
	const transports = new TransportRegistry().build({
		config,
		directory: router,
		metrics: config.metrics.enabled ? new PromClientMetrics() : new NoMetrics(),
		logger
	})
	ctl.on(async request => {
		switch (request.type) {
		case 'ping':
			ctl.send({ type: 'pong' })
			break
		case 'state':
			router.setState(request.state)
			break
		case 'connect':
			try {
				const channel = request.port
					? new MessagePortChannel(request.port as MessagePort)
					: await SocketChannel.connect(request.socketPath!)
				router.connect(request.path, channel, request.info)
			} catch (error: any) {
				logger.error(`[data-gateway] edge: no channel to schema "${request.path || '/'}": ${error?.message ?? error}`)
			}
			break
		case 'stop':
			// stop taking requests, let the ones in flight finish (the transports wait for them), then go
			await Promise.all(transports.map(t => t.stop().catch(error => logger.error(error))))
			router.closeAll()
			process.exit(0)
		}
	})
	try {
		await Promise.all(transports.map(t => t.start()))
	} catch (error: any) {
		const reason = error?.message ?? String(error)
		logger.error(`[data-gateway] edge did not start: ${reason}`)
		ctl.send({ type: 'failed', reason })
		setTimeout(() => process.exit(1), 50)
		return
	}
	ctl.send({ type: 'ready' })
}

process.on('uncaughtException', error => {
	console.error('[data-gateway] edge worker: uncaught exception', error)
	process.exit(1)
})

run()
