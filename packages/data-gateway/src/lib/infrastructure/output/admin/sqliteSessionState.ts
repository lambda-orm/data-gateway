import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { SessionStatePort } from '../../../application/ports/output/adminPorts'

/**
 * The state of the UI of each credential in a SQLite file of the workspace (.data-gateway/state.sqlite, which the
 * monitor and the discovery skip): one row per credential, its state as JSON. node:sqlite, nothing to install.
 */
export class SqliteSessionState implements SessionStatePort {
	private db?: DatabaseSync

	constructor (private readonly file: string) {}

	private open (): DatabaseSync {
		if (!this.db) {
			fs.mkdirSync(path.dirname(this.file), { recursive: true })
			this.db = new DatabaseSync(this.file)
			this.db.exec('PRAGMA journal_mode = WAL')
			this.db.exec('CREATE TABLE IF NOT EXISTS session (credential TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL)')
		}
		return this.db
	}

	public async read (credential: string): Promise<{ state: unknown, updatedAt: string } | undefined> {
		const row = this.open().prepare('SELECT state, updated_at FROM session WHERE credential = ?').get(credential) as { state: string, updated_at: string } | undefined
		return row ? { state: JSON.parse(row.state), updatedAt: row.updated_at } : undefined
	}

	public async write (credential: string, state: unknown, at: string): Promise<void> {
		this.open().prepare('INSERT INTO session (credential, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(credential) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
			.run(credential, JSON.stringify(state), at)
	}

	public async remove (credential: string): Promise<void> {
		this.open().prepare('DELETE FROM session WHERE credential = ?').run(credential)
	}

	public close (): void {
		this.db?.close()
		this.db = undefined
	}
}
