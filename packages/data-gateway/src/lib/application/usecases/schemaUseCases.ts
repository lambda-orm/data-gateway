import { DomainSchema, Entity, EntityMapping, Enum, Mapping, Schema, SchemaData, Stage } from '@lambdaorm/base'
import { authorize } from '../../domain/auth/authorizationPolicy'
import { notFound } from '../../domain/errors/gatewayError'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { OrmSchemaPort, OrmStagePort } from '../ports/output/ormPorts'
import { Auditor } from './auditor'
import { generateTypings } from '../typings/typingsGenerator'
import { DescribedEntities, DomainSearch, describeEntities, searchDomain } from './domainText'
import { NO_VIEWS, ViewResolver } from './viewResolver'

/**
 * The schema as λORM loaded it, in the view of who calls (docs/VIEWS_BY_IDENTITY.md): its domain, its typings, its
 * search and the entities of the mappings are those of the view. Everything needs `read`. A name that doesn't exist (an entity, an enum, a source, a
 * mapping, a stage) is a NotFoundError: 404 on REST, the same status on WebSocket and MCP.
 */
export class SchemaUseCases {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly orm: OrmSchemaPort, private readonly viewResolver: ViewResolver = NO_VIEWS) {}

	private viewOf (ctx: RequestContext): string | undefined { return this.viewResolver.of(ctx.principal) }

	/** the domain of who calls */
	private domainOf (ctx: RequestContext): DomainSchema { return this.orm.domain(this.viewOf(ctx)) }

	/** a mapping with only the entities of the view of who calls (the tables of the others are not its business) */
	private mappingIn (ctx: RequestContext, mapping: Mapping | undefined): Mapping | undefined {
		const view = this.viewOf(ctx)
		if (!mapping || !view) return mapping
		const names = new Set(this.orm.entities(view).map(e => e.name))
		return { ...mapping, entities: (mapping.entities ?? []).filter(e => names.has(e.name)) }
	}

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
			domain: this.domainOf(ctx),
			infrastructure: undefined,
			application: undefined
		}) as unknown as Schema)
	}

	public version (ctx: RequestContext): Promise<{ version: string }> { return this.read(ctx, () => this.orm.version()) }
	public domain (ctx: RequestContext): Promise<DomainSchema> { return this.read(ctx, () => this.domainOf(ctx)) }
	public sources (ctx: RequestContext) { return this.read(ctx, () => this.orm.sources()) }
	public source (ctx: RequestContext, name: string) { return this.find(ctx, 'source', name, () => this.orm.source(name)) }
	public entities (ctx: RequestContext): Promise<Entity[]> { return this.read(ctx, () => this.orm.entities(this.viewOf(ctx))) }
	public entity (ctx: RequestContext, name: string) { return this.find(ctx, 'entity', name, () => this.orm.entity(name, this.viewOf(ctx))) }
	public enums (ctx: RequestContext): Promise<Enum[]> { return this.read(ctx, () => this.orm.enums()) }
	public enum (ctx: RequestContext, name: string) { return this.find(ctx, 'enum', name, () => this.orm.enum(name)) }
	public mappings (ctx: RequestContext): Promise<Mapping[]> { return this.read(ctx, () => this.orm.mappings().map(m => this.mappingIn(ctx, m)!)) }
	public mapping (ctx: RequestContext, name: string) { return this.find(ctx, 'mapping', name, () => this.mappingIn(ctx, this.orm.mapping(name))) }
	public entityMapping (ctx: RequestContext, mapping: string, entity: string): Promise<EntityMapping> {
		return this.find(ctx, 'entity mapping', `${mapping}.${entity}`, () => this.mappingIn(ctx, this.orm.mapping(mapping))?.entities?.some(e => e.name === entity)
			? this.orm.entityMapping(mapping, entity)
			: undefined)
	}

	public stages (ctx: RequestContext): Promise<Stage[]> { return this.read(ctx, () => this.orm.stages()) }
	public stage (ctx: RequestContext, name: string) { return this.find(ctx, 'stage', name, () => this.orm.stage(name)) }
	/** who has a view sees only it (the others are not its business) */
	public views (ctx: RequestContext): Promise<string[]> { return this.read(ctx, () => { const view = this.viewOf(ctx); return view ? [view] : this.orm.views() }) }
	public typings (ctx: RequestContext): Promise<string> { return this.read(ctx, () => generateTypings(this.domainOf(ctx))) }
	/** entities, properties and relations by part of their name, as compact text (L42) */
	public search (ctx: RequestContext, text: string): Promise<DomainSearch> { return this.read(ctx, () => searchDomain(this.domainOf(ctx), text)) }
	/** some entities, two lines each; the names that don't exist apart, with the closest ones */
	public describe (ctx: RequestContext, names: string[]): Promise<DescribedEntities> { return this.read(ctx, () => describeEntities(this.domainOf(ctx), names)) }
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
		return this.auditor.track(ctx, { operation: 'stageImport', stage, data }, () => this.orm.import(stage, data, ctx.principal.actor))
	}
}
