/**
 * The credential of a WebSocket from a browser: its WebSocket can't send headers (X-Api-Key, Authorization), only the
 * subprotocols it asks for (Sec-WebSocket-Protocol). So the gateway also takes them there (docs/DATA_GATEWAY.md §7):
 * `lambdaorm` (the protocol, which the gateway answers) and `lambdaorm.headers.<base64url of a JSON of headers>`.
 * As in an Authorization header, the credential travels in the request: use wss:// (TLS) out of a local machine.
 */
export const PROTOCOL = 'lambdaorm'
const PREFIX = `${PROTOCOL}.headers.`

/** The subprotocols a client offers for these headers (what the IDE sends) */
export const protocolsFor = (headers: Record<string, string>): string[] => {
	const json = JSON.stringify(headers)
	const base64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, 'utf8').toString('base64')
	return [PROTOCOL, PREFIX + base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')]
}

/** The headers carried by the subprotocols of a request (none when there are none, or they can't be read) */
export const headersFromProtocols = (header: string | string[] | undefined): Record<string, string> => {
	const offered = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map(p => p.trim())
	const carried = offered.find(p => p.startsWith(PREFIX))
	if (!carried) return {}
	try {
		const base64 = carried.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')
		const value = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
		if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
		// header names as Node gives them (lowercase); only text values
		return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.toLowerCase(), v as string]))
	} catch { return {} }
}

/** The subprotocol the gateway answers: lambdaorm when it was offered (else none) */
export const chooseProtocol = (offered: Set<string>): string | false => offered.has(PROTOCOL) ? PROTOCOL : false

const SESSION_PREFIX = `${PROTOCOL}.session.`

/** The subprotocols of a WebSocket to the events of management: the token of its session (docs/DATA_GATEWAY_SESSIONS_PLAN.md §4) */
export const sessionProtocolsFor = (token: string): string[] => [PROTOCOL, SESSION_PREFIX + token]

/** The token of a session carried by the subprotocols of a request, if any */
export const sessionFromProtocols = (header: string | string[] | undefined): string | undefined => {
	const offered = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map(p => p.trim())
	const carried = offered.find(p => p.startsWith(SESSION_PREFIX))
	return carried ? carried.slice(SESSION_PREFIX.length) || undefined : undefined
}
