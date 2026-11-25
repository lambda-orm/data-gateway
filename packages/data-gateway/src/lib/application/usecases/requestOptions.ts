import { RequestContext } from '../ports/input/dataGatewayPort'

/**
 * The options of λORM that the gateway decides, never the client: the view (what of the domain it sees and how it is
 * masked) and the context (what the row filters of the views, the defaults and the conditions read). A client that
 * chose them could skip what a view hides or read the rows of another tenant, so they are dropped from what it sends: the
 * context comes from the identity (JWT/OIDC: the claims of its token); the view, until G2, from nowhere.
 */
export const GATEWAY_OPTIONS = ['view', 'context'] as const

/**
 * The options of a λORM operation as the gateway passes them: without the view and the context of the client
 * (GATEWAY_OPTIONS); with the context of the identity (the claims of its token, docs/JWT.md) and the actor of the
 * request, that λORM puts in enduser.id, in the variable user of its trace rules and in its schema.change. Both are
 * always the gateway's: what the client sends is replaced, so nobody can pass for another nor read another's rows.
 */
export const requestOptions = <T extends object> (options: T | string | undefined, ctx: RequestContext): T & { actor?: unknown } => {
	const parsed = typeof options === 'string' ? JSON.parse(options) : { ...(options ?? {}) }
	for (const name of GATEWAY_OPTIONS) delete parsed[name]
	const result = { ...parsed, actor: ctx.principal.actor, context: ctx.principal.context }
	if (result.actor === undefined) delete result.actor
	if (result.context === undefined) delete result.context
	return result
}
