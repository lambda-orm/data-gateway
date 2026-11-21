import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { QueryApiPort, SchemaInfo } from '../application/ports'
import { WorkspaceController, WorkspaceError } from '../application/workspaceController'
import { cardinalityOf, DomainInfo, typeText } from '../domain/diagram'
import { ExplorerMessages, explorerMessagesOf, format } from '../domain/explorerI18n'
import { filterEntities } from '../domain/entityFilter'
import { Locale } from '../domain/i18n'
import { childrenOf, folderPaths, SavedItem, subtreeOf } from '../domain/savedItems'
import { ConfirmDialog, Icons, ItemDialog, MenuButton, Modal } from './dialogs'

export interface ExplorerProps {
	schemas: SchemaInfo[]
	controller: WorkspaceController
	api: QueryApiPort
	locale?: Locale
	theme?: 'light' | 'dark'
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
}

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
export const Explorer: React.FC<ExplorerProps> = ({ schemas, controller, api, locale, theme, activeId, onOpen, onOpenEntity, onOpenDomain, onNewQuery, onNewDiagram, loadDomain: domainOf }) => {
	const m = explorerMessagesOf(locale)
	const state = useSyncExternalStore(controller.subscribe, controller.getState)
	const [expanded, setExpanded] = useState<Set<string>>(new Set())
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

	const loadDomain = (schema: string) => {
		if (domains[schema] !== undefined) return
		const read = domainOf ?? (api.domain ? (path: string) => api.domain!(path) : undefined)
		if (!read) { setDomains(d => ({ ...d, [schema]: 'no domain' })); return }
		setDomains(d => ({ ...d, [schema]: m.loading }))
		read(schema).then(domain => setDomains(d => ({ ...d, [schema]: domain })), e => setDomains(d => ({ ...d, [schema]: e?.message ?? String(e) })))
	}

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

	const creators = (schema: string, parentId?: string) => (
		<MenuButton label={m.add} icon={<Icons.plus />} items={[
			{ label: m.newFolder, icon: <Icons.folderPlus />, onClick: () => setDialog({ kind: 'folder', schema, parentId }) },
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
					icon={isFolder ? <Icons.folder /> : item.kind === 'diagram' ? <Icons.diagram /> : <Icons.query />}
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
		if (typeof domain === 'string') return [<Row key="e-status" level={3} label={domain} icon={null} muted />]
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
			<div key="e-filter" className="lw-tree-filter" style={{ paddingLeft: 6 + 2 * 14 }}>
				<input type="search" value={filter} placeholder={m.filterEntities} aria-label={m.filterEntities} spellCheck={false}
					onChange={e => setFilters(f => ({ ...f, [schema]: e.target.value }))}
					onKeyDown={e => { if (e.key === 'Escape') setFilters(f => ({ ...f, [schema]: '' })) }} />
				{filter.trim() !== '' && <span className="lw-type" role="status">{format(m.matchesOf, { n: found.length, total: domain.entities.length })}</span>}
			</div>
		)
		if (found.length === 0) return [head, <Row key="e-none" level={3} label={m.noMatches} icon={null} muted />]
		return [head, ...found.flatMap(({ entity, properties: matchedProperties, relations: matchedRelations }) => {
			const key = `en:${schema}:${entity.name}`
			const propertiesKey = `ep:${schema}:${entity.name}`
			const relationsKey = `er:${schema}:${entity.name}`
			const relations = entity.relations ?? []
			const rows: React.ReactNode[] = [
				<Row key={key} level={3} label={entity.name} icon={<Icons.entity />} title={`${entity.name} — ${m.openEntity}`}
					expanded={expanded.has(key)} onToggle={() => toggle(key)} onOpen={() => onOpenEntity(schema, entity.name)}
					actions={<Action label={m.open} onClick={() => onOpenEntity(schema, entity.name)}><Icons.open /></Action>} />
			]
			if (!expanded.has(key)) {
				// what the filter found in it, without opening it
				rows.push(...matchedProperties.map(name => propertyRow(entity, name, `${key}.p.${name}`, 4)))
				rows.push(...matchedRelations.map(name => relationRow(entity, name, `${key}.r.${name}`, 4)))
				return rows
			}
			rows.push(<Row key={propertiesKey} level={4} label={`${m.properties} (${entity.properties?.length ?? 0})`} icon={null}
				expanded={expanded.has(propertiesKey)} onToggle={() => toggle(propertiesKey)} />)
			if (expanded.has(propertiesKey)) rows.push(...(entity.properties ?? []).map(p => propertyRow(entity, p.name, `${propertiesKey}.${p.name}`, 5)))
			rows.push(<Row key={relationsKey} level={4} label={`${m.relations} (${relations.length})`} icon={null}
				expanded={expanded.has(relationsKey)} onToggle={() => toggle(relationsKey)} />)
			if (expanded.has(relationsKey)) rows.push(...relations.map(r => relationRow(entity, r.name, `${relationsKey}.${r.name}`, 5)))
			return rows
		})]
	}

	const folders = (schema: string) => folderPaths(state.items, schema)

	return (
		<nav className={`lw-explorer lw-workbench lw-${theme ?? 'light'}`} aria-label={m.explorer}>
			<div className="lw-explorer-head">
				<strong>{m.explorer}</strong>
				<span className="lw-spacer" />
				<Action label={m.exportWorkspace} onClick={download}><Icons.download /></Action>
				<Action label={m.importWorkspace} onClick={() => file.current?.click()}><Icons.upload /></Action>
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
									icon={<Icons.schema />} muted expanded={expanded.has(key)} onToggle={() => toggle(key)} title={s.reason ?? s.status} />
								{expanded.has(key) && <div className="lw-schema-reason" role="note" style={{ paddingLeft: 6 + 14 + 22 }}>{s.reason ?? m.noReason}</div>}
							</React.Fragment>
						)
					}
					const entitiesKey = `e:${s.path}`
					const saved = expanded.has(key) ? savedRows(s.path, undefined, 2) : []
					return (
						<React.Fragment key={s.path}>
							<Row level={1} label={s.path || '/'} icon={<Icons.schema />} expanded={expanded.has(key)} onToggle={() => toggle(key)}
								dropTarget={{ onDrop: id => move(id, undefined) }} actions={creators(s.path)} />
							{expanded.has(key) && (
								<>
									<Row level={2} label={m.domainYaml} icon={<Icons.yaml />} onOpen={() => onOpenDomain(s.path)} title={`${m.domainYaml} — ${m.readOnly}`} />
									<Row level={2} label={m.entities} icon={<Icons.entity />} expanded={expanded.has(entitiesKey)}
										onToggle={() => { toggle(entitiesKey); loadDomain(s.path) }} />
									{expanded.has(entitiesKey) && entityRows(s.path)}
									{saved}
									{state.loaded && saved.length === 0 && <Row level={2} label={m.nothingSaved} icon={null} muted />}
								</>
							)}
						</React.Fragment>
					)
				})}
			</div>

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
