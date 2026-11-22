import { WhoAmI } from '../domain/operations'
import { DomainInfo } from '../domain/diagram'
import { SavedItem } from '../domain/savedItems'
import { HistoryEntry, QueryParameter } from '../domain/workspace'

/** A schema the gateway serves (GET /schemas) */
export interface SchemaInfo {
	path: string
	status: string
	reason?: string
	/** When the version served now started: another value, the schema was reloaded (its lambdaORM.yaml changed) */
	since?: string
	/** A new version of its workspace that didn't start: the previous one is serving */
	pending?: string
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
	/** The entities, their properties and relations (GET /{schema}/domain), for the diagram; optional for other adapters */
	domain? (schema: string): Promise<DomainInfo>
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

/**
 * Where the saved folders, queries and diagrams are kept: IndexedDB in the browser (IndexedDbWorkspaceStore), memory
 * (MemoryWorkspaceStore), or a backend of your own.
 */
export interface WorkspaceStore {
	all (): Promise<SavedItem[]>
	put (items: SavedItem[]): Promise<void>
	remove (ids: string[]): Promise<void>
	clear (): Promise<void>
	/** Whether what is put survives closing the page (false when the browser doesn't allow storing) */
	durable (): Promise<boolean>
}

/** What a credential may do in the administration of the workspaces (GET /admin) */
export interface AdminCapabilities {
	schemaRead: boolean
	schemaWrite: boolean
	schemaAdmin: boolean
	workbenchRead: boolean
	workbenchWrite: boolean
}

export interface SchemaIssue {
	severity: 'error' | 'warning'
	message: string
	line?: number
	column?: number
}

/**
 * The administration of the workspaces of a gateway with admin.enabled (docs/DATA_GATEWAY.md §11). A failure throws
 * an Error with status: 412 (another changed it: details has what there is now), 422 (invalid: details.issues).
 */
export interface AdminApiPort {
	/** undefined when the gateway has no administration (admin off) */
	capabilities (): Promise<AdminCapabilities | undefined>
	readSchema (schema: string): Promise<{ text: string, version: string }>
	writeSchema (schema: string, text: string, version: string): Promise<{ version: string, issues: SchemaIssue[] }>
	validate (text: string): Promise<{ valid: boolean, issues: SchemaIssue[] }>
	createWorkspace (path: string, copyOf?: string): Promise<{ path: string, version: string }>
	removeWorkspace (path: string): Promise<{ trash: string }>
	/** what is saved in every workspace; undefined when it didn't change since that version */
	workbench (version?: string): Promise<{ version: string, items: (SavedItem & { version?: string })[] } | undefined>
	putItems (items: (SavedItem & { version?: string })[]): Promise<{ items: { id: string, version: string }[] }>
	removeItems (ids: string[]): Promise<{ removed: string[] }>
}
