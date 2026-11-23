import { ALL_PERMISSIONS, Permission } from './permission'

/** Who is calling: the name of the credential (never its secret) and what it may do. */
export interface Principal {
	readonly name: string
	readonly permissions: ReadonlySet<Permission>
}

export const principal = (name: string, permissions: readonly Permission[]): Principal =>
	({ name, permissions: new Set(permissions) })

/** The caller when authentication is `adapter: none`: open access, every permission. */
export const ANONYMOUS: Principal = principal('anonymous', ALL_PERMISSIONS)

export interface AuthenticationResult {
	valid: boolean
	principal?: Principal
	reason?: string
}
