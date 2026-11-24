import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { QueryApiPort, SchemaInfo } from '../application/ports'
import { WorkspaceController, WorkspaceError } from '../application/workspaceController'
import { cardinalityOf, DomainInfo, typeText } from '../domain/diagram'
import { ExplorerMessages, explorerMessagesOf, format } from '../domain/explorerI18n'
import { filterEntities } from '../domain/entityFilter'
import { Locale } from '../domain/i18n'
import { childrenOf, folderPaths, SavedItem, subtreeOf } from '../domain/savedItems'
import { ConfirmDialog, Icons, ItemDialog, MenuButton, Modal } from './dialogs'
import { adminMessagesOf } from '../domain/adminI18n'
import { FormFocus } from './SchemaForms'
import { AdminApiPort, AdminCapabilities } from '../application/ports'
import { BuildDialog, downloadBlob } from './BuildDialog'

export interface ExplorerProps {
	schemas: SchemaInfo[]
	controller: WorkspaceController
	/** Asked to read again (its Refresh): what it has read of a schema, or of all when schema is undefined */
	refresh?: { n: number, schema?: string }
	/** Its Refresh of a schema (a button on its row) */
	onRefreshSchema?: (schema: string) => void
	api: QueryApiPort
	locale?: Locale
	theme?: 'light' | 'dark'
	/** What is unfolded, to start with (a restored session); later changes come through onExpandedChange */
	expanded?: string[]
	onExpandedChange?: (keys: string[]) => void
	/** The saved item of the active tab, marked */
	activeId?: string
	onOpen: (item: SavedItem) => void
	/** Open the form of an entity */
	onOpenEntity: (schema: string, entity: string) => void
	/** The domain of a schema, read once (the Workspace shares it with the forms); by default api.domain */
	loadDomain?: (schema: string) => Promise<DomainInfo>
	onOpenDomain: (schema: string) => void
	onNewQuery: (schema: string, parentId?: string) => void
	/** Without it, no diagrams are offered */
	onNewDiagram?: (schema: string, parentId?: string) => void
	/** The administration of the workspaces (admin.enabled), with what this credential may do there */
	admin?: ExplorerAdmin
}

export interface ExplorerAdmin {
	can: AdminCapabilities
	/** config: the lambdaORM.yaml (read first, Edit with schemaWrite) */
	onOpenSchemaFile: (schema: string) => void
	/** the schema itself: its tab with the commands in a toolbar */
	onOpenSchema?: (schema: string) => void
	/** one element of the schema (an entity, a source…), the application section or the variables */
	/** edit: asked by Edit (the form opens in edit), not by a click to read it */
	onOpenElement?: (schema: string, focus: FormFocus, edit?: boolean) => void
	/** a file of data/ or src/ */
	onOpenFile?: (schema: string, path: string) => void
	/** the diagram of a stage: its sources, the tables of each one, their conditions */
	onOpenStageDiagram?: (schema: string, stage: string) => void
	/** the administration itself: the code of the domain built (build), a folder of the code downloaded as a zip */
	api?: AdminApiPort
	/** the lambdaORM.yaml as an object (the lists of infrastructure) */
	loadSchemaDoc?: (schema: string) => Promise<any>
	/** the files under a folder of data/ or src/ */
	loadFiles?: (schema: string, dir?: string) => Promise<{ roots: { data: string, src: string, model: string }, files: { path: string, dir: boolean }[] }>
	onNewSchema: () => void
	onRemoveSchema: (schema: string) => void
}

/** the folders of src/ the build of the gateway writes, one for each of its languages */
const BUILD_FOLDERS = ['node', 'client-node']

type Dialog =
	| { kind: 'folder', schema: string, parentId?: string }
	| { kind: 'edit', item: SavedItem }
	| { kind: 'delete', item: SavedItem }
	| { kind: 'import', text: string }

const MIME = 'application/x-lambdaorm-item'

/** The text for a problem of the workspace, or the error as it is */
export const problemText = (error: unknown, m: ExplorerMessages): string => {
	if (error instanceof WorkspaceError) {
		switch (error.problem) {
		case 'required': return m.nameRequired
		case 'taken': return m.nameTaken
		case 'cannotMove': return m.cannotMove
		case 'invalidFile': return m.invalidFile
		}
	}
	return (error as any)?.message ?? String(error)
}

