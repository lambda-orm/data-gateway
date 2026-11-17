import path from 'path'
import fs from 'fs'
import { InlineSchema, InlineSchemaDirectory } from '../../application/runtime/inlineSchemaDirectory'
import { LoggerPort, MetricsPort, AuditPort, ClockPort, AuthenticatorPort } from '../../application/ports/output/supportPorts'
import { DataGatewayConfig, TransportName } from '../../domain/config/dataGatewayConfig'
import { ConfigError } from '../../domain/errors/gatewayError'
import { effectiveAuthentication, effectiveSettings, resolveSchemas, SchemaDescriptor, SchemaSettings } from '../../domain/runtime/schemas'
import { Transport } from '../input/transport'
import { StdoutAuditAdapter } from '../output/audit/stdoutAuditAdapter'
import { SystemClock } from '../output/clock/systemClock'
import { FileSystemSchemaDiscovery } from '../output/discovery/fileSystemSchemaDiscovery'
import { ConsoleLogger, WinstonLogger } from '../output/logger/loggers'
import { NoMetrics, PromClientMetrics } from '../output/metrics/promClientMetrics'
import { AuthenticatorRegistry, TransportRegistry } from './registries'
import { composeSchema, ComposedSchema } from './schemaComposer'

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
	}
}

export const buildLogger = (config: DataGatewayConfig): LoggerPort =>
	config.logger.adapter === 'winston' ? new WinstonLogger(config.logger.level) : new ConsoleLogger(config.logger.level)

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

/** Discovered under orm.workspacePath + declared in orm.schemas, checked; ConfigError with every problem */
export const resolveConfiguredSchemas = (config: DataGatewayConfig): { descriptor: SchemaDescriptor, settings: SchemaSettings }[] => {
	const discovered = config.orm.workspacePath ? new FileSystemSchemaDiscovery().discover(config.orm.workspacePath) : []
	const { schemas, issues } = resolveSchemas(config, discovered)
	if (issues.length) throw new ConfigError(issues)
	return schemas.map(descriptor => ({ descriptor, settings: effectiveSettings(config, descriptor) }))
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

		const composed: ComposedSchema[] = []
		const inline: InlineSchema[] = []
		try {
			for (const { descriptor, settings } of resolveConfiguredSchemas(config)) {
				const schema = await composeSchema({
					path: descriptor.path,
					workspace: descriptor.workspace,
					settings,
					audit: config.audit,
					mcpName: config.mcp.name,
					pageSize: config.mcp.pageSize,
					version,
					checkConnections: options.checkConnections ?? false
				}, { logger, audit, clock })
				composed.push(schema)
				inline.push({
					path: descriptor.path,
					gateway: schema.gateway,
					mcp: schema.mcp,
					transports: settings.transports,
					authenticators: schemaAuthenticators(config, descriptor, settings, authenticators)
				})
			}
		} catch (error) {
			await Promise.all(composed.map(schema => schema.stop()))
			throw error
		}
		const directory = new InlineSchemaDirectory(inline, clock, version)
		const transports = (options.transports ?? new TransportRegistry()).build({ config, directory, metrics, logger })
		logger.info(`[data-gateway] ${version} (inline): schemas ${inline.map(s => `/${s.path}`).join(', ')}; rate limit ${config.rateLimit.max > 0 ? `${config.rateLimit.max} per ${config.rateLimit.windowMs} ms` : 'off'}; ` +
			`scripts ${config.scripts.enabled ? 'enabled' : 'disabled'}; audit ${config.audit.enabled ? 'on' : 'off'}; authentication ${config.authentication.adapter}`)
		return new RunningGateway(transports, composed, logger)
	}
}
