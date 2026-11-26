import { DataChangeSummary } from '../../domain/runtime/channelProtocol'
import { FileSchemaHistory } from '../output/admin/fileSchemaHistory'
import { resolveObservability, startObservability, stopObservability, withPrometheus } from './observability'
import { otelMetricsAsPromJson } from '../output/metrics/otelPrometheus'
import path from 'path'
import fs from 'fs'
import { InlineSchema, InlineSchemaDirectory } from '../../application/runtime/inlineSchemaDirectory'
import { MeasuredSchemaDirectory } from '../../application/runtime/measuredDirectory'
import { LoggerPort, MetricsPort, AuditPort, ClockPort, AuthenticatorPort, QueueOutcome } from '../../application/ports/output/supportPorts'
import { Listeners } from '../../application/runtime/listeners'
import { DataGatewayConfig, TransportName } from '../../domain/config/dataGatewayConfig'
import { ConfigError, GatewayError } from '../../domain/errors/gatewayError'
import { effectiveAuthentication, effectiveSettings, resolveSchemas, SchemaDescriptor, SchemaSettings } from '../../domain/runtime/schemas'
import { Transport } from '../input/transport'
import { StdoutAuditAdapter } from '../output/audit/stdoutAuditAdapter'
import { SystemClock } from '../output/clock/systemClock'
import { FileSystemSchemaDiscovery } from '../output/discovery/fileSystemSchemaDiscovery'
import { ConsoleLogger, WinstonLogger } from '../output/logger/loggers'
import { NoMetrics, PromClientMetrics } from '../output/metrics/promClientMetrics'
import { AuthenticatorRegistry, TransportRegistry } from './registries'
import { composeSchema, ComposedSchema } from './schemaComposer'
import { AdminService } from '../../application/admin/adminService'
import { CommandService } from '../../application/admin/commandService'
import { SchemaDirectoryPort } from '../../application/ports/input/schemaDirectoryPort'
import { FileWorkspaceStore } from '../output/admin/fileWorkspaceStore'
import { LambdaSchemaValidator } from '../output/admin/lambdaSchemaValidator'
import { YamlAdapter } from '../output/admin/yamlAdapter'
import { NodeCodeGenerator } from '../output/admin/nodeCodeGenerator'
import { ThreeExprLanguage } from '../output/admin/threeExprLanguage'
import { SqliteSessionState } from '../output/admin/sqliteSessionState'

export interface BuildOptions {
	logger?: LoggerPort
	metrics?: MetricsPort
	audit?: AuditPort
	clock?: ClockPort
	authenticators?: AuthenticatorRegistry
	transports?: TransportRegistry
	version?: string
	/** Open a connection of each source at start (default false in the inline runtime) */
	checkConnections?: boolean
}

/** The gateway running inline: its transports and what has to be closed on shutdown. */
export class RunningGateway {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		public readonly transports: Transport[],
		private readonly schemas: ComposedSchema[],
		private readonly logger: LoggerPort
	) {}

	public async start (): Promise<void> {
		await Promise.all(this.transports.map(transport => transport.start()))
	}

	/** Stops accepting requests, then closes the queues and the connection pools */
	public async stop (): Promise<void> {
		await Promise.all(this.transports.map(transport => transport.stop().catch(error => this.logger.error(error))))
		await Promise.all(this.schemas.map(schema => schema.stop()))
		await stopObservability().catch(() => undefined)
	}
}

/** The logger of a worker, its lines labeled with it ([edge], [schema:iot/v1], [supervisor]) */
export const buildLogger = (config: Pick<DataGatewayConfig, 'logger'>, label = ''): LoggerPort =>
	config.logger.adapter === 'winston' ? new WinstonLogger(config.logger.level, label) : new ConsoleLogger(config.logger.level, label)

/** The configuration as it can be logged: secrets and the variables given to the schemas masked */
export const maskSecrets = (config: DataGatewayConfig): unknown => JSON.parse(JSON.stringify(config, (key, value) =>
	['value', 'password', 'token', 'secret', 'secretAccessKey', 'accountKey'].includes(key) && typeof value === 'string' ? '***'
		// a url with a password (cluster.valkey.url): without it
		: key === 'url' && typeof value === 'string' && /^[a-z]+:\/\/[^/]*@/i.test(value) ? value.replace(/\/\/[^/]*@/, '//***@')
		: key === 'env' && value && typeof value === 'object' && !Array.isArray(value) && !('isolate' in value)
			? Object.fromEntries(Object.keys(value).map(k => [k, '***']))
			: value))

