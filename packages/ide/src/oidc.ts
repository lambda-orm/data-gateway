/**
 * The login of a connection with the identity provider of its gateway (docs/OIDC_LOGIN.md §2): OpenID Connect, the code
 * flow with PKCE (S256: no secret in the browser). The browser opens the login in a window of its own that comes back to
 * oidc-callback.html; the desktop app, in the browser of the system that comes back to a loopback of the app (RFC 8252).
 * The tokens stay in the tab; the refresh token renews the access token before it ends.
 */
import { viaProxy } from './proxy'

export interface OidcSettings {
	issuer: string
	clientId: string
	/** space separated; openid is always asked for */
	scopes?: string
}

export interface OidcTokens {
	access: string
	refresh?: string
	id?: string
	/** epoch ms */
	expiresAt: number
	/** who signed in (preferred_username, else sub) */
	user?: string
}

interface Discovery { authorization_endpoint: string, token_endpoint: string, end_session_endpoint?: string }

/** The desktop app: its loopback and the browser of the system (preload.cjs) */
interface DesktopOidc {
	oidcStart: () => Promise<{ redirectUri: string }>
	oidcOpen: (url: string) => Promise<void>
	oidcWait: () => Promise<string>
}
const desktop = (): DesktopOidc | undefined => {
	const d = (window as { ideDesktop?: Partial<DesktopOidc> }).ideDesktop
	return d?.oidcStart && d.oidcOpen && d.oidcWait ? d as DesktopOidc : undefined
}

/** the IdP through the backend of the IDE (its CSP lets the page reach only its origin): in the web image, its origin
 * must be in DATA_GATEWAY_IDE_TARGETS; the desktop app reaches any */
const reach = (url: string) => viaProxy(url)

// ─── SHA-256 (crypto.subtle needs a secure context: an IDE on plain http over the network has none) ───────────────
const K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
	0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])
export const sha256 = (bytes: Uint8Array): Uint8Array => {
	const length = bytes.length
	const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6)
	padded.set(bytes)
	padded[length] = 0x80
	const view = new DataView(padded.buffer)
	view.setUint32(padded.length - 4, length * 8)
	view.setUint32(padded.length - 8, Math.floor(length / 0x20000000))
	const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
	const w = new Uint32Array(64)
	const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
	for (let offset = 0; offset < padded.length; offset += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
		}
		let [a, b, c, d, e, f, g, hh] = h
		for (let i = 0; i < 64; i++) {
			const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0
			const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
			hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
		}
		h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh
	}
	const out = new Uint8Array(32)
	const outView = new DataView(out.buffer)
	h.forEach((v, i) => outView.setUint32(i * 4, v))
	return out
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)))
/** the challenge of a verifier (RFC 7636 S256) */
export const challengeOf = (verifier: string) => base64url(sha256(new TextEncoder().encode(verifier)))

const discoveries = new Map<string, Promise<Discovery>>()
const discover = (issuer: string): Promise<Discovery> => {
	const key = issuer.replace(/\/+$/, '')
	let found = discoveries.get(key)
	if (!found) {
		found = fetch(reach(`${key}/.well-known/openid-configuration`)).then(async r => {
			if (!r.ok) throw new Error(`${key}: its OpenID configuration answered ${r.status}`)
			return r.json()
		})
		found.catch(() => discoveries.delete(key))
		discoveries.set(key, found)
	}
	return found
}

const claimsOf = (jwt?: string): Record<string, any> => {
	try { return JSON.parse(decodeURIComponent(escape(atob(jwt!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))) } catch { return {} }
}

const tokensOf = (body: any, previous?: OidcTokens): OidcTokens => {
	if (typeof body?.access_token !== 'string') throw new Error(body?.error_description ?? body?.error ?? 'the identity provider gave no token')
	const claims = claimsOf(body.id_token ?? body.access_token)
	return {
		access: body.access_token,
		refresh: body.refresh_token ?? previous?.refresh,
		id: body.id_token ?? previous?.id,
		expiresAt: Date.now() + Number(body.expires_in ?? 300) * 1000,
		user: claims.preferred_username ?? claims.email ?? claims.sub ?? previous?.user
	}
}

const tokenRequest = async (settings: OidcSettings, form: Record<string, string>, previous?: OidcTokens): Promise<OidcTokens> => {
	const { token_endpoint: endpoint } = await discover(settings.issuer)
	const response = await fetch(reach(endpoint), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: settings.clientId, ...form }) })
	return tokensOf(await response.json().catch(() => ({})), previous)
}

