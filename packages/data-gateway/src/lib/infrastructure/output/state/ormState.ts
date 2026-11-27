import os from 'os'
import path from 'path'
import { Orm } from '@lambdaorm/lib'
import { Approval, ApprovalStatus } from '../../../domain/approval/approval'
import { Session } from '../../../domain/session/session'
import { ApprovalStorePort } from '../../../application/ports/output/approvalPorts'
import { SessionStorePort } from '../../../application/ports/output/sessionPorts'
import { SessionStatePort } from '../../../application/ports/output/adminPorts'
import { StateMapping } from '../../../domain/config/dataGatewayConfig'
import { ConfigArea, ConfigChange, RoleStorePort, SettingStorePort, StoredRole, StoredSetting } from '../../../application/ports/output/statePorts'

const text = (name: string, length: number, required = false) => ({ name, type: 'string', length, ...(required ? { required: true } : {}) })
// a string without a length (TEXT): λORM 3.15 reads a type text that has a date inside as a date ("Invalid DateTime")
const long = (name: string) => ({ name, type: 'string' })
const TIME = 30

/**
 * The schema of the state of the gateway (docs/GATEWAY_STATE.md §3): inside the gateway, not a workspace; what changes
 * from one installation to another is only its source. Its tables start with dg_; push creates what is missing and
 * adds what a new version brings (it never removes: a replica of the version before still works).
 */
export const STATE_ENTITIES = ['Sessions', 'SessionConnections', 'UiStates', 'Approvals', 'Roles', 'ConfigChanges', 'Settings', 'StateVersions']

/** The table of an entity by default: dg_ and its name in snake case (Sessions → dg_sessions) */
export const defaultTableOf = (entity: string): string => `dg_${entity.replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c.toLowerCase())}`

/**
 * The tables of the SQLite of the volume, as the gateway writes them (node:sqlite): with it λORM reads and writes that
 * file too (SQLjs), to copy the state to another database or from one (docs/GATEWAY_STATE.md §6)
 */
export const VOLUME_MAPPING: StateMapping = {
	Sessions: { table: 'sessions', columns: { tokenHash: 'token_hash', createdAt: 'created_at', lastSeenAt: 'last_seen_at', expiresAt: 'expires_at', revokedAt: 'revoked_at', revokedBy: 'revoked_by', claims: 'context', viewName: 'view' } },
	SessionConnections: { table: 'session_connections', columns: { sessionId: 'session_id', seenAt: 'seen_at' } },
	UiStates: { table: 'session', columns: { updatedAt: 'updated_at' } },
	Approvals: { table: 'approval', columns: { schemaPath: 'schema', createdAt: 'created_at' } },
	Roles: { table: 'roles', columns: { schemaPath: 'schema_path', updatedAt: 'updated_at', updatedBy: 'updated_by' } },
	ConfigChanges: { table: 'config_changes', columns: { changeKey: 'change_key', changedBy: 'changed_by', changedAt: 'changed_at' } },
	Settings: { table: 'settings', columns: { settingKey: 'key', updatedAt: 'updated_at', updatedBy: 'updated_by' } },
	StateVersions: { table: 'state_versions' }
}

/** The mapping of the state: by entity its table (and its columns), with what the configuration changes of it */
const mappingOf = (mapping: StateMapping | undefined) => STATE_ENTITIES.map(name => {
	const own = mapping?.[name]
	const columns = Object.entries(own?.columns ?? {})
	return { name, mapping: own?.table ?? defaultTableOf(name), ...(columns.length ? { properties: columns.map(([property, column]) => ({ name: property, mapping: column })) } : {}) }
})

