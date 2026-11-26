import { timingSafeEqual } from 'crypto'
import { AuthenticatorPort, CredentialScheme, Headers } from '../../../application/ports/output/supportPorts'
import { CredentialConfig } from '../../../domain/config/dataGatewayConfig'
import { ANONYMOUS, AuthenticationResult, Principal, principal } from '../../../domain/auth/principal'
import { RoleLookupPort } from '../../../application/auth/roleCatalog'

/** Compares two secrets in constant time (no timing leak of how much matched). */
export const secretEquals = (sent: string, expected: string): boolean => {
	const a = Buffer.from(sent)
	const b = Buffer.from(expected)
	return a.length === b.length && timingSafeEqual(a, b)
}

const header = (headers: Headers, name: string): string => {
	const value = headers[name.toLowerCase()]
	return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

/** Finds the credential whose secret matches. Every credential is compared, matched or not, to keep the time even. */
const match = (credentials: CredentialConfig[], test: (credential: CredentialConfig) => boolean): CredentialConfig | undefined => {
	let found: CredentialConfig | undefined
	for (const credential of credentials) {
		if (test(credential) && !found) found = credential
	}
	return found
}

/** recognized: the request brought a credential of its kind (another method of authentication.methods may take it if not) */
const result = (credential: CredentialConfig | undefined, reason: string, recognized: boolean, roles?: RoleLookupPort): AuthenticationResult =>
	credential ? { valid: true, principal: principalOf(credential, roles) } : { valid: false, reason, recognized }

/**
 * Who a key is: with roles (docs/ROLE_SCOPES.md), their names, and before a schema the permissions of them all (the
 * schema chooses among them); without them, its own permissions and view (as before 4.4)
 */
export const principalOf = (credential: CredentialConfig, roles?: RoleLookupPort): Principal => {
	if (credential.roles) {
		const approval = credential.approval ?? roles?.approvalOf(credential.roles)
		return { ...principal(credential.name, roles?.permissionsOf(credential.roles) ?? []), roles: credential.roles, ...(approval ? { approval } : {}) }
	}
	return { ...principal(credential.name, credential.permissions), ...(credential.view ? { view: credential.view } : {}), ...(credential.approval ? { approval: credential.approval } : {}) }
}

/** adapter: none — open access, every permission. */
export class NoneAuthenticator implements AuthenticatorPort {
	public async authenticate (): Promise<AuthenticationResult> {
		return { valid: true, principal: ANONYMOUS }
	}

	public scheme (): CredentialScheme { return { type: 'none' } }
}

/** Authorization: Bearer <token> */
export class BearerAuthenticator implements AuthenticatorPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly credentials: CredentialConfig[], private readonly roles?: RoleLookupPort) {}

	public async authenticate (headers: Headers): Promise<AuthenticationResult> {
		const authorization = header(headers, 'authorization')
		const token = authorization.startsWith('Bearer ') ? authorization.substring(7) : ''
		return result(match(this.credentials, c => secretEquals(token, c.value ?? '')), 'a valid token is required (Authorization: Bearer <token>)', token !== '', this.roles)
	}

	public scheme (): CredentialScheme { return { type: 'bearer' } }
}

/** <header>: <key> (default X-Api-Key) */
export class ApiKeyAuthenticator implements AuthenticatorPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly credentials: CredentialConfig[], private readonly headerName = 'x-api-key', private readonly roles?: RoleLookupPort) {}

	public async authenticate (headers: Headers): Promise<AuthenticationResult> {
		const key = header(headers, this.headerName)
		return result(match(this.credentials, c => secretEquals(key, c.value ?? '')), `a valid API key is required (${this.headerName})`, key !== '', this.roles)
	}

	public scheme (): CredentialScheme { return { type: 'apikey', header: this.headerName } }
}

/** Authorization: Basic base64(username:password) */
export class BasicAuthenticator implements AuthenticatorPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly credentials: CredentialConfig[], private readonly roles?: RoleLookupPort) {}

	public async authenticate (headers: Headers): Promise<AuthenticationResult> {
		const authorization = header(headers, 'authorization')
		const decoded = authorization.startsWith('Basic ') ? Buffer.from(authorization.substring(6), 'base64').toString('utf8') : ''
		const separator = decoded.indexOf(':')
		const username = separator >= 0 ? decoded.substring(0, separator) : ''
		const password = separator >= 0 ? decoded.substring(separator + 1) : ''
		return result(
			match(this.credentials, c => secretEquals(username, c.username ?? '') && secretEquals(password, c.password ?? '')),
			'a valid user and password are required (Authorization: Basic)',
			authorization.startsWith('Basic '),
			this.roles
		)
	}

	public scheme (): CredentialScheme { return { type: 'basic' } }
}

/**
 * authentication.methods (docs/JWT.md): several, in order. The first whose kind of credential the request brings decides
 * (valid or not: a wrong API key is not tried as a token); with none, the reasons of all of them.
 */
export class MethodsAuthenticator implements AuthenticatorPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly methods: AuthenticatorPort[]) {}

	public async authenticate (headers: Headers): Promise<AuthenticationResult> {
		const reasons: string[] = []
		let challenge: string | undefined
		for (const method of this.methods) {
			const result = await method.authenticate(headers)
			if (result.valid || result.recognized !== false) return result
			if (result.reason) reasons.push(result.reason)
			challenge ??= result.challenge
		}
		return { valid: false, recognized: false, reason: reasons.join('; or ') || 'a valid credential is required', ...(challenge ? { challenge } : {}) }
	}

	/** how the first method takes the credential (what Swagger's Authorize offers) */
	public scheme (): CredentialScheme { return this.methods[0]?.scheme?.() ?? { type: 'none' } }
}
