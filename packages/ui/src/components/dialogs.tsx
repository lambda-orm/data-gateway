import React, { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpToLine, Boxes, Braces, ChartNetwork, ChevronRight, Code, Database, DatabasePlus, Download, Ellipsis, Eraser, FileCode, FileCog, FilePlus, FileSpreadsheet, FileText, Folder, FolderCode, FolderDown, FolderInput, FolderKanban, FolderOutput, FolderPlus, GitCompareArrows, HardDriveDownload, HardDriveUpload, Info, KeyRound, Layers, ListTree, Merge, PanelLeft, Pencil, Plug, Plus, Route, ScanSearch, Server, Settings2, SquareArrowOutUpRight, SquareTerminal, Table2, Trash2, Upload, Workflow, X, Cable, Copy, Hand, Library, MousePointer2, Network, TriangleAlert, WandSparkles, ListIndentIncrease, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react'
import { createPortal } from 'react-dom'

/** A modal: the page behind can't be used; Escape or Cancel closes it. On the body: no panel clips it or covers it */
export const Modal: React.FC<{ title: string, onClose: () => void, children: React.ReactNode, theme?: 'light' | 'dark' }> = ({ title, onClose, children, theme = 'light' }) => {
	const box = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null
		// only the one on top (a dialog opened from another one: the wizard and its tables to add)
		const escape = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return
			const open = document.querySelectorAll('.lw-modal')
			if (open[open.length - 1] !== box.current) return
			// an editor of the dialog with its suggestions (or its hints, its find) open: Escape closes those, not the dialog
			if (box.current?.querySelector('.monaco-editor .suggest-widget.visible, .monaco-editor .parameter-hints-widget.visible, .monaco-editor .find-widget.visible')) return
			e.stopPropagation()
			onClose()
		}
		document.addEventListener('keydown', escape, true)
		box.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
		return () => { document.removeEventListener('keydown', escape, true); previous?.focus?.() }
	}, [onClose])
	return createPortal(
		<div className={`lw-modal-back lw-workbench lw-${theme}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
			<div className="lw-modal" role="dialog" aria-modal="true" aria-label={title} ref={box}>
				<h3>{title}</h3>
				{children}
			</div>
		</div>,
		document.body
	)
}

export interface ItemDialogTexts { name: string, description: string, folder: string, top: string, cancel: string }

/** Name, description and (when there are folders to choose) the folder of an item */
export const ItemDialog: React.FC<{
	title: string
	submit: string
	texts: ItemDialogTexts
	initial?: { name?: string, description?: string, parentId?: string }
	folders?: { id: string, path: string }[]
	theme?: 'light' | 'dark'
	/** Saves; a text it throws (or returns) is shown and the dialog stays */
	onSubmit: (value: { name: string, description?: string, parentId?: string }) => Promise<string | undefined | void>
	onClose: () => void
}> = ({ title, submit, texts, initial = {}, folders, theme, onSubmit, onClose }) => {
	const [name, setName] = useState(initial.name ?? '')
	const [description, setDescription] = useState(initial.description ?? '')
	const [parentId, setParentId] = useState(initial.parentId ?? '')
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const send = async (e: React.FormEvent) => {
		e.preventDefault()
		setBusy(true)
		try {
			const problem = await onSubmit({ name: name.trim(), description: description.trim() || undefined, parentId: parentId || undefined })
			if (problem) setError(problem)
			else onClose()
		} catch (err: any) {
			setError(err?.message ?? String(err))
		} finally {
			setBusy(false)
		}
	}
	return (
		<Modal title={title} onClose={onClose} theme={theme}>
			<form className="lw-form" onSubmit={send}>
				<label>{texts.name}<input aria-label="name" value={name} onChange={e => { setName(e.target.value); setError(undefined) }} maxLength={120} /></label>
				<label>{texts.description}<textarea aria-label="description" value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={2000} /></label>
				{folders && (
					<label>{texts.folder}
						<select aria-label="folder" value={parentId} onChange={e => { setParentId(e.target.value); setError(undefined) }}>
							<option value="">{texts.top}</option>
							{folders.map(f => <option key={f.id} value={f.id}>{f.path}</option>)}
						</select>
					</label>
				)}
				{error && <div className="lw-notice" role="alert">{error}</div>}
				<div className="lw-form-actions">
					<button type="button" onClick={onClose}>{texts.cancel}</button>
					<button type="submit" className="lw-primary" disabled={busy}>{submit}</button>
				</div>
			</form>
		</Modal>
	)
}

/** A question with a dangerous answer (delete) */
export const ConfirmDialog: React.FC<{ title: string, message: string, confirm: string, cancel: string, theme?: 'light' | 'dark', onConfirm: () => void, onClose: () => void }> =
	({ title, message, confirm, cancel, theme, onConfirm, onClose }) => (
		<Modal title={title} onClose={onClose} theme={theme}>
			<p>{message}</p>
			<div className="lw-form-actions">
				<button onClick={onClose}>{cancel}</button>
				<button className="lw-danger" onClick={() => { onConfirm(); onClose() }}>{confirm}</button>
			</div>
		</Modal>
	)

/**
 * The icons of the workbench: Lucide (https://lucide.dev, ISC), one stroke in currentColor, so they take the color of the
 * theme (light or dark) and of the state of their button (hover, disabled). Each one imported by name: the bundle keeps
 * only these.
 */
const icon = (Glyph: LucideIcon) => {
	const Icon: React.FC<{ size?: number }> = ({ size = 16 }) => <Glyph size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" />
	return Icon
}

export const Icons = {
	folder: icon(Folder),
	folderPlus: icon(FolderPlus),
	query: icon(FileCode),
	queryPlus: icon(FilePlus),
	diagram: icon(Workflow),
	diagramPlus: icon(ChartNetwork),
	entity: icon(Table2),
	schema: icon(Database),
	yaml: icon(FileText),
	edit: icon(Pencil),
	trash: icon(Trash2),
	chevron: icon(ChevronRight),
	upload: icon(Upload),
	download: icon(Download),
	open: icon(SquareArrowOutUpRight),
	plus: icon(Plus),
	panel: icon(PanelLeft),
	terminal: icon(SquareTerminal),
	compare: icon(GitCompareArrows),
	exportData: icon(HardDriveDownload),
	saveData: icon(FolderDown),
	importData: icon(HardDriveUpload),
	push: icon(ArrowUpToLine),
	pull: icon(ArrowDownToLine),
	drop: icon(Eraser),
	introspect: icon(ScanSearch),
	incorporate: icon(Merge),
	code: icon(Code),
	info: icon(Info),
	more: icon(Ellipsis),
	close: icon(X),
	schemaPlus: icon(DatabasePlus),
	exportFolder: icon(FolderOutput),
	importFolder: icon(FolderInput),
	config: icon(FileCog),
	domain: icon(Boxes),
	enums: icon(ListTree),
	application: icon(Settings2),
	infrastructure: icon(Server),
	mappings: icon(Route),
	sources: icon(Plug),
	stages: icon(Layers),
	variables: icon(KeyRound),
	data: icon(FileSpreadsheet),
	src: icon(FolderCode),
	model: icon(Braces),
	projects: icon(FolderKanban),
	metadata: icon(Library),
	zoomIn: icon(ZoomIn),
	zoomOut: icon(ZoomOut),
	pointer: icon(MousePointer2),
	hand: icon(Hand),
	copy: icon(Copy),
	format: icon(ListIndentIncrease),
	// the query wizard (its magic wand); formatting a query is an indent
	wizard: icon(WandSparkles),
	connection: icon(Cable),
	connections: icon(Network),
	warning: icon(TriangleAlert)
}

/** A small button that opens a list of actions; a click outside or Escape closes it */
export const MenuButton: React.FC<{ label: string, icon: React.ReactNode, items: { label: string, icon?: React.ReactNode, onClick: () => void }[], disabled?: boolean, text?: boolean }> = ({ label, icon: content, items, disabled, text }) => {
	const [open, setOpen] = useState(false)
	const box = useRef<HTMLSpanElement>(null)
	useEffect(() => {
		if (!open) return
		const outside = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
		const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
		document.addEventListener('mousedown', outside)
		document.addEventListener('keydown', escape)
		return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
	}, [open])
	return (
		<span className="lw-menu" ref={box}>
			<button className={text ? 'lw-menu-text' : 'lw-icon-button'} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
				{content}{text && <> {label} ▾</>}
			</button>
			{open && (
				<span role="menu" className="lw-menu-list">
					{items.map(item => (
						<button key={item.label} role="menuitem" onClick={() => { setOpen(false); item.onClick() }}>{item.icon} {item.label}</button>
					))}
				</span>
			)}
		</span>
	)
}

export interface DiagramDialogTexts extends ItemDialogTexts {
	entities: string
	search: string
	addNeighbours: string
	clearSelection: string
	selectedCount: string
	chooseEntities: string
	loading: string
}

/**
 * A diagram: its name, description and folder (unless only the entities are edited) and the entities in it, chosen
 * with a search, one by one, or adding the neighbours of the chosen ones.
 */
export const DiagramDialog: React.FC<{
	title: string
	submit: string
	texts: DiagramDialogTexts
	/** The entities of the schema and, for each, the ones related to it */
	domain: () => Promise<{ names: string[], neighbours: (name: string) => string[] }>
	initial?: { name?: string, description?: string, parentId?: string, entities?: string[] }
	/** Without folders, only the entities are asked */
	folders?: { id: string, path: string }[]
	theme?: 'light' | 'dark'
	onSubmit: (value: { name: string, description?: string, parentId?: string, entities: string[] }) => Promise<string | undefined | void>
	onClose: () => void
}> = ({ title, submit, texts, domain, initial = {}, folders, theme, onSubmit, onClose }) => {
	const [name, setName] = useState(initial.name ?? '')
	const [description, setDescription] = useState(initial.description ?? '')
	const [parentId, setParentId] = useState(initial.parentId ?? '')
	const [chosen, setChosen] = useState<Set<string>>(new Set(initial.entities ?? []))
	const [all, setAll] = useState<{ names: string[], neighbours: (name: string) => string[] }>()
	const [search, setSearch] = useState('')
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	useEffect(() => { domain().then(setAll, e => setError(e?.message ?? String(e))) }, [domain])
	const shown = (all?.names ?? []).filter(n => n.toLowerCase().includes(search.trim().toLowerCase()))
	const flip = (n: string) => setChosen(c => { const next = new Set(c); if (next.has(n)) next.delete(n); else next.add(n); return next })
	const send = async (e: React.FormEvent) => {
		e.preventDefault()
		if (chosen.size === 0) { setError(texts.chooseEntities); return }
		setBusy(true)
		try {
			const entities = (all?.names ?? []).filter(n => chosen.has(n))
			const problem = await onSubmit({ name: name.trim(), description: description.trim() || undefined, parentId: parentId || undefined, entities })
			if (problem) setError(problem)
			else onClose()
		} catch (err: any) {
			setError(err?.message ?? String(err))
		} finally {
			setBusy(false)
		}
	}
	return (
		<Modal title={title} onClose={onClose} theme={theme}>
			<form className="lw-form" onSubmit={send}>
				{folders && (
					<>
						<label>{texts.name}<input aria-label="name" value={name} onChange={e => { setName(e.target.value); setError(undefined) }} maxLength={120} /></label>
						<label>{texts.description}<textarea aria-label="description" value={description} onChange={e => setDescription(e.target.value)} rows={2} maxLength={2000} /></label>
						<label>{texts.folder}
							<select aria-label="folder" value={parentId} onChange={e => setParentId(e.target.value)}>
								<option value="">{texts.top}</option>
								{folders.map(f => <option key={f.id} value={f.id}>{f.path}</option>)}
							</select>
						</label>
					</>
				)}
				<fieldset className="lw-picker">
					<legend>{texts.entities} · {texts.selectedCount.replace('{n}', String(chosen.size))}</legend>
					<div className="lw-picker-bar">
						<input aria-label="search entities" placeholder={texts.search} value={search} onChange={e => setSearch(e.target.value)} />
						<button type="button" disabled={!all || chosen.size === 0}
							onClick={() => setChosen(c => new Set([...c, ...[...c].flatMap(n => all!.neighbours(n))]))}>{texts.addNeighbours}</button>
						<button type="button" disabled={chosen.size === 0} onClick={() => setChosen(new Set())}>{texts.clearSelection}</button>
					</div>
					<div className="lw-picker-list" role="group" aria-label={texts.entities}>
						{!all && <span className="lw-muted">{texts.loading}</span>}
						{shown.map(n => (
							<label key={n} className="lw-check"><input type="checkbox" checked={chosen.has(n)} onChange={() => { flip(n); setError(undefined) }} /> {n}</label>
						))}
					</div>
				</fieldset>
				{error && <div className="lw-notice" role="alert">{error}</div>}
				<div className="lw-form-actions">
					<button type="button" onClick={onClose}>{texts.cancel}</button>
					<button type="submit" className="lw-primary" disabled={busy}>{submit}</button>
				</div>
			</form>
		</Modal>
	)
}

export interface NewSchemaTexts { title: string, route: string, routeHint: string, startFrom: string, empty: string, copyOf: string, create: string, cancel: string, name: string, description: string, rootTaken: string }

/** A new schema: its route and what it starts from (empty, or a copy of another one) */
export const NewSchemaDialog: React.FC<{
	texts: NewSchemaTexts
	schemas: string[]
	theme?: 'light' | 'dark'
	/** a text it throws is shown and the dialog stays */
	onSubmit: (value: { path: string, copyOf?: string, name?: string, description?: string }) => Promise<void>
	onClose: () => void
}> = ({ texts, schemas, theme, onSubmit, onClose }) => {
	const [path, setPath] = useState('')
	const [copyOf, setCopyOf] = useState('')
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	// a schema at the root is the only one the gateway serves: the others would be under its routes
	const rootTaken = schemas.includes('')
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const send = async (e: React.FormEvent) => {
		e.preventDefault()
		setBusy(true)
		try {
			await onSubmit({ path: path.trim(), copyOf: copyOf === '' ? undefined : copyOf, name: name.trim() || undefined, description: description.trim() || undefined })
			onClose()
		} catch (err: any) {
			setError(err?.message ?? String(err))
		} finally {
			setBusy(false)
		}
	}
	return (
		<Modal title={texts.title} onClose={onClose} theme={theme}>
			<form className="lw-form" onSubmit={send}>
				<label>{texts.route}<input aria-label="route" value={path} placeholder="sales/v1" onChange={e => { setPath(e.target.value); setError(undefined) }} maxLength={200} /></label>
				<small className="lw-type">{texts.routeHint}</small>
				<label>{texts.name}<input aria-label={texts.name} value={name} onChange={e => setName(e.target.value)} maxLength={200} /></label>
				<label>{texts.description}<textarea aria-label={texts.description} rows={3} value={description} onChange={e => setDescription(e.target.value)} /></label>
				<label>{texts.startFrom}
					<select aria-label="start from" value={copyOf} onChange={e => setCopyOf(e.target.value)}>
						<option value="">{texts.empty}</option>
						{schemas.map(s => <option key={s} value={s}>{texts.copyOf.replace('{name}', s || '/')}</option>)}
					</select>
				</label>
				{rootTaken && <div className="lw-notice" role="alert">{texts.rootTaken}</div>}
				{error && <div className="lw-notice" role="alert">{error}</div>}
				<div className="lw-form-actions">
					<button type="button" onClick={onClose}>{texts.cancel}</button>
					<button type="submit" className="lw-primary" disabled={busy || path.trim() === '' || rootTaken}>{texts.create}</button>
				</div>
			</form>
		</Modal>
	)
}

/** Removes a schema only once its route is typed again */
export const RemoveSchemaDialog: React.FC<{
	title: string
	message: string
	schema: string
	confirm: string
	cancel: string
	theme?: 'light' | 'dark'
	onConfirm: () => Promise<void>
	onClose: () => void
}> = ({ title, message, schema, confirm, cancel, theme, onConfirm, onClose }) => {
	const [typed, setTyped] = useState('')
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const send = async (e: React.FormEvent) => {
		e.preventDefault()
		setBusy(true)
		try {
			await onConfirm()
			onClose()
		} catch (err: any) {
			setError(err?.message ?? String(err))
		} finally {
			setBusy(false)
		}
	}
	return (
		<Modal title={title} onClose={onClose} theme={theme}>
			<form className="lw-form" onSubmit={send}>
				<p>{message}</p>
				<input aria-label="confirm route" value={typed} onChange={e => setTyped(e.target.value)} placeholder={schema} />
				{error && <div className="lw-notice" role="alert">{error}</div>}
				<div className="lw-form-actions">
					<button type="button" onClick={onClose}>{cancel}</button>
					<button type="submit" className="lw-danger" disabled={busy || typed !== schema}>{confirm}</button>
				</div>
			</form>
		</Modal>
	)
}