export const systemSchema = (dialect: string, connection: unknown, stateDir: string, mapping?: StateMapping): any => ({
	domain: {
		entities: [
			{
				name: 'Sessions',
				primaryKey: ['id'],
				uniqueKey: ['tokenHash'],
				properties: [text('id', 64, true), text('tokenHash', 128, true), text('credential', 200, true), long('permissions'),
					text('createdAt', TIME, true), text('lastSeenAt', TIME, true), text('expiresAt', TIME, true), text('ip', 100), long('client'),
					long('activity'), text('revokedAt', TIME), text('revokedBy', 200), long('claims'), text('viewName', 200), long('roles')],
				indexes: [{ name: 'byCredential', fields: ['credential'] }]
			},
			{
				name: 'SessionConnections',
				primaryKey: ['sessionId', 'replica'],
				properties: [text('sessionId', 64, true), text('replica', 64, true), text('seenAt', TIME, true)]
			},
			{
				name: 'UiStates',
				primaryKey: ['credential'],
				properties: [text('credential', 200, true), long('state'), text('updatedAt', TIME, true)]
			},
			{
				name: 'Approvals',
				primaryKey: ['id'],
				properties: [text('id', 64, true), text('schemaPath', 200, true), text('status', 20, true), text('createdAt', TIME, true), long('body')],
				indexes: [{ name: 'bySchema', fields: ['schemaPath', 'status', 'createdAt'] }]
			},
			{
				name: 'Roles',
				primaryKey: ['name', 'schemaPath'],
				// schemaPath '*': global (a key can't be null)
				properties: [text('name', 200, true), text('schemaPath', 200, true), long('config'), text('updatedAt', TIME, true), text('updatedBy', 200, true)]
			},
			{
				name: 'ConfigChanges',
				primaryKey: ['id'],
				properties: [text('id', 64, true), text('area', 40, true), text('changeKey', 400, true), long('before'), long('after'),
					text('changedBy', 200, true), text('changedAt', TIME, true), text('reason', 1000)],
				indexes: [{ name: 'byTime', fields: ['changedAt'] }]
			},
			{
				// the settings of the gateway changed from the administration (its observability): a JSON each
				name: 'Settings',
				primaryKey: ['settingKey'],
				properties: [text('settingKey', 40, true), long('value'), text('updatedAt', TIME, true), text('updatedBy', 200, true)]
			},
			{
				name: 'StateVersions',
				primaryKey: ['area'],
				properties: [text('area', 40, true), { name: 'version', type: 'integer', required: true }]
			}
		],
		enums: []
	},
	infrastructure: {
		paths: { state: stateDir },
		mappings: [{
			name: 'state',
			entities: mappingOf(mapping)
		}],
		sources: [{ name: 'state', dialect, mapping: 'state', connection: connectionOf(dialect, connection) }],
		stages: [{ name: 'state', sources: [{ name: 'state' }] }]
	},
	application: { start: [], listeners: [] }
})

/** A URL of the connection as the driver of its dialect takes it */
const connectionOf = (dialect: string, connection: unknown): unknown => {
	if (typeof connection !== 'string') return connection
	if (dialect === 'PostgreSQL') return { connectionString: connection }
	if (dialect === 'MySQL' || dialect === 'MariaDB') return { uri: connection }
	return connection
}

const json = (value: unknown): string | null => value === undefined || value === null ? null : JSON.stringify(value)
const parse = <T> (value: unknown): T | undefined => typeof value === 'string' && value !== '' ? JSON.parse(value) as T : undefined

/** λORM takes the numbers of page() only as literals (a variable gives NaN): an integer, checked, in the text */
const page = (limit: number): string => `.page(1, ${Math.max(1, Math.trunc(Number(limit)) || 1)})`

/** The λORM of the state: one per source in a process, started (and its tables pushed) on the first use */
export class OrmState {
	private started?: Promise<Orm>
	private static readonly shared = new Map<string, OrmState>()

	private constructor (private readonly dialect: string, private readonly connection: unknown, private readonly mapping?: StateMapping) {}

	public static of (dialect: string, connection: unknown, mapping?: StateMapping): OrmState {
		const key = `${dialect}:${JSON.stringify(connection)}:${JSON.stringify(mapping ?? {})}`
		let state = OrmState.shared.get(key)
		if (!state) {
			state = new OrmState(dialect, connection, mapping)
			OrmState.shared.set(key, state)
		}
		return state
	}

