import { DataChangeSummary } from '../../domain/runtime/channelProtocol'
import { createHash, randomUUID } from 'crypto'
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
import { OutboxDestinationPort, OutboxDispatcher } from '../../application/outbox/outboxDispatcher'
import { KafkaDestination, LambdaOrmOutboxAdapter, WebhookDestination } from '../output/outbox/outboxDestinations'
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
import { Orm } from '@lambdaorm/lib'
import { CommandUseCases } from '../../application/usecases/commandUseCases'
import { adminTools } from '../../application/mcp/adminTools'
import { workspaceAdminTools } from '../output/admin/workspaceAdminTools'
import { KafkaQueueAdapter } from '../output/queue/kafkaQueueAdapter'
import { SchemaChanges, shareChanges } from '../../application/cluster/clusterChanges'
import { LeaderLease } from '../../application/cluster/leaderLease'
import { ClusterBusPort } from '../../application/ports/output/clusterPorts'
import { ValkeyClusterBus } from '../output/cluster/valkeyClusterBus'
import { ApprovalGate, ApprovalUseCases } from '../../application/approval/approvals'
import { MemoryApprovalStore, SqliteApprovalStore } from '../output/approval/approvalStores'
import { FileStorage, FilesUseCases } from '../../application/files/files'
import { AzureBlobUrlSigner, S3UrlSigner } from '../output/files/urlSigners'

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
export const composeSchema = async (input: SchemaCompositionInput, deps: { logger: LoggerPort, audit: AuditPort, clock: ClockPort, queueEvents?: QueueEventsPort, metrics?: MetricsPort, dataEvents?: (changes: DataChangeSummary[]) => void }): Promise<ComposedSchema> => {
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
	// the changes of its data, its own and those of the other replicas (docs/REPLICAS.md §3): what changed, never the data
	const changes = new SchemaChanges()
	orm.onDataChange(list => changes.emit(list.map((c: any) => ({
		entity: c.entity,
		action: c.action,
		...(c.keys ? { keys: c.keys } : {}),
		...(c.count !== undefined ? { count: c.count } : {})
	}))))
	const cluster = await joinCluster(input, changes, logger, deps.metrics)
	// the writes that wait for a person (docs/MUTATION_APPROVAL.md): in the SQLite of the volume, or in memory
	const approvalStore = settings.stateFile ? new SqliteApprovalStore(path.resolve(settings.stateFile)) : new MemoryApprovalStore()
	const gate = new ApprovalGate(approvalStore, { mcp: settings.mcp.approval, expiresMs: settings.mcp.approvalExpiresMs }, input.path, deps.clock, randomUUID,
		(query, options) => orm.plan(query, options as any))
	const queries = new QueryUseCases(orm, auditor, views, readsCache(input, orm, changes, deps.metrics), gate)
	// to the subscriptions of the edge (docs/SUBSCRIPTIONS.md)
	if (deps.dataEvents) {
		const tell = deps.dataEvents
		changes.on(list => tell(list))
	}
	// the queries of application.queries with their limits (docs/NAMED_QUERIES.md)
	const named = new NamedQueryUseCases(orm, queries, settings.queries ?? {}, () => orm.entities() as any)
	const unknownLimits = Object.keys(settings.queries ?? {}).filter(name => !orm.namedQueries().some(q => q.name === name))
	if (unknownLimits.length) logger.warn(`schema "${input.path || '/'}": orm.schemas[].queries names ${unknownLimits.join(', ')}, not in its application.queries`)
	const script = new ScriptUseCase(orm, settings.scripts, auditor, views, gate)
	const schemaUseCases = new SchemaUseCases(orm, views)
	const approvals = new ApprovalUseCases(approvalStore, input.path, { execute: (ctx, request, named) => queries.execute(ctx, request, named), executeScript: (ctx, request) => script.execute(ctx, request) }, deps.clock)
	const gateway = new DataGateway({
		queries,
		script,
		queue: new QueueUseCase(queue, queries, auditor, deps.queueEvents),
		schema: schemaUseCases,
		stages: new StageUseCases(orm, auditor),
		named,
		approvals,
		files: filesOf(input, deps.clock, (ctx, entity) => schemaUseCases.entity(ctx, entity).then((e: any) => (e?.properties ?? []).map((p: any) => p.name)), (ctx, query, data) => queries.execute(ctx, { query, data }))
	}, orm, deps.clock, input.version, settings.server.timeout)
	const outbox = new LambdaOrmOutboxAdapter(orm.orm as Orm)
	const commands = new CommandUseCases(orm, auditor, outbox, approvals)
	const dispatcher = outboxDispatcher(input, orm, outbox, logger, deps.metrics)
	// with a cluster, the replica that holds its lease dispatches (docs/REPLICAS.md §4); without one, this one
	const leader = dispatcher && cluster ? outboxLeader(input, cluster, dispatcher, logger, deps.metrics) : undefined
	if (leader) leader.start()
	else dispatcher?.start()
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
			await leader?.stop().catch(error => logger.error(error))
			await dispatcher?.stop().catch(error => logger.error(error))
			await cluster?.leave().catch(error => logger.error(error))
			await queue?.stop().catch(error => logger.error(error))
			await orm.end().catch(error => logger.error(error))
			if (approvalStore instanceof SqliteApprovalStore) approvalStore.close()
		}
	}
}

