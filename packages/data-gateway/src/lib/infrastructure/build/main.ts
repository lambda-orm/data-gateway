import path from 'path'
import { ConfigSourcePort, LoggerPort } from '../../application/ports/output/supportPorts'
import { Supervisor } from '../../application/runtime/supervisor'
import { ConfigReader } from '../../domain/config/configReader'
import { DataGatewayConfig } from '../../domain/config/dataGatewayConfig'
import { ConfigError } from '../../domain/errors/gatewayError'
import { HeartbeatPolicy, RestartPolicy } from '../../domain/runtime/policies'
import { schemaEnv, threadpoolSize } from '../../domain/runtime/schemas'
import { SystemClock } from '../output/clock/systemClock'
import { DotEnvFileReader } from '../output/discovery/dotEnvFileReader'
import { FileWorkspaceFiles, FsWorkspaceWatcher } from '../output/discovery/workspaceWatch'
import { WorkspaceMonitor } from '../../application/runtime/workspaceMonitor'
import { SchemaDescriptor, SchemaSettings } from '../../domain/runtime/schemas'
import { ConsoleLogger } from '../output/logger/loggers'
import { YamlFileConfigSource } from '../output/config/yamlFileConfigSource'
import { EdgeWorkerRuntime, SchemaWorkerRuntime } from '../output/runtime/workerRuntimes'
import { applicableObservability } from './observability'
import { withPersist } from './persist'
import { closeState, roleStoreOf, stateSourceOf } from '../output/state/stateStores'
import { buildLogger, DataGatewayBuilder, maskSecrets, packageVersion, resolveConfiguredSchemas, RunningGateway } from './dataGatewayBuilder'

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
	// where the state is kept, as the administration changed it (.data-gateway/persist.yaml), over state of the YAML
	reading.config = withPersist(reading.config)
	const logger = buildLogger(reading.config, '[supervisor]')
	for (const note of reading.notes) logger.info(note)
	logger.info(`[data-gateway] configuration ${source.location}`)
	logger.info(`[data-gateway] effective configuration: ${JSON.stringify(maskSecrets(reading.config))}`)
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
	const read = await readConfig(options)
	const logger = read.logger
	// the configuration in use: where the state is kept may change from the administration (persist.yaml)
	let config = read.config
	const schemas = resolveConfiguredSchemas(config, logger)
	const threads = schemas.filter(s => s.settings.runtime.mode === 'thread').length
	// before any worker (and anything of this thread) uses the libuv threadpool
	if (process.env.UV_THREADPOOL_SIZE === undefined) process.env.UV_THREADPOOL_SIZE = String(threadpoolSize(config.runtime.threadpoolSize, threads))
	const gatewayEnv = options.env ?? process.env
	const dotEnv = new DotEnvFileReader()
	const specOf = ({ descriptor, settings }: { descriptor: SchemaDescriptor, settings: SchemaSettings }) => ({
		descriptor,
		settings,
		env: schemaEnv(gatewayEnv, dotEnv.read(descriptor.workspace), descriptor, config.runtime.env)
	})
	const specs = schemas.map(specOf)
	const version = packageVersion()
	// the observability changed from the administration (kept in the state) is over the one of the YAML from the start
	const override = await storedObservability(config, logger)
	const runtimeSettings: { config: DataGatewayConfig, version: string, logger: LoggerPort, observability: ReturnType<typeof applicableObservability>, observabilityOverride?: Record<string, any> } =
		{ config, version, logger, observability: applicableObservability(config, override, gatewayEnv, logger), ...(override ? { observabilityOverride: override } : {}) }
	// saved again (here or in another replica): the edge restarts with it, and the schemas when their SDK changes
	const observe = (next: Record<string, any> | undefined) => {
		const observability = applicableObservability(config, next, gatewayEnv, logger)
		const schemas = JSON.stringify(observability) !== JSON.stringify(runtimeSettings.observability)
		runtimeSettings.observability = observability
		runtimeSettings.observabilityOverride = next
		logger.info(`[data-gateway] observability changed: restarting the edge${schemas ? ' and reloading the schemas' : ''}`)
		supervisor.restart({ schemas }).catch(error => logger.error(error))
	}
	const supervisor = new Supervisor(
		specs,
		new SchemaWorkerRuntime(runtimeSettings),
		new EdgeWorkerRuntime(runtimeSettings),
		{
			restart: new RestartPolicy(config.runtime.restart.initialDelayMs, config.runtime.restart.maxDelayMs),
			heartbeat: new HeartbeatPolicy(config.runtime.heartbeat.intervalMs, config.runtime.heartbeat.timeoutMs),
			graceMs: config.server.timeout,
			onObservability: observe,
			onPersist: () => {
				// the state is somewhere else now: its schemas (their approvals) and the edge (its sessions, roles) with it
				config = withPersist(read.config.state.yaml ? { ...read.config, state: { ...read.config.state.yaml } } : read.config)
				runtimeSettings.config = config
				logger.info(`[data-gateway] the state is kept somewhere else now: restarting the edge and reloading the schemas`)
				for (const schema of resolveConfiguredSchemas(config, logger)) supervisor.reload(specOf(schema))
				supervisor.restart({ schemas: false }).catch(error => logger.error(error))
			}
		},
		new SystemClock(),
		logger
	)
	logger.info(`[data-gateway] ${version}: schemas ${schemas.map(s => `/${s.descriptor.path} (${s.settings.runtime.mode})`).join(', ')}; ` +
		`UV_THREADPOOL_SIZE ${process.env.UV_THREADPOOL_SIZE}; env ${config.runtime.env.isolate ? 'isolated' : 'shared'}; authentication ${config.authentication.adapter}`)
	supervisor.start()
	if (config.orm.watch.enabled) {
		const roots = [...new Set([
			...(config.orm.workspacePath ? [path.resolve(config.orm.workspacePath)] : []),
			...config.orm.schemas.filter(s => s.workspace !== undefined).map(s => path.resolve(s.workspace!))
		])]
		const monitor = new WorkspaceMonitor({
			roots,
			resolve: () => resolveConfiguredSchemas(config),
			spec: specOf,
			intervalMs: config.orm.watch.intervalMs,
			debounceMs: config.orm.watch.debounceMs
		}, supervisor, new FsWorkspaceWatcher(logger), new FileWorkspaceFiles(), new SystemClock(), logger)
		monitor.start(schemas)
		supervisor.attach(monitor)
		logger.info(`[data-gateway] watching the workspaces: ${roots.join(', ')} (scan every ${config.orm.watch.intervalMs} ms)`)
	}
	return supervisor
}

/** The observability the administration put in the state (none when it can't be read: the YAML's) */
const storedObservability = async (config: DataGatewayConfig, logger: LoggerPort): Promise<Record<string, any> | undefined> => {
	const source = stateSourceOf(config.state, config.orm.workspacePath)
	if (source.kind === 'memory') return undefined
	const store = roleStoreOf(source)
	try {
		return (await store.setting('observability'))?.value as Record<string, any> | undefined
	} catch (error: any) {
		logger.warn(`[data-gateway] state: the observability of the state can't be read (${error?.message ?? error}): the one of the configuration`)
		return undefined
	} finally {
		(store as { close?: () => void }).close?.()
		await closeState(source).catch(() => undefined)
	}
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
