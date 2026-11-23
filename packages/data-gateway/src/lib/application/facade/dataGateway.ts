import { timeout } from '../../domain/errors/gatewayError'
import {
	DataGatewayPort, ExecuteRequest, QueryRequest, QueuedRequest, RequestContext, ScriptRequest
} from '../ports/input/dataGatewayPort'
import { ClockPort } from '../ports/output/supportPorts'
import { OrmSchemaPort } from '../ports/output/ormPorts'
import { QueryUseCases } from '../usecases/queryUseCases'
import { ScriptUseCase } from '../usecases/scriptUseCase'
import { QueueUseCase } from '../usecases/queueUseCase'
import { SchemaUseCases, StageUseCases } from '../usecases/schemaUseCases'

export interface DataGatewayUseCases {
	queries: QueryUseCases
	script: ScriptUseCase
	queue: QueueUseCase
	schema: SchemaUseCases
	stages: StageUseCases
}

/**
 * The gateway for one schema: the single entry point of every transport. Delegates to the use cases (which authorize
 * and audit) and answers 504 when an operation takes longer than server.timeout. The operation itself is not
 * cancelled (λORM has no cancellation): a script stops on its own timeout, a query when the database answers.
 */
export class DataGateway implements DataGatewayPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly useCases: DataGatewayUseCases,
		private readonly orm: OrmSchemaPort,
		private readonly clock: ClockPort,
		private readonly packageVersion: string,
		private readonly timeoutMs: number
	) {}

	private limit<T> (operation: () => Promise<T>): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined
		const expired = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => reject(timeout(this.timeoutMs)), this.timeoutMs)
		})
		return Promise.race([Promise.resolve().then(operation), expired]).finally(() => clearTimeout(timer))
	}

	public async version () { return { version: this.packageVersion } }

	public async health () {
		this.orm.check()
		return { message: 'OK', time: this.clock.now().toISOString(), uptime: this.clock.uptimeSeconds() }
	}

	public async ping () { return { message: 'pong', time: this.clock.now().toISOString() } }

	public plan (ctx: RequestContext, request: QueryRequest) { return this.limit(() => this.useCases.queries.plan(ctx, request)) }
	public metadata (ctx: RequestContext, request: QueryRequest) { return this.limit(() => this.useCases.queries.metadata(ctx, request)) }
	public model (ctx: RequestContext, request: QueryRequest) { return this.limit(() => this.useCases.queries.model(ctx, request)) }
	public parameters (ctx: RequestContext, request: QueryRequest) { return this.limit(() => this.useCases.queries.parameters(ctx, request)) }
	public constraints (ctx: RequestContext, request: QueryRequest) { return this.limit(() => this.useCases.queries.constraints(ctx, request)) }
	public execute (ctx: RequestContext, request: ExecuteRequest) { return this.limit(() => this.useCases.queries.execute(ctx, request)) }
	public executeScript (ctx: RequestContext, request: ScriptRequest) { return this.limit(() => this.useCases.script.execute(ctx, request)) }
	public executeQueued (ctx: RequestContext, request: QueuedRequest) { return this.limit(() => this.useCases.queue.execute(ctx, request)) }

	public schema (ctx: RequestContext) { return this.useCases.schema.schema(ctx) }
	public schemaVersion (ctx: RequestContext) { return this.useCases.schema.version(ctx) }
	public domain (ctx: RequestContext) { return this.useCases.schema.domain(ctx) }
	public sources (ctx: RequestContext) { return this.useCases.schema.sources(ctx) }
	public source (ctx: RequestContext, name: string) { return this.useCases.schema.source(ctx, name) }
	public entities (ctx: RequestContext) { return this.useCases.schema.entities(ctx) }
	public entity (ctx: RequestContext, name: string) { return this.useCases.schema.entity(ctx, name) }
	public enums (ctx: RequestContext) { return this.useCases.schema.enums(ctx) }
	public enum (ctx: RequestContext, name: string) { return this.useCases.schema.enum(ctx, name) }
	public mappings (ctx: RequestContext) { return this.useCases.schema.mappings(ctx) }
	public mapping (ctx: RequestContext, name: string) { return this.useCases.schema.mapping(ctx, name) }
	public entityMapping (ctx: RequestContext, mapping: string, entity: string) { return this.useCases.schema.entityMapping(ctx, mapping, entity) }
	public stages (ctx: RequestContext) { return this.useCases.schema.stages(ctx) }
	public stage (ctx: RequestContext, name: string) { return this.useCases.schema.stage(ctx, name) }
	public views (ctx: RequestContext) { return this.useCases.schema.views(ctx) }
	public typings (ctx: RequestContext) { return this.useCases.schema.typings(ctx) }
	public search (ctx: RequestContext, text: string) { return this.useCases.schema.search(ctx, text) }
	public describe (ctx: RequestContext, entities: string[]) { return this.useCases.schema.describe(ctx, entities) }

	public stageExists (ctx: RequestContext, stage: string) { return this.limit(() => this.useCases.stages.exists(ctx, stage)) }
	public stageExport (ctx: RequestContext, stage: string) { return this.limit(() => this.useCases.stages.export(ctx, stage)) }
	public stageImport (ctx: RequestContext, stage: string, data: unknown) { return this.limit(() => this.useCases.stages.import(ctx, stage, data)) }
}
