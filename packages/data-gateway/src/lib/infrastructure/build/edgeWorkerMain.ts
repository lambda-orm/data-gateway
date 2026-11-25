// Composition root of the edge worker: every transport, the authentication and the router to the schema workers.
// It runs no queries and no code of the user; if it falls, the supervisor restarts it and the schemas keep running.
import { MessagePort } from 'worker_threads'
import { SchemaRouter } from '../../application/runtime/schemaRouter'
import { MessagePortChannel, SocketChannel } from '../output/channel/channelClients'
import { SystemClock } from '../output/clock/systemClock'
import { NoMetrics, PromClientMetrics } from '../output/metrics/promClientMetrics'
import { buildAdmin, buildLogger, measureConnections, schemaAuthenticators } from './dataGatewayBuilder'
import { MeasuredSchemaDirectory } from '../../application/runtime/measuredDirectory'
import { AuthenticatorRegistry, TransportRegistry } from './registries'
import { control, EdgeWorkerData } from './workerControl'
import { startObservability, stopObservability } from './observability'

const run = async (): Promise<void> => {
	const ctl = control()
	const data = ctl.data<EdgeWorkerData>()
	const { config } = data
	const logger = buildLogger(config, '[edge]')
	const registry = new AuthenticatorRegistry()
	const routed = ({ descriptor, settings }: EdgeWorkerData['schemas'][number]) => ({
		path: descriptor.path,
		workspace: descriptor.workspace,
		transports: settings.transports,
		maxConcurrent: settings.server.maxConcurrent,
		timeout: settings.server.timeout,
		scriptsEnabled: settings.scripts.enabled,
		authenticators: schemaAuthenticators(config, descriptor, settings, registry)
	})
	// the SDK of the edge: the spans of the transports, and their traceparent to the workers
	const tracing = await startObservability(data.observability, logger)
	const router = new SchemaRouter(data.schemas.map(routed), new SystemClock(), data.version, tracing)
	const metrics = config.metrics.enabled ? new PromClientMetrics('edge') : new NoMetrics()
	// /metrics: the edge's and every schema worker's, asked through its channel (the ones served at that moment)
	metrics.addSource(() => Promise.all(router.states().map(s => router.workerMetrics(s.path).catch(() => []))))
	const directory = metrics.enabled ? new MeasuredSchemaDirectory(router, metrics) : router
	const admin = buildAdmin(config, directory, logger, new SystemClock(), config.orm.watch.enabled)
	const transports = new TransportRegistry().build({ config, directory, metrics, logger, admin })
	measureConnections(metrics, transports)
	ctl.on(async request => {
		switch (request.type) {
		case 'ping':
			ctl.send({ type: 'pong' })
			break
		case 'state':
			router.setState(request.state)
			break
		case 'add':
			router.add(routed(request.schema))
			break
		case 'remove':
			router.remove(request.path)
			break
		case 'workspace':
			router.workspaceChanged(request.change)
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
			await stopObservability().catch(() => undefined)
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
