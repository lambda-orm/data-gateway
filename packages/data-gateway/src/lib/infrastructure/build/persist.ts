import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { Orm } from '@lambdaorm/lib'
import { parse, stringify } from 'yaml'
import { DataGatewayConfig, STATE_DIALECTS, StateConfig, StateMapping } from '../../domain/config/dataGatewayConfig'
import { describeState, StateSource, stateSourceOf } from '../../domain/config/stateSource'
import { Principal } from '../../domain/auth/principal'
import { badRequest, forbidden, GatewayError, notFound } from '../../domain/errors/gatewayError'
import { LoggerPort } from '../../application/ports/output/supportPorts'
import { resolveEnv } from '../output/config/envResolver'
import { defaultTableOf, STATE_ENTITIES, systemSchema, VOLUME_MAPPING } from '../output/state/ormState'
import { closeState, SqliteRoleStore } from '../output/state/stateStores'
import { SqliteSessionStore } from '../output/session/sessionStores'
import { SqliteSessionState } from '../output/admin/sqliteSessionState'
import { SqliteApprovalStore } from '../output/approval/approvalStores'

type Raw = Record<string, any>

/** Where the gateway keeps what the administration says of its state (docs/GATEWAY_STATE.md §2): next to its SQLite */
export const persistFileOf = (workspacePath: string): string => path.join(workspacePath, '.data-gateway', 'persist.yaml')

/** What .data-gateway/persist.yaml says: the source of the state and its mapping, over state of the YAML */
export interface PersistSettings {
	source?: StateConfig['source']
	mapping?: StateMapping
	updatedAt?: string
	updatedBy?: string
}

export const readPersist = (workspacePath: string | undefined, env: Record<string, string | undefined> = process.env): PersistSettings | undefined => {
	if (!workspacePath) return undefined
	const file = persistFileOf(workspacePath)
	if (!fs.existsSync(file)) return undefined
	const raw = parse(fs.readFileSync(file, 'utf8')) as Raw | null
	if (!raw || typeof raw !== 'object') return undefined
	// the connection may name variables ($DB_URL): resolved as the configuration's
	return { ...raw, ...(raw.source ? { source: resolveEnv(raw.source, env) as StateConfig['source'] } : {}) }
}

/**
 * The configuration with what the administration says of the state (its source and its mapping): it replaces
 * state.source and state.mapping of the YAML, which stay as yaml (to go back to them)
 */
export const withPersist = (config: DataGatewayConfig, env: Record<string, string | undefined> = process.env): DataGatewayConfig => {
	const persist = readPersist(config.orm.workspacePath, env)
	if (!persist?.source && !persist?.mapping) return config
	const state: StateConfig = {
		...config.state,
		...(persist.source ? { source: persist.source } : {}),
		...(persist.mapping ? { mapping: persist.mapping } : {}),
		persisted: true,
		yaml: { ...config.state }
	}
	return { ...config, state }
}

const writePersist = (workspacePath: string, persist: PersistSettings | undefined): void => {
	const file = persistFileOf(workspacePath)
	if (!persist) { fs.rmSync(file, { force: true }); return }
	fs.mkdirSync(path.dirname(file), { recursive: true })
	const temporary = `${file}.${process.pid}.tmp`
	fs.writeFileSync(temporary, stringify(persist), 'utf8')
	fs.renameSync(temporary, file)
}

/** The system schema of a source as λORM reaches it: the SQLite of the volume through SQLjs and its own tables */
const schemaOf = (source: StateSource, file: string | undefined, stateDir: string): unknown =>
	source.kind === 'sqlite'
		? systemSchema('SQLjs', { file: file ?? source.file }, stateDir, VOLUME_MAPPING)
		: source.kind === 'orm' ? systemSchema(source.dialect, source.connection, stateDir, source.mapping) : undefined

/** Every table of the SQLite of a volume, as its stores create them (one not used yet, empty) */
const ensureVolumeTables = async (file: string): Promise<void> => {
	const roles = new SqliteRoleStore(file)
	const sessions = new SqliteSessionStore(file)
	const ui = new SqliteSessionState(file)
	const approvals = new SqliteApprovalStore(file)
	try {
		await roles.version()
		await sessions.active()
		await ui.read('')
		await approvals.list('', undefined, 1)
	} finally {
		roles.close()
		sessions.close()
		ui.close()
		;(approvals as { close?: () => void }).close?.()
	}
}

