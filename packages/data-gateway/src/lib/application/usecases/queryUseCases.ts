import { Metadata, MetadataConstraint, MetadataModel, MetadataParameter, QueryPlan } from '@lambdaorm/base'
import { authorize } from '../../domain/auth/authorizationPolicy'
import { badRequest } from '../../domain/errors/gatewayError'
import { classifyQuery, QueryClassification } from '../../domain/query/queryClassification'
import { ExecuteRequest, QueryRequest, RequestContext } from '../ports/input/dataGatewayPort'
import { OrmQueryPort } from '../ports/output/ormPorts'
import { Auditor } from './auditor'

export const requireQuery = (query: unknown): string => {
	if (typeof query !== 'string' || query.trim() === '') {
		throw badRequest('QueryError', 'query is required')
	}
	return query
}

/** What λORM answers about a query, and its execution: authorized with the query's classification, writes audited. */
export class QueryUseCases {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly orm: OrmQueryPort, private readonly auditor: Auditor) {}

	public async plan (ctx: RequestContext, request: QueryRequest): Promise<QueryPlan> {
		authorize(ctx.principal, 'plan')
		return this.orm.plan(requireQuery(request.query), request.options)
	}

	public async metadata (ctx: RequestContext, request: QueryRequest): Promise<Metadata> {
		authorize(ctx.principal, 'metadata')
		return this.orm.metadata(requireQuery(request.query))
	}

	public async model (ctx: RequestContext, request: QueryRequest): Promise<MetadataModel[]> {
		authorize(ctx.principal, 'model')
		return this.orm.model(requireQuery(request.query))
	}

	public async parameters (ctx: RequestContext, request: QueryRequest): Promise<MetadataParameter[]> {
		authorize(ctx.principal, 'parameters')
		return this.orm.parameters(requireQuery(request.query))
	}

	public async constraints (ctx: RequestContext, request: QueryRequest): Promise<MetadataConstraint> {
		authorize(ctx.principal, 'constraints')
		return this.orm.constraints(requireQuery(request.query))
	}

	/** What the query does (λORM metadata, before connecting to any database) */
	public async classify (query: string): Promise<QueryClassification> {
		return classifyQuery(await this.orm.metadata(query))
	}

	public async execute (ctx: RequestContext, request: ExecuteRequest): Promise<any> {
		const query = requireQuery(request.query)
		const classification = await this.classify(query)
		authorize(ctx.principal, 'execute', classification.writes)
		const run = () => this.orm.execute(query, request.data, request.options)
		if (!classification.writes) return run()
		return this.auditor.track(ctx, {
			operation: 'execute',
			actions: classification.actions,
			entities: classification.entities,
			query,
			data: request.data
		}, run)
	}
}