/** the answer of the login window in the browser: the query string of oidc-callback.html, from the same origin */
const waitForWindow = (popup: Window | null): Promise<string> => new Promise((resolve, reject) => {
	if (!popup) { reject(new Error('the browser blocked the window of the login: allow it for the IDE')); return }
	const done = (fn: () => void) => { window.removeEventListener('message', listen); clearInterval(closed); fn() }
	const listen = (event: MessageEvent) => {
		if (event.origin !== window.location.origin || event.data?.type !== 'lambdaorm-oidc') return
		done(() => resolve(String(event.data.search ?? '')))
	}
	const closed = setInterval(() => { if (popup.closed) done(() => reject(new Error('the window of the login was closed'))) }, 500)
	window.addEventListener('message', listen)
})

/** Sign in: the login of the IdP, the code back, exchanged (with its verifier) for the tokens */
export const signIn = async (settings: OidcSettings): Promise<OidcTokens> => {
	const app = desktop()
	// the window opens now, in the click (after an await a browser blocks it), and goes to the login when it is known
	const popup = app ? undefined : window.open('', 'lambdaorm-oidc', 'popup,width=520,height=720')
	let authorize: string
	try {
		authorize = (await discover(settings.issuer)).authorization_endpoint
	} catch (error) {
		popup?.close()
		throw error
	}
	const verifier = random(48)
	const state = random(16)
	const nonce = random(16)
	const redirectUri = app ? (await app.oidcStart()).redirectUri : new URL('oidc-callback.html', document.baseURI).href
	const scopes = new Set(['openid', ...(settings.scopes ?? 'profile').split(/\s+/).filter(Boolean)])
	const url = new URL(authorize)
	for (const [k, v] of Object.entries({ response_type: 'code', client_id: settings.clientId, redirect_uri: redirectUri, scope: [...scopes].join(' '), state, nonce, code_challenge: challengeOf(verifier), code_challenge_method: 'S256' })) url.searchParams.set(k, v)
	let search: string
	if (app) {
		const waiting = app.oidcWait()
		await app.oidcOpen(url.toString())
		search = await waiting
	} else {
		if (popup) popup.location.href = url.toString()
		search = await waitForWindow(popup ?? null)
	}
	const answer = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
	if (answer.get('state') !== state) throw new Error('the answer of the login is not the one asked for (state)')
	if (answer.get('error')) throw new Error(answer.get('error_description') ?? answer.get('error')!)
	const code = answer.get('code')
	if (!code) throw new Error('the login gave no code')
	return tokenRequest(settings, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier })
}

/** a new access token with the refresh token */
export const renew = (settings: OidcSettings, tokens: OidcTokens): Promise<OidcTokens> => {
	if (!tokens.refresh) return Promise.reject(new Error('no refresh token: sign in again'))
	return tokenRequest(settings, { grant_type: 'refresh_token', refresh_token: tokens.refresh }, tokens)
}

/** Sign out: the session of the IdP ends too (its end_session_endpoint), in a window of its own */
export const signOut = async (settings: OidcSettings, tokens: OidcTokens): Promise<void> => {
	const { end_session_endpoint: end } = await discover(settings.issuer).catch(() => ({} as Discovery))
	if (!end) return
	const url = new URL(end)
	url.searchParams.set('client_id', settings.clientId)
	if (tokens.id) url.searchParams.set('id_token_hint', tokens.id)
	const app = desktop()
	if (app) await app.oidcOpen(url.toString())
	else {
		url.searchParams.set('post_logout_redirect_uri', new URL('oidc-callback.html', document.baseURI).href)
		window.open(url.toString(), 'lambdaorm-oidc', 'popup,width=520,height=520')
	}
}
