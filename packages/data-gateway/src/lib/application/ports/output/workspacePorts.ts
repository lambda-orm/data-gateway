/** The file events of some folders (recursive): the absolute path of each file that changed, appeared or went */
export interface WorkspaceWatcherPort {
	watch (folders: string[], onFile: (file: string) => void): () => void
}

/** What a schema is started with, read from its workspace: a hash of its lambdaORM.yaml and of its .env ('' if none) */
export interface WorkspaceFilesPort {
	fingerprint (workspace: string): { schema: string, env: string }
	/** A file as a path inside a workspace, with / (`workbench/a.query.yaml`); undefined if it is not inside it */
	relative (workspace: string, file: string): string | undefined
	/** The absolute form of a folder, to compare it with the files of the events */
	absolute (folder: string): string
}
