import { AuditPort, ClockPort, LoggerPort } from '../ports/output/supportPorts'
import { SessionSecretsPort, SessionStorePort } from '../ports/output/sessionPorts'
import { endOf, listed, ListedSession, Session, SessionClient, SessionEnd, SessionSettings } from '../../domain/session/session'
import { Principal, principal as principalOf } from '../../domain/auth/principal'
import { forbidden, GatewayError, notFound } from '../../domain/errors/gatewayError'
import { SessionAuditEntry } from '../../domain/audit/auditEntry'
import { Listeners } from '../runtime/listeners'

/** lastSeenAt is written at most this often per session, not on every request */
const TOUCH_EVERY_MS = 60000
/** an ended session stays this long (listed as such to nobody, kept for its 401 with the reason), then it is removed */
const KEEP_ENDED_MS = 24 * 3600000
/** a session is connected if some replica saw its WebSocket of events this recently (they say it every 15 s) */
const CONNECTED_WITHIN_MS = 45000
/** session.expiring: this long before the end of its lifetime */
export const EXPIRING_NOTICE_MS = 2 * 60000

export interface Login {
	session: Session
	/** the secret: given once, here; only its hash is kept */
	token: string
	idleTimeoutMs: number
}

/** What a valid session gives a request: who it is, and the session itself */
export interface Authenticated {
	principal: Principal
	session: Session
}

const sessionError = (end: SessionEnd): GatewayError => {
	switch (end.reason) {
	case 'revoked':
		return new GatewayError(401, 'SessionRevokedError', end.by === 'limit'
			? `the session was closed at ${end.at}: its credential went over sessions.maxPerCredential; log in again`
			: `the session was revoked${end.by ? ` by "${end.by}"` : ''} at ${end.at}; log in again`)
	case 'idle':
		return new GatewayError(401, 'SessionExpiredError', `the session expired at ${end.at}: no request within sessions.idleTimeout; log in again`)
	default:
		return new GatewayError(401, 'SessionExpiredError', `the session expired at ${end.at}: sessions.maxLifetime; log in again`)
	}
}

export const sessionRequired = (): GatewayError =>
	new GatewayError(401, 'SessionRequiredError', 'management needs a session: log in with POST /sessions and send its token in X-Data-Gateway-Session')

/**
 * The sessions of management (docs/DATA_GATEWAY_SESSIONS_PLAN.md): log in with a credential, authenticate a request by
 * its token, list them (one's own; all with sessionAdmin) and revoke them. Every login, logout, expiry and revocation
 * leaves an audit line, never with the token.
 */