/** The rows of the state in the SQLite of a volume (its tables that are there) */
const volumeRows = (file: string): number => {
	const db = new DatabaseSync(file, { readOnly: true })
	try {
		const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name))
		return Object.values(VOLUME_MAPPING).map(m => m.table!).filter(t => tables.has(t))
			.reduce((n, t) => n + Number((db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n), 0)
	} finally { db.close() }
}

/** the table and the columns of an entity in a source, as they are (dg_ and its names when the mapping doesn't say them) */
const entityMapping = (source: StateSource, entity: string): string => {
	const own = source.kind === 'orm' ? source.mapping?.[entity] : undefined
	return JSON.stringify({ table: own?.table ?? defaultTableOf(entity), columns: own?.columns ?? {} })
}

/** the same database (another mapping of it): its dialect and its connection */
const sameDatabase = (a: StateSource, b: StateSource): boolean =>
	a.kind === 'orm' && b.kind === 'orm' && a.dialect === b.dialect && JSON.stringify(a.connection) === JSON.stringify(b.connection)

const rowsOf = (data: unknown): number => ((data as { entities?: { rows?: unknown[] }[] } | undefined)?.entities ?? []).reduce((n, e) => n + (e.rows?.length ?? 0), 0)

/**
 * Copies the state from one source to another with the tools of λORM (docs/GATEWAY_STATE.md §6): push (the tables of
 * the system schema in the new one), export (from the current) and import (into the new). The SQLite of the volume is
 * read from a copy (its WAL written in first) and written through SQLjs. A new one that already has a state is refused.
 */
