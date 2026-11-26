import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { DatabaseSync } from 'node:sqlite'
import { SessionSecretsPort, SessionStorePort } from '../../../application/ports/output/sessionPorts'
import { Session } from '../../../domain/session/session'

/**
 * The sessions in the SQLite of the volume (<orm.workspacePath>/.data-gateway/state.sqlite, next to the state of the
 * UI): every replica on that volume sees the same sessions, so a revocation is seen by all on their next request. The
 * token is not kept, only its hash (a stolen volume gives no session).
 */
export class SqliteSessionStore implements SessionStorePort {
	private db?: DatabaseSync

	constructor (private readonly file: string) {}

	private open (): DatabaseSync {
		if (!this.db) {
			fs.mkdirSync(path.dirname(this.file), { recursive: true })
			this.db = new DatabaseSync(this.file)
			this.db.exec('PRAGMA journal_mode = WAL')
			// another replica may be writing: wait for it instead of failing at once
			this.db.exec('PRAGMA busy_timeout = 5000')
			this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				token_hash TEXT NOT NULL UNIQUE,
				credential TEXT NOT NULL,
				permissions TEXT NOT NULL,
				created_at TEXT NOT NULL,
				last_seen_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				ip TEXT,
				client TEXT,
				activity TEXT,
				revoked_at TEXT,
				revoked_by TEXT,
				context TEXT,
				view TEXT,
				roles TEXT
			)`)
			// a store of before the context of a token (docs/JWT.md): its column added
			const columns = (this.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map(c => c.name)
			if (!columns.includes('context')) this.db.exec('ALTER TABLE sessions ADD COLUMN context TEXT')
			if (!columns.includes('view')) this.db.exec('ALTER TABLE sessions ADD COLUMN view TEXT')
			if (!columns.includes('roles')) this.db.exec('ALTER TABLE sessions ADD COLUMN roles TEXT')
			this.db.exec('CREATE INDEX IF NOT EXISTS sessions_credential ON sessions (credential)')
			// the WebSocket of events of each session, by replica: a session is connected if a replica saw it lately
			this.db.exec('CREATE TABLE IF NOT EXISTS session_connections (session_id TEXT NOT NULL, replica TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY (session_id, replica))')
		}
		return this.db
	}

	public async create (session: Session, tokenHash: string): Promise<void> {
		this.open().prepare(`INSERT INTO sessions (id, token_hash, credential, permissions, created_at, last_seen_at, expires_at, ip, client, activity, context, view, roles)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(session.id, tokenHash, session.credential, JSON.stringify(session.permissions),
			session.createdAt, session.lastSeenAt, session.expiresAt, session.ip ?? null,
			session.client ? JSON.stringify(session.client) : null, session.activity ? JSON.stringify(session.activity) : null,
			session.context ? JSON.stringify(session.context) : null, session.view ?? null, session.roles ? JSON.stringify(session.roles) : null)
	}

