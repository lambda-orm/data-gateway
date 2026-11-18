import { timingSafeEqual } from 'crypto'
import { AuthenticatorPort, Headers } from '../../../application/ports/output/supportPorts'
import { CredentialConfig } from '../../../domain/config/dataGatewayConfig'
import { ANONYMOUS, AuthenticationResult, principal } from '../../../domain/auth/principal'

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

const result = (credential: CredentialConfig | undefined, reason: string): AuthenticationResult =>
	credential
		? { valid: true, principal: principal(credential.name, credential.permissions) }
		: { valid: false, reason }

/** adapter: none — open access, every permission. */
export class NoneAuthenticator implements AuthenticatorPort {
	public async authenticate (): Promise<AuthenticationResult> {
		return { valid: true, principal: ANONYMOUS }
	}
}

/** Authorization: Bearer <token> */
export class BearerAuthenticator implements AuthenticatorPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly credentials: CredentialConfig[]) {}

	public async authenticate (headers: Headers): Promise<AuthenticationResult> {
		const authorization = header(headers, 'authorization')
		const token = authorization.startsWith('Bearer ') ? authorization.substring(7) : ''
		return result(match(this.credentials, c => secretEquals(token, c.value ?? '')), 'a valid token is required (Authorization: Bearer <token>)')
	}
}

/** <header>: <key> (default X-Api-Key) */
export class ApiKeyAuthenticator implements AuthenticatorPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly credentials: CredentialConfig[], private readonly headerName = 'x-api-key') {}

	public async authenticate (headers: Headers): Promise<AuthenticationResult> {
		const key = header(headers, this.headerName)
		return result(match(this.credentials, c => secretEquals(key, c.value ?? '')), `a valid API key is required (${this.headerName})`)
	}
}

/** Authorization: Basic base64(username:password) */
export class BasicAuthenticator implements AuthenticatorPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly credentials: CredentialConfig[]) {}

	public async authenticate (headers: Headers): Promise<AuthenticationResult> {
		const authorization = header(headers, 'authorization')
		const decoded = authorization.startsWith('Basic ') ? Buffer.from(authorization.substring(6), 'base64').toString('utf8') : ''
		const separator = decoded.indexOf(':')
		const username = separator >= 0 ? decoded.substring(0, separator) : ''
		const password = separator >= 0 ? decoded.substring(separator + 1) : ''
		return result(
			match(this.credentials, c => secretEquals(username, c.username ?? '') && secretEquals(password, c.password ?? '')),
			'a valid user and password are required (Authorization: Basic)'
		)
	}
}
