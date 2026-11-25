import { HistoryView } from './HistoryView'
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { QueryApiPort, SchemaInfo, SessionStorePort, WorkspaceStore, WorkspaceChangeEvent } from '../application/ports'
import { readSession, WorkspaceSession } from '../domain/session'
import { BrowserSessionStore, FallbackSessionStore, GatewaySessionStore } from '../infrastructure/sessionStores'
import { WorkspaceController, WorkspaceState } from '../application/workspaceController'
import { DomainInfo, edgesOf } from '../domain/diagram'
import { explorerMessagesOf } from '../domain/explorerI18n'
import { messagesOf } from '../domain/i18n'
import { toYaml } from '../domain/results'
import { DiagramDetail, SavedDiagram, SavedItem, SavedQuery, SavedQueryContent, folderPaths, toExport } from '../domain/savedItems'
import { HeadersProvider, RestQueryApi } from '../infrastructure/restQueryApi'
import { IndexedDbWorkspaceStore } from '../infrastructure/workspaceStores'
import { CodeEditor } from './CodeEditor'
import { DiagramDialog, Icons, ItemDialog, NewSchemaDialog, RemoveSchemaDialog } from './dialogs'
import { DomainDiagram } from './DomainDiagram'
import { EntityView } from './EntityView'
import { Explorer, problemText } from './Explorer'
import { QueryWorkbench, QueryWorkbenchProps } from './QueryWorkbench'
import { SchemaEditor } from './SchemaEditor'
import { CommandsPanel } from './CommandsPanel'
import { FormFocus, SchemaForms } from './SchemaForms'
import { FileView } from './FileView'
import { QueryWizard } from './QueryWizard'
import { StageDiagram, StageView } from './StageDiagram'
import { queryOf, WizardReading, WizardState, wizardFromQuery } from '../domain/queryWizard'
import { wizardMessagesOf } from '../domain/wizardI18n'
import { fromYaml } from '../domain/results'
import { RestAdminApi } from '../infrastructure/restAdminApi'
import { GatewayWorkspaceStore } from '../infrastructure/gatewayWorkspaceStore'
import { adminMessagesOf, format } from '../domain/adminI18n'
import { AdminApiPort, AdminCapabilities } from '../application/ports'

export interface WorkspaceProps extends Omit<QueryWorkbenchProps, 'initial' | 'onContentChange' | 'toolbar' | 'initialSchema' | 'schema'> {
	/** Where the saved items are kept; by default IndexedDB of the browser under workspaceKey */
	store?: WorkspaceStore
	/** Separates the saved items (for example the gateway and the user): the same key, the same items */
	workspaceKey?: string
	/** At most this many tabs (default 20) */
	maxTabs?: number
	/**
	 * How often the schemas are read again, in ms (default 5000; 0: never): a schema added, removed or reloaded on the
	 * gateway (orm.watch) shows without reloading the page
	 */
	refreshMs?: number
	/**
	 * The administration of the workspaces (admin.enabled on the gateway): the lambdaORM.yaml editable, new and removed
	 * schemas. By default the gateway's own at {baseUrl}/admin (with the given api, none unless it is given); false: none
	 */
	admin?: AdminApiPort | false
	/**
	 * Where the workspace was (its tabs, what is unfolded), to start there after a reload: by default the gateway keeps it
	 * for the credential (and this browser when the gateway can't); false keeps nothing
	 */
	session?: SessionStorePort | false
	/** Pages of the application shown as tabs (an account, the preferences): their title, icon and content */
	pages?: Record<string, { title: string, icon?: React.ReactNode, render: () => React.ReactNode }>
	/** Opens one of the pages in a tab (or shows the one open): a new value each time, { key, at: Date.now() } */
	openPage?: { key: string, at: number }
	/**
	 * The data-gateways it works with, each with its schemas (an IDE connected to several; the gateway's own UI to the
	 * current one). Without it, one: baseUrl / headers / api / admin / store of these props, and no heading
	 */
	connections?: WorkspaceConnection[]
	/** The root of the connections in the explorer (an IDE): its title and its buttons (add one) */
	/** the root of the connections in the explorer: its title, what goes before it (the menu of the app) and its actions */
	connectionsHeading?: { title: string, lead?: React.ReactNode, actions?: React.ReactNode }
}

/** A data-gateway the workspace is connected to: its workspaces stay in it (the IDE only connects) */
export interface WorkspaceConnection {
	id: string
	name: string
	/** what is shown under its name (its URL) */
	description?: string
	/** the one the page is served by (the gateway's own UI) */
	current?: boolean
	baseUrl?: string
	headers?: HeadersProvider
	api?: QueryApiPort
	admin?: AdminApiPort | false
	/** where its saved items are kept when the gateway doesn't keep them (by default this browser, under workspaceKey) */
	store?: WorkspaceStore
	workspaceKey?: string
	/** buttons of its heading */
	actions?: React.ReactNode
	/** Its page (edit, remove): opened by a click on its name */
	onOpen?: () => void
	/** it can't be reached now: why (its explorer says it) */
	problem?: string
	/**
	 * How its requests are made (by default fetch): the IDE puts its session in them and logs in again when it ends
	 * (docs/DATA_GATEWAY_SESSIONS_PLAN.md). Used by the API, the administration and the store of where it was
	 */
	fetch?: typeof fetch
	/**
	 * The gateway says something changed (its WebSocket of events: schema.statusChanged, workspace.changed): the schemas
	 * and what is saved are read again at once. A subscription; it answers how to unsubscribe
	 */
	changes?: (listener: (event?: WorkspaceChangeEvent) => void) => () => void
	/** How often its schemas are read again while `changes` works (it replaces refreshMs of the workspace) */
	refreshMs?: number
	/** the id of the session of this IDE in the gateway: a change of another session is announced, with a Refresh */
	session?: () => string | undefined
	/** where to see the traces of an entity (Grafana / Tempo filtered by lambdaorm.entity), when the connection has it */
	tracesUrl?: (schema: string, entity: string) => string | undefined
}

/** A flag of this browser (a convenience: without storage it is never set) */
const readFlag = (key: string): boolean => { try { return globalThis.localStorage?.getItem(key) === '1' } catch { return false } }
const writeFlag = (key: string): void => { try { globalThis.localStorage?.setItem(key, '1') } catch { /* no storage */ } }

/** What tells that the schemas changed: their routes, states and the version each serves */
const revisionOf = (schemas: SchemaInfo[]): string => schemas.map(s => `${s.path}|${s.status}|${s.since ?? ''}|${s.pending ?? ''}|${s.reason ?? ''}`).join('\n')

type TabKind = 'query' | 'domain' | 'entity' | 'diagram' | 'schemaFile' | 'schema' | 'element' | 'file' | 'page' | 'stageDiagram'

interface DiagramDraft { entities: string[], positions?: Record<string, { x: number, y: number }>, bends?: Record<string, number>, compact: boolean, detail?: DiagramDetail, relationNames: boolean }

interface Tab {
	id: number
	kind: TabKind
	/** The title of a new query; a saved one takes its name */
	title: string
	schema?: string
	/** The saved query or diagram it shows */
	savedId?: string
	/** The folder a new query is saved in by default */
	parentId?: string
	initial?: Partial<SavedQueryContent>
	/** The entity of an entity tab */
	entity?: string
	/** A saved diagram as it is now on the screen */
	draft?: DiagramDraft
	/** The element of an element tab (an entity, a source, the application section…) */
	focus?: FormFocus
	/** When its form was asked to edit (Edit, not a click to read it): it opens in edit, Cancel and Save */
	editRequest?: number
	/** When its removal was asked (Remove in the view of the element) */
	removeRequest?: number
	/** The file of a file tab (data/…, src/…) */
	file?: string
	/** The stage of a diagram of a stage, and how it was left (turned, what it shows, its boxes moved) */
	stage?: string
	stageView?: StageView
	/** The page of the application of a page tab (account, preferences) */
	page?: string
	/** The connection it belongs to (by default the first) */
	connection?: string
	/** A query written by the wizard: the wizard as it was left, to open it again on the query */
	wizard?: WizardState
	/** The query rewritten in place (by the wizard): its editor starts again with the new text */
	rev?: number
}

/** How a diagram of a stage is shown, as compared: what is not set is the default */
const viewKey = (v: StageView | undefined) => ({ orientation: v?.orientation ?? 'top', detail: v?.detail ?? 'tables', positions: v?.positions ?? {} })

