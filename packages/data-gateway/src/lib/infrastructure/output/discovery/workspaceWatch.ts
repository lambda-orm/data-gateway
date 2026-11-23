import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { WorkspaceFilesPort, WorkspaceWatcherPort } from '../../../application/ports/output/workspacePorts'
import { LoggerPort } from '../../../application/ports/output/supportPorts'

/**
 * fs.watch, recursive, of each folder. Where the events don't arrive (some mounted volumes) or a folder can't be
 * watched, the scan of the monitor (orm.watch.intervalMs) still sees the changes.
 */
export class FsWorkspaceWatcher implements WorkspaceWatcherPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly logger: LoggerPort) {}

	public watch (folders: string[], onFile: (file: string) => void): () => void {
		const watchers: fs.FSWatcher[] = []
		for (const folder of folders) {
			if (!fs.existsSync(folder)) continue
			try {
				const watcher = fs.watch(folder, { recursive: true, persistent: false }, (_event, name) => {
					if (name) onFile(path.join(folder, name.toString()))
				})
				watcher.on('error', error => this.logger.warn(`[data-gateway] watching ${folder}: ${error.message} (the scan of the workspaces goes on)`))
				watchers.push(watcher)
			} catch (error: any) {
				this.logger.warn(`[data-gateway] ${folder} can't be watched: ${error?.message ?? error} (the scan of the workspaces goes on)`)
			}
		}
		return () => { for (const watcher of watchers) watcher.close() }
	}
}

const hashOf = (file: string): string => {
	try {
		return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
	} catch {
		return ''
	}
}

export class FileWorkspaceFiles implements WorkspaceFilesPort {
	public fingerprint (workspace: string): { schema: string, env: string } {
		return { schema: hashOf(path.join(workspace, 'lambdaORM.yaml')), env: hashOf(path.join(workspace, '.env')) }
	}

	public relative (workspace: string, file: string): string | undefined {
		const relative = path.relative(workspace, file)
		if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return undefined
		return relative.split(path.sep).join('/')
	}

	public absolute (folder: string): string {
		return path.resolve(folder)
	}
}
