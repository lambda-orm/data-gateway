import { createHash } from 'crypto'
import { ResolvedObservability } from '@lambdaorm/base'
import fs from 'fs'
import path from 'path'
import { DataGateway } from '../../application/facade/dataGateway'
import { DataGatewayMcpServer } from '../../application/mcp/dataGatewayMcpServer'
import { gatewayTools } from '../../application/mcp/gatewayTools'
import { ToolCatalog } from '../../application/mcp/toolCatalog'
import { DataGatewayPort } from '../../application/ports/input/dataGatewayPort'
import { McpServerPort } from '../../application/ports/input/mcpServerPort'
import { AuditPort, ClockPort, LoggerPort, QueueEventsPort } from '../../application/ports/output/supportPorts'
import { Auditor } from '../../application/usecases/auditor'
import { ViewResolver } from '../../application/usecases/viewResolver'
import { ResultCache } from '../../application/cache/resultCache'
import { ReadsCache } from '../../application/usecases/queryUseCases'
import { MetricsPort } from '../../application/ports/output/supportPorts'
import { NamedQueryUseCases } from '../../application/usecases/namedQueryUseCases'
import { curatedTools, namedQueryTools } from '../../application/mcp/namedQueryTools'
import { QueryUseCases } from '../../application/usecases/queryUseCases'
import { QueueUseCase } from '../../application/usecases/queueUseCase'
import { SchemaUseCases, StageUseCases } from '../../application/usecases/schemaUseCases'
import { ScriptUseCase } from '../../application/usecases/scriptUseCase'
import { AuditConfig } from '../../domain/config/dataGatewayConfig'
import { ConfigError } from '../../domain/errors/gatewayError'
import { SchemaSettings } from '../../domain/runtime/schemas'
import { LambdaOrmAdapter } from '../output/orm/lambdaOrmAdapter'
import { CommandUseCases } from '../../application/usecases/commandUseCases'
import { adminTools } from '../../application/mcp/adminTools'
import { workspaceAdminTools } from '../output/admin/workspaceAdminTools'
import { KafkaQueueAdapter } from '../output/queue/kafkaQueueAdapter'

export interface SchemaCompositionInput {
	path: string
	workspace: string
	settings: SchemaSettings
	audit: AuditConfig
	mcpName: string
	/** tools/list and resources/list page size */
	pageSize: number
	version: string
	/** Open a connection of each source at start: a database down leaves the schema in error */
	checkConnections: boolean
	/** transports.management: the read-only tools of the administration in its MCP server */
	admin?: boolean
	/** the observability of the gateway: λORM's spans and metrics of a schema without infrastructure.observability */
	observability?: ResolvedObservability
}

export interface ComposedSchema {
	gateway: DataGatewayPort
	mcp: McpServerPort
	/** the commands of its workspace (admin): fetch, push, drop, export, import */
	commands: CommandUseCases
	stop (): Promise<void>
}

/** lambdaORM.yaml of a workspace: the folder's, or the file itself */
export const workspaceFile = (workspace: string): string =>
	fs.existsSync(workspace) && fs.statSync(workspace).isDirectory() ? path.join(workspace, 'lambdaORM.yaml') : workspace

/**
 * One schema, in the thread that calls it: λORM on its workspace, its queue, its use cases, facade and MCP server. The
 * schema worker runs one; the inline runtime (tests, one process) runs them all.
 */