const SAME = (a: SavedQueryContent, b: SavedQueryContent) => a.mode === b.mode && a.query === b.query && a.script === b.script && a.data === b.data && a.options === b.options
const contentOf = (q: SavedQuery): SavedQueryContent => ({ mode: q.mode, query: q.query, script: q.script, data: q.data, options: q.options })
const draftOf = (d: SavedDiagram): DiagramDraft => ({ entities: d.entities, positions: d.positions, bends: d.bends, compact: d.compact ?? false, detail: d.detail ?? (d.compact ? 'name' : 'all'), relationNames: d.relationNames ?? false })
const sameDraft = (a: DiagramDraft, b: DiagramDraft) => a.compact === b.compact && (a.detail ?? 'all') === (b.detail ?? 'all') && a.relationNames === b.relationNames && a.entities.join('\n') === b.entities.join('\n') &&
	JSON.stringify(a.positions ?? null) === JSON.stringify(b.positions ?? null) && JSON.stringify(a.bends ?? null) === JSON.stringify(b.bends ?? null)

const DomainYaml: React.FC<{ domain: () => Promise<DomainInfo>, schema: string, theme: 'light' | 'dark', loading: string, readOnly: string }> = ({ domain, schema, theme, loading, readOnly }) => {
	const [text, setText] = useState<string>()
	useEffect(() => {
		let live = true
		// only the domain: the gateway never gives the sources, connections nor the rest of the schema here
		domain().then(d => { if (live) setText(toYaml(d)) }, e => { if (live) setText(`# ${e?.message ?? e}`) })
		return () => { live = false }
	}, [domain])
	return (
		<div className={`lw-workbench lw-${theme}`}>
			<div className="lw-header"><span className="lw-badge">{readOnly}</span><code>/{schema}</code></div>
			{text === undefined ? <div className="lw-muted">{loading}</div> : <CodeEditor ariaLabel="domain" language="yaml" readOnly value={text} onChange={() => undefined} theme={theme} height="70vh" />}
		</div>
	)
}

/**
 * The explorer of the schemas on the left and the tabs on the right: queries (new or saved, with Save / Save as… and
 * Ctrl+S), the forms of the entities, saved diagrams (boxes placed by hand, saved with their places) and the domain
 * of a schema as YAML, read only. What is saved stays in the browser (IndexedDB) unless another store is given.
 */
const MIN_WIDTH = 180
const MAX_WIDTH = 720
const WIDTH_KEY = 'lambdaorm-ui.explorerWidth'
const clampWidth = (value: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)))
const storedWidth = (): number | undefined => {
	try { const value = Number(window.localStorage.getItem(WIDTH_KEY)); return value > 0 ? clampWidth(value) : undefined } catch { return undefined }
}
const rememberWidth = (value: number) => { try { window.localStorage.setItem(WIDTH_KEY, String(value)) } catch { /* private window */ } }

/** What a connection gives the tabs: its gateway, what it allows, its schemas, its saved items, its domains */
interface Runtime {
	id: string
	api: QueryApiPort
	adminApi?: AdminApiPort
	can?: AdminCapabilities
	controller: WorkspaceController
	state: WorkspaceState
	listed: SchemaInfo[]
	schemas: SchemaInfo[]
	revision: string
	domainOf: (schema: string) => Promise<DomainInfo>
	loaderOf: (schema: string) => () => Promise<DomainInfo>
	pokeSoon: () => void
	/** Read again what was read of a schema (or of all): changed elsewhere, by another IDE or user */
	refresh: (schema?: string) => void
	/** How many times it was refreshed: the forms and views read again when it changes */
	refreshes: number
}

/** What the explorer of a connection asks the workspace to open (the connection is given by the section) */
interface Openers {
	saved: (conn: string, item: SavedItem) => void
	domain: (conn: string, schema: string) => void
	entity: (conn: string, schema: string, entity: string) => void
	newQuery: (conn: string, schema: string, parentId?: string) => void
	newDiagram: (conn: string, schema: string, parentId?: string) => void
	schemaFile: (conn: string, schema: string) => void
	schema: (conn: string, schema: string) => void
	element: (conn: string, schema: string, focus: FormFocus, edit?: boolean) => void
	file: (conn: string, schema: string, file: string) => void
	stageDiagram: (conn: string, schema: string, stage: string) => void
	newSchema: (conn: string) => void
	removeSchema: (conn: string, schema: string) => void
}

/**
 * One data-gateway of the workspace: its API and administration, what its credential may do, its schemas (read again
 * every refreshMs), its saved items (in its workspaces, or this browser), the domains read; its heading and explorer.
 * What it is, it gives the workspace (onRuntime) for the tabs of this connection.
 */