export const packageVersion = (): string => {
	for (const candidate of ['../../../package.json', '../../../../package.json', '../../package.json']) {
		const file = path.join(__dirname, candidate)
		if (fs.existsSync(file)) {
			const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
			if (pkg.name === '@lambdaorm/data-gateway') return pkg.version
		}
	}
	return '0.0.0'
}

/** data_gateway_connections{transport}: open WebSocket connections, SSE streams and sessions */
export const measureConnections = (metrics: MetricsPort, transports: Transport[]): void => {
	metrics.gauge('data_gateway_connections', 'Open connections by transport (WebSocket, SSE, stateful sessions)', ['transport'],
		() => transports.filter(t => t.connections !== undefined).map(t => ({ labels: { transport: t.name }, value: t.connections! })))
}

/** Discovered under orm.workspacePath + declared in orm.schemas, checked; ConfigError with every problem */
export const resolveConfiguredSchemas = (config: DataGatewayConfig, logger?: LoggerPort): { descriptor: SchemaDescriptor, settings: SchemaSettings }[] => {
	const discovered = config.orm.workspacePath ? new FileSystemSchemaDiscovery().discover(config.orm.workspacePath) : []
	const { schemas, issues, waiting } = resolveSchemas(config, discovered)
	if (issues.length) throw new ConfigError(issues)
	for (const problem of waiting) logger?.warn(`[data-gateway] ${problem}: waiting for it (orm.watch)`)
	return schemas.map(descriptor => ({ descriptor, settings: effectiveSettings(config, descriptor) }))
}

/** transports.management: the administration of the workspaces of the schemas the directory serves */
export const buildAdmin = (config: DataGatewayConfig, directory: SchemaDirectoryPort, logger: LoggerPort, clock: ClockPort, reloads = false): { service: AdminService, commands: CommandService } | undefined => {
	if (!config.admin.enabled) return undefined
	const anonymousAdmin = config.admin.allowAnonymous && config.authentication.adapter === 'none'
	const store = new FileWorkspaceStore()
	const stateOf = (path: string) => directory.states().find(s => s.path === path)
	// a lambdaORM.yaml written is served once the monitor of the workspaces reloads it (the process, with orm.watch)
	const reloaded = async (path: string, since: string | undefined): Promise<void> => {
		if (!reloads) throw new GatewayError(409, 'ConflictError', 'this gateway does not reload its schemas (orm.watch, the process runtime): incorporate can\'t push the new schema')
		const pendingBefore = stateOf(path)?.pending
		const end = Date.now() + config.admin.commandTimeoutMs
		while (Date.now() < end) {
			const state = stateOf(path)
			if (state?.status === 'ready' && state.since !== since && !state.pending) return
			if (state?.pending && state.pending !== pendingBefore) throw new GatewayError(422, 'SchemaValidationError', state.pending)
			await new Promise(resolve => setTimeout(resolve, 200))
		}
		throw new GatewayError(504, 'TimeoutError', `schema "${path}" did not reload in ${config.admin.commandTimeoutMs} ms`)
	}
	const commands = new CommandService({ anonymousAdmin, timeoutMs: config.admin.commandTimeoutMs, previewTtlMs: 10 * 60000, keepJobs: 200, reloaded, since: path => stateOf(path)?.since },
		() => directory.schemas(), store, new YamlAdapter(), clock, logger)
	const service = new AdminService({
		root: config.orm.workspacePath ? path.resolve(config.orm.workspacePath) : undefined,
		anonymousAdmin: config.admin.allowAnonymous && config.authentication.adapter === 'none',
		maxFileBytes: config.admin.maxFileBytes
	},
	() => directory.schemas().filter(s => s.workspace !== undefined).map(s => ({ path: s.path, workspace: s.workspace! })),
	() => directory.states(),
	store, new LambdaSchemaValidator(), new YamlAdapter(), clock, logger, new NodeCodeGenerator(), new ThreeExprLanguage(),
	config.orm.workspacePath ? new SqliteSessionState(path.join(path.resolve(config.orm.workspacePath), '.data-gateway', 'state.sqlite')) : undefined,
	new FileSchemaHistory(change => directory.workspaceChanged?.(change)))
	return { service, commands }
}

