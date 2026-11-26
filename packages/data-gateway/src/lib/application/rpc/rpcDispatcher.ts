import { RpcCallError } from '../../domain/errors/gatewayError'
import { DataGatewayPort, RequestContext } from '../ports/input/dataGatewayPort'

type Params = Record<string, any>
type RpcMethod = (gateway: DataGatewayPort, ctx: RequestContext, params: Params) => Promise<unknown>

const text = (params: Params, name: string): string => {
	const value = params[name]
	if (typeof value !== 'string' || value === '') throw new RpcCallError(-32602, `params.${name} is required (a string)`)
	return value
}

const names = (params: Params, name: string): string[] => {
	const value = params[name]
	if (!Array.isArray(value) || value.length === 0 || value.some(v => typeof v !== 'string')) throw new RpcCallError(-32602, `params.${name} is required (a list of names)`)
	return value
}

/**
 * The methods of the WebSocket API (docs/DATA_GATEWAY.md §7): {section}.{method} → an operation of DataGatewayPort,
 * with the params of the equivalent REST body. A method is a line here: register adds more.
 */
export class RpcDispatcher {
	private readonly methods = new Map<string, RpcMethod>()

	constructor () {
		this.register('general.version', gw => gw.version())
		this.register('general.health', gw => gw.health())
		this.register('general.ping', gw => gw.ping())
		this.register('query.execute', (gw, ctx, p) => gw.execute(ctx, { query: p.query, data: p.data, options: p.options }))
		this.register('query.executeQueued', (gw, ctx, p) => gw.executeQueued(ctx, { topic: p.topic, query: p.query, data: p.data, chunk: p.chunk, options: p.options, notify: p.notify }))
		this.register('query.script', (gw, ctx, p) => gw.executeScript(ctx, { script: p.script, data: p.data, options: p.options }))
		// the queries of application.queries (docs/NAMED_QUERIES.md)
		this.register('queries.list', (gw, ctx) => gw.queries(ctx))
		this.register('queries.execute', (gw, ctx, p) => gw.query(ctx, text(p, 'name'), { data: p.data, options: p.options }))
		// a write that waits for a person (docs/MUTATION_APPROVAL.md)
		this.register('approvals.status', (gw, ctx, p) => gw.approval(ctx, text(p, 'id')))
		for (const name of ['plan', 'metadata', 'model', 'parameters', 'constraints'] as const) {
			this.register(`query.${name}`, (gw, ctx, p) => (gw[name] as any).call(gw, ctx, { query: p.query, options: p.options }))
		}
		this.register('schema.schema', (gw, ctx) => gw.schema(ctx))
		this.register('schema.version', (gw, ctx) => gw.schemaVersion(ctx))
		this.register('schema.domain', (gw, ctx) => gw.domain(ctx))
		this.register('schema.sources', (gw, ctx) => gw.sources(ctx))
		this.register('schema.source', (gw, ctx, p) => gw.source(ctx, text(p, 'source')))
		this.register('schema.entities', (gw, ctx) => gw.entities(ctx))
		this.register('schema.entity', (gw, ctx, p) => gw.entity(ctx, text(p, 'entity')))
		this.register('schema.search', (gw, ctx, p) => gw.search(ctx, text(p, 'text')))
		this.register('schema.describe', (gw, ctx, p) => gw.describe(ctx, names(p, 'entities')))
		this.register('schema.enums', (gw, ctx) => gw.enums(ctx))
		this.register('schema.enum', (gw, ctx, p) => gw.enum(ctx, text(p, 'enum')))
		this.register('schema.mappings', (gw, ctx) => gw.mappings(ctx))
		this.register('schema.mapping', (gw, ctx, p) => gw.mapping(ctx, text(p, 'mapping')))
		this.register('schema.entityMapping', (gw, ctx, p) => gw.entityMapping(ctx, text(p, 'mapping'), text(p, 'entity')))
		this.register('schema.stages', (gw, ctx) => gw.stages(ctx))
		this.register('schema.stage', (gw, ctx, p) => gw.stage(ctx, text(p, 'stage')))
		this.register('schema.views', (gw, ctx) => gw.views(ctx))
		this.register('schema.typings', (gw, ctx) => gw.typings(ctx))
		this.register('stage.exists', (gw, ctx, p) => gw.stageExists(ctx, text(p, 'stage')))
		this.register('stage.export', (gw, ctx, p) => gw.stageExport(ctx, text(p, 'stage')))
		this.register('stage.import', async (gw, ctx, p) => { await gw.stageImport(ctx, text(p, 'stage'), p.data); return null })
	}

	public register (method: string, run: RpcMethod): void {
		this.methods.set(method, run)
	}

	public get names (): string[] {
		return [...this.methods.keys()]
	}

	public has (method: string): boolean {
		return this.methods.has(method)
	}

	public async dispatch (gateway: DataGatewayPort, ctx: RequestContext, method: string, params: unknown): Promise<unknown> {
		const run = this.methods.get(method)
		if (!run) throw new RpcCallError(-32601, `method "${method}" not found`)
		if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) {
			throw new RpcCallError(-32602, 'params must be an object')
		}
		const result = await run(gateway, ctx, (params ?? {}) as Params)
		// JSON-RPC has no undefined: an answer without a value is null
		return result === undefined ? null : result
	}
}