	public async byTokenHash (tokenHash: string): Promise<Session | undefined> {
		return this.row(this.open().prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash))
	}

	public async byId (id: string): Promise<Session | undefined> {
		return this.row(this.open().prepare('SELECT * FROM sessions WHERE id = ?').get(id))
	}

	public async active (credential?: string): Promise<Session[]> {
		const rows = credential === undefined
			? this.open().prepare('SELECT * FROM sessions WHERE revoked_at IS NULL').all()
			: this.open().prepare('SELECT * FROM sessions WHERE revoked_at IS NULL AND credential = ?').all(credential)
		return rows.map(row => this.row(row)!)
	}

	public async touch (id: string, at: string, ip?: string): Promise<void> {
		if (ip) this.open().prepare('UPDATE sessions SET last_seen_at = ?, ip = ? WHERE id = ?').run(at, ip, id)
		else this.open().prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(at, id)
	}

	public async revoke (id: string, by: string, at: string): Promise<void> {
		this.open().prepare('UPDATE sessions SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL').run(at, by, id)
	}

	public async setActivity (id: string, activity: { schema?: string, tab?: string }): Promise<void> {
		this.open().prepare('UPDATE sessions SET activity = ? WHERE id = ?').run(JSON.stringify(activity), id)
	}

	public async markConnected (replica: string, ids: string[], at: string): Promise<void> {
		const db = this.open()
		db.exec('BEGIN IMMEDIATE')
		try {
			db.prepare('DELETE FROM session_connections WHERE replica = ?').run(replica)
			const insert = db.prepare('INSERT INTO session_connections (session_id, replica, seen_at) VALUES (?, ?, ?)')
			for (const id of ids) insert.run(id, replica, at)
			db.exec('COMMIT')
		} catch (error) {
			db.exec('ROLLBACK')
			throw error
		}
	}

	public async connectedSince (since: string): Promise<Set<string>> {
		const rows = this.open().prepare('SELECT DISTINCT session_id FROM session_connections WHERE seen_at >= ?').all(since) as { session_id: string }[]
		return new Set(rows.map(r => r.session_id))
	}

	public async purge (endedBefore: string): Promise<number> {
		const result = this.open().prepare('DELETE FROM sessions WHERE revoked_at < ? OR expires_at < ?').run(endedBefore, endedBefore)
		this.open().prepare('DELETE FROM session_connections WHERE seen_at < ?').run(endedBefore)
		return Number(result.changes)
	}

	public close (): void {
		this.db?.close()
		this.db = undefined
	}

	private row (raw: unknown): Session | undefined {
		if (!raw) return undefined
		const r = raw as Record<string, string | null>
		const session: Session = {
			id: r.id!,
			credential: r.credential!,
			permissions: JSON.parse(r.permissions!),
			createdAt: r.created_at!,
			lastSeenAt: r.last_seen_at!,
			expiresAt: r.expires_at!
		}
		if (r.ip) session.ip = r.ip
		if (r.client) session.client = JSON.parse(r.client)
		if (r.activity) session.activity = JSON.parse(r.activity)
		if (r.context) session.context = JSON.parse(r.context)
		if (r.view) session.view = r.view
		if (r.roles) session.roles = JSON.parse(r.roles)
		if (r.revoked_at) session.revokedAt = r.revoked_at
		if (r.revoked_by) session.revokedBy = r.revoked_by
		return session
	}
}

/** The sessions in memory: one replica only (without orm.workspacePath, or sessions.store: memory); lost on a restart */
export class MemorySessionStore implements SessionStorePort {
	private readonly sessions = new Map<string, { session: Session, tokenHash: string }>()
	private readonly connections = new Map<string, { ids: string[], at: string }>()

	public async create (session: Session, tokenHash: string): Promise<void> {
		this.sessions.set(session.id, { session: { ...session }, tokenHash })
	}

	public async byTokenHash (tokenHash: string): Promise<Session | undefined> {
		for (const entry of this.sessions.values()) if (entry.tokenHash === tokenHash) return { ...entry.session }
		return undefined
	}

	public async byId (id: string): Promise<Session | undefined> {
		const entry = this.sessions.get(id)
		return entry ? { ...entry.session } : undefined
	}

	public async active (credential?: string): Promise<Session[]> {
		return [...this.sessions.values()].map(e => e.session)
			.filter(s => !s.revokedAt && (credential === undefined || s.credential === credential))
			.map(s => ({ ...s }))
	}

	public async touch (id: string, at: string, ip?: string): Promise<void> {
		const entry = this.sessions.get(id)
		if (!entry) return
		entry.session.lastSeenAt = at
		if (ip) entry.session.ip = ip
	}

	public async revoke (id: string, by: string, at: string): Promise<void> {
		const entry = this.sessions.get(id)
		if (!entry || entry.session.revokedAt) return
		entry.session.revokedAt = at
		entry.session.revokedBy = by
	}

	public async setActivity (id: string, activity: { schema?: string, tab?: string }): Promise<void> {
		const entry = this.sessions.get(id)
		if (entry) entry.session.activity = { ...activity }
	}

	public async markConnected (replica: string, ids: string[], at: string): Promise<void> {
		this.connections.set(replica, { ids: [...ids], at })
	}

	public async connectedSince (since: string): Promise<Set<string>> {
		return new Set([...this.connections.values()].filter(c => c.at >= since).flatMap(c => c.ids))
	}

	public async purge (endedBefore: string): Promise<number> {
		let removed = 0
		for (const [id, { session }] of this.sessions) {
			if ((session.revokedAt && session.revokedAt < endedBefore) || session.expiresAt < endedBefore) {
				this.sessions.delete(id)
				removed++
			}
		}
		return removed
	}
}

/** 32 random bytes as the token (base64url), its SHA-256 as what is kept, and a shorter random public id */
export class NodeSessionSecrets implements SessionSecretsPort {
	public token (): string { return crypto.randomBytes(32).toString('base64url') }
	public hash (token: string): string { return crypto.createHash('sha256').update(token).digest('hex') }
	public id (): string { return `s_${crypto.randomBytes(12).toString('base64url')}` }
}
