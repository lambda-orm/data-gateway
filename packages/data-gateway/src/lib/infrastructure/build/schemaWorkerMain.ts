// Composition root of a schema worker (a thread or a process): λORM on one workspace, its facade and MCP server, and
// the receiving end of the channel with the edge.
import path from 'path'
import net from 'net'
import { randomBytes } from 'crypto'
import { MessagePort } from 'worker_threads'
import { ChannelDispatcher } from '../../application/runtime/channelDispatcher'
import { EventSender, receiveOnPort, receiveOnSocket } from '../input/channel/channelReceivers'
import { ChannelEvent } from '../../domain/runtime/channelProtocol'
import { StdoutAuditAdapter } from '../output/audit/stdoutAuditAdapter'
import { SystemClock } from '../output/clock/systemClock'
import { ConsoleLogger, WinstonLogger } from '../output/logger/loggers'
import { PromClientMetrics } from '../output/metrics/promClientMetrics'
import { composeSchema, ComposedSchema } from './schemaComposer'
import { control, SchemaWorkerData } from './workerControl'
import { startObservability, stopObservability } from './observability'
import { otelMetricsAsPromJson } from '../output/metrics/otelPrometheus'

const ctl = control()
let started = false

const run = async (): Promise<void> => {
	const data = ctl.data<SchemaWorkerData>()
	const label = `[schema:${data.descriptor.path || '/'}]`
	const logger = data.logger.adapter === 'winston' ? new WinstonLogger(data.logger.level, label) : new ConsoleLogger(data.logger.level, label)
	// its event loop lag, memory and GC, for the edge's /metrics
	const metrics = data.metricsEnabled ? new PromClientMetrics(`schema:${data.descriptor.path || '/'}`) : undefined
	const name = `schema "${data.descriptor.path || '/'}"`
	// the heartbeat is answered from the first moment: a slow start is not a hang
	let schema: ComposedSchema | undefined
	let server: net.Server | undefined
	let dispatcher: ChannelDispatcher | undefined
	const pendingPorts: MessagePort[] = []
	// every channel with the edge (a new one when the edge restarts): events go to all of them
	const senders: EventSender[] = []
	const broadcast = (event: ChannelEvent) => { for (const send of senders) send(event) }
	ctl.on(async request => {
		if (request.type === 'ping') {
			ctl.send({ type: 'pong' })
		} else if (request.type === 'attach') {
			const port = request.port as MessagePort
			if (dispatcher) senders.push(receiveOnPort(port, dispatcher))
			else pendingPorts.push(port)
		} else if (request.type === 'stop') {
			server?.close()
			await schema?.stop()
			// what is pending goes to the exporter
			await stopObservability().catch(() => undefined)
			process.exit(0)
		}
	})
	// the SDK before λORM: its Orm uses it
	const tracing = await startObservability(data.observability, logger)
	try {
		schema = await composeSchema({
			path: data.descriptor.path,
			workspace: data.descriptor.workspace,
			settings: data.settings,
			audit: data.audit,
			mcpName: data.mcp.name,
			pageSize: data.mcp.pageSize,
			version: data.version,
			checkConnections: data.settings.runtime.checkConnections,
			admin: data.admin,
			observability: data.observability
		}, {
			logger,
			audit: new StdoutAuditAdapter(),
			clock: new SystemClock(),
			queueEvents: { completed: outcome => broadcast({ type: 'event', event: 'queue', outcome }) },
			dataEvents: changes => broadcast({ type: 'event', event: 'data', changes }),
			metrics
		})
	} catch (error: any) {
		const reason = error?.issues ? error.issues.join('; ') : (error?.message ?? String(error))
		logger.error(`[data-gateway] ${name} did not start: ${reason}`)
		ctl.send({ type: 'failed', reason })
		// let the message leave before the worker ends
		setTimeout(() => process.exit(1), 50)
		return
	}
	dispatcher = new ChannelDispatcher(schema.gateway, schema.mcp, data.settings.server.maxResponseBytes, logger, metrics ? async () => [...await metrics.snapshot(), ...await otelMetricsAsPromJson(`schema:${data.descriptor.path || '/'}`)] : undefined, schema.commands, tracing)
	for (const port of pendingPorts.splice(0)) senders.push(receiveOnPort(port, dispatcher))
	let socketPath: string | undefined
	if (data.settings.runtime.mode === 'process') {
		socketPath = path.join(data.socketDir, `data-gateway-${process.pid}-${randomBytes(4).toString('hex')}.sock`)
		const socket = await receiveOnSocket(socketPath, dispatcher, logger)
		server = socket.server
		senders.push(socket.send)
	}
	started = true
	ctl.send({ type: 'ready', info: schema.mcp.info(), socketPath })
}

// a driver may throw outside any await (a pool's 'error' event): before ready it is why the schema didn't start;
// after, the worker ends and the supervisor restarts it
process.on('uncaughtException', error => {
	if (!started) {
		ctl.send({ type: 'failed', reason: error?.message ?? String(error) })
		setTimeout(() => process.exit(1), 50)
		return
	}
	console.error('[data-gateway] schema worker: uncaught exception', error)
	process.exit(1)
})

run()
