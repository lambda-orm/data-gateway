import { DomainSchema, Entity, EntityMapping, Enum, Mapping, Schema, SchemaData, Stage } from '@lambdaorm/base'
import { authorize } from '../../domain/auth/authorizationPolicy'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { OrmSchemaPort, OrmStagePort } from '../ports/output/ormPorts'
import { Auditor } from './auditor'
import { generateTypings } from '../typings/typingsGenerator'

/** The schema as λORM loaded it. Everything needs `read`. A name that doesn't exist answers undefined (204). */
export class SchemaUseCases {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly orm: OrmSchemaPort) {}

	private async read<T> (ctx: RequestContext, get: () => T): Promise<T> {
		authorize(ctx.principal, 'schema')
		return get()
	}

	public schema (ctx: RequestContext): Promise<Schema> {
		return this.read(ctx, () => ({
			version: this.orm.version().version,
			domain: this.orm.domain(),
			infrastructure: undefined,
			application: undefined
		}) as unknown as Schema)
	}

	public version (ctx: RequestContext): Promise<{ version: string }> { return this.read(ctx, () => this.orm.version()) }
	public domain (ctx: RequestContext): Promise<DomainSchema> { return this.read(ctx, () => this.orm.domain()) }
	public sources (ctx: RequestContext) { return this.read(ctx, () => this.orm.sources()) }
	public source (ctx: RequestContext, name: string) { return this.read(ctx, () => this.orm.source(name)) }
	public entities (ctx: RequestContext): Promise<Entity[]> { return this.read(ctx, () => this.orm.entities()) }
	public entity (ctx: RequestContext, name: string) { return this.read(ctx, () => this.orm.entity(name)) }
	public enums (ctx: RequestContext): Promise<Enum[]> { return this.read(ctx, () => this.orm.enums()) }
	public enum (ctx: RequestContext, name: string) { return this.read(ctx, () => this.orm.enum(name)) }
	public mappings (ctx: RequestContext): Promise<Mapping[]> { return this.read(ctx, () => this.orm.mappings()) }
	public mapping (ctx: RequestContext, name: string) { return this.read(ctx, () => this.orm.mapping(name)) }
	public entityMapping (ctx: RequestContext, mapping: string, entity: string): Promise<EntityMapping | undefined> {
		return this.read(ctx, () => this.orm.entityMapping(mapping, entity))
	}

	public stages (ctx: RequestContext): Promise<Stage[]> { return this.read(ctx, () => this.orm.stages()) }
	public stage (ctx: RequestContext, name: string) { return this.read(ctx, () => this.orm.stage(name)) }
	public views (ctx: RequestContext): Promise<string[]> { return this.read(ctx, () => this.orm.views()) }
	public typings (ctx: RequestContext): Promise<string> { return this.read(ctx, () => generateTypings(this.orm.domain())) }
}

/** Stages: exists and export need `read`; import needs `stageImport` and is audited. */
export class StageUseCases {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly orm: OrmStagePort, private readonly auditor: Auditor) {}

	public async exists (ctx: RequestContext, stage: string): Promise<{ exists: boolean }> {
		authorize(ctx.principal, 'stageExists')
		return { exists: await this.orm.exists(stage) }
	}

	public async export (ctx: RequestContext, stage: string): Promise<SchemaData> {
		authorize(ctx.principal, 'stageExport')
		return this.orm.export(stage)
	}

	public async import (ctx: RequestContext, stage: string, data: unknown): Promise<void> {
		authorize(ctx.principal, 'stageImport')
		return this.auditor.track(ctx, { operation: 'stageImport', stage, data }, () => this.orm.import(stage, data))
	}
}
