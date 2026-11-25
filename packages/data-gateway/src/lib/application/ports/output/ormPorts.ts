import {
	Actor,
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
	import (stage: string, data: unknown, actor?: Actor): Promise<void>
}

/** Sentences of a source (and of a migration, for migrate); destructive, the ones that can lose data and why */
export interface SourceSentences {
	source: string
	version?: string
	sentences: string[]
	destructive?: { sentence: string, reason: string }[]
}

/** The commands of λORM over the databases of a stage (the CLI's push, drop, fetch, migrate, seed) */
export interface OrmCommandPort {
	stageNames (): string[]
	/** per mapping, the entities whose tables differ from the model; none when they are in step */
	fetch (stage: string): Promise<unknown[]>
	/** per source, the sentences push would run; destructive, the ones that can lose data and why */
	pushSentences (stage: string): Promise<SourceSentences[]>
	/** allowDestructive: also the changes that can lose data (without it λORM refuses them: DestructiveChangeError) */
	push (stage: string, force: boolean, actor?: Actor, allowDestructive?: boolean): Promise<unknown[]>
	/** the history of the migrations of the stage (infrastructure.migrations), the newest first */
	migrations (stage: string): Promise<unknown[]>
	/** per migration after the version, the newest first, the sentences of its undo: what migrate to it would run */
	migrateSentences (stage: string, version: string): Promise<SourceSentences[]>
	/** goes back to a version: the undo of the applied migrations after it */
	migrate (stage: string, version: string, actor?: Actor, allowDestructive?: boolean): Promise<unknown[]>
	/** the files of the seed of the stage (stages[].seed), in order */
	seedFiles (stage: string): string[]
	/** of each file of the seed, the rows whose key is not in the database yet */
	seed (stage: string, actor?: Actor): Promise<unknown[]>
	dropSentences (stage: string): Promise<unknown[]>
	drop (stage: string, force: boolean, actor?: Actor): Promise<unknown[]>
	export (stage: string): Promise<unknown>
	import (stage: string, data: unknown, actor?: Actor): Promise<void>
	/** the schema with the structure of the databases of the stage, without writing anything (the preview of pull) */
	pullSchema (stage: string): Promise<unknown>
	/** pull: the state of the stage updated; the schema it gives is written by the caller (λORM doesn't write it) */
	pull (stage: string, actor?: Actor): Promise<unknown>
	/** the schema with the entities of some data, and the data as an export of the stage (introspect, incorporate) */
	introspectSchema (data: unknown, name: string): Promise<{ schema: unknown, data: unknown }>
}
