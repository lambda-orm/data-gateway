import fs from 'fs'
import path from 'path'
import { DiscoveredSchema } from '../../../domain/runtime/schemas'

/** Folders never walked: they hold no schemas and can be large */
const SKIPPED = new Set(['node_modules', '.git'])

/**
 * The schemas under orm.workspacePath: every folder with a lambdaORM.yaml is one, its route is its path relative to the
 * root, and the walk doesn't go down from it (a workspace has folders of its own: orm_state, data, …).
 */
export class FileSystemSchemaDiscovery {
	public discover (root: string): DiscoveredSchema[] {
		if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return []
		const found: DiscoveredSchema[] = []
		// symbolic links to folders are followed (a volume per schema); a cycle is walked once
		const visited = new Set<string>()
		const isFolder = (full: string, entry: fs.Dirent): boolean => {
			if (entry.isDirectory()) return true
			if (!entry.isSymbolicLink()) return false
			try { return fs.statSync(full).isDirectory() } catch { return false }
		}
		const walk = (dir: string): void => {
			const real = fs.realpathSync(dir)
			if (visited.has(real)) return
			visited.add(real)
			if (fs.existsSync(path.join(dir, 'lambdaORM.yaml'))) {
				found.push({ path: path.relative(root, dir).split(path.sep).join('/'), workspace: dir })
				return
			}
			let entries: fs.Dirent[]
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true })
			} catch {
				// a folder it can't read holds no schema it could serve
				return
			}
			for (const entry of entries) {
				const full = path.join(dir, entry.name)
				if (!SKIPPED.has(entry.name) && !entry.name.startsWith('.') && isFolder(full, entry)) walk(full)
			}
		}
		walk(root)
		return found.sort((a, b) => a.path.localeCompare(b.path))
	}
}
