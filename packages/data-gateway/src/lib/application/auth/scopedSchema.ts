import { Principal } from '../../domain/auth/principal'
import { resolveScope, SchemaScope } from '../../domain/auth/roles'
import { CommandOperation, CONTEXT_FREE_OPERATIONS, GATEWAY_OPERATIONS, MCP_OPERATIONS } from '../../domain/runtime/channelProtocol'
import { DataGatewayPort, RequestContext, ScopeInfo } from '../ports/input/dataGatewayPort'
import { McpServerPort } from '../ports/input/mcpServerPort'
import { grantsFor } from './roleCatalog'

/** What the client asked for: its view and its stage (in the options of its request, or the stage of a command) */
export interface Asked { view?: string, stage?: string }

const optionsOf = (raw: unknown): Record<string, unknown> => {
	if (typeof raw === 'string') {
		try { return JSON.parse(raw) ?? {} } catch { return {} }
	}
	return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
}
const text = (value: unknown): string | undefined => typeof value === 'string' && value !== '' ? value : undefined

const askedIn = (options: unknown): Asked => {
	const o = optionsOf(options)
	return { ...(text(o.view) ? { view: text(o.view) } : {}), ...(text(o.stage) ? { stage: text(o.stage) } : {}) }
}

/** The operations of the facade whose first argument after ctx is a stage */
const STAGE_OPERATIONS = ['stageExists', 'stageExport', 'stageImport']

/** what an operation of the facade asks for */
export const askedOf = (op: string, args: unknown[]): Asked => {
	if (STAGE_OPERATIONS.includes(op)) return text(args[0]) ? { stage: text(args[0]) } : {}
	if (op === 'query') return askedIn((args[1] as { options?: unknown } | undefined)?.options)
	return askedIn((args[0] as { options?: unknown } | undefined)?.options)
}

/**
 * The scope of the requests of a schema (docs/ROLE_SCOPES.md §3, §4): with the grants of who calls (its roles in this
 * schema), the view and the stage it asked for among the ones they allow (or theirs by default), and its permissions
 * those of the roles that allow both. Idempotent: a scoped principal keeps its grants.
 */
export class ScopeResolver {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly schema: () => SchemaScope) {}

	public principal (who: Principal, asked: Asked): Principal {
		const grants = grantsFor(who, () => [])
		const scope = resolveScope(who.name, grants, asked, this.schema())
		const rest: Record<string, unknown> = { ...who }
		delete rest.maxRows
		delete rest.approval
		return {
			...rest as unknown as Principal,
			grants,
			permissions: new Set(scope.permissions),
			view: scope.view,
			stage: scope.stage,
			...(scope.maxRows !== undefined ? { maxRows: scope.maxRows } : {}),
			...(scope.approval ? { approval: scope.approval } : {})
		}
	}

	/** where who calls works without choosing, and every view and stage its roles let it choose */
	public describe (who: Principal): ScopeInfo {
		const grants = grantsFor(who, () => [])
		const schema = this.schema()
		const scope = resolveScope(who.name, grants, {}, schema)
		const views = [...new Set(grants.flatMap(g => (g.views ?? ['@schema']).map(v => v === '@schema' ? schema.view ?? 'default' : v)))]
		const stages = schema.openStages ? schema.stages : [...new Set(grants.flatMap(g => (g.stages ?? ['@schema']).map(v => v === '@schema' ? schema.stage ?? schema.stages[0] : v)))]
		return { view: scope.view, stage: scope.stage, views, stages, permissions: scope.permissions, roles: [...(who.roles ?? [])], ...(scope.maxRows !== undefined ? { maxRows: scope.maxRows } : {}) }
	}

	public ctx (ctx: RequestContext, asked: Asked): RequestContext {
		return { ...ctx, principal: this.principal(ctx.principal, asked) }
	}
}

/** The facade of a schema with the scope of each request; a stage operation without a stage gets the chosen one */
export const scopedGateway = (gateway: DataGatewayPort, scopes: ScopeResolver): DataGatewayPort => {
	const scoped = new Map<string, unknown>()
	scoped.set('scope', async (ctx: RequestContext) => scopes.describe(ctx.principal))
	for (const op of GATEWAY_OPERATIONS) {
		if (CONTEXT_FREE_OPERATIONS.includes(op) || op === 'scope') continue
		scoped.set(op, async (ctx: RequestContext, ...args: unknown[]) => {
			const inScope = scopes.ctx(ctx, askedOf(op, args))
			const rest = STAGE_OPERATIONS.includes(op) ? [inScope.principal.stage, ...args.slice(1)] : args
			return (gateway as any)[op](inScope, ...rest)
		})
	}
	return new Proxy(gateway, { get: (target, key, receiver) => typeof key === 'string' && scoped.has(key) ? scoped.get(key) : Reflect.get(target, key, receiver) })
}

/** The MCP server of a schema: an agent doesn't choose, its roles' defaults (docs/ROLE_SCOPES.md decision 6) */
export const scopedMcp = (mcp: McpServerPort, scopes: ScopeResolver): McpServerPort => {
	const scoped = new Map<string, unknown>()
	for (const op of MCP_OPERATIONS) scoped.set(op, async (ctx: RequestContext, ...args: unknown[]) => (mcp as any)[op](scopes.ctx(ctx, {}), ...args))
	return new Proxy(mcp, { get: (target, key, receiver) => typeof key === 'string' && scoped.has(key) ? scoped.get(key) : Reflect.get(target, key, receiver) })
}

/** The commands that take a stage as their first argument (fetch, push, migrate, export…) */
const STAGELESS_COMMANDS: CommandOperation[] = ['stages', 'outboxList', 'outboxRetry', 'introspectSchema', 'approvalsList', 'approve', 'reject']

/** The commands of a workspace: a command of a stage only in a stage of the roles of who runs it */
export const scopedCommands = <T extends { run (ctx: RequestContext, op: CommandOperation, args: unknown[]): Promise<unknown> }>(commands: T, scopes: ScopeResolver): T => {
	const run = (ctx: RequestContext, op: CommandOperation, args: unknown[]): Promise<unknown> => {
		try {
			if (STAGELESS_COMMANDS.includes(op)) return commands.run(scopes.ctx(ctx, {}), op, args)
			const inScope = scopes.ctx(ctx, text(args[0]) ? { stage: text(args[0]) } : {})
			return commands.run(inScope, op, [inScope.principal.stage, ...args.slice(1)])
		} catch (error) {
			return Promise.reject(error)
		}
	}
	return new Proxy(commands, { get: (target, key, receiver) => key === 'run' ? run : Reflect.get(target, key, receiver) })
}