const Row: React.FC<{
	level: number, label: React.ReactNode, icon: React.ReactNode, expanded?: boolean, active?: boolean, title?: string, muted?: boolean
	onToggle?: () => void, onOpen?: () => void, actions?: React.ReactNode, drag?: string, dropTarget?: { onDrop: (id: string) => void }
}> = ({ level, label, icon, expanded, active, title, muted, onToggle, onOpen, actions, drag, dropTarget }) => {
	const [over, setOver] = useState(false)
	return (
		<div role="treeitem" aria-level={level} aria-expanded={expanded} aria-selected={active ?? false} tabIndex={0} title={title}
			className={`lw-tree-row ${active ? 'lw-active' : ''} ${over ? 'lw-drop' : ''} ${muted ? 'lw-muted' : ''}`}
			style={{ paddingLeft: 6 + (level - 1) * 14 }}
			draggable={drag !== undefined}
			onDragStart={drag !== undefined ? e => { e.dataTransfer.setData(MIME, drag); e.dataTransfer.effectAllowed = 'move' } : undefined}
			onDragOver={dropTarget ? e => { if (e.dataTransfer.types.includes(MIME)) { e.preventDefault(); setOver(true) } } : undefined}
			onDragLeave={dropTarget ? () => setOver(false) : undefined}
			onDrop={dropTarget ? e => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData(MIME); if (id) dropTarget.onDrop(id) } : undefined}
			onClick={() => { if (onToggle) onToggle(); else onOpen?.() }}
			onDoubleClick={onToggle && onOpen ? onOpen : undefined}
			onKeyDown={e => {
				if (e.target !== e.currentTarget) return
				if (e.key === 'Enter') { e.preventDefault(); if (onOpen) onOpen(); else onToggle?.() }
				if (e.key === 'ArrowRight' && expanded === false) onToggle?.()
				if (e.key === 'ArrowLeft' && expanded === true) onToggle?.()
			}}>
			<span className={`lw-chevron ${expanded ? 'lw-open' : ''}`}>{expanded !== undefined && <Icons.chevron />}</span>
			<span className="lw-tree-icon">{icon}</span>
			<span className="lw-tree-label">{label}</span>
			{actions && <span className="lw-tree-actions" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>{actions}</span>}
		</div>
	)
}

const Action: React.FC<{ label: string, onClick: () => void, children: React.ReactNode }> = ({ label, onClick, children }) => (
	<button className="lw-icon-button" aria-label={label} title={label} onClick={onClick}>{children}</button>
)

/**
 * The schemas on the left: for each, its domain (as YAML, read only), its entities with their properties, and what is
 * saved in it (folders, queries, diagrams) with a name and a description. Folders nest; items are dragged into them.
 * The whole workspace is exported to and imported from a JSON file.
 */
