import { DescribedEntities, DomainSearch } from '../../usecases/domainText'
import { NamedQueryInfo, NamedQueryRequest } from '../../usecases/namedQueryUseCases'
import {
	DomainSchema, Entity, EntityMapping, Enum, Mapping, Metadata, MetadataConstraint, MetadataModel, MetadataParameter,
	QueryOptions, QueryPlan, Schema, SchemaData, ScriptOptions, Stage
} from '@lambdaorm/base'
import { Principal } from '../../../domain/auth/principal'

/** Who asks and through which transport: every operation is authorized and audited with it. */
export interface RequestContext {
	principal: Principal
	transport: string
}

export interface QueryRequest { query: string, options?: QueryOptions }
export interface ExecuteRequest { query: string, data?: unknown, options?: QueryOptions }
export interface ScriptRequest { script: string, data?: unknown, options?: ScriptOptions }
/** notify: the WebSocket connection that sends it gets queue.completed / queue.failed */
export interface QueuedRequest { topic: string, query: string, data?: unknown, chunk?: number, options?: QueryOptions, notify?: boolean }

/**
 * Everything the gateway does for one schema. Transports (REST, MCP, WebSocket) only talk to this port; whether the
 * schema runs in the same thread or in a worker is invisible to them.
 */
export interface DataGatewayPort {
	version (): Promise<{ version: string }>
	health (): Promise<{ message: string, time: string, uptime: number }>
	ping (): Promise<{ message: string, time: string }>

	plan (ctx: RequestContext, request: QueryRequest): Promise<QueryPlan>
	metadata (ctx: RequestContext, request: QueryRequest): Promise<Metadata>
	model (ctx: RequestContext, request: QueryRequest): Promise<MetadataModel[]>
	parameters (ctx: RequestContext, request: QueryRequest): Promise<MetadataParameter[]>
	constraints (ctx: RequestContext, request: QueryRequest): Promise<MetadataConstraint>
	execute (ctx: RequestContext, request: ExecuteRequest): Promise<any>
	executeScript (ctx: RequestContext, request: ScriptRequest): Promise<any>
	executeQueued (ctx: RequestContext, request: QueuedRequest): Promise<{ queueId: string }>
	/** the queries of application.queries that who calls can use (docs/NAMED_QUERIES.md) */
	queries (ctx: RequestContext): Promise<NamedQueryInfo[]>
	/** one of them, by its name */
	query (ctx: RequestContext, name: string, request: NamedQueryRequest): Promise<unknown>

	schema (ctx: RequestContext): Promise<Schema>
	schemaVersion (ctx: RequestContext): Promise<{ version: string }>
	domain (ctx: RequestContext): Promise<DomainSchema>
	sources (ctx: RequestContext): Promise<{ name: string, dialect: string }[]>
	source (ctx: RequestContext, name: string): Promise<{ name: string, dialect: string }>
	entities (ctx: RequestContext): Promise<Entity[]>
	entity (ctx: RequestContext, name: string): Promise<Entity>
	enums (ctx: RequestContext): Promise<Enum[]>
	enum (ctx: RequestContext, name: string): Promise<Enum>
	mappings (ctx: RequestContext): Promise<Mapping[]>
	mapping (ctx: RequestContext, name: string): Promise<Mapping>
	entityMapping (ctx: RequestContext, mapping: string, entity: string): Promise<EntityMapping>
	stages (ctx: RequestContext): Promise<Stage[]>
	stage (ctx: RequestContext, name: string): Promise<Stage>
	views (ctx: RequestContext): Promise<string[]>
	/** The domain as TypeScript declarations for an editor (docs/DATA_GATEWAY.md §10.3) */
	typings (ctx: RequestContext): Promise<string>
	/** Entities, properties and relations by part of their name, compact (L42) */
	search (ctx: RequestContext, text: string): Promise<DomainSearch>
	/** Some entities, two lines each (L42) */
	describe (ctx: RequestContext, entities: string[]): Promise<DescribedEntities>

	stageExists (ctx: RequestContext, stage: string): Promise<{ exists: boolean }>
	stageExport (ctx: RequestContext, stage: string): Promise<SchemaData>
	stageImport (ctx: RequestContext, stage: string, data: unknown): Promise<void>
}