/** The authenticator of a schema on each transport that exposes it: schema → transport → global */
export const schemaAuthenticators = (config: DataGatewayConfig, descriptor: SchemaDescriptor, settings: SchemaSettings, registry: AuthenticatorRegistry): Partial<Record<TransportName, AuthenticatorPort>> =>
	Object.fromEntries(settings.transports.map(transport => [transport, registry.build(effectiveAuthentication(config, descriptor, transport))]))

/**
 * Composition root of the inline runtime: every schema in this thread, next to the transports (tests, and tools that
 * embed the gateway). The process runs the supervisor (supervisorMain), with a worker per schema and the edge.
 */
export class DataGatewayBuilder {
	public async build (config: DataGatewayConfig, options: BuildOptions = {}): Promise<RunningGateway> {
		const logger = options.logger ?? buildLogger(config)
		const metrics = options.metrics ?? (config.metrics.enabled ? new PromClientMetrics() : new NoMetrics())
		const clock = options.clock ?? new SystemClock()
		const audit = options.audit ?? new StdoutAuditAdapter()
		const version = options.version ?? packageVersion()
		const authenticators = options.authenticators ?? new AuthenticatorRegistry()
		// the SDK before λORM (inline, one for every schema of this thread)
		const observability = withPrometheus(resolveObservability(config.observability, process.env), config.metrics.enabled)
		await startObservability(observability, logger)
		// λORM's metrics (OpenTelemetry) in /metrics, with the gateway's
		if (metrics.enabled) metrics.addSource(() => otelMetricsAsPromJson('edge'))

		const composed: ComposedSchema[] = []
		const inline: InlineSchema[] = []
		try {
			// inline nothing is watched: an empty volume, or an adjustment of nothing, is a problem as without orm.watch
			const unwatched = { ...config, orm: { ...config.orm, watch: { ...config.orm.watch, enabled: false } } }
			for (const { descriptor, settings } of resolveConfiguredSchemas(unwatched)) {
				const queueOutcomes = new Listeners<QueueOutcome>()
				const dataChanges = new Listeners<DataChangeSummary[]>()
				const schema = await composeSchema({
					path: descriptor.path,
					workspace: descriptor.workspace,
					settings,
					audit: config.audit,
					mcpName: config.mcp.name,
					pageSize: config.mcp.pageSize,
					version,
					checkConnections: options.checkConnections ?? false,
					admin: config.admin.enabled,
					observability
				}, { logger, audit, clock, queueEvents: { completed: outcome => queueOutcomes.emit(outcome) }, dataEvents: changes => dataChanges.emit(changes) })
				composed.push(schema)
				inline.push({
					path: descriptor.path,
					workspace: descriptor.workspace,
					commands: schema.commands,
					gateway: schema.gateway,
					mcp: schema.mcp,
					transports: settings.transports,
					features: { scripts: settings.scripts.enabled },
					queueOutcomes,
					dataChanges,
					authenticators: schemaAuthenticators(config, descriptor, settings, authenticators)
				})
			}
		} catch (error) {
			await Promise.all(composed.map(schema => schema.stop()))
			throw error
		}
		const inlineDirectory = new InlineSchemaDirectory(inline, clock, version)
		const directory = metrics.enabled ? new MeasuredSchemaDirectory(inlineDirectory, metrics) : inlineDirectory
		const admin = buildAdmin(config, directory, logger, clock)
		const transports = (options.transports ?? new TransportRegistry()).build({ config, directory, metrics, logger, admin })
		measureConnections(metrics, transports)
		logger.info(`[data-gateway] ${version} (inline): schemas ${inline.map(s => `/${s.path}`).join(', ')}; rate limit ${config.rateLimit.max > 0 ? `${config.rateLimit.max} per ${config.rateLimit.windowMs} ms` : 'off'}; ` +
			`scripts ${config.scripts.enabled ? 'enabled' : 'disabled'}; audit ${config.audit.enabled ? 'on' : 'off'}; authentication ${config.authentication.adapter}`)
		return new RunningGateway(transports, composed, logger)
	}
}
