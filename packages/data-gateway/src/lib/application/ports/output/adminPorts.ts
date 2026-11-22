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
