import { TransportName } from './errors'

/** How to connect: the credential and the rest, never in the URL */
export interface ConnectOptions {
	/** sent as the `X-Api-Key` header (or the one in `apiKeyHeader`); default: DATA_GATEWAY_API_KEY */
	apiKey?: string
	/** the header of the API key, when the gateway uses another one */
	apiKeyHeader?: string
	/** sent as `Authorization: Bearer <token>`; default: DATA_GATEWAY_TOKEN */
	token?: string
	/** any other header */
	headers?: Record<string, string>
	/** milliseconds an operation can take before it fails with the code timeout; default 30000 */
	timeout?: number
	/**
	 * MCP only: what a list cut at mcp.maxRows gives. 'error' (default): a GatewayError with the code truncated, so a
	 * program never gets incomplete data without knowing it; 'return': the cut result, { rows, truncated, … }
	 */
	onTruncated?: 'error' | 'return'
	/** the stage of every query, unless its options say another one */
	stage?: string
}

export interface ConnectionTarget {
	transport: TransportName
	/** the URL of the schema for the transport: http(s)://… or ws(s)://…, without a trailing slash */
	url: string
	headers: Record<string, string>
	timeout: number
	onTruncated: 'error' | 'return'
	stage?: string
}

const SCHEMES: Record<string, { transport: TransportName, protocol: string }> = {
	'http:': { transport: 'http', protocol: 'http' },
	'https:': { transport: 'http', protocol: 'https' },
	'ws:': { transport: 'ws', protocol: 'ws' },
	'wss:': { transport: 'ws', protocol: 'wss' },
	'mcp+http:': { transport: 'mcp+http', protocol: 'http' },
	'mcp+https:': { transport: 'mcp+http', protocol: 'https' },
	'mcp+sse:': { transport: 'mcp+sse', protocol: 'http' },
	'mcp+sses:': { transport: 'mcp+sse', protocol: 'https' },
	'mcp+ws:': { transport: 'mcp+ws', protocol: 'ws' },
	'mcp+wss:': { transport: 'mcp+ws', protocol: 'wss' }
}
const CREDENTIAL_PARAMS = ['apikey', 'api_key', 'api-key', 'key', 'token', 'access_token', 'password', 'secret']

/**
 * The transport and the URL of a connection string (docs/DATA_GATEWAY_CLIENTS_PLAN.md §2):
 * `<scheme>://host[:port][/basePath]/<schema>[?timeout=<ms>&stage=<stage>]`. A credential in the URL is an error.
 */
export const parseConnection = (connection: string | undefined, options: ConnectOptions = {}, env: NodeJS.ProcessEnv = process.env): ConnectionTarget => {
	const text = connection ?? env.DATA_GATEWAY_URL
	if (!text) throw new Error('no connection string: pass one (http://host/schema, ws://…, mcp+http://…) or set DATA_GATEWAY_URL')
	let url: URL
	try {
		url = new URL(text)
	} catch {
		throw new Error(`invalid connection string: ${text}`)
	}
	const scheme = SCHEMES[url.protocol]
	if (!scheme) throw new Error(`unknown transport ${url.protocol.slice(0, -1)} (http, https, ws, wss, mcp+http, mcp+https, mcp+sse, mcp+sses, mcp+ws, mcp+wss)`)
	if (url.username || url.password) throw new Error('the connection string has a credential (user:password@): pass it as apiKey or token, or by DATA_GATEWAY_API_KEY / DATA_GATEWAY_TOKEN')
	for (const name of url.searchParams.keys()) {
		if (CREDENTIAL_PARAMS.includes(name.toLowerCase())) throw new Error(`the connection string has a credential (${name}=): pass it as apiKey or token, or by DATA_GATEWAY_API_KEY / DATA_GATEWAY_TOKEN`)
		if (!['timeout', 'stage'].includes(name)) throw new Error(`unknown option of the connection string: ${name} (timeout, stage)`)
	}
	const fromUrl = Number(url.searchParams.get('timeout') ?? NaN)
	const apiKey = options.apiKey ?? env.DATA_GATEWAY_API_KEY
	const token = options.token ?? env.DATA_GATEWAY_TOKEN
	const headers: Record<string, string> = {
		...(apiKey ? { [options.apiKeyHeader ?? 'X-Api-Key']: apiKey } : {}),
		...(token ? { Authorization: `Bearer ${token}` } : {}),
		...options.headers
	}
	return {
		transport: scheme.transport,
		url: `${scheme.protocol}://${url.host}${url.pathname.replace(/\/+$/, '')}`,
		headers,
		timeout: options.timeout ?? (Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : 30000),
		onTruncated: options.onTruncated ?? 'error',
		stage: options.stage ?? url.searchParams.get('stage') ?? undefined
	}
}
