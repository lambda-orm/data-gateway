/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import {
	QueryOptions, ScriptOptions, QueryPlan, Metadata, MetadataModel, MetadataConstraint, MetadataParameter,
	Entity, EntityMapping, Enum, Mapping, Stage, Schema, DomainSchema, SchemaData
} from '@lambdaorm/base'
import { expressions } from '3xpr'
import { ConnectOptions, ConnectionTarget, parseConnection } from './connection'
import { GatewayError, TransportName } from './errors'
import { Args, Operation } from './operations'
import { McpHttpTransport, McpSseTransport, McpWebSocketTransport } from './transports/mcp'
import { RestTransport } from './transports/rest'
import { NotificationEvent, NotificationListener, Transport } from './transports/transport'
import { WebSocketTransport } from './transports/webSocket'

/** A query: the text of a λORM expression, or a function whose text is one (`p => Products.filter(...)`) */
export type Query = string | Function

/** What schema.search answers: one line per match; `more` beyond 40, `didYouMean` when nothing matches */
export interface DomainSearch { matches: string[], more?: number, hint?: string, didYouMean?: string[] }
/** What schema.describe answers */
export interface DescribedEntities { entities: string[], notFound?: { name: string, didYouMean: string[] }[] }

export interface Whoami { name: string, permissions: string[], schema: string, scripts: boolean }

const TRANSPORTS: Record<TransportName, (target: ConnectionTarget) => Transport> = {
	http: target => new RestTransport(target),
	ws: target => new WebSocketTransport(target),
	'mcp+http': target => new McpHttpTransport(target),
	'mcp+sse': target => new McpSseTransport(target),
	'mcp+ws': target => new McpWebSocketTransport(target)
}

/** the text of a query given as a function */
export const queryText = (query: Query): string => typeof query === 'string' ? query : expressions.convert(query, 'function')[0]

/**
 * A connection to one schema of a Data Gateway, by the transport its connection string names. The same API on the
 * five transports (docs/DATA_GATEWAY_CLIENTS_PLAN.md §3); an operation that fails throws a GatewayError.
 */
export class DataGatewayClient {
	public readonly schema: SchemaOperations
	public readonly stage: StageOperations
	public readonly general: GeneralOperations

	/** use connect() */
	constructor (private readonly transport: Transport, private readonly target: ConnectionTarget) {
		this.schema = new SchemaOperations(this)
		this.stage = new StageOperations(this)
		this.general = new GeneralOperations(this)
	}

	/** the transport of the connection: http, ws, mcp+http, mcp+sse or mcp+ws */
	public get transportName (): TransportName { return this.transport.name }

	/** @internal one operation of the common API on the transport */
	public async call<T> (operation: Operation, args: Args = {}): Promise<T> {
		try {
			return await this.transport.call(operation, args) as T
		} catch (error) {
			if (error instanceof GatewayError && !error.operation) (error as { operation?: string }).operation = operation
			throw error
		}
	}

	private options<T extends QueryOptions> (options?: T): T | undefined {
		return this.target.stage && !options?.stage ? { ...options, stage: this.target.stage } as T : options
	}

	/** runs a query: its rows, or what an insert, update or delete answers */
	public execute<T = any> (query: Query, data: any = {}, options?: QueryOptions): Promise<T> {
		return this.call('execute', { query: queryText(query), data, options: this.options(options) })
	}

	/** runs a script of λORM in one transaction (the gateway needs scripts.enabled): the value of its last statement */
	public executeScript<T = any> (script: string, data: any = {}, options?: ScriptOptions): Promise<T> {
		return this.call('executeScript', { script, data, options: this.options(options) })
	}

	/** queues a query to the topic: the gateway runs it in the background (on ws, `on('queue.completed')` tells when) */
	public executeQueued (query: Query, topic: string, data: any = {}, chunk?: number, options?: QueryOptions): Promise<any> {
		return this.call('executeQueued', { query: queryText(query), topic, data, chunk, options: this.options(options) })
	}

	/** the sentences a query would run, on which source and dialect, without running it */
	public plan (query: Query, options?: QueryOptions): Promise<QueryPlan> {
		return this.call('plan', { query: queryText(query), options: this.options(options) })
	}

	public metadata (query: Query): Promise<Metadata> { return this.call('metadata', { query: queryText(query) }) }
	public model (query: Query): Promise<MetadataModel[]> { return this.call('model', { query: queryText(query) }) }
	public parameters (query: Query): Promise<MetadataParameter[]> { return this.call('parameters', { query: queryText(query) }) }
	public constraints (query: Query): Promise<MetadataConstraint> { return this.call('constraints', { query: queryText(query) }) }

