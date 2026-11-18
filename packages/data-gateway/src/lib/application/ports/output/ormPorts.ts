import {
	DomainSchema, Entity, EntityMapping, Enum, Mapping, Metadata, MetadataConstraint, MetadataModel, MetadataParameter,
	QueryOptions, QueryPlan, SchemaData, ScriptOptions, Stage
} from '@lambdaorm/base'

/** Queries of one schema: what λORM answers about a query, and its execution. */
export interface OrmQueryPort {
	execute (query: string, data?: unknown, options?: QueryOptions): Promise<any>
	plan (query: string, options?: QueryOptions): Promise<QueryPlan>
	metadata (query: string): Promise<Metadata>
	model (query: string): Promise<MetadataModel[]>
	parameters (query: string): Promise<MetadataParameter[]>
	constraints (query: string): Promise<MetadataConstraint>
}

/** Several queries in one transaction: a 3xpr script calling orm.execute. */
export interface OrmScriptPort {
	executeScript (script: string, data?: unknown, options?: ScriptOptions): Promise<any>
}

/** The schema as λORM loaded it. */
export interface OrmSchemaPort {
	/** Throws when the schema is not usable (not loaded, no stages, no sources) */
	check (): void
	version (): { version: string }
	domain (): DomainSchema
	sources (): { name: string, dialect: string }[]
	source (name: string): { name: string, dialect: string } | undefined
	entities (): Entity[]
	entity (name: string): Entity | undefined
	enums (): Enum[]
	enum (name: string): Enum | undefined
	mappings (): Mapping[]
	mapping (name: string): Mapping | undefined
	entityMapping (mapping: string, entity: string): EntityMapping | undefined
	stages (): Stage[]
	stage (name: string): Stage | undefined
	views (): string[]
}

/** Stages: whether a stage exists, and export / import of its data. */
export interface OrmStagePort {
	exists (stage: string): Promise<boolean>
	export (stage: string): Promise<SchemaData>
	import (stage: string, data: unknown): Promise<void>
}
