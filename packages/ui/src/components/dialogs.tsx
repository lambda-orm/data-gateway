import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** A modal: the page behind can't be used; Escape or Cancel closes it. On the body: no panel clips it or covers it */
export const Modal: React.FC<{ title: string, onClose: () => void, children: React.ReactNode, theme?: 'light' | 'dark' }> = ({ title, onClose, children, theme = 'light' }) => {
	const box = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null
		const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
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

const icon = (path: React.ReactNode) => {
	const Icon: React.FC = () => (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
	)
	return Icon
}

export const Icons = {
	folder: icon(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
	folderPlus: icon(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v5M9.5 13.5h5" /></>),
	query: icon(<><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h5" /></>),
	queryPlus: icon(<><path d="M6 3h9l4 4v14H6z" /><path d="M12.5 11v6M9.5 14h6" /></>),
	diagram: icon(<><rect x="3" y="3" width="7" height="6" rx="1" /><rect x="14" y="15" width="7" height="6" rx="1" /><path d="M6.5 9v4.5h11V15" /></>),
	diagramPlus: icon(<><rect x="3" y="3" width="7" height="6" rx="1" /><path d="M6.5 9v4.5h5M17.5 12v6M14.5 15h6" /></>),
	entity: icon(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9h16" /></>),
	schema: icon(<><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>),
	yaml: icon(<><path d="M6 3h9l4 4v14H6z" /><path d="M9 11l2 3v3M13 11l-2 3" /></>),
	edit: icon(<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />),
	trash: icon(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />),
	chevron: icon(<path d="M9 6l6 6-6 6" />),
	upload: icon(<path d="M12 16V4M7 9l5-5 5 5M4 20h16" />),
	download: icon(<path d="M12 4v12M7 11l5 5 5-5M4 20h16" />),
	plus: icon(<path d="M12 5v14M5 12h14" />),
	panel: icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>)
}

/** A small button that opens a list of actions; a click outside or Escape closes it */
export const MenuButton: React.FC<{ label: string, icon: React.ReactNode, items: { label: string, icon?: React.ReactNode, onClick: () => void }[] }> = ({ label, icon: content, items }) => {
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
			<button className="lw-icon-button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{content}</button>
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