	/**
	 * The queries of application.queries of the schema that this credential can use, with their parameters and their
	 * model (never their text): REST and WebSocket (gateway 4.1.0, docs/NAMED_QUERIES.md)
	 */
	public queries (): Promise<{ name: string, description?: string, parameters: MetadataParameter[], model: MetadataModel[], writes: boolean }[]> { return this.call('queries') }

	/** runs a query of application.queries by its name, with its parameters: every transport */
	public query<T = any> (name: string, data: any = {}, options?: QueryOptions): Promise<T> {
		return this.call('query', { name, data, options: this.options(options) })
	}

	/** who the credential is and what it can do (REST only) */
	public whoami (): Promise<Whoami> { return this.call('whoami') }

	/**
	 * Notifications of the gateway (ws only): 'queue.completed' / 'queue.failed' when an executeQueued of this
	 * connection ends, 'schema.statusChanged'. Answers how to stop listening.
	 */
	public on (event: NotificationEvent, listener: NotificationListener): () => void {
		if (!this.transport.on) {
			throw new GatewayError({ code: 'unsupported', message: `notifications are not available on ${this.transport.name}: use a ws:// connection`, transport: this.transport.name, operation: 'on' })
		}
		return this.transport.on(event, listener)
	}

	public close (): Promise<void> { return this.transport.close() }
}

/** The schema as the gateway loaded it. A name that doesn't exist fails with the code not_found. */
export class SchemaOperations {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly client: DataGatewayClient) {}
	public schema (): Promise<Schema> { return this.client.call('schema') }
	public version (): Promise<{ version: string }> { return this.client.call('schemaVersion') }
	public domain (): Promise<DomainSchema> { return this.client.call('domain') }
	public entities (): Promise<Entity[]> { return this.client.call('entities') }
	public entity (entity: string): Promise<Entity> { return this.client.call('entity', { entity }) }
	/** entities, properties and relations whose name contains the text, as compact lines (`Areas.type` only in Areas) */
	public search (text: string): Promise<DomainSearch> { return this.client.call('search', { text }) }
	/** some entities, two lines each; the names that don't exist apart, with the closest ones */
	public describe (entities: string[]): Promise<DescribedEntities> { return this.client.call('describe', { entities }) }
	public enums (): Promise<Enum[]> { return this.client.call('enums') }
	public enum (name: string): Promise<Enum> { return this.client.call('enum', { enum: name }) }
	public sources (): Promise<{ name: string, dialect: string }[]> { return this.client.call('sources') }
	public source (source: string): Promise<{ name: string, dialect: string }> { return this.client.call('source', { source }) }
	public mappings (): Promise<Mapping[]> { return this.client.call('mappings') }
	public mapping (mapping: string): Promise<Mapping> { return this.client.call('mapping', { mapping }) }
	public entityMapping (mapping: string, entity: string): Promise<EntityMapping> { return this.client.call('entityMapping', { mapping, entity }) }
	public stages (): Promise<Stage[]> { return this.client.call('stages') }
	public stage (stage: string): Promise<Stage> { return this.client.call('stage', { stage }) }
	public views (): Promise<string[]> { return this.client.call('views') }
}

export class StageOperations {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly client: DataGatewayClient) {}
	public async exists (stage: string): Promise<boolean> { return (await this.client.call<{ exists: boolean }>('stageExists', { stage })).exists }
	public export (stage: string): Promise<SchemaData> { return this.client.call('stageExport', { stage }) }
	public async import (stage: string, data: SchemaData): Promise<void> { await this.client.call('stageImport', { stage, data }) }
}

export class GeneralOperations {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly client: DataGatewayClient) {}
	public version (): Promise<{ version: string }> { return this.client.call('version') }
	public health (): Promise<{ message: string, time: string, uptime: number }> { return this.client.call('health') }
}

/**
 * Connects to a schema of a Data Gateway. The scheme of the URL chooses the transport:
 * `http(s)://` REST, `ws(s)://` JSON-RPC over WebSocket, `mcp+http(s)://` MCP Streamable HTTP, `mcp+sse(s)://` MCP
 * HTTP+SSE (legacy), `mcp+ws(s)://` MCP over WebSocket. Without a URL, DATA_GATEWAY_URL.
 *
 * ```ts
 * const gateway = await connect('mcp+http://localhost:8081/northwind', { apiKey: process.env.GATEWAY_KEY })
 * const rows = await gateway.execute('Products.filter(p => p.price > min).map(p => p.name)', { min: 50 })
 * ```
 */
export const connect = async (connection?: string, options: ConnectOptions = {}): Promise<DataGatewayClient> => {
	const target = parseConnection(connection, options)
	const transport = TRANSPORTS[target.transport](target)
	await transport.open()
	return new DataGatewayClient(transport, target)
}
