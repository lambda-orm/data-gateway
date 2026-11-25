import {
	AuthenticationConfig, DataGatewayConfig, RuntimeMode, SchemaOverrides, ScriptsConfig, TransportName
} from '../config/dataGatewayConfig'
import { schemaPathsIssues } from './schemaPath'

/** A schema to serve: its route, its workspace and what it overrides */
export interface SchemaDescriptor {
	path: string
	workspace: string
	/** discovered under orm.workspacePath, or declared in orm.schemas */
	origin: 'discovered' | 'explicit'
	overrides: SchemaOverrides
}

/** A workspace found under orm.workspacePath: its route is its folder relative to it */
export interface DiscoveredSchema {
	path: string
	workspace: string
}

/**
 * Discovered + explicit schemas, with the adjustments (orm.schemas entries without workspace) applied. Problems: an
 * adjustment of a schema that wasn't discovered, duplicated routes, prefixes, the root shared, no schema at all. While the
 * workspaces are watched (orm.watch), no schema and an adjustment of one not there yet are not problems (it may
 * appear): they are `waiting`, to warn about.
 */
export const resolveSchemas = (config: DataGatewayConfig, discovered: DiscoveredSchema[]): { schemas: SchemaDescriptor[], issues: string[], waiting: string[] } => {
	const issues: string[] = []
	const waiting: string[] = []
	const watching = config.orm.watch?.enabled === true
	const schemas: SchemaDescriptor[] = discovered.map(d => ({ path: d.path, workspace: d.workspace, origin: 'discovered', overrides: {} }))
	for (const entry of config.orm.schemas) {
		const { path, workspace, ...overrides } = entry
		if (workspace !== undefined) {
			schemas.push({ path, workspace, origin: 'explicit', overrides })
			continue
		}
		const target = schemas.find(s => s.path === path && s.origin === 'discovered')
		if (!target) {
			const problem = `orm.schemas "${path || '/'}" has no workspace and adjusts no discovered schema (discovered: ${discovered.map(d => d.path || '/').join(', ') || 'none'})`
			;(watching ? waiting : issues).push(problem)
			continue
		}
		target.overrides = { ...target.overrides, ...overrides }
	}
	if (schemas.length === 0) (watching ? waiting : issues).push(`no schema found: ${config.orm.workspacePath ?? 'orm.schemas'} has no lambdaORM.yaml`)
	issues.push(...schemaPathsIssues(schemas.map(s => s.path)))
	return { schemas, issues, waiting }
}

/** What a schema runs with, once schema → transport → global is applied */
export interface SchemaSettings {
	transports: TransportName[]
	scripts: ScriptsConfig
	mcp: { maxRows: number, tools: { include: string[], exclude: string[] } }
	server: { timeout: number, maxConcurrent: number, maxResponseBytes: number }
	runtime: { mode: RuntimeMode, maxMemoryMb: number, checkConnections: boolean }
	/** the view of a caller without one (orm.schemas[].view) */
	view?: string
	/** the views the credentials that reach it name (their keys, their roles): checked when it loads */
	namedViews: string[]
}

/** The views an authentication names: of its keys, of the roles of its tokens, of its methods */
export const viewsOf = (authentication: AuthenticationConfig | undefined): string[] => {
	if (!authentication) return []
	return [
		...authentication.credentials.map(c => c.view),
		...Object.values(authentication.jwt?.principal.permissions?.roles ?? {}).map(r => r.view),
		...(authentication.methods ?? []).flatMap(viewsOf)
	].filter((v): v is string => typeof v === 'string')
}

/** The most specific value replaces (they are not merged): a schema's tools replace the global tools */
export const effectiveSettings = (config: DataGatewayConfig, schema: SchemaDescriptor): SchemaSettings => {
	const o = schema.overrides
	const exposed = Object.keys(config.transports) as TransportName[]
	return {
		// management (the IDE) serves every schema, whatever its transports say
		transports: o.transports ? exposed.filter(t => t === 'management' || o.transports!.includes(t)) : exposed,
		scripts: { ...config.scripts, ...o.scripts },
		mcp: { maxRows: o.mcp?.maxRows ?? config.mcp.maxRows, tools: o.mcp?.tools ?? config.mcp.tools },
		server: {
			timeout: o.server?.timeout ?? config.server.timeout,
			maxConcurrent: o.server?.maxConcurrent ?? config.server.maxConcurrent,
			maxResponseBytes: o.server?.maxResponseBytes ?? config.server.maxResponseBytes
		},
		runtime: {
			mode: o.runtime?.mode ?? config.runtime.schemas,
			maxMemoryMb: o.runtime?.maxMemoryMb ?? config.runtime.maxMemoryMb,
			checkConnections: o.runtime?.checkConnections ?? config.runtime.checkConnections
		},
		...(o.view ? { view: o.view } : {}),
		namedViews: [...new Set([
			...viewsOf(o.authentication ?? config.authentication),
			...Object.values(config.transports).flatMap(t => viewsOf((t as { authentication?: AuthenticationConfig } | undefined)?.authentication))
		])]
	}
}

/** The authentication of a schema in a transport: the schema's, else the transport's, else the global one */
export const effectiveAuthentication = (config: DataGatewayConfig, schema: SchemaDescriptor, transport: TransportName): AuthenticationConfig =>
	schema.overrides.authentication ?? config.transports[transport]?.authentication ?? config.authentication

/** Variables every worker may receive whatever the configuration says (system, Node, Oracle client) */
const BASE_VARIABLES = /^(PATH|HOME|TZ|LANG|LC_[A-Z]+|TMPDIR|NODE_[A-Z0-9_]+|LD_LIBRARY_PATH|ORACLE_[A-Z0-9_]+)$/

/**
 * The environment of a schema worker (docs/DATA_GATEWAY.md §2.3), from lower to higher priority: base variables of the
 * gateway (and runtime.env.passthrough), the .env of the workspace, schemas[].env. With isolate: false, the whole
 * environment of the gateway instead of the base variables (local development).
 */
export const schemaEnv = (
	gatewayEnv: Record<string, string | undefined>,
	dotEnv: Record<string, string>,
	schema: SchemaDescriptor,
	runtimeEnv: { isolate: boolean, passthrough: string[] }
): Record<string, string> => {
	const base: Record<string, string> = {}
	for (const [key, value] of Object.entries(gatewayEnv)) {
		if (value === undefined) continue
		if (!runtimeEnv.isolate || BASE_VARIABLES.test(key) || runtimeEnv.passthrough.includes(key)) base[key] = value
	}
	return { ...base, ...dotEnv, ...schema.overrides.env }
}

/** UV_THREADPOOL_SIZE: configured, or max(4, 2 × schemas in threads) up to 64 */
export const threadpoolSize = (configured: number | undefined, threadSchemas: number): number =>
	configured ?? Math.min(64, Math.max(4, 2 * threadSchemas))
