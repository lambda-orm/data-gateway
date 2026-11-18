import { WhoAmI } from '../domain/operations'
import { DomainInfo } from '../domain/diagram'
import { QueryParameter } from '../domain/workspace'
import { Options, QueryApiPort, SchemaInfo } from '../application/ports'

export type HeadersProvider = () => Record<string, string> | Promise<Record<string, string>>

/** An answer of the gateway that is not 2xx, with its JSON error ({ error, message, code }) */
export class GatewayRequestError extends Error {
	constructor (public readonly status: number, name: string, message: string, public readonly code?: string) {
		super(message)
		this.name = name
	}
}

/** The REST API of a data-gateway with fetch. The library keeps no credential: headers() gives it on every request. */
export class RestQueryApi implements QueryApiPort {
	private readonly baseUrl: string

	constructor (baseUrl: string, private readonly headers: HeadersProvider = () => ({}), private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {
		this.baseUrl = baseUrl.replace(/\/+$/, '')
	}

	private url (schema: string, path: string): string {
		return `${this.baseUrl}${schema ? `/${schema}` : ''}${path}`
	}

	private async request (url: string, body?: unknown, accept: 'json' | 'text' = 'json'): Promise<any> {
		const headers: Record<string, string> = { ...(await this.headers()) }
		if (body !== undefined) headers['content-type'] = 'application/json'
		const response = await this.fetcher(url, { method: body !== undefined ? 'POST' : 'GET', headers, body: body !== undefined ? JSON.stringify(body) : undefined })
		const text = await response.text()
		if (!response.ok) {
			let error: any = {}
			try { error = JSON.parse(text) } catch { /* not JSON */ }
			throw new GatewayRequestError(response.status, error.error ?? `HTTP ${response.status}`, error.message ?? (text || response.statusText), error.code)
		}
		if (accept === 'text') return text
		return text ? JSON.parse(text) : undefined
	}

	public schemas (): Promise<SchemaInfo[]> { return this.request(`${this.baseUrl}/schemas`) }
	public whoami (schema: string): Promise<WhoAmI> { return this.request(this.url(schema, '/whoami')) }
	public typings (schema: string): Promise<string> { return this.request(this.url(schema, '/typings'), undefined, 'text') }
	public domain (schema: string): Promise<DomainInfo> { return this.request(this.url(schema, '/domain')) }
	public plan (schema: string, query: string, options?: Options) { return this.request(this.url(schema, '/plan'), { query, options }) }
	public metadata (schema: string, query: string) { return this.request(this.url(schema, '/metadata'), { query }) }
	public model (schema: string, query: string) { return this.request(this.url(schema, '/model'), { query }) }
	public parameters (schema: string, query: string): Promise<QueryParameter[]> { return this.request(this.url(schema, '/parameters'), { query }) }
	public constraints (schema: string, query: string) { return this.request(this.url(schema, '/constraints'), { query }) }
	public execute (schema: string, query: string, data?: unknown, options?: Options) { return this.request(this.url(schema, '/execute'), { query, data, options }) }
	public executeQueued (schema: string, request: { topic: string, query: string, data?: unknown, chunk?: number, options?: Options }) {
		return this.request(this.url(schema, '/execute-queued'), request)
	}

	public executeScript (schema: string, script: string, data?: unknown, options?: Options) { return this.request(this.url(schema, '/script'), { script, data, options }) }
}
