import { KNOWN_PERMISSIONS, Permission } from '../../domain/auth/permission'
import { AuthenticationConfig, DataGatewayConfig } from '../../domain/config/dataGatewayConfig'

/** A local credential as the administration shows it: who it is and its roles, never its secret */
export interface DescribedCredential {
	name: string
	/** of a user of basic */
	username?: string
	roles: string[]
	context?: Record<string, string | number | boolean>
}

/** An authentication as the administration shows it (docs/ROLE_SCOPES.md §5): what it takes, never a secret */
export interface DescribedAuthentication {
	adapter: AuthenticationConfig['adapter']
	type?: AuthenticationConfig['type']
	header?: string
	credentials?: DescribedCredential[]
	/** a method jwt: its issuer, the claims of the name and of the roles, and those of the context */
	jwt?: { issuer: string, audience: string[], name: string, roles?: string, context: Record<string, string> }
	methods?: DescribedAuthentication[]
}

/** Where an authentication applies: the global one, the one of a transport, the one of a schema (the most specific wins) */
export interface PlacedAuthentication extends DescribedAuthentication {
	where: { level: 'global' } | { level: 'transport', transport: string } | { level: 'schema', schema: string }
}

export interface AccessDescription {
	/** every permission there is, for a role to name */
	permissions: readonly Permission[]
	authentications: PlacedAuthentication[]
}

const described = (a: AuthenticationConfig): DescribedAuthentication => ({
	adapter: a.adapter,
	...(a.type ? { type: a.type } : {}),
	...(a.header ? { header: a.header } : {}),
	...(a.adapter === 'local'
		? {
				credentials: a.credentials.map(c => ({
					name: c.name,
					...(c.username ? { username: c.username } : {}),
					roles: [...c.roles],
					...(c.context ? { context: { ...c.context } } : {})
				}))
			}
		: {}),
	...(a.jwt
		? {
				jwt: {
					issuer: a.jwt.issuer,
					audience: [...a.jwt.audience],
					name: a.jwt.principal.name,
					...(a.jwt.principal.permissions ? { roles: a.jwt.principal.permissions.claim } : {}),
					context: { ...a.jwt.context }
				}
			}
		: {}),
	...(a.methods ? { methods: a.methods.map(described) } : {})
})

/**
 * Who may come in, as the configuration says it (docs/ROLE_SCOPES.md §5): the authentications of every level with
 * their keys, their roles and their context. It never says a secret (a key, a token, a password, the secret of a jwt).
 */
export const describeAccess = (config: Pick<DataGatewayConfig, 'authentication' | 'transports' | 'orm'>): AccessDescription => ({
	permissions: KNOWN_PERMISSIONS,
	authentications: [
		{ where: { level: 'global' }, ...described(config.authentication) },
		...Object.entries(config.transports)
			.map(([transport, t]) => [transport, (t as { authentication?: AuthenticationConfig } | undefined)?.authentication] as const)
			.filter((entry): entry is readonly [string, AuthenticationConfig] => entry[1] !== undefined)
			.map(([transport, a]) => ({ where: { level: 'transport' as const, transport }, ...described(a) })),
		...config.orm.schemas
			.filter(s => s.authentication)
			.map(s => ({ where: { level: 'schema' as const, schema: s.path }, ...described(s.authentication!) }))
	]
})
