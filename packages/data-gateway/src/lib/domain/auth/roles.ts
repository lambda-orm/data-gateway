import { GatewayError } from '../errors/gatewayError'
import { RoleConfig } from '../config/dataGatewayConfig'
import { Permission } from './permission'

/**
 * A role as it applies in one schema (docs/ROLE_SCOPES.md): where it may work and what it may do there. Its views and
 * stages, when it doesn't name them, are the ones of the schema (SCHEMA_DEFAULT).
 */
export interface RoleGrant {
	role: string
	permissions: Permission[]
	/** the first, the one of who doesn't choose; undefined: the one of the schema */
	views?: string[]
	stages?: string[]
	maxRows?: number
	approval?: 'writes'
	/** any: its permissions count whatever was chosen */
	scope?: 'any'
}

/** The permissions of the commands of a stage: they count in the stages of their role, whatever the view */
const STAGE_COMMANDS: Permission[] = ['ddl', 'destructive', 'stageImport']
/** The permissions of the administration: they don't depend on the view nor the stage */
const ADMINISTRATION: Permission[] = ['schemaRead', 'schemaWrite', 'schemaAdmin', 'workbenchWrite', 'build', 'sessionAdmin', 'approve', 'roles']

/** In a list of views or stages: the one of the schema (a role without views extended with some keeps it) */
export const SCHEMA_DEFAULT = '@schema'

/** The role of a configuration, as a grant (view, as before 4.4, is views: [view]) */
export const grantOf = (role: string, config: Partial<RoleConfig>): RoleGrant => {
	const views = config.views ?? (config.view ? [config.view] : undefined)
	return {
		role,
		permissions: [...(config.permissions ?? [])],
		...(views ? { views: [...views] } : {}),
		...(config.stages ? { stages: [...config.stages] } : {}),
		...(config.maxRows !== undefined ? { maxRows: config.maxRows } : {}),
		...(config.approval ? { approval: config.approval } : {}),
		...(config.scope ? { scope: config.scope } : {})
	}
}

const union = (first: string[] | undefined, then: string[] | undefined): string[] | undefined => {
	if (first === undefined) return then
	// a level that names its views is first (its first is the default); a base without them keeps the schema's
	return [...new Set([...first, ...(then ?? [SCHEMA_DEFAULT])])]
}

/**
 * A role extended by a more specific level (docs/ROLE_SCOPES.md §5): its permissions, views and stages added (nothing
 * of the base is taken away), the default and the limits of the extension when it says them.
 */
export const extendGrant = (base: RoleGrant | undefined, extension: Partial<RoleConfig>, role: string): RoleGrant => {
	const more = grantOf(role, extension)
	if (!base) return more
	return {
		role,
		permissions: [...new Set([...base.permissions, ...more.permissions])],
		...(union(more.views, base.views) ? { views: union(more.views, base.views) } : {}),
		...(union(more.stages, base.stages) ? { stages: union(more.stages, base.stages) } : {}),
		...((more.maxRows ?? base.maxRows) !== undefined ? { maxRows: more.maxRows ?? base.maxRows } : {}),
		...((more.approval ?? base.approval) ? { approval: more.approval ?? base.approval } : {}),
		...((more.scope ?? base.scope) ? { scope: more.scope ?? base.scope } : {})
	}
}

/** What the schema says when nobody chooses (orm.schemas[].view and stage) and what it has */
export interface SchemaScope {
	/** the view of who doesn't have one: undefined, default (the domain) */
	view?: string
	/** the stage of who doesn't have one: undefined, the first of stages */
	stage?: string
	stages: string[]
	/** authorization.stages open: a stage no role names may be chosen (as before 4.4) */
	openStages?: boolean
}

/** What a request may do, once its view and its stage are chosen */
export interface Scope {
	permissions: Permission[]
	/** the view of λORM ('default': the domain) */
	view: string
	stage: string
	maxRows?: number
	approval?: 'writes'
	/** the roles that gave it */
	roles: string[]
}

const viewsOf = (grant: RoleGrant, schema: SchemaScope): string[] =>
	(grant.views ?? [SCHEMA_DEFAULT]).map(v => v === SCHEMA_DEFAULT ? schema.view ?? 'default' : v)

const stagesOf = (grant: RoleGrant, schema: SchemaScope): string[] =>
	schema.openStages && !grant.stages ? schema.stages : (grant.stages ?? [SCHEMA_DEFAULT]).map(s => s === SCHEMA_DEFAULT ? schema.stage ?? schema.stages[0] : s)

/** the one asked for, if the roles allow it; else the default of the roles (or of the schema when they don't agree) */
const choose = (what: 'view' | 'stage', asked: string | undefined, lists: string[][], schemaDefault: string | undefined, principal: string): string => {
	const allowed = [...new Set(lists.flat())]
	if (asked !== undefined && asked !== '') {
		if (!allowed.includes(asked)) {
			throw new GatewayError(403, 'ForbiddenError', `"${principal}" may not use the ${what} "${asked}" (${allowed.join(', ') || 'none'})`)
		}
		return asked
	}
	const defaults = [...new Set(lists.filter(l => l.length).map(l => l[0]))]
	if (defaults.length === 1) return defaults[0]
	if (schemaDefault !== undefined && allowed.includes(schemaDefault)) return schemaDefault
	throw new GatewayError(403, 'ForbiddenError', `"${principal}" must choose a ${what}: ${allowed.join(', ')}`)
}

/**
 * The view and the stage of a request and what it may do there (docs/ROLE_SCOPES.md §3, §4): what the client asks for
 * only among what its roles allow, and the permissions of the roles that allow both (not the sum of all of them).
 */
export const resolveScope = (principal: string, grants: RoleGrant[], asked: { view?: string, stage?: string }, schema: SchemaScope): Scope => {
	const scoped = grants.filter(g => g.scope !== 'any')
	const considered = scoped.length ? scoped : grants
	// the stage first; then the view among the roles that allow that stage (a role of another stage doesn't decide it)
	const stage = choose('stage', asked.stage, considered.map(g => stagesOf(g, schema)), schema.stage ?? schema.stages[0], principal)
	const inThatStage = considered.filter(g => stagesOf(g, schema).includes(stage))
	const view = choose('view', asked.view, (inThatStage.length ? inThatStage : considered).map(g => viewsOf(g, schema)), schema.view ?? 'default', principal)
	const inStage = (g: RoleGrant) => g.scope === 'any' || stagesOf(g, schema).includes(stage)
	const matching = grants.filter(g => g.scope === 'any' || (viewsOf(g, schema).includes(view) && inStage(g)))
	const limits = matching.filter(g => g.scope !== 'any').map(g => g.maxRows)
	// the data in the view and the stage chosen; the commands of a stage in that stage (they see the whole schema); the
	// administration, whatever was chosen
	const permissions = new Set<Permission>()
	for (const g of grants) {
		for (const p of g.permissions) {
			if (ADMINISTRATION.includes(p) || (STAGE_COMMANDS.includes(p) && inStage(g)) || matching.includes(g)) permissions.add(p)
		}
	}
	return {
		permissions: [...permissions],
		view,
		stage,
		// a role without a limit doesn't limit; with them all limited, the largest
		...(limits.length && limits.every(l => l !== undefined) ? { maxRows: Math.max(...(limits as number[])) } : {}),
		...(matching.some(g => g.approval === 'writes') ? { approval: 'writes' as const } : {}),
		roles: matching.map(g => g.role)
	}
}
