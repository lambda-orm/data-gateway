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
}
