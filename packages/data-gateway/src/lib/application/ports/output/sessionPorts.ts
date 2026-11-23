import { Session } from '../../../domain/session/session'

/**
 * Where the sessions of management are kept (docs/DATA_GATEWAY_SESSIONS_PLAN.md §6): SQLite on the volume, shared by
 * the replicas, or memory (one replica). Synchronous: node:sqlite is, and a request validates its session on every call.
 */
export interface SessionStorePort {
	create (session: Session, tokenHash: string): void
	/** the session of a token (by its hash), revoked or expired too: the caller tells why it can't be used */
	byTokenHash (tokenHash: string): Session | undefined
	byId (id: string): Session | undefined
	/** the sessions not revoked, of a credential or of all; the expired ones too (the caller filters them) */
	active (credential?: string): Session[]
	/** the last request of a session (written at most once a minute, by the caller) */
	touch (id: string, at: string, ip?: string): void
	revoke (id: string, by: string, at: string): void
	/** sessions that ended (revoked, or expired before `endedBefore`) more than a day ago are removed */
	purge (endedBefore: string): number
	close? (): void
}

/** The secrets of a session: its random token, the hash that is kept instead, and its public id */
export interface SessionSecretsPort {
	token (): string
	hash (token: string): string
	id (): string
}