	public orm (): Promise<Orm> {
		if (!this.started) {
			this.started = this.start()
			this.started.catch(() => { this.started = undefined })
		}
		return this.started
	}

	private async start (): Promise<Orm> {
		const orm = new Orm()
		// λORM keeps what it pushed here; push reads the database too, so another replica's tables are not created again
		await orm.init(systemSchema(this.dialect, this.connection, path.join(os.tmpdir(), `data-gateway-state-${process.pid}`), this.mapping), true)
		try {
			await orm.stage.push({ stage: 'state' }).execute()
		} catch {
			// two replicas creating the tables at once: the other one won; the second time there is nothing to create
			await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500))
			await orm.stage.push({ stage: 'state' }).execute()
		}
		return orm
	}

	public async execute (query: string, data?: unknown): Promise<any> {
		return (await this.orm()).execute(query, data ?? {}, { stage: 'state' })
	}

	public async end (): Promise<void> {
		const started = this.started
		this.started = undefined
		if (started) await (await started).end().catch(() => undefined)
	}
}

const sessionOf = (r: any): Session | undefined => {
	if (!r) return undefined
	const session: Session = {
		id: r.id,
		credential: r.credential,
		permissions: parse<string[]>(r.permissions) as Session['permissions'] ?? [],
		createdAt: r.createdAt,
		lastSeenAt: r.lastSeenAt,
		expiresAt: r.expiresAt
	}
	if (r.ip) session.ip = r.ip
	const client = parse<Session['client']>(r.client)
	if (client) session.client = client
	const activity = parse<Session['activity']>(r.activity)
	if (activity) session.activity = activity
	const context = parse<Record<string, unknown>>(r.claims)
	if (context) session.context = context
	if (r.viewName) session.view = r.viewName
	const roles = parse<string[]>(r.roles)
	if (roles) session.roles = roles
	if (r.revokedAt) session.revokedAt = r.revokedAt
	if (r.revokedBy) session.revokedBy = r.revokedBy
	return session
}

/** The sessions of management in the database of the state (docs/GATEWAY_STATE.md): shared by every replica */
export class OrmSessionStore implements SessionStorePort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly state: OrmState) {}

	public async create (session: Session, tokenHash: string): Promise<void> {
		await this.state.execute('Sessions.insert()', {
			id: session.id, tokenHash, credential: session.credential, permissions: json(session.permissions), createdAt: session.createdAt,
			lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt, ip: session.ip ?? null, client: json(session.client), activity: json(session.activity),
			revokedAt: null, revokedBy: null, claims: json(session.context), viewName: session.view ?? null, roles: json(session.roles)
		})
	}

	public async byTokenHash (tokenHash: string): Promise<Session | undefined> {
		return sessionOf((await this.state.execute('Sessions.filter(p => p.tokenHash == tokenHash)', { tokenHash }))[0])
	}

	public async byId (id: string): Promise<Session | undefined> {
		return sessionOf((await this.state.execute('Sessions.filter(p => p.id == id)', { id }))[0])
	}

	public async active (credential?: string): Promise<Session[]> {
		const rows = credential === undefined
			? await this.state.execute('Sessions.filter(p => isNull(p.revokedAt))')
			: await this.state.execute('Sessions.filter(p => isNull(p.revokedAt) && p.credential == credential)', { credential })
		return rows.map((r: any) => sessionOf(r)!)
	}

	public async touch (id: string, at: string, ip?: string): Promise<void> {
		if (ip) await this.state.execute('Sessions.update(p => ({ lastSeenAt: at, ip: ip })).filter(p => p.id == id)', { id, at, ip })
		else await this.state.execute('Sessions.update(p => ({ lastSeenAt: at })).filter(p => p.id == id)', { id, at })
	}

	public async revoke (id: string, by: string, at: string): Promise<void> {
		await this.state.execute('Sessions.update(p => ({ revokedAt: at, revokedBy: by })).filter(p => p.id == id && isNull(p.revokedAt))', { id, by, at })
	}

	public async setActivity (id: string, activity: { schema?: string, tab?: string }): Promise<void> {
		await this.state.execute('Sessions.update(p => ({ activity: activity })).filter(p => p.id == id)', { id, activity: JSON.stringify(activity) })
	}

	public async markConnected (replica: string, ids: string[], at: string): Promise<void> {
		await this.state.execute('SessionConnections.delete().filter(p => p.replica == replica)', { replica })
		for (const sessionId of ids) await this.state.execute('SessionConnections.insert()', { sessionId, replica, seenAt: at })
	}

	public async connectedSince (since: string): Promise<Set<string>> {
		const rows = await this.state.execute('SessionConnections.filter(p => p.seenAt >= since).map(p => p.sessionId)', { since })
		return new Set(rows.map((r: any) => r.sessionId))
	}

	public async purge (endedBefore: string): Promise<number> {
		const removed = await this.state.execute('Sessions.delete().filter(p => p.revokedAt < before || p.expiresAt < before)', { before: endedBefore })
		await this.state.execute('SessionConnections.delete().filter(p => p.seenAt < before)', { before: endedBefore })
		return Number(removed) || 0
	}
}