/**
 * The cache of the reads of a schema, when its configuration turns it on (docs/RESULT_CACHE.md): a write of λORM (its
 * DataChange) drops what reads its entities; its hits, misses, invalidations and entries in /metrics.
 */
const readsCache = (input: SchemaCompositionInput, orm: LambdaOrmAdapter, changes: SchemaChanges, metrics?: MetricsPort): ReadsCache | undefined => {
	const settings = input.settings.cache
	if (!settings?.enabled) return undefined
	const results = new ResultCache(settings, text => createHash('sha256').update(text).digest('base64url'))
	// its writes and, with a cluster, those of the other replicas
	changes.on(list => results.invalidate(list.map(c => c.entity)))
	const schema = input.path || '/'
	metrics?.gauge('data_gateway_cache_requests', 'Reads asked of the result cache, by result (hit, miss)', ['schema', 'result'], () => [
		{ labels: { schema, result: 'hit' }, value: results.snapshot.hits },
		{ labels: { schema, result: 'miss' }, value: results.snapshot.misses }
	])
	metrics?.gauge('data_gateway_cache_invalidations', 'Writes of an entity that dropped cached results', ['schema'], () => [{ labels: { schema }, value: results.snapshot.invalidations }])
	metrics?.gauge('data_gateway_cache_entries', 'Results kept in the cache', ['schema'], () => [{ labels: { schema }, value: results.snapshot.entries }])
	return { results, domain: () => orm.entities() as any }
}

/**
 * The dispatcher of the outbox of a schema (docs/OUTBOX_DISPATCHER.md): when its lambdaORM.yaml declares
 * infrastructure.outbox, the configuration gives destinations and this replica dispatches (outbox.dispatch, and
 * DATA_GATEWAY_OUTBOX_DISPATCH=false turns it off: one per outbox).
 */
const outboxDispatcher = (input: SchemaCompositionInput, orm: LambdaOrmAdapter, outbox: LambdaOrmOutboxAdapter, logger: LoggerPort, metrics?: MetricsPort): OutboxDispatcher | undefined => {
	const settings = input.settings.outbox
	const schema = input.path || '/'
	if (!settings?.destinations.length) return undefined
	if (!orm.infrastructure()?.outbox) {
		logger.warn(`schema "${schema}": outbox has destinations but its lambdaORM.yaml declares no infrastructure.outbox: nothing to dispatch`)
		return undefined
	}
	if (!settings.dispatch || process.env.DATA_GATEWAY_OUTBOX_DISPATCH === 'false') {
		logger.info(`schema "${schema}": the outbox is dispatched by another replica (outbox.dispatch false)`)
		return undefined
	}
	const kafka = orm.infrastructure()?.queue?.config
	const destinations: OutboxDestinationPort[] = []
	for (const destination of settings.destinations) {
		if (destination.type === 'webhook') destinations.push(new WebhookDestination(destination))
		else if (kafka) destinations.push(new KafkaDestination(destination, kafka))
		else logger.warn(`schema "${schema}": the outbox destination kafka ${destination.topic} needs infrastructure.queue (its brokers) in the lambdaORM.yaml: ignored`)
	}
	if (!destinations.length) return undefined
	const dispatcher = new OutboxDispatcher(outbox, destinations, settings, logger)
	metrics?.gauge('data_gateway_outbox_events', 'Events of the outbox the dispatcher delivered or that failed (retried later)', ['schema', 'result'], () => [
		{ labels: { schema, result: 'delivered' }, value: dispatcher.snapshot.delivered },
		{ labels: { schema, result: 'failed' }, value: dispatcher.snapshot.failed }
	])
	logger.info(`schema "${schema}": the outbox goes to ${destinations.map(d => d.name).join(', ')}`)
	return dispatcher
}

