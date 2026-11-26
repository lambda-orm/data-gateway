import { Session } from '../../../domain/session/session'

/**
 * Where the sessions of management are kept (docs/DATA_GATEWAY_SESSIONS_PLAN.md §6): SQLite on the volume, shared by
 * the replicas, a database through λORM (docs/GATEWAY_STATE.md), or memory (one replica).
 */
export interface SessionStorePort {
	create (session: Session, tokenHash: string): Promise<void>
	/** the session of a token (by its hash), revoked or expired too: the caller tells why it can't be used */
	byTokenHash (tokenHash: string): Promise<Session | undefined>
	byId (id: string): Promise<Session | undefined>
	/** the sessions not revoked, of a credential or of all; the expired ones too (the caller filters them) */
	active (credential?: string): Promise<Session[]>
	/** the last request of a session (written at most once a minute, by the caller) */
	touch (id: string, at: string, ip?: string): Promise<void>
	revoke (id: string, by: string, at: string): Promise<void>
	/** what the IDE says it is looking at (session.activity) */
	setActivity (id: string, activity: { schema?: string, tab?: string }): Promise<void>
	/** the sessions with a WebSocket of events open in this replica now (replaces what this replica said before) */
	markConnected (replica: string, ids: string[], at: string): Promise<void>
	/** the sessions some replica saw connected since then */
	connectedSince (since: string): Promise<Set<string>>
	/** sessions that ended (revoked, or expired before `endedBefore`) more than a day ago are removed */
	purge (endedBefore: string): Promise<number>
	close? (): void | Promise<void>
}

/** The secrets of a session: its random token, the hash that is kept instead, and its public id */
export interface SessionSecretsPort {
	token (): string
	hash (token: string): string
	id (): string
}
