import { Permission } from '../auth/permission'

/**
 * A session of management (docs/DATA_GATEWAY_SESSIONS_PLAN.md): a login with a credential gives a token, and every
 * request carries the token instead of the credential. A session is what is listed and revoked; its token is secret and
 * only its hash is kept.
 */
export interface Session {
	/** public: it is listed and revoked by it */
	id: string
	/** the name of the credential that logged in, and its permissions at that moment */
	credential: string
	permissions: Permission[]
	createdAt: string
	lastSeenAt: string
	/** the end of its lifetime (sessions.maxLifetime after the login) */
	expiresAt: string
	ip?: string
	client?: SessionClient
	activity?: { schema?: string, tab?: string }
	revokedAt?: string
	/** who revoked it: a credential, or "limit" (sessions.maxPerCredential) */
	revokedBy?: string
}

/** What the client says of itself in the login (the IDE: its name, version and kind) */
export interface SessionClient {
	app?: string
	version?: string
	kind?: 'web' | 'desktop' | string
	userAgent?: string
}

export interface SessionSettings {
	/** without HTTP requests, it expires */
	idleTimeoutMs: number
	/** after the login, it expires */
	maxLifetimeMs: number
	/** 0 = no limit; over it, a login closes the oldest session of that credential */
	maxPerCredential: number
}

/** Why a session can't be used any more, or undefined when it can */
export type SessionEnd = { reason: 'revoked', by?: string, at: string } | { reason: 'idle' | 'lifetime', at: string }

export const endOf = (session: Session, now: Date, settings: SessionSettings): SessionEnd | undefined => {
	if (session.revokedAt) return { reason: 'revoked', by: session.revokedBy, at: session.revokedAt }
	const expires = Date.parse(session.expiresAt)
	if (now.getTime() >= expires) return { reason: 'lifetime', at: session.expiresAt }
	const idleEnd = Date.parse(session.lastSeenAt) + settings.idleTimeoutMs
	if (now.getTime() >= idleEnd) return { reason: 'idle', at: new Date(idleEnd).toISOString() }
	return undefined
}

/** A session as it is listed: never its token (it isn't kept), with `current` for the caller's own */
export type ListedSession = Omit<Session, 'permissions' | 'revokedAt' | 'revokedBy'> & { current: boolean, connected: boolean }

export const listed = (session: Session, currentId: string | undefined, connected: boolean): ListedSession => {
	const result: ListedSession & Partial<Pick<Session, 'permissions' | 'revokedAt' | 'revokedBy'>> = { ...session, current: session.id === currentId, connected }
	delete result.permissions
	delete result.revokedAt
	delete result.revokedBy
	return result
}
