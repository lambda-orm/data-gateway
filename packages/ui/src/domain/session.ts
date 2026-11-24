/**
 * Where the workspace of a person was: its tabs (what each one shows, and the text of the queries as it was typed),
 * the active one, what is unfolded in the explorer and whether the explorer is hidden. Kept by the gateway for each
 * credential (or in the browser) so that a reload, or another browser, starts where it was.
 */
export interface SessionTab {
	kind: string
	title: string
	schema?: string
	savedId?: string
	parentId?: string
	/** a query tab: its content as it was typed */
	initial?: Record<string, unknown>
	entity?: string
	draft?: unknown
	/** a query written by the query wizard: the wizard as it was left */
	wizard?: unknown
	focus?: unknown
	file?: string
	page?: string
	stage?: string
	/** a diagram of a stage: how it was left */
	stageView?: unknown
}

export interface WorkspaceSession {
	version: 1
	tabs: SessionTab[]
	/** the index of the active tab */
	active: number
	expanded: string[]
	collapsed: boolean
}

const KINDS = ['query', 'domain', 'entity', 'diagram', 'schemaFile', 'schema', 'element', 'file', 'page', 'stageDiagram']

/** A session read back, kept only in what it can be: tabs of known kinds, an active one among them */
export const readSession = (value: unknown): WorkspaceSession | undefined => {
	const s = value as any
	if (!s || typeof s !== 'object' || s.version !== 1 || !Array.isArray(s.tabs)) return undefined
	const tabs = s.tabs.filter((t: any) => t && typeof t === 'object' && KINDS.includes(t.kind) && typeof t.title === 'string')
	return {
		version: 1,
		tabs,
		active: Number.isInteger(s.active) && s.active >= 0 && s.active < tabs.length ? s.active : 0,
		expanded: Array.isArray(s.expanded) ? s.expanded.filter((k: unknown) => typeof k === 'string') : [],
		collapsed: s.collapsed === true
	}
}
