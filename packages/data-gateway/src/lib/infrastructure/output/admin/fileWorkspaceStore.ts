import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { StoredFile, VersionConflict, WorkspaceStorePort } from '../../../application/ports/output/adminPorts'

const LOCK = '.lambdaorm.lock'
/** A lock older than this was left by a process that ended without releasing it */
const STALE_LOCK_MS = 30000
const LOCK_WAIT_MS = 10000

export const versionOf = (content: string | Buffer): string => crypto.createHash('sha256').update(content).digest('hex').slice(0, 32)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** The workspaces in the volume (docs/DATA_GATEWAY_ADMIN_PLAN.md §2.4) */
export class FileWorkspaceStore implements WorkspaceStorePort {
	/** in this process the writes to a workspace wait in line; across processes the lock file decides */
	private readonly queues = new Map<string, Promise<unknown>>()

	/** A path of the workspace, checked to stay inside it */
	private inside (workspace: string, relative: string): string {
		if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(`"${relative}" is not a path inside the workspace`)
		const root = path.resolve(workspace)
		const full = path.resolve(root, relative)
		if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`"${relative}" is not a path inside the workspace`)
		// a link inside the workspace that leads out of it
		let existing = full
		while (!fs.existsSync(existing) && existing !== root) existing = path.dirname(existing)
		const real = fs.realpathSync(existing)
		const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root
		if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error(`"${relative}" leads out of the workspace`)
		return full
	}

	public async read (workspace: string, file: string): Promise<StoredFile | undefined> {
		const full = this.inside(workspace, file)
		try {
			const [content, stat] = await Promise.all([fs.promises.readFile(full), fs.promises.stat(full)])
			if (!stat.isFile()) return undefined
			return { text: content.toString('utf8'), version: versionOf(content), modified: stat.mtime.toISOString() }
		} catch (error: any) {
			if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return undefined
			throw error
		}
	}

	public async write (workspace: string, file: string, text: string, expected?: string | null): Promise<string> {
		const full = this.inside(workspace, file)
		if (expected !== undefined) {
			const current = await this.read(workspace, file)
			if (expected === null ? current !== undefined : current?.version !== expected) throw new VersionConflict(file, current?.version)
		}
		await fs.promises.mkdir(path.dirname(full), { recursive: true })
		// atomic: a reader sees the old file or the new one, never half of it
		const temporary = path.join(path.dirname(full), `.${path.basename(full)}.${process.pid}.${Date.now()}.tmp`)
		await fs.promises.writeFile(temporary, text)
		await fs.promises.rename(temporary, full)
		return versionOf(text)
	}

	public async remove (workspace: string, target: string): Promise<void> {
		await fs.promises.rm(this.inside(workspace, target), { recursive: true, force: true })
	}

	public async move (workspace: string, from: string, to: string): Promise<void> {
		const [source, destination] = [this.inside(workspace, from), this.inside(workspace, to)]
		if (fs.existsSync(destination) && path.resolve(source).toLowerCase() !== path.resolve(destination).toLowerCase()) {
			throw Object.assign(new Error(`${to} already exists`), { code: 'EEXIST' })
		}
		await fs.promises.mkdir(path.dirname(destination), { recursive: true })
		await fs.promises.rename(source, destination)
	}

	public async mkdir (workspace: string, dir: string): Promise<void> {
		await fs.promises.mkdir(this.inside(workspace, dir), { recursive: true })
	}

	public async list (workspace: string, dir: string): Promise<{ path: string, dir: boolean, modified: string }[]> {
		const base = this.inside(workspace, dir)
		const found: { path: string, dir: boolean, modified: string }[] = []
		const walk = async (folder: string, relative: string): Promise<void> => {
			let entries: fs.Dirent[]
			try { entries = await fs.promises.readdir(folder, { withFileTypes: true }) } catch { return }
			for (const entry of entries) {
				// hidden files (.folder.yaml, temporaries, the lock) are not items
				if (entry.name.startsWith('.')) continue
				const full = path.join(folder, entry.name)
				const rel = `${relative}/${entry.name}`
				const stat = await fs.promises.stat(full).catch(() => undefined)
				if (!stat) continue
				found.push({ path: rel, dir: stat.isDirectory(), modified: stat.mtime.toISOString() })
				if (stat.isDirectory()) await walk(full, rel)
			}
		}
		await walk(base, dir)
		return found
	}

	public async withLock<T> (workspace: string, task: () => Promise<T>): Promise<T> {
		const key = path.resolve(workspace)
		const previous = this.queues.get(key) ?? Promise.resolve()
		const run = previous.catch(() => undefined).then(() => this.locked(key, task))
		this.queues.set(key, run.catch(() => undefined))
		return run
	}

	private async locked<T> (workspace: string, task: () => Promise<T>): Promise<T> {
		const lock = path.join(workspace, LOCK)
		const end = Date.now() + LOCK_WAIT_MS
		for (;;) {
			try {
				const handle = await fs.promises.open(lock, 'wx')
				await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`)
				await handle.close()
				break
			} catch (error: any) {
				if (error?.code !== 'EEXIST') throw error
				const stat = await fs.promises.stat(lock).catch(() => undefined)
				if (stat && Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
					await fs.promises.rm(lock, { force: true })
					continue
				}
				if (Date.now() > end) throw Object.assign(new Error(`the workspace is busy (${lock})`), { status: 409, name: 'ConflictError' })
				await sleep(50)
			}
		}
		try {
			return await task()
		} finally {
			await fs.promises.rm(lock, { force: true })
		}
	}

	public async create (dir: string, files: Record<string, string>): Promise<void> {
		// mkdir of the last folder without recursive: EEXIST if it is there
		await fs.promises.mkdir(path.dirname(dir), { recursive: true })
		await fs.promises.mkdir(dir)
		for (const [file, text] of Object.entries(files)) {
			const full = this.inside(dir, file)
			await fs.promises.mkdir(path.dirname(full), { recursive: true })
			await fs.promises.writeFile(full, text)
		}
		// the lambdaORM.yaml last would be better, but the monitor reads the content: what matters is that it is whole
	}

	public async trash (root: string, dir: string): Promise<string> {
		const relative = path.relative(path.resolve(root), path.resolve(dir))
		if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') throw new Error(`${dir} is not under ${root}`)
		const target = path.join(root, '.trash', `${relative.split(path.sep).join('__')}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
		await fs.promises.mkdir(path.dirname(target), { recursive: true })
		await fs.promises.rename(dir, target)
		// the lock of the remove went with it: in the trash nobody releases it
		await fs.promises.rm(path.join(target, LOCK), { force: true })
		// the folders that held only it (iot/ of iot/v1) stay: another schema may be created there
		return path.relative(root, target).split(path.sep).join('/')
	}

	public folderOf (root: string, schemaPath: string): string {
		return path.join(path.resolve(root), ...schemaPath.split('/'))
	}
}
