import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { QueryApiPort, SchemaInfo, WorkspaceStore } from '../application/ports'
import { WorkspaceController } from '../application/workspaceController'
import { explorerMessagesOf } from '../domain/explorerI18n'
import { messagesOf } from '../domain/i18n'
import { toYaml } from '../domain/results'
import { folderPaths, SavedItem, SavedQuery, SavedQueryContent } from '../domain/savedItems'
import { RestQueryApi } from '../infrastructure/restQueryApi'
import { IndexedDbWorkspaceStore } from '../infrastructure/workspaceStores'
import { CodeEditor } from './CodeEditor'
import { Icons, ItemDialog } from './dialogs'
import { DomainDiagram } from './DomainDiagram'
import { Explorer, problemText } from './Explorer'
import { QueryWorkbench, QueryWorkbenchProps } from './QueryWorkbench'

export interface WorkspaceProps extends Omit<QueryWorkbenchProps, 'initial' | 'onContentChange' | 'toolbar' | 'initialSchema' | 'schema'> {
	/** Where the saved items are kept; by default IndexedDB of the browser under workspaceKey */
	store?: WorkspaceStore
	/** Separates the saved items (for example the gateway and the user): the same key, the same items */
	workspaceKey?: string
	/** A first fixed tab with the diagram of the domain (default true) */
	diagram?: boolean
	/** At most this many tabs besides the model (default 20) */
	maxTabs?: number
}

type TabKind = 'query' | 'domain'

interface Tab {
	id: number
	kind: TabKind
	/** The title of a new query; a saved one takes its name */
	title: string
	schema?: string
	/** The saved query it edits */
	savedId?: string
	/** The folder a new query is saved in by default */
	parentId?: string
	initial?: Partial<SavedQueryContent>
}

const MODEL = 0
const SAME = (a: SavedQueryContent, b: SavedQueryContent) => a.mode === b.mode && a.query === b.query && a.script === b.script && a.data === b.data && a.options === b.options
const contentOf = (q: SavedQuery): SavedQueryContent => ({ mode: q.mode, query: q.query, script: q.script, data: q.data, options: q.options })

const DomainYaml: React.FC<{ api: QueryApiPort, schema: string, theme: 'light' | 'dark', loading: string, readOnly: string }> = ({ api, schema, theme, loading, readOnly }) => {
	const [text, setText] = useState<string>()
	useEffect(() => {
		let live = true
		if (!api.domain) { setText('# this gateway gives no domain'); return }
		// only the domain: the gateway never gives the sources, connections nor the rest of the schema here
		api.domain(schema).then(d => { if (live) setText(toYaml(d)) }, e => { if (live) setText(`# ${e?.message ?? e}`) })
		return () => { live = false }
	}, [api, schema])
	return (
		<div className={`lw-workbench lw-${theme}`}>
			<div className="lw-header"><span className="lw-badge">{readOnly}</span><code>/{schema}</code></div>
			{text === undefined ? <div className="lw-muted">{loading}</div> : <CodeEditor ariaLabel="domain" language="yaml" readOnly value={text} onChange={() => undefined} theme={theme} height="70vh" />}
		</div>
	)
}

/**
 * The explorer of the schemas on the left and the tabs on the right: the model (diagram), the queries (new or saved,
 * with Save / Save as… and Ctrl+S) and the domain of a schema as YAML, read only. What is saved stays in the browser
 * (IndexedDB) unless another store is given.
 */
