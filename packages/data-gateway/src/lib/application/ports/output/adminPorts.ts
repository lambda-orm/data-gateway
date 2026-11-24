/** A file of a workspace as it is now: its text and its version (a hash of the content) */
export interface StoredFile {
	text: string
	version: string
	/** when it was last changed, ISO */
	modified: string
}

/** A write found the file in another version than the one it was asked to change */
export class VersionConflict extends Error {
	constructor (public readonly file: string, public readonly current: string | undefined) {
		super(current === undefined ? `${file} doesn't exist anymore` : `${file} changed since it was read`)
		this.name = 'VersionConflict'
	}
}

/**
 * The files of the workspaces, in the volume. Every path is relative to the workspace and stays inside it (no `..`,
 * no link that leads out). A write is atomic (a temporary file and a rename) and, with `expected`, a compare-and-swap.
 */
export interface WorkspaceStorePort {
	read (workspace: string, file: string): Promise<StoredFile | undefined>
	/** expected: the version it must have now; null: it must not exist; undefined: whatever. Answers the new version */
	write (workspace: string, file: string, text: string, expected?: string | null): Promise<string>
	/** a file, or a folder with what it holds */
	remove (workspace: string, path: string): Promise<void>
	move (workspace: string, from: string, to: string): Promise<void>
	mkdir (workspace: string, dir: string): Promise<void>
	/** what is under a folder, recursively; [] if it doesn't exist */
	list (workspace: string, dir: string): Promise<{ path: string, dir: boolean, modified: string }[]>
	/** one at a time per workspace, also across replicas of the gateway on the same volume (a lock file) */
	withLock<T> (workspace: string, task: () => Promise<T>): Promise<T>
	/** a new workspace: fails if the folder exists */
	create (dir: string, files: Record<string, string>): Promise<void>
	/** moves a workspace to <root>/.trash/<route>-<time>; answers where */
	trash (root: string, dir: string): Promise<string>
	/** the folder of a route under the root */
	folderOf (root: string, path: string): string
}

export interface SchemaIssue {
	severity: 'error' | 'warning'
	message: string
	/** 1-based, when it is known */
	line?: number
	column?: number
}

/** Checks a lambdaORM.yaml without connecting nor running anything of it (application.start, listeners) */
export interface SchemaValidatorPort {
	validate (text: string): Promise<SchemaIssue[]>
}

/** YAML in and out (the files of workbench/) */
export interface YamlPort {
	parse (text: string): unknown
	stringify (value: unknown): string
	/** a YAML text with a new value, keeping the comments, order and style of what didn't change */
	merge (text: string, value: unknown): string
}

/** The code of a domain for a language: its files, relative to the folder of the domain (model.ts, repositoryX.ts) */
export interface CodeGeneratorPort {
	files (language: 'node' | 'client-node', domain: unknown, options: { model: boolean, repositories: boolean }): { file: string, content: string }[]
}

/** A function or an operator of the language of the expressions (3xpr) */
export interface ExpressionSign {
	name: string
	params: { name: string, type?: string, multiple?: boolean }[]
	returnType: string
	description?: string
}

/** The language of the expressions: to suggest and to explain while one is written */
export interface ExpressionLanguage {
	functions: ExpressionSign[]
	operators: ExpressionSign[]
	constants: string[]
}

/** An expression of 3xpr: its language, and whether one is right */
export interface ExpressionLanguagePort {
	language (): ExpressionLanguage
	/** the problem of an expression that doesn't parse, or the variables it uses */
	check (expression: string): { error?: string, variables: string[] }
	/** its value with these variables (it throws when it doesn't parse or evaluate) */
	evaluate (expression: string, data: Record<string, unknown>): unknown
}

/** Where the UI of each credential was: its tabs, their drafts, what is unfolded (kept by the gateway, docs/DATA_GATEWAY.md §11.8) */
export interface SessionStatePort {
	read (credential: string): Promise<{ state: unknown, updatedAt: string } | undefined>
	write (credential: string, state: unknown, at: string): Promise<void>
	remove (credential: string): Promise<void>
}

