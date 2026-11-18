import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { SchemaInfo, WorkspaceStore } from '../application/ports'
import { WorkspaceController } from '../application/workspaceController'
import { DomainInfo, edgesOf } from '../domain/diagram'
import { explorerMessagesOf } from '../domain/explorerI18n'
import { messagesOf } from '../domain/i18n'
import { toYaml } from '../domain/results'
import { folderPaths, SavedDiagram, SavedItem, SavedQuery, SavedQueryContent } from '../domain/savedItems'
import { RestQueryApi } from '../infrastructure/restQueryApi'
import { IndexedDbWorkspaceStore } from '../infrastructure/workspaceStores'
import { CodeEditor } from './CodeEditor'
import { DiagramDialog, Icons, ItemDialog } from './dialogs'
import { DomainDiagram } from './DomainDiagram'
import { EntityView } from './EntityView'
import { Explorer, problemText } from './Explorer'
import { QueryWorkbench, QueryWorkbenchProps } from './QueryWorkbench'

export interface WorkspaceProps extends Omit<QueryWorkbenchProps, 'initial' | 'onContentChange' | 'toolbar' | 'initialSchema' | 'schema'> {
	/** Where the saved items are kept; by default IndexedDB of the browser under workspaceKey */
	store?: WorkspaceStore
	/** Separates the saved items (for example the gateway and the user): the same key, the same items */
	workspaceKey?: string
	/** At most this many tabs (default 20) */
	maxTabs?: number
}

type TabKind = 'query' | 'domain' | 'entity' | 'diagram'

interface DiagramDraft { entities: string[], positions?: Record<string, { x: number, y: number }>, compact: boolean }

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
}

