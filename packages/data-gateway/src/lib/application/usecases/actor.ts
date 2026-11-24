import { RequestContext } from '../ports/input/dataGatewayPort'

/**
 * The options of a λORM operation with the actor of the request: λORM puts it in enduser.id, in the variable user of
 * its trace rules and in its schema.change. Always the gateway's: an actor sent by the client is replaced, so nobody
 * can pass for another.
 */
export const withActor = <T extends object> (options: T | string | undefined, ctx: RequestContext): T & { actor?: unknown } => {
	const parsed = typeof options === 'string' ? JSON.parse(options) : { ...(options ?? {}) }
	const result = { ...parsed, actor: ctx.principal.actor }
	if (result.actor === undefined) delete result.actor
	return result
}
