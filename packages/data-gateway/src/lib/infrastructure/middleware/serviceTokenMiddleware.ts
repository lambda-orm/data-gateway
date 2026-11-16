import { timingSafeEqual } from 'crypto'

/**
 * Requires "Authorization: Bearer <token>" on every request but the open paths (health checks): 401 otherwise.
 * The comparison takes the same time whatever the token sent (no timing leak).
 */
export const serviceToken = (token: string, openPaths: string[] = []) => {
	const expected = Buffer.from(token)
	return (req: any, res: any, next: any) => {
		if (openPaths.includes(req.path)) return next()
		const header = String(req.headers.authorization || '')
		const sent = Buffer.from(header.startsWith('Bearer ') ? header.substring(7) : '')
		if (sent.length === expected.length && timingSafeEqual(sent, expected)) return next()
		res.status(401).json({ error: 'Unauthorized', message: 'a valid service token is required (Authorization: Bearer <token>)' })
	}
}
