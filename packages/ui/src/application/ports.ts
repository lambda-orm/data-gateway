import { WhoAmI } from '../domain/operations'
import { HistoryEntry, QueryParameter } from '../domain/workspace'

/** A schema the gateway serves (GET /schemas) */
export interface SchemaInfo {
	path: string
	status: string
	reason?: string
}

export type Options = Record<string, unknown>

/**
 * What the workbench needs from a data-gateway. RestQueryApi does it over the REST API; another adapter can go through
 * a backend of its own (a Portal). A failure throws an Error with name, message and, when there is one, status / code.
 */
export interface QueryApiPort {
	schemas (): Promise<SchemaInfo[]>
	whoami (schema: string): Promise<WhoAmI>
	/** The domain as TypeScript declarations (GET /{schema}/typings) */
	typings (schema: string): Promise<string>
	plan (schema: string, query: string, options?: Options): Promise<unknown>
	metadata (schema: string, query: string): Promise<unknown>
	model (schema: string, query: string): Promise<unknown>
	parameters (schema: string, query: string): Promise<QueryParameter[]>
	constraints (schema: string, query: string): Promise<unknown>
	execute (schema: string, query: string, data?: unknown, options?: Options): Promise<unknown>
	executeQueued (schema: string, request: { topic: string, query: string, data?: unknown, chunk?: number, options?: Options }): Promise<unknown>
	executeScript (schema: string, script: string, data?: unknown, options?: Options): Promise<unknown>
}

/** Where the history of each schema is kept */
export interface HistoryPort {
	load (schema: string): HistoryEntry[]
	save (schema: string, entries: HistoryEntry[]): void
	clear (schema: string): void
}