/** The state of the UI of each credential in the database of the state */
export class OrmUiStateStore implements SessionStatePort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly state: OrmState) {}

	public async read (credential: string): Promise<{ state: unknown, updatedAt: string } | undefined> {
		const row = (await this.state.execute('UiStates.filter(p => p.credential == credential)', { credential }))[0]
		return row ? { state: parse(row.state) ?? null, updatedAt: row.updatedAt } : undefined
	}

	public async write (credential: string, state: unknown, at: string): Promise<void> {
		const changed = await this.state.execute('UiStates.update(p => ({ state: state, updatedAt: at })).filter(p => p.credential == credential)', { credential, state: JSON.stringify(state), at })
		if (!Number(changed)) await this.state.execute('UiStates.insert()', { credential, state: JSON.stringify(state), updatedAt: at })
	}

	public async remove (credential: string): Promise<void> {
		await this.state.execute('UiStates.delete().filter(p => p.credential == credential)', { credential })
	}
}

/** The writes that wait for a person in the database of the state: every worker and replica sees them */
export class OrmApprovalStore implements ApprovalStorePort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly state: OrmState) {}

	public async create (approval: Approval): Promise<void> {
		await this.state.execute('Approvals.insert()', { id: approval.id, schemaPath: approval.schema, status: approval.status, createdAt: approval.createdAt, body: JSON.stringify(approval) })
	}

	public async get (id: string): Promise<Approval | undefined> {
		return parse<Approval>((await this.state.execute('Approvals.filter(p => p.id == id)', { id }))[0]?.body)
	}

	public async list (schema: string, status: ApprovalStatus | undefined, limit: number): Promise<Approval[]> {
		const rows = status
			? await this.state.execute('Approvals.filter(p => p.schemaPath == schema && p.status == status).sort(p => desc(p.createdAt))' + page(limit), { schema, status })
			: await this.state.execute('Approvals.filter(p => p.schemaPath == schema).sort(p => desc(p.createdAt))' + page(limit), { schema })
		return rows.map((r: any) => parse<Approval>(r.body)!)
	}

	public async transition (id: string, from: ApprovalStatus, change: Partial<Approval> & { status: ApprovalStatus }): Promise<boolean> {
		const current = await this.get(id)
		if (!current || current.status !== from) return false
		// one statement moves it, only while it still has from: two people approving at once, one wins
		const moved = await this.state.execute('Approvals.update(p => ({ status: to, body: body })).filter(p => p.id == id && p.status == from)',
			{ id, from, to: change.status, body: JSON.stringify({ ...current, ...change }) })
		return Number(moved) > 0
	}
}

const GLOBAL = '*'

