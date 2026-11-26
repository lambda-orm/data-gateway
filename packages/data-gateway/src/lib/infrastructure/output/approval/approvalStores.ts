import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { Approval, ApprovalStatus } from '../../../domain/approval/approval'
import { ApprovalStorePort } from '../../../application/ports/output/approvalPorts'

/**
 * The writes that wait, in the SQLite of the volume (<orm.workspacePath>/.data-gateway/state.sqlite, next to the
 * sessions): every worker and every replica with the same volume sees them; a status moves in one statement, so two
 * people approving at once can't both run it.
 */
export class SqliteApprovalStore implements ApprovalStorePort {
	private db?: DatabaseSync

	constructor (private readonly file: string) {}

	private open (): DatabaseSync {
		if (!this.db) {
			fs.mkdirSync(path.dirname(this.file), { recursive: true })
			this.db = new DatabaseSync(this.file)
			this.db.exec('PRAGMA journal_mode = WAL')
			this.db.exec('PRAGMA busy_timeout = 5000')
			this.db.exec('CREATE TABLE IF NOT EXISTS approval (id TEXT PRIMARY KEY, schema TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL)')
			this.db.exec('CREATE INDEX IF NOT EXISTS approval_schema ON approval (schema, status, created_at)')
		}
		return this.db
	}

	public async create (approval: Approval): Promise<void> {
		this.open().prepare('INSERT INTO approval (id, schema, status, created_at, body) VALUES (?, ?, ?, ?, ?)')
			.run(approval.id, approval.schema, approval.status, approval.createdAt, JSON.stringify(approval))
	}

	public async get (id: string): Promise<Approval | undefined> {
		const row = this.open().prepare('SELECT body FROM approval WHERE id = ?').get(id) as { body: string } | undefined
		return row ? JSON.parse(row.body) : undefined
	}

	public async list (schema: string, status: ApprovalStatus | undefined, limit: number): Promise<Approval[]> {
		const rows = status
			? this.open().prepare('SELECT body FROM approval WHERE schema = ? AND status = ? ORDER BY created_at DESC LIMIT ?').all(schema, status, limit)
			: this.open().prepare('SELECT body FROM approval WHERE schema = ? ORDER BY created_at DESC LIMIT ?').all(schema, limit)
		return (rows as { body: string }[]).map(r => JSON.parse(r.body))
	}

	public async transition (id: string, from: ApprovalStatus, change: Partial<Approval> & { status: ApprovalStatus }): Promise<boolean> {
		const db = this.open()
		db.exec('BEGIN IMMEDIATE')
		try {
			const row = db.prepare('SELECT body FROM approval WHERE id = ? AND status = ?').get(id, from) as { body: string } | undefined
			if (!row) { db.exec('ROLLBACK'); return false }
			const body = { ...JSON.parse(row.body), ...change }
			db.prepare('UPDATE approval SET status = ?, body = ? WHERE id = ?').run(change.status, JSON.stringify(body), id)
			db.exec('COMMIT')
			return true
		} catch (error) {
			db.exec('ROLLBACK')
			throw error
		}
	}

	public close (): void {
		this.db?.close()
		this.db = undefined
	}
}

/** The writes that wait in memory: one process (no orm.workspacePath); a restart forgets them */
export class MemoryApprovalStore implements ApprovalStorePort {
	private readonly rows = new Map<string, Approval>()

	public async create (approval: Approval): Promise<void> { this.rows.set(approval.id, structuredClone(approval)) }

	public async get (id: string): Promise<Approval | undefined> {
		const row = this.rows.get(id)
		return row ? structuredClone(row) : undefined
	}

	public async list (schema: string, status: ApprovalStatus | undefined, limit: number): Promise<Approval[]> {
		return [...this.rows.values()].filter(a => a.schema === schema && (!status || a.status === status))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(a => structuredClone(a))
	}

	public async transition (id: string, from: ApprovalStatus, change: Partial<Approval> & { status: ApprovalStatus }): Promise<boolean> {
		const row = this.rows.get(id)
		if (!row || row.status !== from) return false
		this.rows.set(id, { ...row, ...structuredClone(change) })
		return true
	}
}
