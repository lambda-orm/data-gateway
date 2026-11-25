import { RequestContext } from '../ports/input/dataGatewayPort'

/**
 * The options of λORM that the gateway decides, never the client: the view (what of the domain it sees and how it is
 * masked) and the context (what the row filters of the views, the defaults and the conditions read). A client that
 * chose them could skip what a view hides or read the rows of another tenant, so they are dropped from what it sends;
 * until the gateway takes them from the identity (JWT/OIDC, the view per credential) λORM runs without them.
 */
export const GATEWAY_OPTIONS = ['view', 'context'] as const

/**
 * The options of a λORM operation as the gateway passes them: without the view and the context of the client
 * (GATEWAY_OPTIONS), and with the actor of the request, that λORM puts in enduser.id, in the variable user of its trace
 * rules and in its schema.change. The actor is always the gateway's: one sent by the client is replaced, so nobody can
 * pass for another.
 */
export const requestOptions = <T extends object> (options: T | string | undefined, ctx: RequestContext): T & { actor?: unknown } => {
	const parsed = typeof options === 'string' ? JSON.parse(options) : { ...(options ?? {}) }
	for (const name of GATEWAY_OPTIONS) delete parsed[name]
	const result = { ...parsed, actor: ctx.principal.actor }
	if (result.actor === undefined) delete result.actor
	return result
}