export const composeSchema = async (input: SchemaCompositionInput, deps: { logger: LoggerPort, audit: AuditPort, clock: ClockPort, queueEvents?: QueueEventsPort, metrics?: MetricsPort }): Promise<ComposedSchema> => {
	const { logger } = deps
	const file = workspaceFile(input.workspace)
	if (!fs.existsSync(file)) throw new ConfigError([`schema "${input.path || '/'}": ${file} not found (the workspace must have its lambdaORM.yaml)`])
	const orm = new LambdaOrmAdapter()
	await orm.init(input.workspace)
	// a schema without its own observability takes the gateway's (with its own, it decides)
	if (input.observability && !orm.infrastructure()?.observability) orm.observe(input.observability)
	let queue: KafkaQueueAdapter | undefined
	try {
		if (input.checkConnections) await orm.checkConnections(Math.min(input.settings.server.timeout, 30000))
		const infrastructure = orm.infrastructure() ?? {}
		if (infrastructure.service !== undefined) {
			logger.warn(`schema "${input.path || '/'}": lambdaORM.yaml has infrastructure.service: ignored, the gateway reads data-gateway.config.yaml (docs/DATA_GATEWAY.md §2.7)`)
		}
		if (infrastructure.queue) {
			queue = new KafkaQueueAdapter(orm.orm, logger)
			await queue.start(infrastructure.queue)
		}
	} catch (error) {
		await orm.end().catch(() => undefined)
		throw error
	}
	const { settings } = input
	const auditor = new Auditor(deps.audit, deps.clock, input.path, input.audit)
	// the view of each caller (docs/VIEWS_BY_IDENTITY.md); one the schema doesn't have is said now and refused later
	const views = new ViewResolver(() => orm.views(), settings.view)
	const missing = views.missing(settings.namedViews ?? [])
	if (missing.length) logger.warn(`schema "${input.path || '/'}": the views ${missing.join(', ')} of the configuration are not in its lambdaORM.yaml: a request with one is refused (403)`)
	const queries = new QueryUseCases(orm, auditor, views, readsCache(input, orm, deps.metrics))
	// the queries of application.queries with their limits (docs/NAMED_QUERIES.md)
	const named = new NamedQueryUseCases(orm, queries, settings.queries ?? {})
	const unknownLimits = Object.keys(settings.queries ?? {}).filter(name => !orm.namedQueries().some(q => q.name === name))
	if (unknownLimits.length) logger.warn(`schema "${input.path || '/'}": orm.schemas[].queries names ${unknownLimits.join(', ')}, not in its application.queries`)
	const gateway = new DataGateway({
		queries,
		script: new ScriptUseCase(orm, settings.scripts, auditor, views),
		queue: new QueueUseCase(queue, queries, auditor, deps.queueEvents),
		schema: new SchemaUseCases(orm, views),
		stages: new StageUseCases(orm, auditor),
		named
	}, orm, deps.clock, input.version, settings.server.timeout)
	const commands = new CommandUseCases(orm, auditor)
	// mcp.freeQueries false: an agent only with the named queries (and the tools of the schema)
	const tools = [...curatedTools(gatewayTools(gateway), settings.mcp.freeQueries !== false), ...(input.admin ? adminTools(workspaceAdminTools(file, commands)) : [])]
	const mcp = new DataGatewayMcpServer(new ToolCatalog(tools, settings.mcp.tools), orm, {
		name: input.path ? `${input.mcpName} ${input.path}` : input.mcpName,
		version: input.version,
		pageSize: input.pageSize,
		maxRows: settings.mcp.maxRows
	}, views, namedQueryTools(gateway))
	return {
		gateway,
		mcp,
		commands,
		stop: async () => {
			await queue?.stop().catch(error => logger.error(error))
			await orm.end().catch(error => logger.error(error))
		}
	}
}

/**
 * The cache of the reads of a schema, when its configuration turns it on (docs/RESULT_CACHE.md): a write of λORM (its
 * DataChange) drops what reads its entities; its hits, misses, invalidations and entries in /metrics.
 */
const readsCache = (input: SchemaCompositionInput, orm: LambdaOrmAdapter, metrics?: MetricsPort): ReadsCache | undefined => {
	const settings = input.settings.cache
	if (!settings?.enabled) return undefined
	const results = new ResultCache(settings, text => createHash('sha256').update(text).digest('base64url'))
	orm.onDataChange(changes => results.invalidate(changes.map(c => c.entity)))
	const schema = input.path || '/'
	metrics?.gauge('data_gateway_cache_requests', 'Reads asked of the result cache, by result (hit, miss)', ['schema', 'result'], () => [
		{ labels: { schema, result: 'hit' }, value: results.snapshot.hits },
		{ labels: { schema, result: 'miss' }, value: results.snapshot.misses }
	])
	metrics?.gauge('data_gateway_cache_invalidations', 'Writes of an entity that dropped cached results', ['schema'], () => [{ labels: { schema }, value: results.snapshot.invalidations }])
	metrics?.gauge('data_gateway_cache_entries', 'Results kept in the cache', ['schema'], () => [{ labels: { schema }, value: results.snapshot.entries }])
	return { results, domain: () => orm.entities() as any }
}
