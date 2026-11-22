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
	/** admin.enabled: the read-only tools of the administration in its MCP server */
	admin?: boolean
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
export const composeSchema = async (input: SchemaCompositionInput, deps: { logger: LoggerPort, audit: AuditPort, clock: ClockPort, queueEvents?: QueueEventsPort }): Promise<ComposedSchema> => {
	const { logger } = deps
	const file = workspaceFile(input.workspace)
	if (!fs.existsSync(file)) throw new ConfigError([`schema "${input.path || '/'}": ${file} not found (the workspace must have its lambdaORM.yaml)`])
	const orm = new LambdaOrmAdapter()
	await orm.init(input.workspace)
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
	const queries = new QueryUseCases(orm, auditor)
	const gateway = new DataGateway({
		queries,
		script: new ScriptUseCase(orm, settings.scripts, auditor),
		queue: new QueueUseCase(queue, queries, auditor, deps.queueEvents),
		schema: new SchemaUseCases(orm),
		stages: new StageUseCases(orm, auditor)
	}, orm, deps.clock, input.version, settings.server.timeout)
	const commands = new CommandUseCases(orm, auditor)
	const tools = [...gatewayTools(gateway), ...(input.admin ? adminTools(workspaceAdminTools(file, commands)) : [])]
	const mcp = new DataGatewayMcpServer(new ToolCatalog(tools, settings.mcp.tools), orm, {
		name: input.path ? `${input.mcpName} ${input.path}` : input.mcpName,
		version: input.version,
		pageSize: input.pageSize,
		maxRows: settings.mcp.maxRows
	})
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
