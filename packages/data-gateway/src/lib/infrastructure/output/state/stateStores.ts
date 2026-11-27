import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { StateSource } from '../../../domain/config/stateSource'
import { ApprovalStorePort } from '../../../application/ports/output/approvalPorts'
import { SessionStorePort } from '../../../application/ports/output/sessionPorts'
import { SessionStatePort } from '../../../application/ports/output/adminPorts'
import { ConfigArea, ConfigChange, RoleStorePort, SettingStorePort, StoredRole, StoredSetting } from '../../../application/ports/output/statePorts'
import { MemoryApprovalStore, SqliteApprovalStore } from '../approval/approvalStores'
import { MemorySessionStore, SqliteSessionStore } from '../session/sessionStores'
import { SqliteSessionState } from '../admin/sqliteSessionState'
import { OrmApprovalStore, OrmRoleStore, OrmSessionStore, OrmState, OrmUiStateStore } from './ormState'

export { StateSource, stateSourceOf, describeState } from '../../../domain/config/stateSource'

/** The sessions of management */
export const sessionStoreOf = (source: StateSource): SessionStorePort =>
	source.kind === 'sqlite' ? new SqliteSessionStore(path.resolve(source.file)) : source.kind === 'orm' ? new OrmSessionStore(OrmState.of(source.dialect, source.connection)) : new MemorySessionStore()

/** The state of the UI of each credential (none in memory: the IDE keeps it) */
export const uiStateStoreOf = (source: StateSource): SessionStatePort | undefined =>
	source.kind === 'sqlite' ? new SqliteSessionState(path.resolve(source.file)) : source.kind === 'orm' ? new OrmUiStateStore(OrmState.of(source.dialect, source.connection)) : undefined

/** The writes that wait for a person */
export const approvalStoreOf = (source: StateSource): ApprovalStorePort =>
	source.kind === 'sqlite' ? new SqliteApprovalStore(path.resolve(source.file)) : source.kind === 'orm' ? new OrmApprovalStore(OrmState.of(source.dialect, source.connection)) : new MemoryApprovalStore()

/** The roles and the settings of the state (one store: the same database, the same changes and versions) */
export const roleStoreOf = (source: StateSource): RoleStorePort & SettingStorePort =>
	source.kind === 'sqlite' ? new SqliteRoleStore(path.resolve(source.file)) : source.kind === 'orm' ? new OrmRoleStore(OrmState.of(source.dialect, source.connection)) : new MemoryRoleStore()

/** Ends what a source holds open (the λORM of a database) */
export const closeState = async (source: StateSource): Promise<void> => {
	if (source.kind === 'orm') await OrmState.of(source.dialect, source.connection).end()
}

const GLOBAL = '*'

/** The roles in the SQLite of the volume, next to the sessions and the approvals */
export class SqliteRoleStore implements RoleStorePort, SettingStorePort {
	private db?: DatabaseSync

	constructor (private readonly file: string) {}