export class SessionService {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly settings: SessionSettings,
		private readonly store: SessionStorePort,
		private readonly secrets: SessionSecretsPort,
		private readonly clock: ClockPort,
		private readonly logger: LoggerPort,
		private readonly audit?: AuditPort
	) {
		this.replica = secrets.id()
	}

	/** this replica, in the presence it tells (session_connections) */
	private readonly replica: string

	/** a session that can't be used any more, ended in this replica (logout, revoked, limit): its WebSocket closes now */
	public readonly ended = new Listeners<{ id: string, error: GatewayError }>()

	public get idleTimeoutMs (): number { return this.settings.idleTimeoutMs }

	/** A credential already validated by the authenticator of management becomes a session */
	public login (principal: Principal, client: SessionClient | undefined, ip: string | undefined): Login {
		const now = this.clock.now()
		const at = now.toISOString()
		this.store.purge(new Date(now.getTime() - KEEP_ENDED_MS).toISOString())
		if (this.settings.maxPerCredential > 0) {
			// over the limit, the oldest sessions of that credential go (not the new login)
			const live = this.store.active(principal.name).filter(s => !endOf(s, now, this.settings))
				.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
			for (const old of live.slice(0, Math.max(0, live.length - this.settings.maxPerCredential + 1))) {
				this.store.revoke(old.id, 'limit', at)
				this.write({ credential: old.credential, operation: 'sessionRevoked', session: old.id, by: 'limit', result: 'ok' })
				this.ended.emit({ id: old.id, error: sessionError({ reason: 'revoked', by: 'limit', at }) })
			}
		}
		const token = this.secrets.token()
		const session: Session = {
			id: this.secrets.id(),
			credential: principal.name,
			permissions: [...principal.permissions],
			createdAt: at,
			lastSeenAt: at,
			expiresAt: new Date(now.getTime() + this.settings.maxLifetimeMs).toISOString(),
			...(ip ? { ip } : {}),
			...(client && Object.keys(client).length ? { client } : {})
		}
		this.store.create(session, this.secrets.hash(token))
		this.write({ credential: principal.name, operation: 'login', session: session.id, ip, result: 'ok' })
		this.logger.info(`[data-gateway] management: "${principal.name}" logged in (session ${session.id}${ip ? `, ${ip}` : ''})`)
		return { session, token, idleTimeoutMs: this.settings.idleTimeoutMs }
	}

	/** A login whose credential was refused: audited, without the credential's secret */
	public rejected (reason: string, ip: string | undefined): void {
		this.write({ credential: '-', operation: 'loginRejected', ip, reason, result: 'error' })
	}

	/** The session of a token, valid now; else the 401 that says why. Renews its inactivity (at most once a minute). */
	public authenticate (token: string | undefined, ip: string | undefined): Authenticated {
		if (!token) throw sessionRequired()
		const session = this.store.byTokenHash(this.secrets.hash(token))
		if (!session) throw sessionRequired()
		const now = this.clock.now()
		const error = this.settle(session, now, ip)
		if (error) throw error
		if (now.getTime() - Date.parse(session.lastSeenAt) >= TOUCH_EVERY_MS || (ip && ip !== session.ip)) {
			const at = now.toISOString()
			this.store.touch(session.id, at, ip)
			session.lastSeenAt = at
			if (ip) session.ip = ip
		}
		return { principal: principalOf(session.credential, session.permissions), session }
	}

	/** Why a session can't be used now (and, the first time it is seen expired, its audit line), or undefined */
	private settle (session: Session, now: Date, ip?: string): GatewayError | undefined {
		const end = endOf(session, now, this.settings)
		if (!end) return undefined
		if (end.reason !== 'revoked' && !session.revokedAt) {
			// it ended now: once, its audit line, and it is kept as revoked by its expiry so it isn't counted again
			this.store.revoke(session.id, `expired:${end.reason}`, end.at)
			this.write({ credential: session.credential, operation: 'sessionExpired', session: session.id, reason: end.reason, ip, result: 'ok' })
		}
		return sessionError(end.reason === 'revoked' && session.revokedBy?.startsWith('expired:')
			? { reason: session.revokedBy.slice('expired:'.length) as 'idle' | 'lifetime', at: session.revokedAt! }
			: end)
	}

	/** Of the sessions of the sockets of this replica, the ones that ended (in any replica) and why: they are closed */
	public check (ids: string[]): { id: string, error: GatewayError }[] {
		const now = this.clock.now()
		const ended: { id: string, error: GatewayError }[] = []
		for (const id of ids) {
			const session = this.store.byId(id)
			const error = session ? this.settle(session, now) : sessionRequired()
			if (error) ended.push({ id, error })
		}
		return ended
	}

	/** How long until session.expiring (its lifetime ends in EXPIRING_NOTICE_MS); 0 if it is already due */
	public expiringInMs (session: Session): number {
		return Math.max(0, Date.parse(session.expiresAt) - EXPIRING_NOTICE_MS - this.clock.now().getTime())
	}

	/** The sessions with a WebSocket of events open in this replica, said to the others (every 15 s, and on a change) */
	public presence (ids: string[]): void {
		this.store.markConnected(this.replica, ids, this.clock.now().toISOString())
	}

	/** What the IDE is looking at (session.activity); orientative, not audit */
	public activity (id: string, activity: { schema?: string, tab?: string }): void {
		const text = (value: unknown) => typeof value === 'string' && value ? value.slice(0, 200) : undefined
		const clean = { schema: text(activity?.schema), tab: text(activity?.tab) }
		this.store.setActivity(id, Object.fromEntries(Object.entries(clean).filter(([, v]) => v !== undefined)))
	}

	private connectedIds (): Set<string> {
		return this.store.connectedSince(new Date(this.clock.now().getTime() - CONNECTED_WITHIN_MS).toISOString())
	}

	public current (auth: Authenticated): ListedSession {
		return listed(this.store.byId(auth.session.id) ?? auth.session, auth.session.id, this.connectedIds().has(auth.session.id))
	}

	public logout (auth: Authenticated): void {
		const at = this.clock.now().toISOString()
		this.store.revoke(auth.session.id, auth.session.credential, at)
		this.write({ credential: auth.session.credential, operation: 'logout', session: auth.session.id, result: 'ok' })
		this.ended.emit({ id: auth.session.id, error: sessionError({ reason: 'revoked', by: auth.session.credential, at }) })
	}

	/** One's own sessions; with all, every credential's (sessionAdmin). Only the ones that can still be used. */
	public list (auth: Authenticated, all: boolean): ListedSession[] {
		if (all) this.require(auth, 'sessionAdmin')
		const now = this.clock.now()
		const connected = this.connectedIds()
		return this.store.active(all ? undefined : auth.session.credential)
			.filter(s => !endOf(s, now, this.settings))
			.sort((a, b) => a.credential.localeCompare(b.credential) || b.lastSeenAt.localeCompare(a.lastSeenAt))
			.map(s => listed(s, auth.session.id, connected.has(s.id)))
	}

	/** Revokes a session: one's own credential's, or any with sessionAdmin */
	public revoke (auth: Authenticated, id: string): void {
		const session = this.store.byId(id)
		if (!session || session.revokedAt) throw notFound(`there is no session "${id}" (it may have ended already)`)
		if (session.credential !== auth.session.credential) this.require(auth, 'sessionAdmin')
		this.end(session, auth.session.credential)
	}

	/** Revokes every session of a credential (but the caller's own with exceptCurrent): its own, or any with sessionAdmin */
	public revokeCredential (auth: Authenticated, credential: string, exceptCurrent: boolean): { revoked: number } {
		if (credential !== auth.session.credential) this.require(auth, 'sessionAdmin')
		const now = this.clock.now()
		const sessions = this.store.active(credential)
			.filter(s => !endOf(s, now, this.settings))
			.filter(s => !(exceptCurrent && s.id === auth.session.id))
		for (const session of sessions) this.end(session, auth.session.credential)
		return { revoked: sessions.length }
	}

	/** Sessions that can be used now: for the metrics */
	public count (): { active: number, connected: number } {
		const now = this.clock.now()
		const live = this.store.active().filter(s => !endOf(s, now, this.settings))
		const connected = this.connectedIds()
		return { active: live.length, connected: live.filter(s => connected.has(s.id)).length }
	}

	private end (session: Session, by: string): void {
		const at = this.clock.now().toISOString()
		this.store.revoke(session.id, by, at)
		this.ended.emit({ id: session.id, error: sessionError({ reason: 'revoked', by, at }) })
		this.write({ credential: session.credential, operation: 'sessionRevoked', session: session.id, by, result: 'ok' })
		this.logger.info(`[data-gateway] management: session ${session.id} of "${session.credential}" revoked by "${by}"`)
	}

	private require (auth: Authenticated, permission: 'sessionAdmin'): void {
		if (!auth.principal.permissions.has(permission)) throw forbidden(auth.principal.name, permission)
	}

	private write (fields: Omit<SessionAuditEntry, 'type' | 'time' | 'transport'>): void {
		if (!this.audit) return
		const entry: SessionAuditEntry = { type: 'audit', time: this.clock.now().toISOString(), transport: 'management', ...fields }
		if (entry.ip === undefined) delete entry.ip
		this.audit.write(entry)
	}
}
