import { RequestContext } from '../ports/input/dataGatewayPort'

/**
 * The options of λORM that the gateway decides, never the client: the view (what of the domain it sees and how it is
 * masked) and the context (what the row filters of the views, the defaults and the conditions read). A client that
 * chose them could skip what a view hides or read the rows of another tenant, so they are dropped from what it sends: the
 * context comes from the identity (JWT/OIDC: the claims of its token) and the view from its key or its roles. The
 * stage and the view the client asked for were chosen among those of its roles before (docs/ROLE_SCOPES.md §3), and
 * allowDestructive is the permission destructive, never an option.
 */
export const GATEWAY_OPTIONS = ['view', 'context', 'stage', 'allowDestructive'] as const

/**
 * The options of a λORM operation as the gateway passes them: without the view and the context of the client
 * (GATEWAY_OPTIONS); with the context of the identity (the claims of its token, docs/JWT.md) and the actor of the
 * request, that λORM puts in enduser.id, in the variable user of its trace rules and in its schema.change. Both are
 * always the gateway's: what the client sends is replaced, so nobody can pass for another nor read another's rows.
 */
export const requestOptions = <T extends object> (options: T | string | undefined, ctx: RequestContext, view?: string): T & { actor?: unknown } => {
	const parsed = typeof options === 'string' ? JSON.parse(options) : { ...(options ?? {}) }
	// a principal not scoped (a use case called by a test) keeps the stage it asked for
	const stage = ctx.principal.stage ?? parsed.stage
	for (const name of GATEWAY_OPTIONS) delete parsed[name]
	// the most rows: the client may ask for fewer than its roles allow, never more
	const limit = ctx.principal.maxRows
	if (limit !== undefined) {
		const asked = Number(parsed.maxRows)
		parsed.maxRows = Number.isFinite(asked) && asked > 0 ? Math.min(asked, limit) : limit
	}
	// the view: the one the gateway chose for who calls (ViewResolver, docs/VIEWS_BY_IDENTITY.md)
	const result = { ...parsed, actor: ctx.principal.actor, context: ctx.principal.context, view, stage }
	for (const name of ['actor', 'context', 'view', 'stage']) if (result[name] === undefined) delete result[name]
	return result
}