	private open (): DatabaseSync {
		if (!this.db) {
			fs.mkdirSync(path.dirname(this.file), { recursive: true })
			this.db = new DatabaseSync(this.file)
			this.db.exec('PRAGMA journal_mode = WAL')
			this.db.exec('PRAGMA busy_timeout = 5000')
			this.db.exec('CREATE TABLE IF NOT EXISTS roles (name TEXT NOT NULL, schema_path TEXT NOT NULL, config TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (name, schema_path))')
			this.db.exec('CREATE TABLE IF NOT EXISTS config_changes (id TEXT PRIMARY KEY, area TEXT NOT NULL, change_key TEXT NOT NULL, before TEXT, after TEXT, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL, reason TEXT)')
			this.db.exec('CREATE INDEX IF NOT EXISTS config_changes_time ON config_changes (changed_at)')
			this.db.exec('CREATE TABLE IF NOT EXISTS state_versions (area TEXT PRIMARY KEY, version INTEGER NOT NULL)')
			this.db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)')
		}
		return this.db
	}

	public async roles (): Promise<StoredRole[]> {
		const rows = this.open().prepare('SELECT name, schema_path, config, updated_at, updated_by FROM roles ORDER BY name, schema_path').all() as Record<string, string>[]
		return rows.map(r => ({ name: r.name, ...(r.schema_path !== GLOBAL ? { schema: r.schema_path } : {}), config: JSON.parse(r.config), updatedAt: r.updated_at, updatedBy: r.updated_by }))
	}

	private inTransaction<T> (work: (db: DatabaseSync) => T): T {
		const db = this.open()
		db.exec('BEGIN IMMEDIATE')
		try {
			const result = work(db)
			db.exec('COMMIT')
			return result
		} catch (error) {
			db.exec('ROLLBACK')
			throw error
		}
	}

	private record (db: DatabaseSync, change: ConfigChange): void {
		db.prepare('INSERT INTO config_changes (id, area, change_key, before, after, changed_by, changed_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
			.run(change.id, change.area, change.key, change.before === undefined ? null : JSON.stringify(change.before), change.after === undefined ? null : JSON.stringify(change.after), change.by, change.at, change.reason ?? null)
		db.prepare('INSERT INTO state_versions (area, version) VALUES (?, 1) ON CONFLICT(area) DO UPDATE SET version = version + 1').run(change.area)
	}

	public async put (role: StoredRole, change: ConfigChange): Promise<void> {
		this.inTransaction(db => {
			db.prepare('INSERT INTO roles (name, schema_path, config, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name, schema_path) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
				.run(role.name, role.schema ?? GLOBAL, JSON.stringify(role.config), role.updatedAt, role.updatedBy)
			this.record(db, change)
		})
	}

	public async remove (name: string, schema: string | undefined, change: ConfigChange): Promise<boolean> {
		return this.inTransaction(db => {
			const removed = db.prepare('DELETE FROM roles WHERE name = ? AND schema_path = ?').run(name, schema ?? GLOBAL)
			if (!Number(removed.changes)) return false
			this.record(db, change)
			return true
		})
	}

	public async changes (limit: number): Promise<ConfigChange[]> {
		const rows = this.open().prepare('SELECT * FROM config_changes ORDER BY changed_at DESC LIMIT ?').all(limit) as Record<string, string | null>[]
		return rows.map(r => ({
			id: r.id!, area: r.area as ConfigArea, key: r.change_key!, ...(r.before ? { before: JSON.parse(r.before) } : {}), ...(r.after ? { after: JSON.parse(r.after) } : {}),
			by: r.changed_by!, at: r.changed_at!, ...(r.reason ? { reason: r.reason } : {})
		}))
	}

	public async version (): Promise<number> {
		return this.areaVersion('roles')
	}

	public async areaVersion (area: ConfigArea): Promise<number> {
		const row = this.open().prepare('SELECT version FROM state_versions WHERE area = ?').get(area) as { version: number } | undefined
		return Number(row?.version ?? 0)
	}

	public async setting (key: ConfigArea): Promise<StoredSetting | undefined> {
		const row = this.open().prepare('SELECT key, value, updated_at, updated_by FROM settings WHERE key = ?').get(key) as Record<string, string> | undefined
		return row ? { key: row.key as ConfigArea, value: JSON.parse(row.value), updatedAt: row.updated_at, updatedBy: row.updated_by } : undefined
	}

	public async putSetting (setting: StoredSetting, change: ConfigChange): Promise<void> {
		this.inTransaction(db => {
			db.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
				.run(setting.key, JSON.stringify(setting.value), setting.updatedAt, setting.updatedBy)
			this.record(db, change)
		})
	}

	public async removeSetting (key: ConfigArea, change: ConfigChange): Promise<boolean> {
		return this.inTransaction(db => {
			const removed = db.prepare('DELETE FROM settings WHERE key = ?').run(key)
			if (!Number(removed.changes)) return false
			this.record(db, change)
			return true
		})
	}

	public close (): void {
		this.db?.close()
		this.db = undefined
	}
}

/** The roles in memory: one process (no volume); a restart forgets them */
export class MemoryRoleStore implements RoleStorePort, SettingStorePort {
	private rows: StoredRole[] = []
	private log: ConfigChange[] = []
	private current = 0
	private settings = new Map<ConfigArea, StoredSetting>()
	private versions = new Map<ConfigArea, number>()

	public async setting (key: ConfigArea): Promise<StoredSetting | undefined> {
		const found = this.settings.get(key)
		return found ? structuredClone(found) : undefined
	}

	public async putSetting (setting: StoredSetting, change: ConfigChange): Promise<void> {
		this.settings.set(setting.key, structuredClone(setting))
		this.log.unshift(structuredClone(change))
		this.versions.set(setting.key, (this.versions.get(setting.key) ?? 0) + 1)
	}

	public async removeSetting (key: ConfigArea, change: ConfigChange): Promise<boolean> {
		if (!this.settings.delete(key)) return false
		this.log.unshift(structuredClone(change))
		this.versions.set(key, (this.versions.get(key) ?? 0) + 1)
		return true
	}

	public async areaVersion (area: ConfigArea): Promise<number> {
		return area === 'roles' ? this.current : this.versions.get(area) ?? 0
	}

	public async roles (): Promise<StoredRole[]> { return this.rows.map(r => structuredClone(r)) }

	public async put (role: StoredRole, change: ConfigChange): Promise<void> {
		this.rows = [...this.rows.filter(r => !(r.name === role.name && r.schema === role.schema)), structuredClone(role)]
		this.log.unshift(structuredClone(change))
		this.current++
	}

	public async remove (name: string, schema: string | undefined, change: ConfigChange): Promise<boolean> {
		const before = this.rows.length
		this.rows = this.rows.filter(r => !(r.name === name && r.schema === schema))
		if (this.rows.length === before) return false
		this.log.unshift(structuredClone(change))
		this.current++
		return true
	}

	public async changes (limit: number): Promise<ConfigChange[]> { return this.log.slice(0, limit).map(c => structuredClone(c)) }

	public async version (): Promise<number> { return this.current }
}
