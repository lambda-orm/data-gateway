import { createRemoteJWKSet, errors, jwtVerify, JWTPayload, JWTVerifyGetKey } from 'jose'
import { AuthenticatorPort, CredentialScheme, Headers } from '../../../application/ports/output/supportPorts'
import { JwtConfig } from '../../../domain/config/dataGatewayConfig'
import { AuthenticationResult, principal } from '../../../domain/auth/principal'
import { Permission } from '../../../domain/auth/permission'

/** header.payload.signature, base64url: what a JWT looks like (an opaque token is left to another method) */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/

const header = (headers: Headers, name: string): string => {
	const value = headers[name]
	return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

/**
 * The value of a claim: its name as it is (Auth0 names them with a URL: https://example.com/roles) or a path with dots
 * (realm_access.roles, address.region)
 */
export const claimOf = (payload: Record<string, unknown>, path: string): unknown => {
	if (path in payload) return payload[path]
	let value: unknown = payload
	for (const part of path.split('.')) {
		if (value === null || typeof value !== 'object') return undefined
		value = (value as Record<string, unknown>)[part]
	}
	return value
}

/** The jwks_uri of an issuer, from its /.well-known/openid-configuration (OIDC discovery) */
export const discoverJwksUri = async (issuer: string): Promise<string> => {
	const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
	const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
	if (!response.ok) throw new Error(`${url} answered ${response.status}`)
	const jwksUri = (await response.json() as { jwks_uri?: unknown }).jwks_uri
	if (typeof jwksUri !== 'string' || !jwksUri) throw new Error(`${url} has no jwks_uri`)
	return jwksUri
}

/** Why jose refused a token, in words a client can act on; unavailable when the keys of the issuer can't be read */
const why = (error: unknown): { reason: string, unavailable?: boolean } => {
	if (error instanceof errors.JWTExpired) return { reason: 'expired' }
	if (error instanceof errors.JWTClaimValidationFailed) {
		const claim = error.claim
		return { reason: claim === 'iss' ? 'issuer' : claim === 'aud' ? 'audience' : claim === 'nbf' ? 'not yet valid' : `claim ${claim}` }
	}
	if (error instanceof errors.JWSSignatureVerificationFailed) return { reason: 'signature' }
	if (error instanceof errors.JOSEAlgNotAllowed) return { reason: 'algorithm' }
	if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys) return { reason: 'unknown key' }
	if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) return { reason: 'the keys of the issuer can\'t be read', unavailable: true }
	if (error instanceof errors.JOSEError) return { reason: 'malformed' }
	// fetch: the issuer (its discovery or its JWKS) doesn't answer
	return { reason: 'the keys of the issuer can\'t be read', unavailable: true }
}

/**
 * adapter: jwt (docs/JWT.md) — Authorization: Bearer <a JWT of the issuer>. The signature is checked with the keys of
 * the issuer (its JWKS, cached; a token signed with a new kid refreshes them) or a shared secret (HS256, for
 * development); then the issuer, the audience and the times. From its claims: the name, the permissions (roles mapped
 * in the configuration) and the context of λORM. The token is never kept nor written anywhere.
 */
export class JwtAuthenticator implements AuthenticatorPort {
	private keys?: Promise<JWTVerifyGetKey>

	/**
	 * jwks: how long its keys are kept, and the least time between two readings (a token of an unknown kid reads them
	 * again, but not more often: made up kids can't flood the issuer)
	 */
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly config: JwtConfig,
		private readonly discover: (issuer: string) => Promise<string> = discoverJwksUri,
		private readonly jwks: { cacheMaxAgeMs: number, cooldownMs: number } = { cacheMaxAgeMs: 600_000, cooldownMs: 30_000 }
	) {}

	public scheme (): CredentialScheme { return { type: 'bearer' } }

	/** The JWKS of the issuer, once; when it can't be had (discovery down) the next request tries again */
	private remoteKeys (): Promise<JWTVerifyGetKey> {
		if (!this.keys) {
			const keys = (async () => createRemoteJWKSet(new URL(this.config.jwksUri ?? await this.discover(this.config.issuer)), {
				timeoutDuration: 5000,
				cooldownDuration: this.jwks.cooldownMs,
				cacheMaxAge: this.jwks.cacheMaxAgeMs
			}))()
			keys.catch(() => { if (this.keys === keys) this.keys = undefined })
			this.keys = keys
		}
		return this.keys
	}

	public async authenticate (headers: Headers): Promise<AuthenticationResult> {
		const authorization = header(headers, 'authorization')
		const token = authorization.startsWith('Bearer ') ? authorization.substring(7).trim() : ''
		if (!JWT_SHAPE.test(token)) {
			return { valid: false, recognized: false, reason: 'a valid token is required (Authorization: Bearer <JWT>)', challenge: 'Bearer' }
		}
		const options = {
			issuer: this.config.issuer,
			...(this.config.audience.length ? { audience: this.config.audience } : {}),
			algorithms: this.config.algorithms,
			clockTolerance: this.config.clockToleranceSec
		}
		let payload: JWTPayload
		try {
			payload = this.config.secret
				? (await jwtVerify(token, new TextEncoder().encode(this.config.secret), options)).payload
				: (await jwtVerify(token, await this.remoteKeys(), options)).payload
		} catch (error) {
			const { reason, unavailable } = why(error)
			if (unavailable) return { valid: false, status: 503, reason: `the token can't be checked now: ${reason}` }
			return { valid: false, reason: `the token is not valid: ${reason}`, challenge: `Bearer error="invalid_token", error_description="${reason}"` }
		}
		return this.principalOf(payload)
	}

	/** Who the claims say it is: its name, the permissions of its roles and its context */
	private principalOf (payload: JWTPayload): AuthenticationResult {
		const claims = payload as Record<string, unknown>
		const name = claimOf(claims, this.config.principal.name)
		if (typeof name !== 'string' || name === '') {
			const reason = `no ${this.config.principal.name}`
			return { valid: false, reason: `the token is not valid: ${reason}`, challenge: `Bearer error="invalid_token", error_description="${reason}"` }
		}
		const permissions = new Set<Permission>()
		const mapping = this.config.principal.permissions
		if (mapping) {
			const value = claimOf(claims, mapping.claim)
			const roles = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
			for (const role of roles) for (const permission of mapping.roles[role] ?? []) permissions.add(permission)
		}
		const context: Record<string, unknown> = {}
		for (const [variable, path] of Object.entries(this.config.context)) {
			const value = claimOf(claims, path)
			if (value !== undefined) context[variable] = value
		}
		const who = principal(name, [...permissions])
		return {
			valid: true,
			principal: {
				...who,
				...(Object.keys(context).length ? { context } : {}),
				...(typeof payload.exp === 'number' ? { expiresAt: payload.exp * 1000 } : {})
			}
		}
	}
}