/** The roles of the state, their changes and their version (docs/ROLE_SCOPES.md §5) in the database of the state */
export class OrmRoleStore implements RoleStorePort, SettingStorePort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly state: OrmState) {}

	public async roles (): Promise<StoredRole[]> {
		const rows = await this.state.execute('Roles.map(p => [p.name, p.schemaPath, p.config, p.updatedAt, p.updatedBy])')
		return rows.map((r: any) => ({
			name: r.name,
			...(r.schemaPath !== GLOBAL ? { schema: r.schemaPath } : {}),
			config: parse(r.config) ?? {},
			updatedAt: r.updatedAt,
			updatedBy: r.updatedBy
		}))
	}

	private async bump (area: ConfigArea = 'roles'): Promise<void> {
		const moved = await this.state.execute('StateVersions.update(p => ({ version: p.version + 1 })).filter(p => p.area == area)', { area })
		if (!Number(moved)) await this.state.execute('StateVersions.insert()', { area, version: 1 })
	}

	public async setting (key: ConfigArea): Promise<StoredSetting | undefined> {
		const row = (await this.state.execute('Settings.filter(p => p.settingKey == key)', { key }))[0]
		return row ? { key, value: parse(row.value), updatedAt: row.updatedAt, updatedBy: row.updatedBy } : undefined
	}

	public async putSetting (setting: StoredSetting, change: ConfigChange): Promise<void> {
		const data = { settingKey: setting.key, value: JSON.stringify(setting.value), updatedAt: setting.updatedAt, updatedBy: setting.updatedBy }
		const changed = await this.state.execute('Settings.update(p => ({ value: value, updatedAt: updatedAt, updatedBy: updatedBy })).filter(p => p.settingKey == settingKey)', data)
		if (!Number(changed)) await this.state.execute('Settings.insert()', data)
		await this.record(change)
		await this.bump(setting.key)
	}

	public async removeSetting (key: ConfigArea, change: ConfigChange): Promise<boolean> {
		const removed = await this.state.execute('Settings.delete().filter(p => p.settingKey == key)', { key })
		if (!Number(removed)) return false
		await this.record(change)
		await this.bump(key)
		return true
	}

	public async areaVersion (area: ConfigArea): Promise<number> {
		const row = (await this.state.execute('StateVersions.filter(p => p.area == area)', { area }))[0]
		return Number(row?.version ?? 0)
	}

	private async record (change: ConfigChange): Promise<void> {
		await this.state.execute('ConfigChanges.insert()', {
			id: change.id, area: change.area, changeKey: change.key, before: json(change.before), after: json(change.after),
			changedBy: change.by, changedAt: change.at, reason: change.reason ?? null
		})
	}

	public async put (role: StoredRole, change: ConfigChange): Promise<void> {
		const schemaPath = role.schema ?? GLOBAL
		const data = { name: role.name, schemaPath, config: JSON.stringify(role.config), updatedAt: role.updatedAt, updatedBy: role.updatedBy }
		const changed = await this.state.execute('Roles.update(p => ({ config: config, updatedAt: updatedAt, updatedBy: updatedBy })).filter(p => p.name == name && p.schemaPath == schemaPath)', data)
		if (!Number(changed)) await this.state.execute('Roles.insert()', data)
		await this.record(change)
		await this.bump()
	}

	public async remove (name: string, schema: string | undefined, change: ConfigChange): Promise<boolean> {
		const removed = await this.state.execute('Roles.delete().filter(p => p.name == name && p.schemaPath == schemaPath)', { name, schemaPath: schema ?? GLOBAL })
		if (!Number(removed)) return false
		await this.record(change)
		await this.bump()
		return true
	}

	public async changes (limit: number): Promise<ConfigChange[]> {
		const rows = await this.state.execute('ConfigChanges.sort(p => desc(p.changedAt))' + page(limit))
		return rows.map((r: any) => ({
			id: r.id, area: r.area, key: r.changeKey, ...(r.before ? { before: parse(r.before) } : {}), ...(r.after ? { after: parse(r.after) } : {}),
			by: r.changedBy, at: r.changedAt, ...(r.reason ? { reason: r.reason } : {})
		}))
	}

	public async version (): Promise<number> {
		const row = (await this.state.execute('StateVersions.filter(p => p.area == area)', { area: 'roles' }))[0]
		return Number(row?.version ?? 0)
	}
}
