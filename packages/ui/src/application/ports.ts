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
	/** The names of the stages and of the views of a schema (GET /{schema}/stages, /views): the choices of the options */
	stages? (schema: string): Promise<string[]>
	views? (schema: string): Promise<string[]>
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
	/** generate the code of the domain (lambdaorm build) */
	build?: boolean
}

/** A file of workbench/ that is not an item (not valid YAML): nothing saved from here replaces it */
export interface WorkbenchProblem {
	schema: string
	file: string
	message: string
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
/** A function or an operator of the expressions of λORM (3xpr) */
export interface ExpressionSign {
	name: string
	params: { name: string, type?: string, multiple?: boolean }[]
	returnType: string
	description?: string
}

/** The language of the expressions and the variables of each kind of expression (stageSource: a condition of a stage) */
export interface ExpressionLanguage {
	functions: ExpressionSign[]
	operators: ExpressionSign[]
	constants: string[]
	contexts: Record<string, { name: string, type: string, description: string }[]>
}

/** An expression checked: it parses, and uses only the variables of its context */
export interface ExpressionCheck {
	valid: boolean
	error?: string
	variables: string[]
	unknown: string[]
}

/** Where the entities of a stage go: each source in its order, its condition and the entities that live in it */
export interface StageRouting {
	stage: string
	sources: {
		name: string
		dialect?: string
		mapping?: string
		/** none: it takes what reaches it */
		condition?: string
		/** the condition doesn't evaluate (it is taken as false) */
		error?: string
		/** its table by the mapping of the source; read, write: the source its reads or writes go to, when another one */
		entities: { entity: string, table: string, view?: boolean, read?: string, write?: string }[]
	}[]
	/** the entities no source takes */
	unrouted: string[]
}

/** What the build of the code generates: the model, the repositories (both by default) */
export interface CodeParts { model?: boolean, repositories?: boolean }

export interface AdminApiPort {
	/** undefined when the gateway has no administration (admin off) */
	capabilities (): Promise<AdminCapabilities | undefined>
	readSchema (schema: string): Promise<{ text: string, version: string }>
	/** one change of one element (a form): 412 when that element changed since it was read (details.current) */
	patchSchema (schema: string, patch: SchemaPatch): Promise<{ version: string, references: string[], added: number, removed: number }>
	/** the variables of the connections (.env): which are defined and where they are used, never their value */
	variables (schema: string): Promise<{ variables: SchemaVariable[] }>
	setVariables (schema: string, change: { set?: Record<string, string>, remove?: string[] }): Promise<{ variables: SchemaVariable[] }>
	/** the code of the domain written in src/ of the workspace */
	/** parts: only the model, or only the repositories (as -m and -r of the CLI); by default both */
	build (schema: string, language: 'node' | 'client-node', parts?: CodeParts): Promise<{ language: string, files: { path: string, written?: string, bytes: number }[] }>
	/** the same code as a zip, without writing anything */
	buildZip (schema: string, language: 'node' | 'client-node', parts?: CodeParts): Promise<Blob>
	/** a folder of data/ or src/ as a zip, as it is in the workspace (a gateway before 4.1.0 doesn't have it) */
	folderZip? (schema: string, dir: string): Promise<Blob>
	/** a folder of the source code taken out (the code of a language, under src/) */
	removeCode? (schema: string, dir: string): Promise<{ removed: string }>
	/** the files of data/ or src/ of a workspace (recursive), and where its data, code and model folders are */
	files (schema: string, dir?: string): Promise<{ roots: { data: string, src: string, model: string }, files: { path: string, dir: boolean, modified: string }[] }>
	/** the text of a file of data/ or src/ */
	fileContent (schema: string, path: string): Promise<{ path: string, text: string, version: string }>
	/** who uses an element (to warn before removing it) */
	references (schema: string, at: string[]): Promise<{ references: string[] }>
	writeSchema (schema: string, text: string, version: string): Promise<{ version: string, issues: SchemaIssue[] }>
	validate (text: string): Promise<{ valid: boolean, issues: SchemaIssue[] }>
	/** the language of the expressions (a gateway before 3.3.0 doesn't have it: a plain input then) */
	expressionLanguage? (): Promise<ExpressionLanguage>
	checkExpression? (expression: string, context?: string): Promise<ExpressionCheck>
	/** where the entities of a stage go (a gateway before 4.1.0 doesn't have it) */
	stageRouting? (schema: string, stage: string): Promise<StageRouting>
	/** a new schema; its name and description go on top of its lambdaORM.yaml */
	createWorkspace (path: string, copyOf?: string, about?: { name?: string, description?: string }): Promise<{ path: string, version: string }>
	removeWorkspace (path: string): Promise<{ trash: string }>
	/** what is saved in every workspace; undefined when it didn't change since that version */
	workbench (version?: string): Promise<{ version: string, items: (SavedItem & { version?: string })[], problems?: WorkbenchProblem[] } | undefined>
	putItems (items: (SavedItem & { version?: string })[]): Promise<{ items: { id: string, version: string }[] }>
	removeItems (ids: string[]): Promise<{ removed: string[] }>
	/** the commands of a workspace (§4): the stages and what may be run */
	commands (schema: string): Promise<CommandsSummary>
	previewCommand (schema: string, command: CommandName, body: { stage?: string, data?: unknown, name?: string }): Promise<CommandPreview>
	runCommand (schema: string, command: CommandName, body: { stage?: string, previewId?: string, force?: boolean, save?: boolean }): Promise<Job | Record<string, unknown>>
	jobs (schema: string): Promise<Job[]>
	job (schema: string, id: string): Promise<Job>
}

export type CommandName = 'version' | 'fetch' | 'export' | 'push' | 'drop' | 'import' | 'pull' | 'introspect' | 'incorporate'

export interface Job {
	id: string
	schema: string
	command: CommandName
	stage?: string
	status: 'running' | 'done' | 'failed'
	credential: string
	startedAt: string
	finishedAt?: string
	result?: unknown
	error?: { name: string, message: string, status?: number }
	file?: string
}

export interface CommandsSummary {
	stages: string[]
	can: Record<CommandName, boolean>
	running?: Job
}

/** What a command that changes the databases would do, and the id to run exactly that */
export interface CommandPreview {
	previewId: string
	command: CommandName
	stage: string
	expiresAt: string
	/** push: by source; drop: the sentences */
	sentences?: unknown[]
	/** import, introspect, incorporate: the rows of each entity */
	rows?: Record<string, number>
	/** pull, introspect, incorporate: what changes in the lambdaORM.yaml */
	diff?: { added: number, removed: number, hunks: { oldStart: number, newStart: number, lines: { op: ' ' | '+' | '-', text: string }[] }[] }
}

/** One change of one element of a schema, named by names (['domain', 'entities', 'Products']) */
export interface SchemaPatch {
	op: 'set' | 'add' | 'remove' | 'rename'
	at: string[]
	value?: unknown
	to?: string
	/** the element as it was read */
	expected?: unknown
}

/** A variable of the connections of a workspace: never its value */
export interface SchemaVariable {
	name: string
	/** the .env of the workspace defines it (it may also come from the gateway's configuration or environment) */
	defined: boolean
	/** the sources whose connection names it */
	usedBy: string[]
	/** the lambdaORM.yaml names it */
	used: boolean
}

/** Where the workspace of a person was (domain/session.ts): kept by the gateway for its credential, or in the browser */
export interface SessionStorePort {
	load (): Promise<unknown>
	/** keepalive: the page is being left (the request outlives it) */
	save (session: unknown, options?: { keepalive?: boolean }): Promise<void>
}

