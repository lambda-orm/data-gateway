import { MetadataModel, MetadataParameter } from '@lambdaorm/base'
import { authorize } from '../../domain/auth/authorizationPolicy'
import { GatewayError, notFound } from '../../domain/errors/gatewayError'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { OrmQueryPort } from '../ports/output/ormPorts'
import { QueryUseCases } from './queryUseCases'
import { readEntities, RelatedEntity } from '../../domain/query/readEntities'

/** A query of application.queries as who calls sees it: never its text (docs/NAMED_QUERIES.md §2) */
export interface NamedQueryInfo {
	name: string
	description?: string
	parameters: MetadataParameter[]
	model: MetadataModel[]
	/** it writes: it needs the write permission */
	writes: boolean
	/** the entities it reads (its sentences and the relations it goes through): what a subscription to it waits for */
	reads: string[]
}

/** The limits of a named query, on top of the gateway's (orm.schemas[].queries in data-gateway.config.yaml) */
export interface NamedQueryLimits {
	maxRows?: number
	timeoutMs?: number
}

export interface NamedQueryRequest { data?: unknown, options?: unknown }

/**
 * The queries of the application with a name (docs/NAMED_QUERIES.md): listed with their parameters and their model,
 * run by their name. Each in the view of who calls (one that uses what its view excludes is not listed); run as
 * execute (its permissions, its audit, with its name), within its limits.
 */
export class NamedQueryUseCases {
	/** what each view sees of the queries ('' the domain): they don't change while the schema runs */
	private readonly described = new Map<string, Promise<NamedQueryInfo[]>>()

	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly orm: OrmQueryPort,
		private readonly queries: QueryUseCases,
		private readonly limits: Record<string, NamedQueryLimits> = {},
		private readonly domain: () => RelatedEntity[] = () => []
	) {}

	public async list (ctx: RequestContext): Promise<NamedQueryInfo[]> {
		authorize(ctx.principal, 'schema')
		const view = this.queries.viewOf(ctx)
		const key = view ?? ''
		let described = this.described.get(key)
		if (!described) {
			described = this.describe(ctx)
			this.described.set(key, described)
		}
		return described
	}

	private async describe (ctx: RequestContext): Promise<NamedQueryInfo[]> {
		const view = this.queries.viewOf(ctx)
		const options = view ? { view } : {}
		const infos: NamedQueryInfo[] = []
		for (const query of this.orm.namedQueries()) {
			try {
				const [parameters, model, classification] = await Promise.all([
					this.orm.parameters(query.query, options),
					this.orm.model(query.query, options),
					this.queries.classify(query.query, ctx)
				])
				infos.push({
					name: query.name,
					...(query.description ? { description: query.description } : {}),
					parameters,
					model,
					writes: classification.writes,
					reads: readEntities(query.query, classification.entities, this.domain())
				})
			} catch {
				// it uses what this view excludes: not this caller's
			}
		}
		return infos
	}

	public async execute (ctx: RequestContext, name: string, request: NamedQueryRequest = {}): Promise<unknown> {
		const query = this.orm.namedQueries().find(q => q.name === name)
		if (!query) throw notFound(`query ${name} not found (GET /queries lists them)`)
		const limits = this.limits[name] ?? {}
		const run = this.queries.execute(ctx, { query: query.query, data: request.data, options: request.options as any }, name)
		const result = limits.timeoutMs
			? await within(run, limits.timeoutMs, () => new GatewayError(504, 'TimeoutError', `the query ${name} did not finish within ${limits.timeoutMs} ms (its timeout)`))
			: await run
		if (limits.maxRows !== undefined && Array.isArray(result) && result.length > limits.maxRows) {
			throw new GatewayError(422, 'TooManyRowsError', `the query ${name} gives more than ${limits.maxRows} rows (its maxRows): narrow it with its parameters`)
		}
		return result
	}
}

const within = <T>(promise: Promise<T>, ms: number, expiredError: () => Error): Promise<T> => {
	let timer: NodeJS.Timeout | undefined
	const expired = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(expiredError()), ms) })
	return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}
