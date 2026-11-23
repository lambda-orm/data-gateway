/**
 * The browser talks only to the backend of the IDE (its own origin: the gateways answer no CORS). A gateway's URL, as
 * the backend reaches it, goes in the path: {IDE}/gw/{base64url of the URL}/{rest of the path}
 * (docs/DATA_GATEWAY.md §11.9). The same for REST, MCP and the upgrade of a WebSocket.
 */

const base64url = (text: string) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** The URL of a gateway (http, https, ws or wss) through the backend of the IDE */
export const viaProxy = (target: string): string => {
	const url = new URL(target.trim())
	const secure = url.protocol === 'https:' || url.protocol === 'wss:'
	const socket = url.protocol === 'ws:' || url.protocol === 'wss:'
	// the backend reaches it by HTTP (it upgrades a WebSocket itself): the target is always http(s)
	const http = `${secure ? 'https' : 'http'}://${url.host}${url.pathname.replace(/\/+$/, '')}`
	// the desktop app gives the base of its local proxy (with its token); the web image, the page itself
	const base = (window as { ideDesktop?: { proxyBase?: string } }).ideDesktop?.proxyBase ?? document.baseURI
	const proxy = new URL(`gw/${base64url(http)}`, base)
	if (socket) proxy.protocol = proxy.protocol === 'https:' ? 'wss:' : 'ws:'
	return proxy.toString()
}

/** A failure of the backend reaching the gateway (its 502 / 504), or of the browser reaching the backend */
export const unreachable = (e: any) => e?.status === 502 || e?.status === 504 || e?.message === 'Failed to fetch'

/** The backend refused the target (403 ForbiddenTargetError: not in DATA_GATEWAY_IDE_TARGETS) */
export const forbiddenTarget = (e: any) => e?.error === 'ForbiddenTargetError'