export const Explorer: React.FC<ExplorerProps> = ({ refresh, onRefreshSchema, schemas, controller, api, locale, theme, activeId, onOpen, onOpenEntity, onOpenDomain, onNewQuery, onNewDiagram, loadDomain: domainOf, admin, expanded: expandedProp, onExpandedChange }) => {
	const m = explorerMessagesOf(locale)
	const a = adminMessagesOf(locale)
	// the lambdaORM.yaml of a schema (to fix one that didn't start, too) and removing it
	const schemaFileRow = (schema: string, level = 2) => admin?.can.schemaRead
		? <Row level={level} label={a.config} icon={<Icons.config />} onOpen={() => admin.onOpenSchemaFile(schema)} title={a.schemaFile} />
		: null
	// what the workspace has that the domain doesn't say: the lambdaORM.yaml as written, the files of data/ and src/
	const [docs, setDocs] = useState<Record<string, any>>({})
	const [files, setFiles] = useState<Record<string, { path: string, dir: boolean }[] | string>>({})
	const [roots, setRoots] = useState<Record<string, { data: string, src: string, model: string }>>({})
	// the schema whose code is being built (its dialog), and the code being deleted (its confirmation)
	const [building, setBuilding] = useState<{ schema: string, language?: 'node' | 'client-node', name?: string }>()
	const [removingCode, setRemovingCode] = useState<{ schema: string, dir: string, name: string }>()
	const loadDoc = (schema: string) => {
		if (!admin?.loadSchemaDoc) return
		admin.loadSchemaDoc(schema).then(doc => setDocs(d => ({ ...d, [schema]: doc ?? {} })), () => setDocs(d => ({ ...d, [schema]: {} })))
	}
	const loadFolder = (schema: string, which: 'data' | 'src') => {
		if (!admin?.loadFiles) return
		const known = roots[schema]
		const id = `${schema}\0${which}`
		admin.loadFiles(schema, known ? known[which] : which === 'data' ? undefined : 'src')
			.then(async answer => {
				setRoots(r => ({ ...r, [schema]: answer.roots }))
				// without its roots, the first answer may be of another folder: ask again for the right one
				const list = known || which === 'data' ? answer : await admin.loadFiles!(schema, answer.roots[which])
				setFiles(f => ({ ...f, [id]: list.files }))
			}, e => setFiles(f => ({ ...f, [id]: e?.message ?? String(e) })))
	}
	// a schema reloaded: what was read of it, again
	const sinceSeen = useRef<Record<string, string | undefined>>({})
	useEffect(() => {
		for (const s of schemas) {
			const before = sinceSeen.current[s.path]
			sinceSeen.current[s.path] = s.since
			if (before === undefined || before === s.since) continue
			if (docs[s.path] !== undefined) loadDoc(s.path)
			for (const which of ['data', 'src'] as const) if (files[`${s.path}\0${which}`] !== undefined) loadFolder(s.path, which)
		}
	}, [schemas])
	const canWrite = !!admin?.can.schemaWrite && !!admin.onOpenElement
	const newOf = (schema: string, section: 'entities' | 'enums' | 'sources' | 'mappings' | 'stages') => canWrite
		? <Action label={format(a.newNamed, { name: a[section] })} onClick={() => admin!.onOpenElement!(schema, { section })}><Icons.plus /></Action>
		: null
	const elementRows = (schema: string, section: 'enums' | 'sources' | 'mappings' | 'stages', names: string[], level: number) => names.length === 0
		? [<Row key={`${section}-none`} level={level} label={a.empty} icon={null} muted />]
		: names.map(name => (
			<Row key={`${section}:${name}`} level={level} label={name} icon={section === 'enums' ? <Icons.enums /> : section === 'mappings' ? <Icons.mappings /> : section === 'sources' ? <Icons.sources /> : <Icons.stages />}
				onOpen={admin?.onOpenElement ? () => admin.onOpenElement!(schema, { section, name }) : undefined}
				actions={section === 'stages' && admin?.onOpenStageDiagram
					? <Action label={`${a.stageDiagram}: ${name}`} onClick={() => admin.onOpenStageDiagram!(schema, name)}><Icons.diagram /></Action>
					: undefined} />
		))
	const fileRows = (schema: string, which: 'data' | 'src', level: number) => {
		const list = files[`${schema}\0${which}`]
		if (list === undefined) return [<Row key={`${which}-loading`} level={level} label={m.loading} icon={null} muted />]
		if (typeof list === 'string') return [<Row key={`${which}-error`} level={level} label={list} icon={null} muted />]
		const root = roots[schema]?.[which] ?? which
		const shown = list.filter(f => !f.dir)
		if (shown.length === 0) return [<Row key={`${which}-none`} level={level} label={a.empty} icon={null} muted />]
		return shown.map(f => (
			<Row key={f.path} level={level} label={f.path.slice(root.length + 1)} icon={<Icons.query />} title={f.path}
				onOpen={admin?.onOpenFile ? () => admin.onOpenFile!(schema, f.path) : undefined} />
		))
	}
	// the language of a folder of code, by the extensions of its files (the most of them)
	const LANGUAGES: Record<string, string> = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', mjs: 'JavaScript', kt: 'Kotlin', java: 'Java', go: 'Go', py: 'Python', cs: 'C#', rs: 'Rust', php: 'PHP', rb: 'Ruby', swift: 'Swift', dart: 'Dart', scala: 'Scala' }
	/** what a node of code is named: its language, and the folder when it is the one of a build (node, client-node) */
	const codeName = (folder: string, paths: string[]): string => {
		const counts = new Map<string, number>()
		for (const p of paths) { const language = LANGUAGES[p.split('.').pop()?.toLowerCase() ?? '']; if (language) counts.set(language, (counts.get(language) ?? 0) + 1) }
		const language = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
		if (!language) return folder
		return BUILD_FOLDERS.includes(folder) ? `${language} · ${folder}` : language
	}
	// the source code: a folder of src/ for each language built (node, client-node…), with its files and its zip
	const codeRows = (schema: string, level: number, k: (part: string) => string, unfold: (part: string) => () => void) => {
		const list = files[`${schema}\0src`]
		if (list === undefined) return [<Row key="code-loading" level={level} label={m.loading} icon={null} muted />]
		if (typeof list === 'string') return [<Row key="code-error" level={level} label={list} icon={null} muted />]
		const root = roots[schema]?.src ?? 'src'
		const codes = [...new Set(list.filter(f => f.path.startsWith(`${root}/`)).map(f => f.path.slice(root.length + 1).split('/')[0]).filter(Boolean))].sort()
		if (codes.length === 0) return [<Row key="code-none" level={level} label={a.empty} icon={null} muted />]
		return codes.flatMap(name => {
			const dir = `${root}/${name}`
			const inside = list.filter(f => !f.dir && f.path.startsWith(`${dir}/`))
			const label = codeName(name, inside.map(f => f.path))
			const api = admin?.api
			const canBuild = !!admin?.can.build && !!api
			const actions = (
				<>
					{api?.folderZip && <Action label={format(a.downloadZip, { name: label })} onClick={() => { api.folderZip!(schema, dir).then(blob => downloadBlob(blob, `${schema.replace(/\//g, '_') || 'root'}-${name}.zip`), e => setMessage(e?.message ?? String(e))) }}><Icons.download /></Action>}
					{canBuild && BUILD_FOLDERS.includes(name) && (
						<Action label={format(a.rebuildCode, { name: label })} onClick={() => setBuilding({ schema, language: name as 'node' | 'client-node', name: label })}><Icons.rebuild /></Action>
					)}
					{canBuild && api!.removeCode && <Action label={format(a.removeCode, { name: label })} onClick={() => setRemovingCode({ schema, dir, name: label })}><Icons.trash /></Action>}
				</>
			)
			return [
				<Row key={`code:${name}`} level={level} label={label} icon={<Icons.code />} title={dir} expanded={expanded.has(k(`code:${name}`))} onToggle={unfold(`code:${name}`)} actions={actions} />,
				...(expanded.has(k(`code:${name}`))
					? inside.length
						? inside.map(f => <Row key={f.path} level={level + 1} label={f.path.slice(dir.length + 1)} icon={<Icons.query />} title={f.path} onOpen={admin?.onOpenFile ? () => admin.onOpenFile!(schema, f.path) : undefined} />)
						: [<Row key={`code:${name}-none`} level={level + 1} label={a.empty} icon={null} muted />]
					: [])
			]
		})
	}
	const namesIn = (list: unknown): string[] => Array.isArray(list) ? list.map((e: any) => e?.name).filter((n: unknown): n is string => typeof n === 'string') : []
	const removeSchema = (schema: string) => admin?.can.schemaAdmin
		? <Action label={`${a.removeSchema} ${schema || '/'}`} onClick={() => admin.onRemoveSchema(schema)}><Icons.trash /></Action>
		: null
	const state = useSyncExternalStore(controller.subscribe, controller.getState)
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set(expandedProp ?? []))
	// what was unfolded, restored (the state of the session): it replaces what there is
	useEffect(() => { if (expandedProp) setExpanded(new Set(expandedProp)) }, [expandedProp])
	useEffect(() => { onExpandedChange?.([...expanded]) }, [expanded])
	// the text that narrows the entities of each schema
	const [filters, setFilters] = useState<Record<string, string>>({})
	const [domains, setDomains] = useState<Record<string, DomainInfo | string>>({})
	const [dialog, setDialog] = useState<Dialog>()
	const [message, setMessage] = useState<string>()
	const file = useRef<HTMLInputElement>(null)

	// the first schema starts open
	const first = schemas[0]?.path
	useEffect(() => { if (first !== undefined) setExpanded(e => e.size ? e : new Set([`s:${first}`])) }, [first])
	useEffect(() => { if (!message) return; const t = setTimeout(() => setMessage(undefined), 5000); return () => clearTimeout(t) }, [message])

	const toggle = (key: string) => setExpanded(e => { const n = new Set(e); if (n.has(key)) n.delete(key); else n.add(key); return n })
	const open = (key: string) => setExpanded(e => e.has(key) ? e : new Set(e).add(key))

	// what an unfolded branch shows, read when it was unfolded by a restored session (not by a click)
	const requested = useRef(new Set<string>())
	useEffect(() => {
		for (const s of schemas) {
			const has = (part: string) => expanded.has(`${part}:${s.path}`)
			const once = (id: string, load: () => void) => { if (!requested.current.has(id)) { requested.current.add(id); load() } }
			if (has('d') || has('e') || has('n')) loadDomain(s.path)
			if (has('i') || has('mappings') || has('sources') || has('stages')) once(`doc:${s.path}`, () => loadDoc(s.path))
			if (has('da')) once(`data:${s.path}`, () => loadFolder(s.path, 'data'))
			if (has('sc')) once(`src:${s.path}`, () => loadFolder(s.path, 'src'))
		}
	}, [expanded, schemas])

	// a schema reloaded (another since): its domain again, if it was read
	const seen = useRef<Record<string, string | undefined>>({})
	useEffect(() => {
		for (const s of schemas) {
			const before = seen.current[s.path]
			seen.current[s.path] = s.since
			if (before === undefined || before === s.since || domains[s.path] === undefined) continue
			const read = domainOf ?? (api.domain ? (path: string) => api.domain!(path) : undefined)
			if (read) read(s.path).then(domain => setDomains(d => ({ ...d, [s.path]: domain })), () => undefined)
		}
	}, [schemas])

	const loadDomain = (schema: string) => {
		if (domains[schema] !== undefined) return
		const read = domainOf ?? (api.domain ? (path: string) => api.domain!(path) : undefined)
		if (!read) { setDomains(d => ({ ...d, [schema]: 'no domain' })); return }
		setDomains(d => ({ ...d, [schema]: m.loading }))
		read(schema).then(domain => setDomains(d => ({ ...d, [schema]: domain })), e => setDomains(d => ({ ...d, [schema]: e?.message ?? String(e) })))
	}

	// Refresh: what it read of the schema (or of all) is read again (its domain, its YAML, its folders)
	useEffect(() => {
		if (!refresh?.n) return
		const of = (path: string) => refresh.schema === undefined || refresh.schema === path
		const read = domainOf ?? (api.domain ? (path: string) => api.domain!(path) : undefined)
		for (const path of Object.keys(domains)) {
			if (!of(path) || !read) continue
			read(path).then(domain => setDomains(d => ({ ...d, [path]: domain })), e => setDomains(d => ({ ...d, [path]: e?.message ?? String(e) })))
		}
		for (const path of Object.keys(docs)) if (of(path)) loadDoc(path)
		for (const id of Object.keys(files)) {
			const [path, which] = id.split('\0')
			if (of(path) && (which === 'data' || which === 'src')) loadFolder(path, which)
		}
	}, [refresh?.n])

	const move = (id: string, parentId: string | undefined) => { controller.move(id, parentId).catch(e => setMessage(problemText(e, m))) }

	const download = () => {
		const url = URL.createObjectURL(new Blob([controller.exportText()], { type: 'application/json' }))
		const link = document.createElement('a')
		link.href = url
		link.download = `lambdaorm-workspace-${new Date().toISOString().slice(0, 10)}.json`
		document.body.appendChild(link)
		link.click()
		link.remove()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	}
	const chooseFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const chosen = e.target.files?.[0]
		e.target.value = ''
		if (!chosen) return
		const text = await chosen.text()
		setDialog({ kind: 'import', text })
	}
	const importAs = (text: string, mode: 'merge' | 'replace') => {
		setDialog(undefined)
		controller.importText(text, mode).then(n => setMessage(format(m.importDone, { n })), e => setMessage(problemText(e, m)))
	}

	const creators = (schema: string, parentId?: string, top = false) => (
		<MenuButton label={m.add} icon={<Icons.plus />} items={[
			{ label: top ? a.newProject : m.newFolder, icon: <Icons.folderPlus />, onClick: () => setDialog({ kind: 'folder', schema, parentId }) },
			{ label: m.newQuery, icon: <Icons.queryPlus />, onClick: () => onNewQuery(schema, parentId) },
			...(onNewDiagram ? [{ label: m.newDiagram, icon: <Icons.diagramPlus />, onClick: () => onNewDiagram(schema, parentId) }] : [])
		]} />
	)

	const savedRows = (schema: string, parentId: string | undefined, level: number): React.ReactNode[] =>
		childrenOf(state.items, schema, parentId).flatMap(item => {
			const key = `f:${item.id}`
			const isFolder = item.kind === 'folder'
			const edit = (
				<>
					<Action label={m.edit} onClick={() => setDialog({ kind: 'edit', item })}><Icons.edit /></Action>
					<Action label={m.remove} onClick={() => setDialog({ kind: 'delete', item })}><Icons.trash /></Action>
				</>
			)
			const row = (
				<Row key={item.id} level={level} label={item.name} title={item.description ? `${item.name}\n${item.description}` : item.name}
					icon={isFolder ? <Icons.folder /> : item.kind === 'diagram' ? (item.stage ? <Icons.stages /> : <Icons.diagram />) : <Icons.query />}
					expanded={isFolder ? expanded.has(key) : undefined} active={item.id === activeId}
					onToggle={isFolder ? () => toggle(key) : undefined} onOpen={isFolder ? undefined : () => onOpen(item)}
					drag={item.id} dropTarget={isFolder ? { onDrop: id => { if (id !== item.id) { move(id, item.id); open(key) } } } : undefined}
					actions={isFolder ? <>{creators(schema, item.id)}{edit}</> : edit} />
			)
			return isFolder && expanded.has(key) ? [row, ...savedRows(schema, item.id, level + 1)] : [row]
		})

	const entityRows = (schema: string): React.ReactNode[] => {
		const domain = domains[schema]
		if (domain === undefined) return []
		if (typeof domain === 'string') return [<Row key="e-status" level={5} label={domain} icon={null} muted />]
		const filter = filters[schema] ?? ''
		const found = filterEntities(domain.entities, filter)
		const propertyRow = (entity: typeof domain.entities[number], name: string, key: string, level: number) => {
			const p = (entity.properties ?? []).find(q => q.name === name)!
			const isKey = (entity.primaryKey ?? []).includes(name)
			return <Row key={key} level={level} icon={null} muted={!isKey}
				label={<span className="lw-property"><span className={isKey ? 'lw-pk' : ''}>{p.name}</span><span className="lw-type">{typeText(p)}</span></span>} />
		}
		const relationRow = (entity: typeof domain.entities[number], name: string, key: string, level: number) => {
			const r = (entity.relations ?? []).find(q => q.name === name)!
			return <Row key={key} level={level} icon={null} title={`${r.name}: ${r.from} → ${r.entity}.${r.to} (${r.type})`}
				onOpen={() => onOpenEntity(schema, r.entity)}
				actions={<Action label={`${m.open} ${r.entity}`} onClick={() => onOpenEntity(schema, r.entity)}><Icons.open /></Action>}
				label={<span className="lw-property"><span>{r.name}</span><span className="lw-type">→ {r.entity} · {cardinalityOf(r)}</span></span>} />
		}
		const head = (
			<div key="e-filter" className="lw-tree-filter" style={{ paddingLeft: 6 + 4 * 14 }}>
				<input type="search" value={filter} placeholder={m.filterEntities} aria-label={m.filterEntities} spellCheck={false}
					onChange={e => setFilters(f => ({ ...f, [schema]: e.target.value }))}
					onKeyDown={e => { if (e.key === 'Escape') setFilters(f => ({ ...f, [schema]: '' })) }} />
				{filter.trim() !== '' && <span className="lw-type" role="status">{format(m.matchesOf, { n: found.length, total: domain.entities.length })}</span>}
			</div>
		)
		if (found.length === 0) return [head, <Row key="e-none" level={5} label={m.noMatches} icon={null} muted />]
		return [head, ...found.flatMap(({ entity, properties: matchedProperties, relations: matchedRelations }) => {
			const key = `en:${schema}:${entity.name}`
			const propertiesKey = `ep:${schema}:${entity.name}`
			const relationsKey = `er:${schema}:${entity.name}`
			const relations = entity.relations ?? []
			const rows: React.ReactNode[] = [
				<Row key={key} level={5} label={entity.name} icon={<Icons.entity />} title={`${entity.name} — ${m.openEntity}`}
					expanded={expanded.has(key)} onToggle={() => { if (!expanded.has(key)) onOpenEntity(schema, entity.name); toggle(key) }} onOpen={() => onOpenEntity(schema, entity.name)} />
			]
			if (!expanded.has(key)) {
				// what the filter found in it, without opening it
				rows.push(...matchedProperties.map(name => propertyRow(entity, name, `${key}.p.${name}`, 6)))
				rows.push(...matchedRelations.map(name => relationRow(entity, name, `${key}.r.${name}`, 6)))
				return rows
			}
			rows.push(<Row key={propertiesKey} level={6} label={`${m.properties} (${entity.properties?.length ?? 0})`} icon={null}
				expanded={expanded.has(propertiesKey)} onToggle={() => toggle(propertiesKey)} />)
			if (expanded.has(propertiesKey)) rows.push(...(entity.properties ?? []).map(p => propertyRow(entity, p.name, `${propertiesKey}.${p.name}`, 7)))
			rows.push(<Row key={relationsKey} level={6} label={`${m.relations} (${relations.length})`} icon={null}
				expanded={expanded.has(relationsKey)} onToggle={() => toggle(relationsKey)} />)
			if (expanded.has(relationsKey)) rows.push(...relations.map(r => relationRow(entity, r.name, `${relationsKey}.${r.name}`, 7)))
			return rows
		})]
	}

	const folders = (schema: string) => folderPaths(state.items, schema)

	return (
		<nav className={`lw-explorer lw-workbench lw-${theme ?? 'light'}`} aria-label={m.explorer}>
			<div className="lw-explorer-head">
				<strong>{a.schemas}</strong>
				<span className="lw-spacer" />
				{admin?.can.schemaAdmin && <Action label={a.newSchema} onClick={admin.onNewSchema}><Icons.schemaPlus /></Action>}
				<Action label={m.exportWorkspace} onClick={download}><Icons.exportFolder /></Action>
				<Action label={m.importWorkspace} onClick={() => file.current?.click()}><Icons.importFolder /></Action>
				<input ref={file} type="file" accept="application/json,.json" hidden onChange={chooseFile} aria-label={m.importWorkspace} />
			</div>
			{!state.durable && <div className="lw-notice">{m.notDurable}</div>}
			{state.error && <div className="lw-notice" role="alert">{state.error}</div>}
			{message && <div className="lw-notice lw-toast" role="status">{message}</div>}
			<div role="tree" aria-label={m.explorer} className="lw-tree">
				{schemas.map(s => {
					const key = `s:${s.path}`
					if (s.status !== 'ready') {
						// a schema that didn't start (a database down, a variable not set): its reason, nothing to do in it
						return (
							<React.Fragment key={s.path}>
								<Row level={1} label={<span>{s.path || '/'} <span className="lw-type">{format(m.schemaStatus, { status: s.status })}</span></span>}
									icon={<Icons.schema />} muted expanded={expanded.has(key)} onToggle={() => toggle(key)} title={s.reason ?? s.status} actions={removeSchema(s.path)} />
								{expanded.has(key) && <div className="lw-schema-reason" role="note" style={{ paddingLeft: 6 + 14 + 22 }}>{s.reason ?? m.noReason}</div>}
								{expanded.has(key) && schemaFileRow(s.path)}
							</React.Fragment>
						)
					}
					// the schema as its workspace is: config, domain, application, infrastructure, data, src, projects
					const k = (part: string) => `${part}:${s.path}`
					const domainInfo = domains[s.path]
					const enums = typeof domainInfo === 'object' ? namesIn((domainInfo as any).enums) : []
					const doc = docs[s.path]
					const projects = expanded.has(k('p')) ? savedRows(s.path, undefined, 3) : []
					const unfold = (part: string, load?: () => void) => () => { toggle(k(part)); if (!expanded.has(k(part))) load?.() }
					return (
						<React.Fragment key={s.path}>
							<Row level={1} label={s.pending ? <span>{s.path || '/'} <span className="lw-pending" aria-label={m.schemaPending}>⚠</span></span> : s.path || '/'}
								icon={<Icons.schema />} expanded={expanded.has(key)}
								onToggle={() => { if (!expanded.has(key)) admin?.onOpenSchema?.(s.path); toggle(key) }}
								onOpen={admin?.onOpenSchema ? () => admin.onOpenSchema!(s.path) : undefined}
								title={s.pending ? `${m.schemaPending}: ${s.pending}` : undefined}
								actions={onRefreshSchema ? <Action label={format(m.refreshOf, { name: s.path || '/' })} onClick={() => onRefreshSchema(s.path)}><Icons.refresh /></Action> : undefined} />
							{expanded.has(key) && (
								<>
									{s.pending && <div className="lw-schema-reason lw-schema-pending" role="note" style={{ paddingLeft: 6 + 14 + 22 }}>{m.schemaPending}: {s.pending}</div>}
									<Row level={2} label={a.metadata} icon={<Icons.metadata />} expanded={expanded.has(k('md'))} onToggle={unfold('md')} />
									{expanded.has(k('md')) && (
										<>
											{schemaFileRow(s.path, 3)}
											<Row level={3} label={a.domain} icon={<Icons.domain />} expanded={expanded.has(k('d'))} onToggle={unfold('d', () => loadDomain(s.path))}
												onOpen={() => onOpenDomain(s.path)} title={`${m.domainYaml} — ${m.readOnly}`} />
											{expanded.has(k('d')) && (
												<>
													<Row level={4} label={m.entities} icon={<Icons.entity />} expanded={expanded.has(k('e'))}
														onToggle={unfold('e', () => loadDomain(s.path))} actions={newOf(s.path, 'entities')} />
													{expanded.has(k('e')) && entityRows(s.path)}
													<Row level={4} label={a.enums} icon={<Icons.enums />} expanded={expanded.has(k('n'))}
														onToggle={unfold('n', () => loadDomain(s.path))} actions={newOf(s.path, 'enums')} />
													{expanded.has(k('n')) && elementRows(s.path, 'enums', enums, 5)}
												</>
											)}
											{admin?.can.schemaRead && admin.onOpenElement && (
												<Row level={3} label={a.application} icon={<Icons.application />} onOpen={() => admin.onOpenElement!(s.path, { section: 'application' })} />
											)}
											{admin?.can.schemaRead && admin.loadSchemaDoc && (
												<>
													<Row level={3} label={a.infrastructure} icon={<Icons.infrastructure />} expanded={expanded.has(k('i'))} onToggle={unfold('i', () => loadDoc(s.path))} />
													{expanded.has(k('i')) && (['mappings', 'sources', 'stages'] as const).flatMap(section => [
														<Row key={section} level={4} label={a[section]} icon={section === 'mappings' ? <Icons.mappings /> : section === 'sources' ? <Icons.sources /> : <Icons.stages />} expanded={expanded.has(k(section))}
															onToggle={unfold(section, () => loadDoc(s.path))} actions={newOf(s.path, section)} />,
														...(expanded.has(k(section)) ? (doc === undefined ? [<Row key={`${section}-loading`} level={5} label={m.loading} icon={null} muted />] : elementRows(s.path, section, namesIn(doc?.infrastructure?.[section]), 5)) : [])
													])}
													{expanded.has(k('i')) && admin.onOpenElement && (
														<Row level={4} label={a.variables} icon={<Icons.variables />} onOpen={() => admin.onOpenElement!(s.path, { section: 'variables' })} />
													)}
												</>
											)}
										</>
									)}
									{admin?.can.schemaRead && admin.loadFiles && (
										<>
											<Row level={2} label={a.state} icon={<Icons.state />} expanded={expanded.has(k('st'))} onToggle={unfold('st')} />
											{expanded.has(k('st')) && <Row level={3} label={a.data} icon={<Icons.data />} expanded={expanded.has(k('da'))} onToggle={unfold('da', () => loadFolder(s.path, 'data'))} />}
											{expanded.has(k('st')) && expanded.has(k('da')) && fileRows(s.path, 'data', 4)}
											<Row level={2} label={a.sourceCode} icon={<Icons.src />} expanded={expanded.has(k('sc'))} onToggle={unfold('sc', () => loadFolder(s.path, 'src'))}
												actions={admin.can.build && admin.api ? <Action label={`${a.build}: ${s.path || '/'}`} onClick={() => setBuilding({ schema: s.path })}><Icons.code /></Action> : null} />
											{expanded.has(k('sc')) && codeRows(s.path, 3, k, unfold)}
										</>
									)}
									<Row level={2} label={a.projects} icon={<Icons.projects />} expanded={expanded.has(k('p'))} onToggle={unfold('p')}
										dropTarget={{ onDrop: id => move(id, undefined) }} actions={creators(s.path, undefined, true)} />
									{projects}
									{expanded.has(k('p')) && state.loaded && projects.length === 0 && <Row level={3} label={m.nothingSaved} icon={null} muted />}
								</>
							)}
						</React.Fragment>
					)
				})}
			</div>

			{removingCode && admin?.api?.removeCode && (
				<ConfirmDialog title={a.removeCode.replace('{name}', removingCode.name)} confirm={format(a.removeCode, { name: '' }).trim()} cancel={m.cancel} theme={theme}
					message={format(a.removeCodeConfirm, { name: removingCode.name, dir: removingCode.dir })}
					onConfirm={() => {
						const { schema, name } = removingCode
						admin.api!.removeCode!(schema, removingCode.dir).then(() => { setMessage(format(a.removedCode, { name })); loadFolder(schema, 'src') }, e => setMessage(e?.message ?? String(e)))
					}}
					onClose={() => setRemovingCode(undefined)} />
			)}
			{building && admin?.api && (
				<BuildDialog admin={admin.api} schema={building.schema} language={building.language} locale={locale} theme={theme} onClose={() => setBuilding(undefined)}
					onBuilt={(built, language) => {
						const { schema, name } = building
						setMessage(format(a.rebuilt, { name: name ?? language, n: built.filter(f => f.written === 'created' || f.written === 'updated').length }))
						loadFolder(schema, 'src')
						setExpanded(e => new Set([...e, `sc:${schema}`]))
					}} />
			)}
			{dialog?.kind === 'folder' && (
				<ItemDialog title={m.newFolder} submit={m.create} texts={m} theme={theme} initial={{ parentId: dialog.parentId }} folders={folders(dialog.schema)}
					onClose={() => setDialog(undefined)}
					onSubmit={async v => {
						try { const f = await controller.createFolder({ schema: dialog.schema, ...v }); open(v.parentId ? `f:${v.parentId}` : `s:${dialog.schema}`); open(`f:${f.id}`) } catch (e) { return problemText(e, m) }
					}} />
			)}
			{dialog?.kind === 'edit' && (
				<ItemDialog title={m.edit} submit={m.save} texts={m} theme={theme}
					initial={{ name: dialog.item.name, description: dialog.item.description, parentId: dialog.item.parentId }}
					folders={folders(dialog.item.schema).filter(f => !subtreeOf(state.items, dialog.item.id).includes(f.id))}
					onClose={() => setDialog(undefined)}
					onSubmit={async v => {
						try {
							if (v.parentId !== dialog.item.parentId) await controller.move(dialog.item.id, v.parentId)
							await controller.update(dialog.item.id, { name: v.name, description: v.description ?? '' })
						} catch (e) { return problemText(e, m) }
					}} />
			)}
			{dialog?.kind === 'delete' && (
				<ConfirmDialog title={m.deleteTitle} confirm={m.remove} cancel={m.cancel} theme={theme}
					message={dialog.item.kind === 'folder'
						? format(m.confirmDeleteFolder, { name: dialog.item.name, n: subtreeOf(state.items, dialog.item.id).length - 1 })
						: format(m.confirmDelete, { name: dialog.item.name })}
					onConfirm={() => { controller.remove(dialog.item.id).catch(e => setMessage(problemText(e, m))) }}
					onClose={() => setDialog(undefined)} />
			)}
			{dialog?.kind === 'import' && (
				<Modal title={m.importWorkspace} onClose={() => setDialog(undefined)} theme={theme}>
					<div className="lw-form-actions lw-column">
						<button className="lw-primary" onClick={() => importAs(dialog.text, 'merge')}>{m.importMerge}</button>
						<button className="lw-danger" onClick={() => importAs(dialog.text, 'replace')}>{m.importReplace}</button>
						<button onClick={() => setDialog(undefined)}>{m.cancel}</button>
					</div>
				</Modal>
			)}
		</nav>
	)
}