export const Workspace: React.FC<WorkspaceProps> = ({ store, workspaceKey, diagram = true, maxTabs = 20, ...workbench }) => {
	const theme = workbench.theme ?? 'light'
	const m = messagesOf(workbench.locale)
	const x = explorerMessagesOf(workbench.locale)
	const api = useMemo(() => workbench.api ?? new RestQueryApi(workbench.baseUrl ?? '', workbench.headers), [workbench.api, workbench.baseUrl, workbench.headers])
	const controller = useMemo(() => new WorkspaceController(store ?? new IndexedDbWorkspaceStore(workspaceKey ?? workbench.baseUrl ?? 'default')), [store, workspaceKey, workbench.baseUrl])
	const state = useSyncExternalStore(controller.subscribe, controller.getState)
	const [schemas, setSchemas] = useState<SchemaInfo[]>([])
	const [tabs, setTabs] = useState<Tab[]>([{ id: 1, kind: 'query', title: `${m.tabNamed} 1` }])
	const [active, setActive] = useState(diagram ? MODEL : 1)
	const [next, setNext] = useState(2)
	const [width, setWidth] = useState(280)
	const [collapsed, setCollapsed] = useState(false)
	const [saving, setSaving] = useState<{ tab: Tab, as: boolean }>()
	const [notice, setNotice] = useState<string>()
	// the content of each query tab as it is typed: a ref (no render per key), and a tick to show unsaved changes
	const contents = useRef(new Map<number, SavedQueryContent & { schema?: string }>())
	const [, setTick] = useState(0)

	useEffect(() => { controller.load() }, [controller])
	useEffect(() => { api.schemas().then(all => setSchemas(all.filter(s => s.status === 'ready')), () => setSchemas([])) }, [api])
	useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(undefined), 5000); return () => clearTimeout(t) }, [notice])

	const savedOf = (tab: Tab): SavedQuery | undefined => {
		const item = tab.savedId ? state.items.find(i => i.id === tab.savedId) : undefined
		return item?.kind === 'query' ? item : undefined
	}
	const dirty = (tab: Tab): boolean => {
		const content = contents.current.get(tab.id)
		if (!content) return false
		const saved = savedOf(tab)
		if (!saved) return !!(content.query.trim() || content.script.trim()) && tab.kind === 'query'
		return !SAME(content, contentOf(saved))
	}

	const add = (tab: Omit<Tab, 'id'>) => {
		if (tabs.length >= maxTabs) { setNotice(m.tabLimit.replace('{n}', String(maxTabs))); return }
		const id = next
		setTabs(t => [...t, { ...tab, id }])
		setActive(id)
		setNext(id + 1)
	}
	const close = (id: number) => {
		const index = tabs.findIndex(t => t.id === id)
		const rest = tabs.filter(t => t.id !== id)
		contents.current.delete(id)
		setTabs(rest)
		if (active === id) setActive(rest[Math.max(0, index - 1)]?.id ?? (diagram ? MODEL : -1))
	}
	const openSaved = (item: SavedItem) => {
		if (item.kind !== 'query') return
		const already = tabs.find(t => t.savedId === item.id)
		if (already) { setActive(already.id); return }
		add({ kind: 'query', title: item.name, schema: item.schema, savedId: item.id, initial: contentOf(item) })
	}
	const newQuery = (schema: string, parentId?: string, initial?: Partial<SavedQueryContent>, title?: string) =>
		add({ kind: 'query', title: title ?? `${m.tabNamed} ${next}`, schema, parentId, initial })
	const openDomain = (schema: string) => {
		const already = tabs.find(t => t.kind === 'domain' && t.schema === schema)
		if (already) setActive(already.id)
		else add({ kind: 'domain', title: `${x.domainYaml} ${schema || '/'}`, schema })
	}

	const save = useCallback(async (tab: Tab, as = false) => {
		const content = contents.current.get(tab.id)
		if (!content || content.schema === undefined) return
		const saved = savedOf(tab)
		if (saved && !as && saved.schema === content.schema) {
			try {
				await controller.update(saved.id, { mode: content.mode, query: content.query, script: content.script, data: content.data, options: content.options })
				setTick(t => t + 1)
			} catch (e) { setNotice(problemText(e, x)) }
			return
		}
		setSaving({ tab, as })
	// savedOf reads the state of this render
	}, [controller, state])

	const onContent = useCallback((id: number, content: SavedQueryContent & { schema?: string }) => {
		contents.current.set(id, content)
		setTick(t => t + 1)
	}, [])

	const startResize = (e: React.PointerEvent) => {
		const start = e.clientX
		const from = width
		const move = (ev: PointerEvent) => setWidth(Math.min(600, Math.max(180, from + ev.clientX - start)))
		const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
	}

	const activeTab = tabs.find(t => t.id === active)
	return (
		<div className={`lw-space lw-${theme}`}>
			{!collapsed && (
				<>
					<div className="lw-space-side" style={{ width }}>
						<Explorer schemas={schemas} controller={controller} api={api} locale={workbench.locale} theme={theme} activeId={activeTab?.savedId}
							onOpen={openSaved} onOpenDomain={openDomain}
							onOpenEntity={(schema, entity) => newQuery(schema, undefined, { query: `${entity}.page(1, 10)` }, entity)}
							onNewQuery={(schema, parentId) => newQuery(schema, parentId)} />
					</div>
					<div className="lw-space-resizer" role="separator" aria-orientation="vertical" onPointerDown={startResize} />
				</>
			)}
			<div className="lw-space-main">
				<div className={`lw-tabs lw-${theme}`}>
					<div className="lw-tabbar" role="tablist" aria-label="tabs">
						<button className="lw-icon-button lw-side-toggle" aria-label={collapsed ? x.showExplorer : x.hideExplorer} title={collapsed ? x.showExplorer : x.hideExplorer}
							aria-pressed={!collapsed} onClick={() => setCollapsed(!collapsed)}><Icons.panel /></button>
						{diagram && (
							<div className={`lw-tab lw-tab-model ${active === MODEL ? 'lw-active' : ''}`}>
								<button role="tab" aria-selected={active === MODEL} onClick={() => setActive(MODEL)}>{m.model}</button>
							</div>
						)}
						{tabs.map(tab => {
							const title = savedOf(tab)?.name ?? tab.title
							const changed = dirty(tab)
							return (
								<div key={tab.id} className={`lw-tab ${tab.id === active ? 'lw-active' : ''}`}>
									<button role="tab" aria-selected={tab.id === active} onClick={() => setActive(tab.id)} title={savedOf(tab)?.description || title}>
										{tab.kind === 'domain' ? <Icons.yaml /> : savedOf(tab) ? <Icons.query /> : null} {title}{changed && <span className="lw-dirty" title={x.unsaved}> •</span>}
									</button>
									<button className="lw-tab-close" aria-label={`close ${title}`} title={m.close} onClick={() => close(tab.id)}>×</button>
								</div>
							)
						})}
						<button className="lw-tab-add" aria-label="new tab" title={m.newTab} onClick={() => newQuery(schemas[0]?.path ?? '')}>+</button>
					</div>
					{notice && <div className="lw-notice" role="status">{notice}</div>}
					{diagram && (
						<div role="tabpanel" aria-label={m.model} hidden={active !== MODEL}>
							<DomainDiagram api={api} theme={theme} locale={workbench.locale} onQuery={(schema, entity) => newQuery(schema, undefined, { query: `${entity}.page(1, 10)` }, entity)} />
						</div>
					)}
					{tabs.map(tab => (
						<div key={tab.id} role="tabpanel" aria-label={savedOf(tab)?.name ?? tab.title} hidden={tab.id !== active}
							onKeyDownCapture={tab.kind === 'query' ? e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(tab) } } : undefined}>
							{tab.kind === 'domain'
								? <DomainYaml api={api} schema={tab.schema ?? ''} theme={theme} loading={x.loading} readOnly={x.readOnly} />
								: <QueryPanel tab={tab} workbench={{ ...workbench, api }} onContent={onContent}
									toolbar={(
										<span className="lw-save">
											<button onClick={() => save(tab)} disabled={contents.current.get(tab.id)?.schema === undefined} title="Ctrl+S">{x.save}</button>
											<button onClick={() => save(tab, true)} disabled={contents.current.get(tab.id)?.schema === undefined}>{x.saveAs}</button>
											{savedOf(tab) && !dirty(tab) && <span className="lw-muted">{x.saved}</span>}
										</span>
									)} />}
						</div>
					))}
				</div>
			</div>

			{saving && (
				<ItemDialog title={x.saveQuery} submit={x.save} texts={x} theme={theme}
					initial={{ name: saving.as ? '' : (savedOf(saving.tab)?.name ?? (saving.tab.title.startsWith(m.tabNamed) ? '' : saving.tab.title)), parentId: saving.tab.parentId }}
					folders={folderPaths(state.items, contents.current.get(saving.tab.id)?.schema ?? '')}
					onClose={() => setSaving(undefined)}
					onSubmit={async v => {
						const content = contents.current.get(saving.tab.id)
						if (!content || content.schema === undefined) return
						try {
							const query = await controller.createQuery({ schema: content.schema, ...v },
								{ mode: content.mode, query: content.query, script: content.script, data: content.data, options: content.options })
							setTabs(t => t.map(tab => tab.id === saving.tab.id ? { ...tab, savedId: query.id, schema: query.schema, parentId: query.parentId } : tab))
						} catch (e) { return problemText(e, x) }
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
