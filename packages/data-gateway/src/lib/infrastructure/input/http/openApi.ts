import { CredentialScheme } from '../../../application/ports/output/supportPorts'

const NAMES: Record<Exclude<CredentialScheme['type'], 'none'>, string> = { bearer: 'bearerAuth', apikey: 'apiKeyAuth', basic: 'basicAuth' }

/**
 * The security of the OpenAPI document as the schemas served are configured: the schemes they use (a bearer token,
 * an API key in its header, basic), offered by Authorize, and any of them for every operation (the routes that need
 * none keep `security: []`). A schema without authentication adds the empty requirement.
 */
export const withSecurity = <T extends { components?: any, security?: any }>(document: T, schemes: CredentialScheme[]): T => {
	const securitySchemes: Record<string, unknown> = {}
	const names: string[] = []
	let open = schemes.length === 0
	for (const scheme of schemes) {
		if (scheme.type === 'none') { open = true; continue }
		let name = NAMES[scheme.type]
		// two schemas with their API key in different headers: one scheme per header
		if (scheme.type === 'apikey' && securitySchemes[name] && (securitySchemes[name] as any).name !== scheme.header) name = `${name}_${scheme.header}`
		if (securitySchemes[name]) continue
		securitySchemes[name] = scheme.type === 'apikey'
			? { type: 'apiKey', in: 'header', name: scheme.header ?? 'x-api-key', description: `The API key, in the ${scheme.header ?? 'x-api-key'} header` }
			: scheme.type === 'bearer'
				? { type: 'http', scheme: 'bearer', description: 'The token (Authorization: Bearer <token>)' }
				: { type: 'http', scheme: 'basic', description: 'The user and the password (Authorization: Basic)' }
		names.push(name)
	}
	return {
		...document,
		components: { ...document.components, securitySchemes },
		security: [...names.map(name => ({ [name]: [] })), ...(open ? [{}] : [])]
	}
}
