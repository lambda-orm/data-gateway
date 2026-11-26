import { Actor } from '@lambdaorm/base'
import { ALL_PERMISSIONS, Permission } from './permission'

/** Who is calling: the name of the credential (never its secret) and what it may do. */
export interface Principal {
	readonly name: string
	readonly permissions: ReadonlySet<Permission>
	/**
	 * Who it is for λORM and the audit: the credential, and the session, the client and the IP when the transport knows
	 * them. Set by the gateway, never taken from the request.
	 */
	readonly actor?: Actor
	/**
	 * The context of λORM of who calls (docs/JWT.md): what the row filters of the views, the defaults and the conditions
	 * read. From the identity (the claims of a token), never from the request.
	 */
	readonly context?: Record<string, unknown>
	/** The view of λORM it sees (docs/VIEWS_BY_IDENTITY.md): of its key or its roles; none, the one of the schema */
	readonly view?: string
	/** When its credential ends (the exp of a token, epoch ms): a session or a connection doesn't outlive it */
	readonly expiresAt?: number
	/** its writes wait for a person to approve them (docs/MUTATION_APPROVAL.md): of its key or its roles */
	readonly approval?: 'writes'
}

export const principal = (name: string, permissions: readonly Permission[], actor?: Actor): Principal =>
	actor ? { name, permissions: new Set(permissions), actor } : { name, permissions: new Set(permissions) }

/** The principal with its actor: the credential plus what the transport knows (session, client, IP) */
export const withActor = (who: Principal, actor: Omit<Actor, 'credential'>): Principal => {
	const known = Object.fromEntries(Object.entries(actor).filter(([, value]) => value !== undefined && value !== ''))
	return { ...who, actor: { ...who.actor, credential: who.name, ...known } }
}

/** The caller when authentication is `adapter: none`: open access, every permission. */
export const ANONYMOUS: Principal = principal('anonymous', ALL_PERMISSIONS)

export interface AuthenticationResult {
	valid: boolean
	principal?: Principal
	reason?: string
	/**
	 * false: there is no credential of this kind in the request (no header of its key, no token of its shape), so
	 * another method may take it (authentication.methods); undefined or true: it was its kind, valid or not
	 */
	recognized?: boolean
	/** the status of a refusal that is not 401: 503 when the issuer of the tokens can't be reached */
	status?: number
	/** WWW-Authenticate of the 401 (Bearer error="invalid_token") */
	challenge?: string
}

/** A refused authentication as every transport answers it: its status, the message and the WWW-Authenticate */
export const refusalOf = (result: AuthenticationResult): { status: number, message: string, challenge?: string } => ({
	status: result.status ?? 401,
	message: result.reason ?? 'a valid credential is required',
	...(result.challenge ? { challenge: result.challenge } : {})
})