const ConnectionSection: React.FC<{
	spec: WorkspaceConnection
	heading: boolean
	refreshMs: number
	theme: 'light' | 'dark'
	locale?: WorkspaceProps['locale']
	activeId?: string
	expanded?: string[]
	onExpandedChange: (keys: string[]) => void
	open: Openers
	onRuntime: (id: string, runtime: Runtime | undefined) => void
	onNotice: (notice: string) => void
}> = ({ spec, heading, refreshMs: workspaceRefreshMs, theme, locale, activeId, expanded, onExpandedChange, open, onRuntime, onNotice }) => {
	const refreshMs = spec.refreshMs ?? workspaceRefreshMs
	const x = explorerMessagesOf(locale)
	const a = adminMessagesOf(locale)
	const id = spec.id
	const api = useMemo(() => spec.api ?? new RestQueryApi(spec.baseUrl ?? '', spec.headers, spec.fetch), [spec.api, spec.baseUrl, spec.headers, spec.fetch])
	const adminApi = useMemo<AdminApiPort | undefined>(() => spec.admin === false ? undefined : spec.admin ?? (spec.api ? undefined : new RestAdminApi(spec.baseUrl ?? '', spec.headers, spec.fetch)),
		[spec.admin, spec.api, spec.baseUrl, spec.headers, spec.fetch])
	const [can, setCan] = useState<AdminCapabilities>()
	// what the gateway allows is known (or there is no administration): until then nothing saved is read
	const [known, setKnown] = useState(false)
	useEffect(() => {
		setCan(undefined)
		setKnown(!adminApi)
		adminApi?.capabilities().then(setCan, () => setCan(undefined)).finally(() => setKnown(true))
	}, [adminApi])
	// with workbenchWrite what is saved goes to the workspaces of the gateway, shared; without it, to this browser
	const shared = !spec.store && !!adminApi && !!can?.workbenchWrite
	const browserKey = spec.workspaceKey ?? spec.baseUrl ?? 'default'
	const browserStore = useMemo(() => spec.store ?? new IndexedDbWorkspaceStore(browserKey), [spec.store, browserKey])
	const sharedStore = useMemo(() => shared ? new GatewayWorkspaceStore(adminApi!) : undefined, [shared, adminApi])
	const controller = useMemo(() => new WorkspaceController(sharedStore ?? browserStore), [sharedStore, browserStore])
	// what this browser kept before the workspace was shared: offered to copy there
	const [inBrowser, setInBrowser] = useState<SavedItem[]>([])
	useEffect(() => {
		if (!shared) { setInBrowser([]); return }
		if (readFlag(`lambdaorm-ui.copied:${browserKey}`)) return
		browserStore.all().then(items => setInBrowser(items), () => setInBrowser([]))
	}, [shared, browserStore, browserKey])
	const copyToWorkspace = async () => {
		try {
			await controller.importText(JSON.stringify(toExport(inBrowser)), 'merge')
			onNotice(format(a.copiedToWorkspace, { n: inBrowser.length }))
			writeFlag(`lambdaorm-ui.copied:${browserKey}`)
			setInBrowser([])
		} catch (e) { onNotice(problemText(e, x)) }
	}
	const state = useSyncExternalStore(controller.subscribe, controller.getState)
	useEffect(() => { if (known) controller.load() }, [controller, known])
	// someone else saved in the workspace (or a file of workbench/ changed): read again
	useEffect(() => {
		if (!sharedStore) return
		const check = () => { sharedStore.changed().then(changed => { if (changed) controller.load() }, () => undefined) }
		const off = spec.changes?.(check)
		const timer = refreshMs > 0 ? setInterval(check, refreshMs) : undefined
		return () => { off?.(); if (timer) clearInterval(timer) }
	}, [controller, sharedStore, refreshMs, spec.changes])

	// the domain of each schema is read once, for the explorer, the forms, the diagrams and the YAML
	const domains = useRef(new Map<string, Promise<DomainInfo>>())
	const loaders = useRef(new Map<string, () => Promise<DomainInfo>>())
	useEffect(() => { domains.current.clear(); loaders.current.clear() }, [api])
	const domainOf = useCallback((schema: string): Promise<DomainInfo> => {
		let domain = domains.current.get(schema)
		if (!domain) {
			domain = api.domain ? api.domain(schema).then(d => ({ entities: d.entities ?? [], enums: d.enums ?? [] })) : Promise.reject(new Error('this gateway gives no domain'))
			domain.catch(() => domains.current.delete(schema))
			domains.current.set(schema, domain)
		}
		return domain
	}, [api])
	// a stable loader per schema (the components read it in their effects)
	const loaderOf = useCallback((schema: string) => {
		if (!loaders.current.has(schema)) loaders.current.set(schema, () => domainOf(schema))
		return loaders.current.get(schema)!
	}, [domainOf])

	// the explorer also shows the schemas that didn't start, with their reason; the rest of the workspace only the ready ones
	const [listed, setListed] = useState<SchemaInfo[]>([])
	const [poke, setPoke] = useState(0)
	useEffect(() => {
		let current: SchemaInfo[] | undefined
		const read = () => api.schemas().then(all => {
			if (current && revisionOf(all) === revisionOf(current)) return
			// a schema reloaded (another since): its domain is read again by whoever shows it
			for (const s of all) {
				const before = current?.find(c => c.path === s.path)
				if (before && before.since !== s.since) {
					domains.current.delete(s.path)
					loaders.current.delete(s.path)
				}
			}
			current = all
			setListed(all)
		}, () => { if (!current) setListed([]) })
		read()
		// the gateway says it changed (its events): read at once; the timer stays, slower, for when they don't come
		const off = spec.changes?.(read)
		const timer = refreshMs > 0 ? setInterval(read, refreshMs) : undefined
		return () => { off?.(); if (timer) clearInterval(timer) }
	}, [api, refreshMs, poke, spec.changes])
	// a change of another session (another IDE, the CLI through the gateway): said, with a Refresh
	const [remote, setRemote] = useState<{ text: string, schema?: string }>()
	useEffect(() => {
		const off = spec.changes?.(event => {
			const change = event?.change
			if (!change || (change.actor?.session && change.actor.session === spec.session?.())) return
			setRemote({
				text: format(a.remoteChange, { name: change.actor?.credential ?? change.actor?.client ?? '?', target: change.target ?? change.kind, schema: event?.path || '/' }),
				schema: event?.path
			})
		})
		return () => { off?.() }
	}, [spec.changes, spec.session, a])
	const pokeSoon = useCallback(() => { for (const ms of [300, 1500, 4000]) setTimeout(() => setPoke(p => p + 1), ms) }, [])
	// Refresh: the schemas, the domains, what is saved and what the explorer read, again
	const [refreshing, setRefreshing] = useState<{ n: number, schema?: string }>({ n: 0 })
	const refresh = useCallback((schema?: string) => {
		for (const path of [...domains.current.keys()]) if (schema === undefined || path === schema) { domains.current.delete(path); loaders.current.delete(path) }
		setPoke(p => p + 1)
		if (known) controller.load()
		setRefreshing(r => ({ n: r.n + 1, schema }))
	}, [controller, known])
	const revision = useMemo(() => revisionOf(listed), [listed])
	const schemas = useMemo(() => listed.filter(s => s.status === 'ready'), [listed])

	const runtime = useMemo<Runtime>(() => ({ id, api, adminApi, can, controller, state, listed, schemas, revision, domainOf, loaderOf, pokeSoon, refresh, refreshes: refreshing.n }),
		[id, api, adminApi, can, controller, state, listed, schemas, revision, domainOf, loaderOf, pokeSoon, refresh, refreshing.n])
	useEffect(() => { onRuntime(id, runtime) }, [id, runtime, onRuntime])
	useEffect(() => () => onRuntime(id, undefined), [id, onRuntime])

	const [folded, setFolded] = useState(false)
	const loadSchemaDoc = async (schema: string) => fromYaml((await adminApi!.readSchema(schema)).text)
	const loadFiles = (schema: string, dir?: string) => adminApi!.files(schema, dir)
	return (
		<section className="lw-connection" aria-label={spec.name}>
			{heading && (
				<div className="lw-connection-head">
					<button type="button" className="lw-icon-button" aria-expanded={!folded} aria-label={`${folded ? x.showExplorer : x.hideExplorer} ${spec.name}`} onClick={() => setFolded(!folded)}>
						<span className={`lw-chevron ${folded ? '' : 'lw-open'}`} aria-hidden="true"><Icons.chevron /></span>
					</button>
					<span className={spec.problem ? 'lw-connection-icon lw-problem' : 'lw-connection-icon'} title={spec.problem}>{spec.problem ? <Icons.warning /> : <Icons.connection />}</span>
					{(() => {
						const name = (
							<>
								<strong>{spec.name}</strong>{spec.current && <span className="lw-badge">{a.current}</span>}
								{spec.description && <span className="lw-type lw-connection-url">{spec.description}</span>}
							</>
						)
						return spec.onOpen
							? <button type="button" className="lw-connection-name lw-connection-open" title={spec.description} aria-label={spec.name} onClick={spec.onOpen}>{name}</button>
							: <span className="lw-connection-name" title={spec.description}>{name}</span>
					})()}
					<span className="lw-connection-actions">
						<button type="button" className="lw-icon-button" aria-label={format(x.refreshOf, { name: spec.name })} title={format(x.refreshOf, { name: spec.name })} onClick={() => refresh()}><Icons.refresh /></button>
						{spec.actions}
					</span>
				</div>
			)}
			{!folded && (
				<>
					{spec.problem && <div className="lw-notice" role="alert">{spec.problem}</div>}
					{(sharedStore?.problems.length ?? 0) > 0 && state.loaded && (
						<div className="lw-notice" role="alert">
							{a.unreadableFiles}
							<ul className="lw-issues">{sharedStore!.problems.map(p => <li key={`${p.schema}/${p.file}`}>{p.schema || '/'}/{p.file}: {p.message}</li>)}</ul>
						</div>
					)}
					{remote && (
						<div className="lw-notice" role="status">
							{remote.text} <button type="button" onClick={() => { refresh(remote.schema); setRemote(undefined) }}>{a.refreshNow}</button>
						</div>
					)}
					{inBrowser.length > 0 && (
						<div className="lw-notice" role="note">
							{format(a.browserItems, { n: inBrowser.length })} <button type="button" onClick={copyToWorkspace}>{a.copyToWorkspace}</button>
						</div>
					)}
					<Explorer schemas={listed} controller={controller} api={api} refresh={refreshing} onRefreshSchema={refresh} locale={locale} theme={theme} activeId={activeId}
						expanded={expanded} onExpandedChange={onExpandedChange}
						loadDomain={domainOf} onOpen={item => open.saved(id, item)} onOpenDomain={schema => open.domain(id, schema)} onOpenEntity={(schema, entity) => open.entity(id, schema, entity)}
						onNewQuery={(schema, parentId) => open.newQuery(id, schema, parentId)}
						onNewDiagram={(schema, parentId) => open.newDiagram(id, schema, parentId)}
						admin={adminApi && can ? {
							can,
							onOpenSchemaFile: schema => open.schemaFile(id, schema),
							onOpenSchema: schema => open.schema(id, schema),
							onOpenElement: (schema, focus, edit) => open.element(id, schema, focus, edit),
							onOpenFile: (schema, file) => open.file(id, schema, file),
							onOpenStageDiagram: (schema, stage) => open.stageDiagram(id, schema, stage),
							api: adminApi,
							loadSchemaDoc,
							loadFiles,
							onNewSchema: () => open.newSchema(id),
							onRemoveSchema: schema => open.removeSchema(id, schema)
						} : undefined} />
				</>
			)}
		</section>
	)
}

/** The key of what a connection unfolded, kept with the others in the session (one connection: as it is) */
const SEP = '␟'