/** This schema among the replicas (docs/REPLICAS.md): its bus, who it is, and how it leaves */
interface ClusterMembership { bus: ClusterBusPort, replica: string, prefix: string, leave: () => Promise<void> }

const channelSchema = (input: SchemaCompositionInput) => input.path || '/'

/**
 * With cluster.valkey: the changes of this schema to the other replicas and theirs to it (its cache and its
 * subscriptions hear them); data_gateway_cluster_connected in /metrics. A Valkey down at the start doesn't stop it.
 */
const joinCluster = async (input: SchemaCompositionInput, changes: SchemaChanges, logger: LoggerPort, metrics?: MetricsPort): Promise<ClusterMembership | undefined> => {
	const valkey = input.settings.valkey
	if (!valkey) return undefined
	const schema = channelSchema(input)
	const bus = new ValkeyClusterBus(valkey.url, logger, `data-gateway ${schema}`)
	await bus.connect()
	const replica = randomUUID()
	const stop = await shareChanges(bus, `${valkey.prefix}:${schema}:changes`, replica, changes, logger)
	metrics?.gauge('data_gateway_cluster_connected', 'The schema reaches the Valkey of the replicas (1) or not (0)', ['schema'], () => [{ labels: { schema }, value: bus.connected ? 1 : 0 }])
	logger.info(`schema "${schema}": with the other replicas through the Valkey (${bus.connected ? 'connected' : 'not reached yet'})`)
	return { bus, replica, prefix: valkey.prefix, leave: async () => { await stop(); await bus.close() } }
}

/** The dispatcher of the outbox runs only on the replica that holds its lease; data_gateway_outbox_leader in /metrics */
const outboxLeader = (input: SchemaCompositionInput, cluster: ClusterMembership, dispatcher: OutboxDispatcher, logger: LoggerPort, metrics?: MetricsPort): LeaderLease => {
	const schema = channelSchema(input)
	const lease = new LeaderLease(cluster.bus, `${cluster.prefix}:${schema}:outbox`, cluster.replica, { lead: () => dispatcher.start(), follow: () => dispatcher.pause() }, logger)
	metrics?.gauge('data_gateway_outbox_leader', 'This replica dispatches the outbox of the schema (1) or another does (0)', ['schema'], () => [{ labels: { schema }, value: lease.isLeader ? 1 : 0 }])
	return lease
}

/**
 * The files of some properties of a schema (docs/FILES_AND_PANELS.md): a signer per storage (S3 SigV4, the SAS of Azure
 * Blob); without files.properties, none.
 */
const filesOf = (input: SchemaCompositionInput, clock: ClockPort, propertiesOf: (ctx: any, entity: string) => Promise<string[]>, read: (ctx: any, query: string, data: Record<string, unknown>) => Promise<unknown>): FilesUseCases | undefined => {
	const files = input.settings.files
	if (!files || Object.keys(files.properties).length === 0) return undefined
	const storages: Record<string, FileStorage> = {}
	for (const [name, config] of Object.entries(files.storages)) {
		const signer = config.type === 's3'
			? new S3UrlSigner({ bucket: config.bucket, region: config.region, ...(config.endpoint ? { endpoint: config.endpoint } : {}), accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey })
			: new AzureBlobUrlSigner({ account: config.account, container: config.container, accountKey: config.accountKey, ...(config.endpoint ? { endpoint: config.endpoint } : {}) })
		storages[name] = { signer, prefix: config.prefix, maxBytes: config.maxBytes, ...(config.types ? { types: config.types } : {}), expiresMs: config.expiresMs }
	}
	return new FilesUseCases(storages, files.properties, { propertiesOf, read }, clock, randomUUID)
}
