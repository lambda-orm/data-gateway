import { DomainSchema, Entity, EntityMapping, Enum, Mapping, Schema, SchemaData, Stage } from '@lambdaorm/base'
import { authorize } from '../../domain/auth/authorizationPolicy'
import { notFound } from '../../domain/errors/gatewayError'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { OrmSchemaPort, OrmStagePort } from '../ports/output/ormPorts'
import { Auditor } from './auditor'
import { generateTypings } from '../typings/typingsGenerator'
import { DescribedEntities, DomainSearch, describeEntities, searchDomain } from './domainText'

/**
 * The schema as λORM loaded it. Everything needs `read`. A name that doesn't exist (an entity, an enum, a source, a
 * mapping, a stage) is a NotFoundError: 404 on REST, the same status on WebSocket and MCP.
 */
export class SchemaUseCases {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly orm: OrmSchemaPort) {}

	private async read<T> (ctx: RequestContext, get: () => T): Promise<T> {
		authorize(ctx.principal, 'schema')
		return get()
	}

	/** one item by its name: the item, or a NotFoundError that names what was looked for */
	private async find<T> (ctx: RequestContext, kind: string, name: string, get: () => T | undefined): Promise<T> {
		const item = await this.read(ctx, get)
		if (item === undefined || item === null) throw notFound(`${kind} ${name} not found`)
		return item
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
	public source (ctx: RequestContext, name: string) { return this.find(ctx, 'source', name, () => this.orm.source(name)) }
	public entities (ctx: RequestContext): Promise<Entity[]> { return this.read(ctx, () => this.orm.entities()) }
	public entity (ctx: RequestContext, name: string) { return this.find(ctx, 'entity', name, () => this.orm.entity(name)) }
	public enums (ctx: RequestContext): Promise<Enum[]> { return this.read(ctx, () => this.orm.enums()) }
	public enum (ctx: RequestContext, name: string) { return this.find(ctx, 'enum', name, () => this.orm.enum(name)) }
	public mappings (ctx: RequestContext): Promise<Mapping[]> { return this.read(ctx, () => this.orm.mappings()) }
	public mapping (ctx: RequestContext, name: string) { return this.find(ctx, 'mapping', name, () => this.orm.mapping(name)) }
	public entityMapping (ctx: RequestContext, mapping: string, entity: string): Promise<EntityMapping> {
		return this.find(ctx, 'entity mapping', `${mapping}.${entity}`, () => this.orm.entityMapping(mapping, entity))
	}

	public stages (ctx: RequestContext): Promise<Stage[]> { return this.read(ctx, () => this.orm.stages()) }
	public stage (ctx: RequestContext, name: string) { return this.find(ctx, 'stage', name, () => this.orm.stage(name)) }
	public views (ctx: RequestContext): Promise<string[]> { return this.read(ctx, () => this.orm.views()) }
	public typings (ctx: RequestContext): Promise<string> { return this.read(ctx, () => generateTypings(this.orm.domain())) }
	/** entities, properties and relations by part of their name, as compact text (L42) */
	public search (ctx: RequestContext, text: string): Promise<DomainSearch> { return this.read(ctx, () => searchDomain(this.orm.domain(), text)) }
	/** some entities, two lines each; the names that don't exist apart, with the closest ones */
	public describe (ctx: RequestContext, names: string[]): Promise<DescribedEntities> { return this.read(ctx, () => describeEntities(this.orm.domain(), names)) }
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