export const Workspace: React.FC<WorkspaceProps> = ({ store, workspaceKey, maxTabs = 20, refreshMs = 5000, admin, session, pages, openPage, connections: given, connectionsHeading, ...workbench }) => {
	const theme = workbench.theme ?? 'light'
	const m = messagesOf(workbench.locale)
	const x = explorerMessagesOf(workbench.locale)
	const a = adminMessagesOf(workbench.locale)
	// the connections; without them, one made of these props (as the workspace always was)
	const connections = useMemo<WorkspaceConnection[]>(() => given ?? [{ id: 'current', name: 'current', baseUrl: workbench.baseUrl, headers: workbench.headers, api: workbench.api, admin, store, workspaceKey }],
		[given, workbench.baseUrl, workbench.headers, workbench.api, admin, store, workspaceKey])
	const heading = !!given
	const first = connections[0]?.id ?? 'current'
	const [runtimes, setRuntimes] = useState<Record<string, Runtime>>({})
	const onRuntime = useCallback((id: string, runtime: Runtime | undefined) => setRuntimes(all => {
		if (all[id] === runtime) return all
		const next = { ...all }
		if (runtime) next[id] = runtime; else delete next[id]
		return next
	}), [])
	const connOf = (tab: Pick<Tab, 'connection'>) => tab.connection ?? first
	const rt = (conn: string | undefined): Runtime | undefined => runtimes[conn ?? first]

	// a first query to write in; none while there is no connection (an IDE that starts empty)
	const [tabs, setTabs] = useState<Tab[]>(() => connections.length ? [{ id: 1, kind: 'query', title: `${m.tabNamed} 1` }] : [])
	const [active, setActive] = useState(1)
	const [next, setNext] = useState(2)
	// the next id also in a ref: two tabs opened in the same tick (before a render) never share an id
	const nextId = useRef(next)
	if (next > nextId.current) nextId.current = next
	// the width of the explorer, remembered in this browser (a convenience: without storage it starts at 280)
	const [width, setWidthState] = useState(() => storedWidth() ?? 280)
	const setWidth = (value: number) => { const w = clampWidth(value); setWidthState(w); rememberWidth(w) }
	const side = useRef<HTMLDivElement>(null)
	const [collapsed, setCollapsed] = useState(false)
	const [rootFolded, setRootFolded] = useState(false)
	const [saving, setSaving] = useState<{ tab: Tab, as: boolean }>()
	const [creatingDiagram, setCreatingDiagram] = useState<{ conn: string, schema: string, parentId?: string }>()
	const [wizarding, setWizarding] = useState<{ tab: Tab, schema: string, domain: DomainInfo, reading?: WizardReading }>()
	const [choosingEntities, setChoosingEntities] = useState<Tab>()
	const [notice, setNotice] = useState<string>()
	const [newSchema, setNewSchema] = useState<string>()
	const [removing, setRemoving] = useState<{ conn: string, schema: string }>()
	const [dirtySchemas, setDirtySchemas] = useState<Set<number>>(new Set())
	// the content of each query tab as it is typed: a ref (no render per key), and a tick to show unsaved changes
	const contents = useRef(new Map<number, SavedQueryContent & { schema?: string }>())
	const [tick, setTick] = useState(0)

	// where the workspace was: restored once, then kept as it changes
	const primary = connections[0]
	const browserKey = primary?.workspaceKey ?? primary?.baseUrl ?? 'default'
	const sessionStore = useMemo<SessionStorePort | undefined>(() => session === false
		? undefined
		: session ?? (connections.length !== 1 || primary?.api
			? (connections.length > 1 ? new BrowserSessionStore(`lambdaorm-ui.session:${connections.map(c => c.id).join(',')}`) : undefined)
			: new FallbackSessionStore(new GatewaySessionStore(primary?.baseUrl ?? '', primary?.headers, primary?.fetch), new BrowserSessionStore(`lambdaorm-ui.session:${browserKey}`))),
	[session, connections, primary, browserKey])
	const [restored, setRestored] = useState(!sessionStore)
	const tabsNow = useRef(tabs)
	tabsNow.current = tabs
	const [restoredExpanded, setRestoredExpanded] = useState<Record<string, string[]>>()
	const expandedNow = useRef<Record<string, string[]>>({})
	const [expandedTick, setExpandedTick] = useState(0)
	const known = (conn: string | undefined) => conn === undefined || connections.some(c => c.id === conn)
	useEffect(() => {
		if (!sessionStore) { setRestored(true); return }
		let alive = true
		sessionStore.load().then(value => {
			const kept = readSession(value)
			if (!alive || !kept) return
			// new ids: a tab with the id of one shown (Query 1) would keep that one's editor and lose what is restored
			const base = Math.max(0, ...tabsNow.current.map(tab => tab.id)) + 1
			for (const id of tabsNow.current.map(tab => tab.id)) contents.current.delete(id)
			const back = kept.tabs
				.filter(tab => (tab.kind !== 'page' || !!pages?.[tab.page ?? '']) && known((tab as any).connection))
				.map((tab, i) => ({ ...tab, id: base + i }) as Tab)
			setTabs(back)
			setActive(back[kept.active]?.id ?? back[0]?.id ?? -1)
			setNext(base + back.length)
			// what each connection unfolded (one connection: its keys as they are)
			const byConnection: Record<string, string[]> = {}
			for (const key of kept.expanded) {
				const at = key.indexOf(SEP)
				const conn = at < 0 ? first : key.slice(0, at)
				;(byConnection[conn] ??= []).push(at < 0 ? key : key.slice(at + 1))
			}
			setRestoredExpanded(byConnection)
			setCollapsed(kept.collapsed)
		}).catch(() => undefined).finally(() => { if (alive) setRestored(true) })
		return () => { alive = false }
	}, [sessionStore])
	const snapshot = (): WorkspaceSession => ({
		version: 1,
		tabs: tabs.map(({ id, ...tab }) => {
			const content = contents.current.get(id)
			return tab.kind === 'query' && content
				? { ...tab, schema: content.schema ?? tab.schema, initial: { mode: content.mode, query: content.query, script: content.script, data: content.data, options: content.options } }
				: tab
		}),
		active: Math.max(0, tabs.findIndex(t => t.id === active)),
		expanded: Object.entries(expandedNow.current).flatMap(([conn, keys]) => heading ? keys.map(k => `${conn}${SEP}${k}`) : keys),
		collapsed
	})
	const latest = useRef(snapshot)
	latest.current = snapshot
	useEffect(() => {
		if (!sessionStore || !restored) return
		const timer = setTimeout(() => { sessionStore.save(latest.current()).catch(() => undefined) }, 800)
		return () => clearTimeout(timer)
	}, [sessionStore, restored, tabs, active, collapsed, tick, expandedTick])
	useEffect(() => {
		if (!sessionStore) return
		const leave = () => { if (restored) sessionStore.save(latest.current(), { keepalive: true }).catch(() => undefined) }
		window.addEventListener('pagehide', leave)
		return () => window.removeEventListener('pagehide', leave)
	}, [sessionStore, restored])

	// a connection removed (or a page the application no longer has): its tabs go too
	useEffect(() => {
		if (!restored) return
		const gone = tabs.filter(tab => (tab.connection !== undefined && !connections.some(c => c.id === tab.connection)) || (tab.kind === 'page' && !pages?.[tab.page ?? '']))
		if (!gone.length) return
		for (const tab of gone) contents.current.delete(tab.id)
		const rest = tabs.filter(tab => !gone.includes(tab))
		setTabs(rest)
		if (gone.some(tab => tab.id === active)) setActive(rest[rest.length - 1]?.id ?? -1)
	}, [connections, pages, restored])
	const pickerDomain = (conn: string, schema: string) => async () => {
		const domain = await rt(conn)!.domainOf(schema)
		const edges = edgesOf(domain)
		return {
			names: domain.entities.map(e => e.name).sort((a, b) => a.localeCompare(b)),
			neighbours: (name: string) => edges.flatMap(e => e.parent === name ? [e.child] : e.child === name ? [e.parent] : [])
		}
	}
	const sinceOf = (conn: string, schema: string | undefined) => `${rt(conn)?.listed.find(s => s.path === schema)?.since ?? ''}#${rt(conn)?.refreshes ?? 0}`
	useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(undefined), 5000); return () => clearTimeout(t) }, [notice])

	const savedOf = (tab: Tab): SavedItem | undefined => tab.savedId ? rt(connOf(tab))?.state.items.find(i => i.id === tab.savedId) : undefined
	const dirty = (tab: Tab): boolean => {
		const saved = savedOf(tab)
		if (tab.kind === 'diagram') return saved?.kind === 'diagram' && !!tab.draft && !sameDraft(tab.draft, draftOf(saved))
		if (tab.kind === 'schemaFile') return dirtySchemas.has(tab.id)
		// not saved yet: changed once it is turned, shown otherwise or a box moved
		if (tab.kind === 'stageDiagram') return saved?.kind !== 'diagram' ? !!tab.stageView : JSON.stringify(viewKey(tab.stageView)) !== JSON.stringify(viewKey(saved.stageView))
		if (tab.kind !== 'query') return false
		const content = contents.current.get(tab.id)
		if (!content) return false
		if (saved?.kind !== 'query') return !!(content.query.trim() || content.script.trim())
		return !SAME(content, contentOf(saved)) || JSON.stringify(tab.wizard ?? null) !== JSON.stringify(saved.wizard ?? null)
	}

	const add = (tab: Omit<Tab, 'id'>) => {
		if (tabs.length >= maxTabs) { setNotice(m.tabLimit.replace('{n}', String(maxTabs))); return }
		const id = nextId.current
		nextId.current = id + 1
		setTabs(t => [...t, { ...tab, id }])
		setActive(id)
		setNext(id + 1)
	}
	const close = (id: number) => {
		const index = tabs.findIndex(t => t.id === id)
		const rest = tabs.filter(t => t.id !== id)
		contents.current.delete(id)
		setTabs(rest)
		if (active === id) setActive(rest[Math.max(0, index - 1)]?.id ?? -1)
	}
	// close all the tabs, or all but one (that one becomes the active)
	const closeAllBut = (keep?: number) => {
		const rest = tabs.filter(t => t.id === keep)
		for (const tab of tabs) if (tab.id !== keep) contents.current.delete(tab.id)
		setTabs(rest)
		setActive(rest[0]?.id ?? -1)
	}
	// the menu of a tab (right click) or of the bar (⋯): where it opens and for which tab
	const [tabMenu, setTabMenu] = useState<{ id?: number, x: number, y: number }>()
	useEffect(() => {
		if (!tabMenu) return
		const hide = () => setTabMenu(undefined)
		const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
		window.addEventListener('click', hide)
		window.addEventListener('keydown', key)
		return () => { window.removeEventListener('click', hide); window.removeEventListener('keydown', key) }
	}, [tabMenu])
	// a page of the application asked to open: its tab, once
	const pageAsked = useRef<number>()
	useEffect(() => {
		if (!openPage || !pages?.[openPage.key] || pageAsked.current === openPage.at) return
		pageAsked.current = openPage.at
		if (!reuse(t => t.kind === 'page' && t.page === openPage.key)) add({ kind: 'page', title: pages[openPage.key].title, page: openPage.key })
	}, [openPage, pages])
	const reuse = (match: (t: Tab) => boolean): boolean => {
		const already = tabs.find(match)
		if (already) setActive(already.id)
		return !!already
	}
	const same = (conn: string, t: Tab) => connOf(t) === conn
	const openSaved = (conn: string, item: SavedItem) => {
		if (item.kind === 'folder' || reuse(t => same(conn, t) && t.savedId === item.id)) return
		if (item.kind === 'query') add({ kind: 'query', title: item.name, schema: item.schema, savedId: item.id, initial: contentOf(item), wizard: item.wizard, connection: conn })
		else if (item.stage) add({ kind: 'stageDiagram', title: item.name, schema: item.schema, stage: item.stage, stageView: item.stageView, savedId: item.id, connection: conn })
		else add({ kind: 'diagram', title: item.name, schema: item.schema, savedId: item.id, draft: draftOf(item), connection: conn })
	}
	const newQuery = (conn: string, schema: string, parentId?: string, initial?: Partial<SavedQueryContent>, title?: string) =>
		add({ kind: 'query', title: title ?? `${m.tabNamed} ${next}`, schema, parentId, initial, connection: conn })
	const queryEntity = (conn: string) => (schema: string, entity: string) => newQuery(conn, schema, undefined, { query: `${entity}.page(1, 10)` }, entity)
	// the query of what a diagram shows, in a tab of its own
	const queryOfDiagram = (conn: string) => (schema: string, query: string) => newQuery(conn, schema, undefined, { mode: 'query', query })
	const openEntity = (conn: string, schema: string, entity: string) => {
		if (!reuse(t => same(conn, t) && t.kind === 'entity' && t.schema === schema && t.entity === entity)) add({ kind: 'entity', title: entity, schema, entity, connection: conn })
	}
	const openSchemaFile = (conn: string, schema: string) => {
		if (!reuse(t => same(conn, t) && t.kind === 'schemaFile' && t.schema === schema)) add({ kind: 'schemaFile', title: `lambdaORM.yaml ${schema || '/'}`, schema, connection: conn })
	}
	// the schema: its tab, with the commands in a toolbar
	const openSchema = (conn: string, schema: string) => {
		if (!reuse(t => same(conn, t) && t.kind === 'schema' && t.schema === schema)) add({ kind: 'schema', title: format(a.commandsOf, { name: schema || '/' }), schema, connection: conn })
	}
	const focusKey = (f: FormFocus) => `${f.section}:${(f as any).name ?? ''}`
	const focusTitle = (f: FormFocus) => (f as any).name ?? (f.section === 'application' || f.section === 'variables' || f.section === 'about' ? a[f.section] : format(a.newNamed, { name: a[f.section] }))
	// one element of the schema; a new one (no name) is always a tab of its own
	// edit: asked by Edit, it opens in edit (an open tab of it goes to edit too)
	// remove: asked by Remove in the view of the element (its form says what uses it and asks to confirm)
	const openElement = (conn: string, schema: string, focus: FormFocus, edit = false, remove = false) => {
		const named = (focus as any).name !== undefined || focus.section === 'application' || focus.section === 'variables' || focus.section === 'about'
		const editRequest = edit ? Date.now() : undefined
		const removeRequest = remove ? Date.now() : undefined
		const open = named ? tabs.find(t => same(conn, t) && t.kind === 'element' && t.schema === schema && !!t.focus && focusKey(t.focus) === focusKey(focus)) : undefined
		if (open && (editRequest || removeRequest)) setTabs(all => all.map(t => t.id === open.id ? { ...t, editRequest: editRequest ?? t.editRequest, removeRequest: removeRequest ?? t.removeRequest } : t))
		if (named && reuse(t => same(conn, t) && t.kind === 'element' && t.schema === schema && !!t.focus && focusKey(t.focus) === focusKey(focus))) return
		add({ kind: 'element', title: focusTitle(focus), schema, focus, connection: conn, editRequest, removeRequest })
	}
	// a form opened by Edit, cancelled or saved: it closes, and an entity goes back to its view
	const elementDone = (conn: string, tab: Tab) => {
		close(tab.id)
		const focus = tab.focus as { section: string, name?: string } | undefined
		if (focus?.section === 'entities' && focus.name) openEntity(conn, tab.schema ?? '', focus.name)
	}
	const elementChanged = (id: number, focus: FormFocus | undefined) => {
		if (!focus) {
			// removed: the view of a removed entity goes too
			const form = tabs.find(t => t.id === id)
			const was = form?.focus as { section: string, name?: string } | undefined
			const gone = new Set([id, ...(form && was?.section === 'entities' && was.name
				? tabs.filter(t => t.kind === 'entity' && same(connOf(form), t) && t.schema === form.schema && t.entity === was.name).map(t => t.id)
				: [])])
			const index = tabs.findIndex(t => t.id === id)
			const rest = tabs.filter(t => !gone.has(t.id))
			for (const g of gone) contents.current.delete(g)
			setTabs(rest)
			if (gone.has(active)) setActive(rest[Math.max(0, Math.min(index, rest.length) - 1)]?.id ?? -1)
			return
		}
		setTabs(all => all.map(t => t.id === id ? { ...t, focus, title: focusTitle(focus) } : t))
	}
	const openFile = (conn: string, schema: string, file: string) => {
		if (!reuse(t => same(conn, t) && t.kind === 'file' && t.schema === schema && t.file === file)) add({ kind: 'file', title: file.split('/').pop() ?? file, schema, file, connection: conn })
	}
	const openStageDiagram = (conn: string, schema: string, stage: string) => {
		const kept = rt(conn)?.state.items.find(i => i.kind === 'diagram' && i.schema === schema && i.stage === stage)
		if (kept) { openSaved(conn, kept); return }
		if (!reuse(t => same(conn, t) && t.kind === 'stageDiagram' && t.schema === schema && t.stage === stage)) add({ kind: 'stageDiagram', title: format(a.stageDiagramOf, { name: stage }), schema, stage, connection: conn })
	}
	const openDomain = (conn: string, schema: string) => {
		if (!reuse(t => same(conn, t) && t.kind === 'domain' && t.schema === schema)) add({ kind: 'domain', title: `${x.domainYaml} ${schema || '/'}`, schema, connection: conn })
	}
	const openers: Openers = {
		saved: openSaved,
		domain: openDomain,
		entity: openEntity,
		newQuery: (conn, schema, parentId) => newQuery(conn, schema, parentId),
		newDiagram: (conn, schema, parentId) => setCreatingDiagram({ conn, schema, parentId }),
		schemaFile: openSchemaFile,
		schema: openSchema,
		element: openElement,
		file: openFile,
		stageDiagram: openStageDiagram,
		newSchema: conn => setNewSchema(conn),
		removeSchema: (conn, schema) => setRemoving({ conn, schema })
	}
	// a box out of a diagram: its place and the lines that touched it go too
	const removeFromDiagram = (tab: Tab, entity: string | string[]) => {
		const draft = tab.draft
		const out = new Set(Array.isArray(entity) ? entity : [entity])
		if (!draft || draft.entities.filter(e => !out.has(e)).length < 1) return
		const positions = draft.positions ? Object.fromEntries(Object.entries(draft.positions).filter(([name]) => !out.has(name))) : undefined
		const bends = draft.bends ? Object.fromEntries(Object.entries(draft.bends).filter(([id]) => !id.split(/[>=:]/).some(part => out.has(part.split('.')[0])))) : undefined
		setDraft(tab.id, { entities: draft.entities.filter(e => !out.has(e)), positions, bends: bends && Object.keys(bends).length ? bends : undefined })
	}
	const setDraft = (id: number, patch: Partial<DiagramDraft>) => setTabs(t => t.map(tab => tab.id === id && tab.draft ? { ...tab, draft: { ...tab.draft, ...patch } } : tab))

	const save = async (tab: Tab, as = false) => {
		const saved = savedOf(tab)
		const controller = rt(connOf(tab))?.controller
		if (!controller) return
		// a diagram of a stage: how it is shown, in place; the first time (or as another one), its name and folder
		if (tab.kind === 'stageDiagram') {
			if (saved?.kind === 'diagram' && !as) {
				try { await controller.update(saved.id, { stageView: tab.stageView ?? {} }) } catch (e) { setNotice(problemText(e, x)) }
				return
			}
			setSaving({ tab, as })
			return
		}
		if (tab.kind === 'diagram') {
			if (saved?.kind !== 'diagram' || !tab.draft) return
			try { await controller.update(saved.id, { entities: tab.draft.entities, positions: tab.draft.positions, bends: tab.draft.bends, compact: tab.draft.compact, detail: tab.draft.detail, relationNames: tab.draft.relationNames }) } catch (e) { setNotice(problemText(e, x)) }
			return
		}
		const content = contents.current.get(tab.id)
		if (!content || content.schema === undefined) return
		if (saved?.kind === 'query' && !as && saved.schema === content.schema) {
			try {
				await controller.update(saved.id, { mode: content.mode, query: content.query, script: content.script, data: content.data, options: content.options, wizard: tab.wizard })
				setTick(t => t + 1)
			} catch (e) { setNotice(problemText(e, x)) }
			return
		}
		setSaving({ tab, as })
	}

	// the query wizard: on a query it wrote, it opens as it was left and rewrites that query; else a new tab
	const wz = wizardMessagesOf(workbench.locale)
	const openWizard = async (tab: Tab) => {
		const schema = contents.current.get(tab.id)?.schema ?? tab.schema
		const r = rt(connOf(tab))
		if (schema === undefined || !r) return
		try {
			const domain = await r.domainOf(schema)
			// a query not written by the wizard: read as far as it can show it (its tables, fields, filter, order and page)
			const query = contents.current.get(tab.id)
			// one it wrote and was edited by hand since: read too, with its boxes where they were
			const text = query?.query ?? ''
			const edited = !tab.wizard || text.trim() !== queryOf(tab.wizard, domain).trim()
			const read = query?.mode === 'script' || !edited ? undefined : wizardFromQuery(text, domain)
			const reading = read && tab.wizard?.positions ? { ...read, state: { ...read.state, positions: tab.wizard.positions } } : read
			setWizarding({ tab, schema, domain, reading })
		} catch (e) { setNotice(problemText(e, x)) }
	}
	const acceptWizard = (state: WizardState, query: string) => {
		if (!wizarding) return
		const { tab, schema } = wizarding
		setWizarding(undefined)
		if (tab.wizard) {
			const content = contents.current.get(tab.id)
			const initial = content ? { mode: content.mode, query: content.query, script: content.script, data: content.data, options: content.options } : tab.initial
			setTabs(t => t.map(other => other.id === tab.id ? { ...other, schema, wizard: state, rev: (other.rev ?? 0) + 1, initial: { ...initial, mode: 'query', query } } : other))
			return
		}
		add({ kind: 'query', title: state.root, schema, initial: { mode: 'query', query }, wizard: state, connection: connOf(tab) })
	}

	const onContent = useCallback((id: number, content: SavedQueryContent & { schema?: string }) => {
		contents.current.set(id, content)
		setTick(t => t + 1)
	}, [])

	const startResize = (e: React.PointerEvent) => {
		const start = e.clientX
		const from = width
		const move = (ev: PointerEvent) => setWidth(from + ev.clientX - start)
		const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
	}

	/** a double click on the border: as wide as the longest row of the explorer (long names of a large schema) */
	const fitWidth = () => {
		const rows = [...(side.current?.querySelectorAll<HTMLElement>('.lw-tree-row') ?? [])]
		// the label cuts its text (ellipsis): the row as wide as the whole text of its label
		const widest = rows.reduce((w, row) => {
			const label = row.querySelector<HTMLElement>('.lw-tree-label')
			return Math.max(w, row.scrollWidth + (label ? label.scrollWidth - label.clientWidth : 0))
		}, 0)
		if (widest > 0) setWidth(widest + 24)
	}
	const resizeKeys = (e: React.KeyboardEvent) => {
		const step = e.shiftKey ? 60 : 20
		if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(width - step) }
		if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + step) }
		if (e.key === 'Enter') { e.preventDefault(); fitWidth() }
	}

	const iconOf = (tab: Tab) => tab.kind === 'page' ? pages?.[tab.page ?? '']?.icon ?? null : tab.kind === 'element' ? <Icons.edit /> : tab.kind === 'stageDiagram' ? <Icons.stages /> : tab.kind === 'schema' ? <Icons.terminal /> : tab.kind === 'file' ? <Icons.query /> : tab.kind === 'domain' || tab.kind === 'schemaFile' ? <Icons.yaml /> : tab.kind === 'entity' ? <Icons.entity /> : tab.kind === 'diagram' ? <Icons.diagram /> : savedOf(tab) ? <Icons.query /> : null
	const activeTab = tabs.find(t => t.id === active)
	const saveKeys = (tab: Tab) => (e: React.KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(tab) } }
	const texts = { ...x, entities: x.entities }
	const nameOf = (conn: string) => connections.find(c => c.id === conn)?.name ?? conn
	// a new tab: in the connection of the active one (or the first), on its first schema ready
	const newTab = () => {
		const conn = activeTab && activeTab.kind !== 'page' ? connOf(activeTab) : first
		newQuery(conn, rt(conn)?.schemas[0]?.path ?? '')
	}
	const savingRt = saving ? rt(connOf(saving.tab)) : undefined
	const creatingRt = creatingDiagram ? rt(creatingDiagram.conn) : undefined
	const newSchemaRt = newSchema !== undefined ? rt(newSchema) : undefined
	const removingRt = removing ? rt(removing.conn) : undefined

	return (
		<div className={`lw-space lw-${theme}`}>
			{!collapsed && (
				<>
					<div className="lw-space-side" style={{ width }} ref={side}>
						{connectionsHeading && (
							<div className="lw-connections-root">
								{connectionsHeading.lead}
								{connectionsHeading.lead
									? (
										<>
											{/* by the menu of the app: their title and count, nothing to fold */}
											<span className="lw-spacer" />
											<strong className="lw-connections-title">{connectionsHeading.title}</strong>
											<span className="lw-type">{connections.length}</span>
										</>
										)
									: (
										<>
											<button type="button" className="lw-icon-button" aria-expanded={!rootFolded} aria-label={`${rootFolded ? x.showExplorer : x.hideExplorer} ${connectionsHeading.title}`} onClick={() => setRootFolded(!rootFolded)}>
												<span className={`lw-chevron ${rootFolded ? '' : 'lw-open'}`} aria-hidden="true"><Icons.chevron /></span>
											</button>
											<Icons.connections />
											<strong className="lw-connections-title">{connectionsHeading.title}</strong>
											<span className="lw-type">{connections.length}</span>
											<span className="lw-spacer" />
										</>
										)}
								<span className="lw-connection-actions"><button type="button" className="lw-icon-button" aria-label={format(x.refreshOf, { name: connectionsHeading.title })} title={format(x.refreshOf, { name: connectionsHeading.title })} onClick={() => { for (const r of Object.values(runtimes)) r.refresh() }}><Icons.refresh /></button>{connectionsHeading.actions}</span>
							</div>
						)}
						{/* the sections stay mounted while folded: what each connection knows (its schemas) is kept */}
						<div className={connectionsHeading ? 'lw-connections-list' : undefined} hidden={!!connectionsHeading && !connectionsHeading.lead && rootFolded}>
							{connections.map(spec => (
								<ConnectionSection key={spec.id} spec={spec} heading={heading} refreshMs={refreshMs} theme={theme} locale={workbench.locale}
									activeId={activeTab && connOf(activeTab) === spec.id ? activeTab.savedId : undefined}
									expanded={restoredExpanded?.[spec.id]} onExpandedChange={keys => { expandedNow.current = { ...expandedNow.current, [spec.id]: keys }; setExpandedTick(n => n + 1) }}
									open={openers} onRuntime={onRuntime} onNotice={setNotice} />
							))}
						</div>
					</div>
					<div className="lw-space-resizer" role="separator" aria-orientation="vertical" aria-label={x.resizeExplorer} title={x.resizeExplorer}
						tabIndex={0} aria-valuenow={width} aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH}
						onPointerDown={startResize} onDoubleClick={fitWidth} onKeyDown={resizeKeys} />
				</>
			)}
			<div className="lw-space-main">
				<div className={`lw-tabs lw-${theme}`}>
					<div className="lw-tabbar" role="tablist" aria-label="tabs">
						<button className="lw-icon-button lw-side-toggle" aria-label={collapsed ? x.showExplorer : x.hideExplorer} title={collapsed ? x.showExplorer : x.hideExplorer}
							aria-pressed={!collapsed} onClick={() => setCollapsed(!collapsed)}><Icons.panel /></button>
						{tabs.map(tab => {
							const saved = savedOf(tab)
							const title = tab.kind === 'page' ? pages?.[tab.page ?? '']?.title ?? tab.title : saved?.name ?? tab.title
							// with several connections, which one a tab is of
							const of = heading && connections.length > 1 && tab.kind !== 'page' ? nameOf(connOf(tab)) : undefined
							return (
								<div key={tab.id} className={`lw-tab ${tab.id === active ? 'lw-active' : ''}`}
									onContextMenu={e => { e.preventDefault(); setTabMenu({ id: tab.id, x: e.clientX, y: e.clientY }) }}>
									<button role="tab" aria-selected={tab.id === active} onClick={() => setActive(tab.id)} title={[of, saved?.description || title].filter(Boolean).join(' · ')}>
										{iconOf(tab)} {title}{of && <span className="lw-tab-connection"> · {of}</span>}{dirty(tab) && <span className="lw-dirty" title={x.unsaved}> •</span>}
									</button>
									<button className="lw-tab-close" aria-label={`close ${title}`} title={m.close} onClick={() => close(tab.id)}>×</button>
								</div>
							)
						})}
						<button className="lw-tab-add" aria-label="new tab" title={m.newTab} onClick={newTab}>+</button>
						<button className="lw-icon-button lw-tab-actions" aria-label="tab actions" aria-haspopup="menu" title={a.closeAll} disabled={tabs.length === 0}
							onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setTabMenu({ id: active, x: r.left, y: r.bottom }) }}><Icons.more /></button>
					</div>
					{tabMenu && (
						<div className="lw-tab-menu" role="menu" style={{ position: 'fixed', left: tabMenu.x, top: tabMenu.y }} onClick={e => e.stopPropagation()}>
							{tabMenu.id !== undefined && tabs.some(t => t.id === tabMenu.id) && (
								<>
									<button role="menuitem" onClick={() => { close(tabMenu.id!); setTabMenu(undefined) }}>{a.closeTab}</button>
									<button role="menuitem" disabled={tabs.length < 2} onClick={() => { closeAllBut(tabMenu.id); setTabMenu(undefined) }}>{a.closeOthers}</button>
								</>
							)}
							<button role="menuitem" onClick={() => { closeAllBut(); setTabMenu(undefined) }}>{a.closeAll}</button>
						</div>
					)}
					{notice && <div className="lw-notice" role="status">{notice}</div>}
					{tabs.length === 0 && <div className={`lw-workbench lw-${theme}`}><p className="lw-muted">{x.nothingOpen}</p></div>}
					{tabs.map(tab => {
						const saved = savedOf(tab)
						const conn = connOf(tab)
						const r = rt(conn)
						const adminApi = r?.adminApi
						const can = r?.can
						return (
							<div key={tab.id} role="tabpanel" aria-label={saved?.name ?? tab.title} hidden={tab.id !== active}
								onKeyDownCapture={tab.kind === 'query' || tab.kind === 'diagram' || tab.kind === 'stageDiagram' ? saveKeys(tab) : undefined}>
								{tab.kind === 'page' && pages?.[tab.page ?? ''] && <div className="lw-page">{pages[tab.page!].render()}</div>}
								{tab.kind !== 'page' && !r && <div className={`lw-workbench lw-${theme}`}><p className="lw-muted">{x.loading}</p></div>}
								{r && tab.kind === 'element' && adminApi && tab.focus && (
									<SchemaForms admin={adminApi} theme={theme} schema={tab.schema ?? ''} writable={!!can?.schemaWrite} canAdmin={!!can?.schemaAdmin} revision={sinceOf(conn, tab.schema)} locale={workbench.locale}
										focus={tab.focus} editRequest={tab.editRequest} removeRequest={tab.removeRequest} onChanged={focus => elementChanged(tab.id, focus)}
										onDone={() => elementDone(conn, tab)} />
								)}
								{r && tab.kind === 'schema' && adminApi && (
									<CommandsPanel admin={adminApi} schema={tab.schema ?? ''} canSave={!!can?.workbenchWrite} canBuild={!!can?.build} locale={workbench.locale}
										title={format(a.commandsOf, { name: tab.schema || '/' })}>
										{can?.schemaRead && (
											<SchemaForms admin={adminApi} theme={theme} schema={tab.schema ?? ''} writable={!!can?.schemaWrite} canAdmin={!!can?.schemaAdmin} revision={sinceOf(conn, tab.schema)} locale={workbench.locale}
												focus={{ section: 'about' }} onRemoveSchema={can?.schemaAdmin ? () => openers.removeSchema(conn, tab.schema ?? '') : undefined} />
										)}
										{can?.schemaRead && adminApi.history && (
											<details className="lw-history-section">
												<summary>{a.history}</summary>
												<HistoryView admin={adminApi} schema={tab.schema ?? ''} locale={workbench.locale} revision={sinceOf(conn, tab.schema)} />
											</details>
										)}
									</CommandsPanel>
								)}
								{r && tab.kind === 'stageDiagram' && adminApi && tab.stage && (
									<StageDiagram admin={adminApi} schema={tab.schema ?? ''} stage={tab.stage} theme={theme} locale={workbench.locale} revision={sinceOf(conn, tab.schema)}
										view={tab.stageView} onViewChange={stageView => setTabs(all => all.map(t => t.id === tab.id ? { ...t, stageView } : t))}
										toolbar={(
											<span className="lw-save">
												<button onClick={() => save(tab)} disabled={!!saved && !dirty(tab)} title="Ctrl+S">{x.save}</button>
												{saved && <button onClick={() => save(tab, true)}>{x.saveAs}</button>}
												{saved && !dirty(tab) && <span className="lw-muted">{x.saved}</span>}
											</span>
										)} />
								)}
								{r && tab.kind === 'file' && adminApi && tab.file && (
									<FileView admin={adminApi} schema={tab.schema ?? ''} path={tab.file} theme={theme} revision={sinceOf(conn, tab.schema)} />
								)}
								{r && tab.kind === 'schemaFile' && adminApi && (
									<SchemaEditor admin={adminApi} schema={tab.schema ?? ''} writable={!!can?.schemaWrite} theme={theme} locale={workbench.locale}
										revision={sinceOf(conn, tab.schema)} pending={r.listed.find(s => s.path === tab.schema)?.pending}
										onDirty={d => setDirtySchemas(set => { const n = new Set(set); if (d) n.add(tab.id); else n.delete(tab.id); return n })} />
								)}
								{r && tab.kind === 'domain' && <DomainYaml key={sinceOf(conn, tab.schema)} domain={r.loaderOf(tab.schema ?? '')} schema={tab.schema ?? ''} theme={theme} loading={x.loading} readOnly={x.readOnly} />}
								{r && tab.kind === 'entity' && (
									<EntityView key={sinceOf(conn, tab.schema)} api={r.api} schema={tab.schema ?? ''} entity={tab.entity ?? ''} domain={r.loaderOf(tab.schema ?? '')} theme={theme} locale={workbench.locale}
										onOpenEntity={(schema, entity) => openEntity(conn, schema, entity)} onQuery={queryEntity(conn)} onQueryText={queryOfDiagram(conn)} culture={workbench.culture}
										onEdit={adminApi && can?.schemaWrite ? (schema, entity) => openElement(conn, schema, { section: 'entities', name: entity }, true) : undefined} editLabel={a.edit}
										onRemove={adminApi && can?.schemaWrite ? (schema, entity) => openElement(conn, schema, { section: 'entities', name: entity }, false, true) : undefined} removeLabel={a.remove}
										admin={adminApi && can?.schemaRead ? adminApi : undefined} revision={sinceOf(conn, tab.schema)}
										tracesUrl={connections.find(c => c.id === conn)?.tracesUrl?.(tab.schema ?? '', tab.entity ?? '')} />
								)}
								{r && tab.kind === 'diagram' && tab.draft && (
									<div tabIndex={-1} className="lw-diagram-tab">
										<DomainDiagram api={r.api} schema={tab.schema ?? ''} theme={theme} locale={workbench.locale} entities={tab.draft.entities} onQueryText={queryOfDiagram(conn)}
											positions={tab.draft.positions} onPositionsChange={positions => setDraft(tab.id, { positions })}
											bends={tab.draft.bends} onBendsChange={bends => setDraft(tab.id, { bends })}
											relationNames={tab.draft.relationNames} onRelationNamesChange={relationNames => setDraft(tab.id, { relationNames })}
											detail={tab.draft.detail ?? (tab.draft.compact ? 'name' : 'all')} onDetailChange={detail => setDraft(tab.id, { detail, compact: detail === 'name' })}
											onAddEntities={entities => setDraft(tab.id, { entities: [...new Set([...(tab.draft?.entities ?? []), ...entities])] })}
											onOpenEntity={(schema, entity) => openEntity(conn, schema, entity)} exportName={saved?.name ?? tab.title}
											onRemoveEntity={entity => removeFromDiagram(tab, entity)} onRemoveEntities={entities => removeFromDiagram(tab, entities)}
											toolbar={(
												<span className="lw-save">
													<button onClick={() => save(tab)} disabled={!dirty(tab)} title="Ctrl+S">{x.save}</button>
													<button onClick={() => setChoosingEntities(tab)}>{x.editEntities}</button>
													{!dirty(tab) && <span className="lw-muted">{x.saved}</span>}
												</span>
											)} />
									</div>
								)}
								{r && tab.kind === 'query' && (
									<QueryPanel key={tab.rev ?? 0} tab={tab} workbench={{ ...workbench, baseUrl: undefined, headers: undefined, api: r.api, schemasRevision: r.revision, loadDomain: r.domainOf }} onContent={onContent}
										toolbar={(
											<span className="lw-save">
												<button onClick={() => openWizard(tab)} disabled={contents.current.get(tab.id)?.schema === undefined} title={wz.title}><Icons.wizard /> {wz.wizard}</button>
												<button onClick={() => save(tab)} disabled={contents.current.get(tab.id)?.schema === undefined} title="Ctrl+S">{x.save}</button>
												<button onClick={() => save(tab, true)} disabled={contents.current.get(tab.id)?.schema === undefined}>{x.saveAs}</button>
												{saved && !dirty(tab) && <span className="lw-muted">{x.saved}</span>}
											</span>
										)} />
								)}
							</div>
						)
					})}
				</div>
			</div>

			{saving && savingRt && (
				<ItemDialog title={saving.tab.kind === 'stageDiagram' ? a.stageDiagram : x.saveQuery} submit={x.save} texts={x} theme={theme}
					initial={{ name: saving.as ? '' : (savedOf(saving.tab)?.name ?? (saving.tab.title.startsWith(m.tabNamed) ? '' : saving.tab.title)), parentId: saving.tab.parentId }}
					folders={folderPaths(savingRt.state.items, saving.tab.kind === 'stageDiagram' ? saving.tab.schema ?? '' : contents.current.get(saving.tab.id)?.schema ?? '')}
					onClose={() => setSaving(undefined)}
					onSubmit={async v => {
						if (saving.tab.kind === 'stageDiagram') {
							try {
								const diagram = await savingRt.controller.createDiagram({ schema: saving.tab.schema ?? '', ...v }, { entities: [], stage: saving.tab.stage, stageView: saving.tab.stageView ?? {} })
								setTabs(t => t.map(tab => tab.id === saving.tab.id ? { ...tab, savedId: diagram.id, title: diagram.name, parentId: diagram.parentId } : tab))
							} catch (e) { return problemText(e, x) }
							return
						}
						const content = contents.current.get(saving.tab.id)
						if (!content || content.schema === undefined) return
						try {
							const query = await savingRt.controller.createQuery({ schema: content.schema, ...v },
								{ mode: content.mode, query: content.query, script: content.script, data: content.data, options: content.options, ...(saving.tab.wizard ? { wizard: saving.tab.wizard } : {}) })
							setTabs(t => t.map(tab => tab.id === saving.tab.id ? { ...tab, savedId: query.id, schema: query.schema, parentId: query.parentId } : tab))
						} catch (e) { return problemText(e, x) }
					}} />
			)}
			{wizarding && rt(connOf(wizarding.tab)) && (
				<QueryWizard api={rt(connOf(wizarding.tab))!.api} schema={wizarding.schema} domain={wizarding.domain} initial={wizarding.tab.wizard} reading={wizarding.reading} theme={theme} locale={workbench.locale}
					current={wizarding.tab.wizard ? contents.current.get(wizarding.tab.id)?.query : undefined}
					start={/^\s*([\w.]+)/.exec(contents.current.get(wizarding.tab.id)?.query ?? '')?.[1]?.replace(/\.(filter|map|include|sort|page|first|having|groupBy|distinct)$/, '')}
					onClose={() => setWizarding(undefined)} onAccept={acceptWizard} />
			)}
			{creatingDiagram && creatingRt && (
				<DiagramDialog title={x.newDiagram} submit={x.create} texts={texts} theme={theme} domain={pickerDomain(creatingDiagram.conn, creatingDiagram.schema)}
					initial={{ parentId: creatingDiagram.parentId }} folders={folderPaths(creatingRt.state.items, creatingDiagram.schema)}
					onClose={() => setCreatingDiagram(undefined)}
					onSubmit={async v => {
						try {
							const diagram = await creatingRt.controller.createDiagram({ schema: creatingDiagram.schema, name: v.name, description: v.description, parentId: v.parentId }, { entities: v.entities, compact: false, relationNames: false })
							openSaved(creatingDiagram.conn, diagram)
						} catch (e) { return problemText(e, x) }
					}} />
			)}
			{newSchema !== undefined && newSchemaRt?.adminApi && (
				<NewSchemaDialog theme={theme} schemas={newSchemaRt.listed.map(s => s.path)}
					texts={{ title: a.newSchema, route: a.route, routeHint: a.routeHint, startFrom: a.startFrom, empty: a.emptySchema, copyOf: a.copyOf, create: a.create, cancel: a.cancel, name: a.schemaName, description: a.schemaDescription, rootTaken: a.rootTaken }}
					onClose={() => setNewSchema(undefined)}
					onSubmit={async v => {
						const created = await newSchemaRt.adminApi!.createWorkspace(v.path, v.copyOf, { name: v.name, description: v.description })
						setNotice(format(a.created, { name: created.path }))
						newSchemaRt.pokeSoon()
					}} />
			)}
			{removing !== undefined && removingRt?.adminApi && (
				<RemoveSchemaDialog theme={theme} title={a.removeSchema} schema={removing.schema} message={format(a.removeConfirm, { name: removing.schema || '/' })} confirm={a.remove} cancel={a.cancel}
					onClose={() => setRemoving(undefined)}
					onConfirm={async () => {
						await removingRt.adminApi!.removeWorkspace(removing.schema)
						setTabs(t => t.filter(tab => connOf(tab) !== removing.conn || tab.schema !== removing.schema || tab.kind === 'query'))
						setNotice(format(a.removed, { name: removing.schema || '/' }))
						removingRt.pokeSoon()
					}} />
			)}
			{choosingEntities?.draft && (
				<DiagramDialog title={x.editEntities} submit={x.save} texts={texts} theme={theme} domain={pickerDomain(connOf(choosingEntities), choosingEntities.schema ?? '')}
					initial={{ entities: choosingEntities.draft.entities }}
					onClose={() => setChoosingEntities(undefined)}
					onSubmit={async v => {
						const kept = Object.fromEntries(Object.entries(choosingEntities.draft?.positions ?? {}).filter(([name]) => v.entities.includes(name)))
						setDraft(choosingEntities.id, { entities: v.entities, positions: Object.keys(kept).length ? kept : undefined })
					}} />
			)}
		</div>
	)
}

/** A query tab: its workbench reports its content with a callback that keeps its identity */
const QueryPanel: React.FC<{ tab: Tab, workbench: QueryWorkbenchProps, toolbar: React.ReactNode, onContent: (id: number, content: SavedQueryContent & { schema?: string }) => void }> =
	({ tab, workbench, toolbar, onContent }) => {
		const report = useCallback((content: SavedQueryContent & { schema?: string }) => onContent(tab.id, content), [tab.id, onContent])
		return <QueryWorkbench {...workbench} initialSchema={tab.schema} initial={tab.initial} onContentChange={report} toolbar={toolbar} showWho={false} />
	}