export const migrateState = async (from: StateSource, to: StateSource, logger: LoggerPort): Promise<{ rows: number }> => {
	const work = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-persist-'))
	const opened: Orm[] = []
	const open = async (schema: unknown, dir: string): Promise<Orm> => {
		const orm = new Orm()
		await orm.init(schema as any, true)
		opened.push(orm)
		fs.mkdirSync(dir, { recursive: true })
		return orm
	}
	try {
		// the current one: what it has (nothing in memory, nor in a SQLite that isn't there yet)
		let data: unknown
		if (from.kind === 'sqlite' && fs.existsSync(from.file)) {
			const db = new DatabaseSync(from.file)
			try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } finally { db.close() }
			const copy = path.join(work, 'from.sqlite')
			fs.copyFileSync(from.file, copy)
			// a table the gateway hasn't used yet (the state of the UI, the approvals): created empty in the copy, as the
			// gateway creates it
			await ensureVolumeTables(copy)
			const orm = await open(schemaOf(from, copy, path.join(work, 'from')), path.join(work, 'from'))
			data = await orm.stage.export({ stage: 'state' }).execute()
		} else if (from.kind === 'orm') {
			const orm = await open(schemaOf(from, undefined, path.join(work, 'from')), path.join(work, 'from'))
			data = await orm.stage.export({ stage: 'state' }).execute()
		}
		// the new one: its tables (push), empty, and the rows of the current one (import)
		if (to.kind === 'memory') throw badRequest('ValidationError', 'the state can\'t be moved to memory: it would be lost at the next start')
		if (to.kind === 'sqlite') {
			// a SQLite that is already there (going back to the one of the volume): never pushed over; the one it has is
			// kept aside (.bak-<time>), and the current state copied in a new file
			if (fs.existsSync(to.file)) {
				const aside = `${to.file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
				if (volumeRows(to.file) > 0) {
					fs.renameSync(to.file, aside)
					for (const suffix of ['-wal', '-shm']) if (fs.existsSync(to.file + suffix)) fs.renameSync(to.file + suffix, aside + suffix)
					logger.info(`[data-gateway] state: ${to.file} had a state: kept as ${aside}`)
				}
				fs.rmSync(to.file, { force: true })
			}
			fs.mkdirSync(path.dirname(to.file), { recursive: true })
		}
		const target = await open(schemaOf(to, undefined, path.join(work, 'to')), path.join(work, 'to'))
		await target.stage.push({ stage: 'state' }).execute()
		// the same database with another mapping: only the entities whose table or columns change are copied (the
		// others are the same tables)
		const moving = sameDatabase(from, to) ? STATE_ENTITIES.filter(e => entityMapping(from, e) !== entityMapping(to, e)) : STATE_ENTITIES
		const only = (d: unknown) => ({ entities: ((d as { entities?: { entity: string, rows: unknown[] }[] } | undefined)?.entities ?? []).filter(e => moving.includes(e.entity)) })
		const already = rowsOf(only(await target.stage.export({ stage: 'state' }).execute()))
		if (already > 0) throw new GatewayError(409, 'ConflictError', `${describeState(to)} already has a state (${already} rows): give an empty database`)
		if (data) await target.stage.import({ stage: 'state' }).execute(only(data) as any)
		const rows = rowsOf(only(data))
		logger.info(`[data-gateway] state: ${rows} rows copied from ${describeState(from)} to ${describeState(to)}`)
		return { rows }
	} finally {
		// SQLjs writes its file when it ends
		for (const orm of opened) await orm.end().catch(() => undefined)
		fs.rmSync(work, { recursive: true, force: true })
	}
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/

/**
 * The mapping of a lambdaORM.yaml of the state edited (Persist › Config): only the mapping changes (the tables and the
 * columns of each entity); its domain must be the gateway's, its sources and stages are of the connection
 */
export const mappingOfText = (text: unknown, dialect: string): StateMapping => {
	if (typeof text !== 'string' || !text.trim()) throw badRequest('ValidationError', 'text is required (the lambdaORM.yaml of the state)')
	let doc: Raw
	try { doc = parse(text) } catch (error: any) { throw badRequest('ValidationError', `not YAML: ${error?.message ?? error}`) }
	const expected = systemSchema(dialect, undefined, '')
	if (JSON.stringify(doc?.domain) !== JSON.stringify(expected.domain)) throw badRequest('ValidationError', 'only the mapping can change: the domain of the state is the gateway\'s (its code reads and writes those entities)')
	const entities = doc?.infrastructure?.mappings?.[0]?.entities
	if (!Array.isArray(entities)) throw badRequest('ValidationError', 'infrastructure.mappings[0].entities is the mapping of the state')
	const issues: string[] = []
	const mapping: StateMapping = {}
	const seen: string[] = []
	for (const entity of entities) {
		if (!STATE_ENTITIES.includes(entity?.name)) { issues.push(`"${entity?.name}" is not an entity of the state (${STATE_ENTITIES.join(', ')})`); continue }
		const properties = (expected.domain.entities as Raw[]).find(e => e.name === entity.name)!.properties.map((p: Raw) => p.name)
		if (typeof entity.mapping !== 'string' || !IDENTIFIER.test(entity.mapping)) issues.push(`${entity.name}: its mapping "${entity.mapping}" is not a table (letters, digits and _; schema.table)`)
		const columns: Record<string, string> = {}
		for (const p of entity.properties ?? []) {
			if (!properties.includes(p?.name)) { issues.push(`${entity.name}.${p?.name} is not a property of it`); continue }
			if (typeof p.mapping !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.mapping)) { issues.push(`${entity.name}.${p.name}: its mapping "${p.mapping}" is not a column`); continue }
			if (p.mapping !== p.name) columns[p.name] = p.mapping
		}
		// only what differs from dg_ and its names
		if (entity.mapping !== defaultTableOf(entity.name) || Object.keys(columns).length) mapping[entity.name] = { table: entity.mapping, ...(Object.keys(columns).length ? { columns } : {}) }
		seen.push(entity.name)
	}
	const missing = STATE_ENTITIES.filter(e => !seen.includes(e))
	if (missing.length) issues.push(`the mapping lacks ${missing.join(', ')}`)
	if (issues.length) throw badRequest('ValidationError', issues.join('; '))
	return mapping
}

const sameSource = (a: StateSource, b: StateSource): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Persist (docs/GATEWAY_STATE.md §2): where the gateway keeps its administration and the mapping of its tables,
 * changed from the administration over the YAML (.data-gateway/persist.yaml). With the permission persist. A change
 * copies the state to where it goes (λORM: push, export, import) and then the gateway restarts with it; one that can't
 * be copied changes nothing.
 */
export class PersistAdmin {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly config: DataGatewayConfig,
		private readonly logger: LoggerPort,
		/** saved: the gateway restarts with the new source (the supervisor) */
		private readonly applied: () => void,
		private readonly migrate: typeof migrateState = migrateState,
		private readonly clock: () => Date = () => new Date()
	) {}

	/** state of data-gateway.config.yaml, without what the administration says */
	private get yaml (): StateConfig {
		return this.config.state.yaml ?? this.config.state
	}

	private require (who: Principal): void {
		if (!who.permissions.has('persist')) throw forbidden(who.name, 'persist')
	}

	private workspace (): string {
		if (!this.config.orm.workspacePath) throw new GatewayError(409, 'ConflictError', 'the state can be changed from the administration only with orm.workspacePath (its volume keeps .data-gateway/persist.yaml)')
		return this.config.orm.workspacePath
	}

	/** what the administration says of the state now: the source and the mapping in persist.yaml, when it says them */
	public persisted (who: Principal): PersistSettings | undefined {
		this.require(who)
		return readPersist(this.config.orm.workspacePath)
	}

	/** another database (its dialect and connection): the state is copied there, and the gateway restarts with it */
	public async connection (who: Principal, body: unknown, reason?: string): Promise<{ rows: number, where: string }> {
		this.require(who)
		const raw = (body ?? {}) as Raw
		const dialect = String(raw.dialect ?? '')
		if (!(STATE_DIALECTS as readonly string[]).includes(dialect)) throw badRequest('ValidationError', `dialect: one of ${STATE_DIALECTS.join(', ')}`)
		const connection = dialect === 'SQLite' && typeof raw.connection === 'string' ? { file: raw.connection } : raw.connection
		if (connection === undefined || connection === null || connection === '') throw badRequest('ValidationError', 'connection is required (SQLite: its file; the others, the connection of λORM: a URL or its object)')
		if (dialect === 'SQLite' && !connection?.file) throw badRequest('ValidationError', 'SQLite: the connection is its file ({ file })')
		const current = readPersist(this.workspace())
		return this.apply(who, { ...(current?.mapping ? { mapping: current.mapping } : {}), source: { dialect: dialect as any, connection } }, reason)
	}

	/** the lambdaORM.yaml of the state edited: only its mapping (the tables and columns) changes */
	public async schema (who: Principal, text: unknown, reason?: string): Promise<{ rows: number, where: string }> {
		this.require(who)
		const source = this.current(this.workspace())
		if (source.kind !== 'orm') throw new GatewayError(409, 'ConflictError', `${describeState(source)} has its own tables (the gateway writes them): the mapping changes in a database through λORM`)
		const mapping = mappingOfText(text, source.dialect)
		const current = readPersist(this.workspace())
		return this.apply(who, { ...(current?.source ? { source: current.source } : {}), mapping }, reason)
	}

	/** back to state of data-gateway.config.yaml: the state is copied back there */
	public async reset (who: Principal, reason?: string): Promise<{ rows: number, where: string }> {
		this.require(who)
		if (!readPersist(this.workspace())) throw notFound('the state is where the configuration says: nothing changed from the administration')
		return this.apply(who, undefined, reason)
	}

	/** where the state is now: the YAML with what persist.yaml says (written by this replica or another, restarted or not) */
	private current (workspace: string): StateSource {
		const now = readPersist(workspace)
		return stateSourceOf({ ...this.yaml, ...(now?.source ? { source: now.source } : {}), ...(now?.mapping ? { mapping: now.mapping } : {}) }, workspace)
	}

	private async apply (who: Principal, next: PersistSettings | undefined, reason?: string): Promise<{ rows: number, where: string }> {
		const workspace = this.workspace()
		const current = this.current(workspace)
		const target = stateSourceOf({ ...this.yaml, ...(next?.source ? { source: next.source } : {}), ...(next?.mapping ? { mapping: next.mapping } : {}) }, workspace)
		let rows = 0
		if (!sameSource(current, target)) {
			// the gateway keeps using the current one until the copy is done; one that fails leaves everything as it was
			rows = (await this.migrate(current, target, this.logger)).rows
			await closeState(target).catch(() => undefined)
		}
		writePersist(workspace, next ? { ...next, updatedAt: this.clock().toISOString(), updatedBy: who.name } : undefined)
		this.logger.info(`[data-gateway] state: "${who.name}" moved it to ${describeState(target)}${reason ? ` (${reason})` : ''}: the gateway restarts with it`)
		this.applied()
		return { rows, where: describeState(target) }
	}
}
