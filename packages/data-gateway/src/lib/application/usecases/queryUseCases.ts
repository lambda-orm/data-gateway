import { Metadata, MetadataConstraint, MetadataModel, MetadataParameter, QueryPlan } from '@lambdaorm/base'
import { authorize } from '../../domain/auth/authorizationPolicy'
import { badRequest } from '../../domain/errors/gatewayError'
import { classifyQuery, QueryClassification } from '../../domain/query/queryClassification'
import { ExecuteRequest, QueryRequest, RequestContext } from '../ports/input/dataGatewayPort'
import { OrmQueryPort } from '../ports/output/ormPorts'
import { Auditor } from './auditor'
import { requestOptions } from './requestOptions'
import { NO_VIEWS, ViewResolver } from './viewResolver'
import { ResultCache } from '../cache/resultCache'
import { readEntities, RelatedEntity } from '../../domain/query/readEntities'

/** The cache of the reads of a schema (docs/RESULT_CACHE.md), and its domain (the relations a read goes through) */
export interface ReadsCache {
	results: ResultCache
	domain: () => RelatedEntity[]
}

export const requireQuery = (query: unknown): string => {
	if (typeof query !== 'string' || query.trim() === '') {
		throw badRequest('QueryError', 'query is required')
	}
	return query
}

/** What λORM answers about a query, and its execution: authorized with the query's classification, writes audited. */
export class QueryUseCases {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly orm: OrmQueryPort,
		private readonly auditor: Auditor,
		private readonly views: ViewResolver = NO_VIEWS,
		private readonly cache?: ReadsCache
	) {}

	/** the view of λORM of who calls (docs/VIEWS_BY_IDENTITY.md) */
	public viewOf (ctx: RequestContext): string | undefined {
		return this.views.of(ctx.principal)
	}

	/** the options of the metadata of a query: the view of who calls */
	private inView (ctx: RequestContext): { view?: string } {
		const view = this.viewOf(ctx)
		return view ? { view } : {}
	}

	public async plan (ctx: RequestContext, request: QueryRequest): Promise<QueryPlan> {
		authorize(ctx.principal, 'plan')
		return this.orm.plan(requireQuery(request.query), requestOptions(request.options, ctx, this.viewOf(ctx)))
	}

	public async metadata (ctx: RequestContext, request: QueryRequest): Promise<Metadata> {
		authorize(ctx.principal, 'metadata')
		return this.orm.metadata(requireQuery(request.query), this.inView(ctx))
	}

	public async model (ctx: RequestContext, request: QueryRequest): Promise<MetadataModel[]> {
		authorize(ctx.principal, 'model')
		return this.orm.model(requireQuery(request.query), this.inView(ctx))
	}

	public async parameters (ctx: RequestContext, request: QueryRequest): Promise<MetadataParameter[]> {
		authorize(ctx.principal, 'parameters')
		return this.orm.parameters(requireQuery(request.query), this.inView(ctx))
	}

	public async constraints (ctx: RequestContext, request: QueryRequest): Promise<MetadataConstraint> {
		authorize(ctx.principal, 'constraints')
		return this.orm.constraints(requireQuery(request.query), this.inView(ctx))
	}

	/**
	 * What the query does (λORM metadata, before connecting to any database), in the view of who calls: an entity the
	 * view excludes is a ViewError (403) here
	 */
	public async classify (query: string, ctx?: RequestContext): Promise<QueryClassification> {
		return classifyQuery(await this.orm.metadata(query, ctx ? this.inView(ctx) : {}))
	}

	/** named: the name of a query of application.queries run by it (its audit says it) */
	public async execute (ctx: RequestContext, request: ExecuteRequest, named?: string): Promise<any> {
		const query = requireQuery(request.query)
		const classification = await this.classify(query, ctx)
		authorize(ctx.principal, 'execute', classification.writes)
		const options = requestOptions(request.options, ctx, this.viewOf(ctx))
		const run = () => this.orm.execute(query, request.data, options)
		if (!classification.writes) return this.cache ? this.cached(query, request.data, options, classification.entities, run) : run()
		return this.auditor.track(ctx, {
			operation: 'execute',
			actions: classification.actions,
			entities: classification.entities,
			query,
			...(named ? { name: named } : {}),
			data: request.data
		}, run)
	}

	/**
	 * A read through the cache: its key is the query, its data and its options (the stage, the view and the context of
	 * who calls; never the actor), so two identities never share a result. A read of an entity the cache doesn't keep
	 * goes to the database.
	 */
	private async cached (query: string, data: unknown, options: object, sentences: string[], run: () => Promise<unknown>): Promise<unknown> {
		const cache = this.cache!
		const entities = readEntities(query, sentences, cache.domain())
		if (cache.results.ttlFor(entities) === undefined) return run()
		const relevant: Record<string, unknown> = { ...options }
		delete relevant.actor
		const key = cache.results.keyOf({ query, data: data ?? null, options: relevant })
		const hit = cache.results.get(key)
		if (hit) return hit.value
		const value = await run()
		cache.results.set(key, value, entities)
		return value
	}

}