const SAME = (a: SavedQueryContent, b: SavedQueryContent) => a.mode === b.mode && a.query === b.query && a.script === b.script && a.data === b.data && a.options === b.options
const contentOf = (q: SavedQuery): SavedQueryContent => ({ mode: q.mode, query: q.query, script: q.script, data: q.data, options: q.options })
const draftOf = (d: SavedDiagram): DiagramDraft => ({ entities: d.entities, positions: d.positions, compact: d.compact ?? false })
const sameDraft = (a: DiagramDraft, b: DiagramDraft) => a.compact === b.compact && a.entities.join('\n') === b.entities.join('\n') && JSON.stringify(a.positions ?? null) === JSON.stringify(b.positions ?? null)

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
export const Workspace: React.FC<WorkspaceProps> = ({ store, workspaceKey, maxTabs = 20, ...workbench }) => {
	const theme = workbench.theme ?? 'light'
	const m = messagesOf(workbench.locale)
	const x = explorerMessagesOf(workbench.locale)
	const api = useMemo(() => workbench.api ?? new RestQueryApi(workbench.baseUrl ?? '', workbench.headers), [workbench.api, workbench.baseUrl, workbench.headers])
	const controller = useMemo(() => new WorkspaceController(store ?? new IndexedDbWorkspaceStore(workspaceKey ?? workbench.baseUrl ?? 'default')), [store, workspaceKey, workbench.baseUrl])
	const state = useSyncExternalStore(controller.subscribe, controller.getState)
	const [schemas, setSchemas] = useState<SchemaInfo[]>([])
	const [tabs, setTabs] = useState<Tab[]>([{ id: 1, kind: 'query', title: `${m.tabNamed} 1` }])
	const [active, setActive] = useState(1)
	const [next, setNext] = useState(2)
	const [width, setWidth] = useState(280)
	const [collapsed, setCollapsed] = useState(false)
	const [saving, setSaving] = useState<{ tab: Tab, as: boolean }>()
	const [creatingDiagram, setCreatingDiagram] = useState<{ schema: string, parentId?: string }>()
	const [choosingEntities, setChoosingEntities] = useState<Tab>()
	const [notice, setNotice] = useState<string>()
	// the content of each query tab as it is typed: a ref (no render per key), and a tick to show unsaved changes
	const contents = useRef(new Map<number, SavedQueryContent & { schema?: string }>())
	const [, setTick] = useState(0)

	// the domain of each schema is read once, for the explorer, the forms, the diagrams and the YAML
	const domains = useRef(new Map<string, Promise<DomainInfo>>())
	useEffect(() => { domains.current.clear() }, [api])
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
	const loaders = useRef(new Map<string, () => Promise<DomainInfo>>())
	const loaderOf = (schema: string) => {
		if (!loaders.current.has(schema)) loaders.current.set(schema, () => domainOf(schema))
		return loaders.current.get(schema)!
	}
	const pickerDomain = (schema: string) => async () => {
		const domain = await domainOf(schema)
		const edges = edgesOf(domain)
		return {
			names: domain.entities.map(e => e.name).sort((a, b) => a.localeCompare(b)),
			neighbours: (name: string) => edges.flatMap(e => e.parent === name ? [e.child] : e.child === name ? [e.parent] : [])
		}
	}

	useEffect(() => { controller.load() }, [controller])
	useEffect(() => { api.schemas().then(all => setSchemas(all.filter(s => s.status === 'ready')), () => setSchemas([])) }, [api])
	useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(undefined), 5000); return () => clearTimeout(t) }, [notice])

	const savedOf = (tab: Tab): SavedItem | undefined => tab.savedId ? state.items.find(i => i.id === tab.savedId) : undefined
	const dirty = (tab: Tab): boolean => {
		const saved = savedOf(tab)
		if (tab.kind === 'diagram') return saved?.kind === 'diagram' && !!tab.draft && !sameDraft(tab.draft, draftOf(saved))
		if (tab.kind !== 'query') return false
		const content = contents.current.get(tab.id)
		if (!content) return false
		if (saved?.kind !== 'query') return !!(content.query.trim() || content.script.trim())
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
		if (active === id) setActive(rest[Math.max(0, index - 1)]?.id ?? -1)
	}
	const reuse = (match: (t: Tab) => boolean): boolean => {
		const already = tabs.find(match)
		if (already) setActive(already.id)
		return !!already
	}
	const openSaved = (item: SavedItem) => {
		if (item.kind === 'folder' || reuse(t => t.savedId === item.id)) return
		if (item.kind === 'query') add({ kind: 'query', title: item.name, schema: item.schema, savedId: item.id, initial: contentOf(item) })
		else add({ kind: 'diagram', title: item.name, schema: item.schema, savedId: item.id, draft: draftOf(item) })
	}
	const newQuery = (schema: string, parentId?: string, initial?: Partial<SavedQueryContent>, title?: string) =>
		add({ kind: 'query', title: title ?? `${m.tabNamed} ${next}`, schema, parentId, initial })
	const queryEntity = (schema: string, entity: string) => newQuery(schema, undefined, { query: `${entity}.page(1, 10)` }, entity)
	const openEntity = (schema: string, entity: string) => {
		if (!reuse(t => t.kind === 'entity' && t.schema === schema && t.entity === entity)) add({ kind: 'entity', title: entity, schema, entity })
	}
	const openDomain = (schema: string) => {
		if (!reuse(t => t.kind === 'domain' && t.schema === schema)) add({ kind: 'domain', title: `${x.domainYaml} ${schema || '/'}`, schema })
	}
	const setDraft = (id: number, patch: Partial<DiagramDraft>) => setTabs(t => t.map(tab => tab.id === id && tab.draft ? { ...tab, draft: { ...tab.draft, ...patch } } : tab))

	const save = async (tab: Tab, as = false) => {
		const saved = savedOf(tab)
		if (tab.kind === 'diagram') {
			if (saved?.kind !== 'diagram' || !tab.draft) return
			try { await controller.update(saved.id, { entities: tab.draft.entities, positions: tab.draft.positions, compact: tab.draft.compact }) } catch (e) { setNotice(problemText(e, x)) }
			return
		}
		const content = contents.current.get(tab.id)
		if (!content || content.schema === undefined) return
		if (saved?.kind === 'query' && !as && saved.schema === content.schema) {
			try {
				await controller.update(saved.id, { mode: content.mode, query: content.query, script: content.script, data: content.data, options: content.options })
				setTick(t => t + 1)
			} catch (e) { setNotice(problemText(e, x)) }
			return
		}
		setSaving({ tab, as })
	}

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

	const iconOf = (tab: Tab) => tab.kind === 'domain' ? <Icons.yaml /> : tab.kind === 'entity' ? <Icons.entity /> : tab.kind === 'diagram' ? <Icons.diagram /> : savedOf(tab) ? <Icons.query /> : null
	const activeTab = tabs.find(t => t.id === active)
	const saveKeys = (tab: Tab) => (e: React.KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(tab) } }
	const texts = { ...x, entities: x.entities }

	return (
		<div className={`lw-space lw-${theme}`}>
			{!collapsed && (
				<>
					<div className="lw-space-side" style={{ width }}>
						<Explorer schemas={schemas} controller={controller} api={api} locale={workbench.locale} theme={theme} activeId={activeTab?.savedId}
							loadDomain={domainOf} onOpen={openSaved} onOpenDomain={openDomain} onOpenEntity={openEntity}
							onNewQuery={(schema, parentId) => newQuery(schema, parentId)}
							onNewDiagram={(schema, parentId) => setCreatingDiagram({ schema, parentId })} />
					</div>
					<div className="lw-space-resizer" role="separator" aria-orientation="vertical" onPointerDown={startResize} />
				</>
			)}
			<div className="lw-space-main">
				<div className={`lw-tabs lw-${theme}`}>
					<div className="lw-tabbar" role="tablist" aria-label="tabs">
						<button className="lw-icon-button lw-side-toggle" aria-label={collapsed ? x.showExplorer : x.hideExplorer} title={collapsed ? x.showExplorer : x.hideExplorer}
							aria-pressed={!collapsed} onClick={() => setCollapsed(!collapsed)}><Icons.panel /></button>
						{tabs.map(tab => {
							const saved = savedOf(tab)
							const title = saved?.name ?? tab.title
							return (
								<div key={tab.id} className={`lw-tab ${tab.id === active ? 'lw-active' : ''}`}>
									<button role="tab" aria-selected={tab.id === active} onClick={() => setActive(tab.id)} title={saved?.description || title}>
										{iconOf(tab)} {title}{dirty(tab) && <span className="lw-dirty" title={x.unsaved}> •</span>}
									</button>
									<button className="lw-tab-close" aria-label={`close ${title}`} title={m.close} onClick={() => close(tab.id)}>×</button>
								</div>
							)
						})}
						<button className="lw-tab-add" aria-label="new tab" title={m.newTab} onClick={() => newQuery(schemas[0]?.path ?? '')}>+</button>
					</div>
					{notice && <div className="lw-notice" role="status">{notice}</div>}
					{tabs.length === 0 && <div className={`lw-workbench lw-${theme}`}><p className="lw-muted">{x.nothingOpen}</p></div>}
					{tabs.map(tab => {
						const saved = savedOf(tab)
						return (
							<div key={tab.id} role="tabpanel" aria-label={saved?.name ?? tab.title} hidden={tab.id !== active}
								onKeyDownCapture={tab.kind === 'query' || tab.kind === 'diagram' ? saveKeys(tab) : undefined}>
								{tab.kind === 'domain' && <DomainYaml domain={loaderOf(tab.schema ?? '')} schema={tab.schema ?? ''} theme={theme} loading={x.loading} readOnly={x.readOnly} />}
								{tab.kind === 'entity' && (
									<EntityView api={api} schema={tab.schema ?? ''} entity={tab.entity ?? ''} domain={loaderOf(tab.schema ?? '')} theme={theme} locale={workbench.locale}
										onOpenEntity={openEntity} onQuery={queryEntity} />
								)}
								{tab.kind === 'diagram' && tab.draft && (
									<div tabIndex={-1} className="lw-diagram-tab">
										<DomainDiagram api={api} schema={tab.schema ?? ''} theme={theme} locale={workbench.locale} entities={tab.draft.entities}
											positions={tab.draft.positions} onPositionsChange={positions => setDraft(tab.id, { positions })}
											compact={tab.draft.compact} onCompactChange={compact => setDraft(tab.id, { compact })}
											onOpenEntity={openEntity} exportName={saved?.name ?? tab.title}
											toolbar={(
												<span className="lw-save">
													<button onClick={() => save(tab)} disabled={!dirty(tab)} title="Ctrl+S">{x.save}</button>
													<button onClick={() => setChoosingEntities(tab)}>{x.editEntities}</button>
													{!dirty(tab) && <span className="lw-muted">{x.saved}</span>}
												</span>
											)} />
									</div>
								)}
								{tab.kind === 'query' && (
									<QueryPanel tab={tab} workbench={{ ...workbench, api }} onContent={onContent}
										toolbar={(
											<span className="lw-save">
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
			{creatingDiagram && (
				<DiagramDialog title={x.newDiagram} submit={x.create} texts={texts} theme={theme} domain={pickerDomain(creatingDiagram.schema)}
					initial={{ parentId: creatingDiagram.parentId }} folders={folderPaths(state.items, creatingDiagram.schema)}
					onClose={() => setCreatingDiagram(undefined)}
					onSubmit={async v => {
						try {
							const diagram = await controller.createDiagram({ schema: creatingDiagram.schema, name: v.name, description: v.description, parentId: v.parentId }, { entities: v.entities, compact: false })
							openSaved(diagram)
						} catch (e) { return problemText(e, x) }
					}} />
			)}
			{choosingEntities?.draft && (
				<DiagramDialog title={x.editEntities} submit={x.save} texts={texts} theme={theme} domain={pickerDomain(choosingEntities.schema ?? '')}
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
