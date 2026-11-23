import express from 'express'
import { Authenticated, SessionService } from '../../../application/session/sessionService'
import { AuthenticatorPort } from '../../../application/ports/output/supportPorts'
import { SessionClient } from '../../../domain/session/session'
import { ClientAddress } from './clientAddress'
import { toHttpError } from './httpErrors'
import { badRequest, notFound } from '../../../domain/errors/gatewayError'

/** The header of the token of a session (a WebSocket from a browser sends it in its subprotocols: phase 2) */
export const SESSION_HEADER = 'x-data-gateway-session'

export interface SessionDeps {
	service: SessionService
	/** the authentication of management (its own, or the global one): what a login checks */
	authenticator: AuthenticatorPort
	address: ClientAddress
	/** the timers of the WebSocket of events (tests make them short) */
	events?: { pingMs?: number, presenceMs?: number, checkMs?: number }
}

const ipOf = (req: express.Request, address: ClientAddress) => address.of(req.socket.remoteAddress, req.headers['x-forwarded-for'])

const tokenOf = (req: express.Request): string | undefined => {
	const value = req.headers[SESSION_HEADER]
	const token = Array.isArray(value) ? value[0] : value
	return token?.trim() || undefined
}

/**
 * The authentication of management: a valid session, else the 401 that says why (required, expired, revoked). The
 * principal of the session goes on as the one of the request; the session too (res.locals.session).
 */
export const sessionAuthentication = (deps: SessionDeps, open: string[]): express.RequestHandler =>
	(req, res, next) => {
		if (open.includes(req.path)) return next()
		try {
			const auth = deps.service.authenticate(tokenOf(req), ipOf(req, deps.address))
			res.locals.principal = auth.principal
			res.locals.session = auth
			next()
		} catch (error) {
			const httpError = toHttpError(error)
			res.status(httpError.status).json(httpError.body)
		}
	}

const clientOf = (body: any, userAgent: string | undefined): SessionClient | undefined => {
	const raw = body && typeof body === 'object' && body.client && typeof body.client === 'object' ? body.client : {}
	const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : undefined
	const client: SessionClient = {}
	for (const key of ['app', 'version', 'kind'] as const) {
		const value = text(raw[key])
		if (value) client[key] = value
	}
	if (userAgent) client.userAgent = userAgent.slice(0, 300)
	return Object.keys(client).length ? client : undefined
}

/**
 * {basePath}/sessions of management (docs/DATA_GATEWAY_SESSIONS_PLAN.md §3): the login with the credential, and with a
 * session its own, its logout, the list and the revocations.
 */
export const sessionRouter = (deps: SessionDeps): express.Router => {
	const router = express.Router()
	const authenticate = sessionAuthentication(deps, [])
	const auth = (res: express.Response) => res.locals.session as Authenticated
	const handle = (status: number, action: (req: express.Request, res: express.Response) => unknown) =>
		async (req: express.Request, res: express.Response) => {
			try {
				const result = await action(req, res)
				if (result === undefined) res.status(204).end()
				else res.status(status).json(result)
			} catch (error) {
				const httpError = toHttpError(error)
				res.status(httpError.status).json(httpError.body)
			}
		}

	// the login: the credential as every transport takes it (X-Api-Key, Bearer, Basic), never in the body
	router.post('/', handle(201, async req => {
		const ip = ipOf(req, deps.address)
		const result = await deps.authenticator.authenticate(req.headers)
		if (!result.valid || !result.principal) {
			deps.service.rejected(result.reason ?? 'invalid credential', ip)
			return Promise.reject(Object.assign(new Error(result.reason ?? 'a valid credential is required'), { status: 401, name: 'UnauthorizedError' }))
		}
		const login = deps.service.login(result.principal, clientOf(req.body, req.headers['user-agent']), ip)
		const { session } = login
		return {
			id: session.id,
			token: login.token,
			credential: session.credential,
			permissions: session.permissions,
			createdAt: session.createdAt,
			idleTimeoutMs: login.idleTimeoutMs,
			expiresAt: session.expiresAt
		}
	}))
	router.get('/current', authenticate, handle(200, (_req, res) => deps.service.current(auth(res))))
	router.delete('/current', authenticate, handle(204, (_req, res) => { deps.service.logout(auth(res)) }))
	router.get('/', authenticate, handle(200, (req, res) => deps.service.list(auth(res), req.query.all === 'true')))
	// every session of a credential: ?credential=name (&except=current to keep the caller's own)
	router.delete('/', authenticate, handle(200, (req, res) => {
		const credential = typeof req.query.credential === 'string' ? req.query.credential : ''
		if (!credential) throw badRequest('ValidationError', 'say whose sessions: ?credential=name (&except=current)')
		return deps.service.revokeCredential(auth(res), credential, req.query.except === 'current')
	}))
	router.delete('/:id', authenticate, handle(204, (req, res) => {
		const id = String(req.params.id)
		if (id === 'current') throw notFound('DELETE /sessions/current is the logout')
		deps.service.revoke(auth(res), id)
	}))
	return router
}
