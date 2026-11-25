import WebSocket from 'ws'
import { Principal } from '../../../domain/auth/principal'

/** The code a connection is closed with when the token it was opened with expires: connect again with a new one */
export const CREDENTIAL_EXPIRED = 4401

/** setTimeout takes up to 2^31-1 ms (~24.8 days): a later end is waited for in steps */
const MAX_DELAY = 2_147_483_647

/**
 * A connection doesn't outlive its credential (docs/JWT.md §3): when the token it was opened with expires (its exp) it
 * is closed with 4401. A credential without an end (an API key) leaves it as it is.
 */
export const closeWhenExpired = (ws: WebSocket, principal: Principal, now: () => number = Date.now): void => {
	if (principal.expiresAt === undefined) return
	const expiresAt = principal.expiresAt
	let timer: NodeJS.Timeout | undefined
	const wait = () => {
		const left = expiresAt - now()
		if (left <= 0) {
			if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(CREDENTIAL_EXPIRED, 'the token expired: connect again with a new one')
			return
		}
		timer = setTimeout(wait, Math.min(left, MAX_DELAY))
		timer.unref?.()
	}
	wait()
	ws.once('close', () => { if (timer) clearTimeout(timer) })
}
