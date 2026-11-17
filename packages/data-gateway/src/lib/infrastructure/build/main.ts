import { ConfigSourcePort, LoggerPort } from '../../application/ports/output/supportPorts'
import { Supervisor } from '../../application/runtime/supervisor'
import { ConfigReader } from '../../domain/config/configReader'
import { DataGatewayConfig } from '../../domain/config/dataGatewayConfig'
import { ConfigError } from '../../domain/errors/gatewayError'
import { HeartbeatPolicy, RestartPolicy } from '../../domain/runtime/policies'
import { schemaEnv, threadpoolSize } from '../../domain/runtime/schemas'
import { SystemClock } from '../output/clock/systemClock'
import { DotEnvFileReader } from '../output/discovery/dotEnvFileReader'
import { ConsoleLogger } from '../output/logger/loggers'
import { YamlFileConfigSource } from '../output/config/yamlFileConfigSource'
import { EdgeWorkerRuntime, SchemaWorkerRuntime } from '../output/runtime/workerRuntimes'
import { buildLogger, DataGatewayBuilder, packageVersion, resolveConfiguredSchemas, RunningGateway } from './dataGatewayBuilder'

export interface MainOptions {
	source?: ConfigSourcePort
	builder?: DataGatewayBuilder
	/** Before the configuration is read (it chooses the logger) */
	bootLogger?: LoggerPort
	/** The environment the schemas' variables come from (default process.env) */
	env?: Record<string, string | undefined>
}

const readConfig = async (options: MainOptions): Promise<{ config: DataGatewayConfig, logger: LoggerPort, location: string }> => {
	const bootLogger = options.bootLogger ?? new ConsoleLogger()
	const source = options.source ?? new YamlFileConfigSource()
	const reading = new ConfigReader().read(await source.load())
	for (const warning of reading.warnings) bootLogger.warn(warning)
	if (!reading.config) throw new ConfigError(reading.issues)
	const logger = buildLogger(reading.config)
	for (const note of reading.notes) logger.info(note)
	logger.info(`[data-gateway] configuration ${source.location}`)
	return { config: reading.config, logger, location: source.location }
}

/** Inline runtime (every schema in this thread): reads and checks the configuration, builds and starts the transports */
export const startGateway = async (options: MainOptions = {}): Promise<RunningGateway> => {
	const { config, logger } = await readConfig(options)
	const gateway = await (options.builder ?? new DataGatewayBuilder()).build(config, { logger })
	await gateway.start()
	return gateway
}

/**
 * The runtime of the process (docs/DATA_GATEWAY.md §3): this thread supervises, a worker per schema (thread or process,
 * each with its own env) and the edge worker with the transports. Throws ConfigError when the configuration can't be
 * used; a schema that doesn't start does not stop the others.
 */
export const startSupervisor = async (options: MainOptions = {}): Promise<Supervisor> => {
	const { config, logger } = await readConfig(options)
	const schemas = resolveConfiguredSchemas(config)
	const threads = schemas.filter(s => s.settings.runtime.mode === 'thread').length
	// before any worker (and anything of this thread) uses the libuv threadpool
	if (process.env.UV_THREADPOOL_SIZE === undefined) process.env.UV_THREADPOOL_SIZE = String(threadpoolSize(config.runtime.threadpoolSize, threads))
	const gatewayEnv = options.env ?? process.env
	const dotEnv = new DotEnvFileReader()
	const specs = schemas.map(({ descriptor, settings }) => ({
		descriptor,
		settings,
		env: schemaEnv(gatewayEnv, dotEnv.read(descriptor.workspace), descriptor, config.runtime.env)
	}))
	const version = packageVersion()
	const runtimeSettings = { config, version, logger }
	const supervisor = new Supervisor(
		specs,
		new SchemaWorkerRuntime(runtimeSettings),
		new EdgeWorkerRuntime(runtimeSettings, schemas),
		{
			restart: new RestartPolicy(config.runtime.restart.initialDelayMs, config.runtime.restart.maxDelayMs),
			heartbeat: new HeartbeatPolicy(config.runtime.heartbeat.intervalMs, config.runtime.heartbeat.timeoutMs),
			graceMs: config.server.timeout
		},
		new SystemClock(),
		logger
	)
	logger.info(`[data-gateway] ${version}: schemas ${schemas.map(s => `/${s.descriptor.path} (${s.settings.runtime.mode})`).join(', ')}; ` +
		`UV_THREADPOOL_SIZE ${process.env.UV_THREADPOOL_SIZE}; env ${config.runtime.env.isolate ? 'isolated' : 'shared'}; authentication ${config.authentication.adapter}`)
	supervisor.start()
	return supervisor
}

/** The process: starts the supervisor; on SIGTERM / SIGINT the edge finishes its requests, then the schemas close. */
export const main = async (): Promise<void> => {
	const logger = new ConsoleLogger()
	let supervisor: Supervisor
	try {
		supervisor = await startSupervisor({ bootLogger: logger })
	} catch (error: any) {
		logger.error(error instanceof ConfigError ? error.message : `the gateway did not start: ${error?.stack ?? error}`)
		process.exit(1)
	}
	let stopping = false
	const shutdown = async (signal: string) => {
		if (stopping) return
		stopping = true
		logger.info(`[data-gateway] ${signal}: shutting down`)
		await supervisor.stop()
		process.exit(0)
	}
	process.on('SIGTERM', () => { shutdown('SIGTERM') })
	process.on('SIGINT', () => { shutdown('SIGINT') })
}
