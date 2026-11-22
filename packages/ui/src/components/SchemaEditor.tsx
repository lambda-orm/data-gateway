import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AdminApiPort, SchemaIssue } from '../application/ports'
import { adminMessagesOf, format } from '../domain/adminI18n'
import { EditorMarker } from '../domain/workspace'
import { CodeEditor } from './CodeEditor'
import { schemaCompletions } from '../domain/schemaCompletion'

export interface SchemaEditorProps {
	admin: AdminApiPort
	schema: string
	/** the credential may change it (schemaWrite) */
	writable: boolean
	/** changes when the gateway serves another version of the schema (its since): the file is read again */
	revision?: string
	/** a new version that didn't start (the previous one is serving) */
	pending?: string
	theme?: 'light' | 'dark'
	locale?: string
	/** a change not saved yet: the tab shows it */
	onDirty?: (dirty: boolean) => void
}

/** The issues as marks in the text: the whole line when the column is not known */
export const markersOf = (issues: SchemaIssue[]): EditorMarker[] => issues.filter(i => i.line !== undefined).map(i => ({
	message: i.message,
	severity: i.severity,
	startLineNumber: i.line!,
	startColumn: i.column ?? 1,
	endLineNumber: i.line!,
	endColumn: i.column !== undefined ? i.column + 1 : 1000
}))

const statusOf = (error: any): number | undefined => typeof error?.status === 'number' ? error.status : undefined

/**
 * The lambdaORM.yaml of a schema, whole, in Monaco (docs/DATA_GATEWAY_ADMIN_PLAN.md §3.2): validated while typed,
 * saved (Ctrl+S) with the version read, and when someone else saved another version, both side by side to choose. A
 * version the gateway serves now is read again: taken as is when there is nothing unsaved, offered when there is.
 */
export const SchemaEditor: React.FC<SchemaEditorProps> = ({ admin, schema, writable, revision, pending, theme = 'light', locale, onDirty }) => {
	const m = adminMessagesOf(locale)
	const [base, setBase] = useState<{ text: string, version: string }>()
	const [draft, setDraft] = useState('')
	const [issues, setIssues] = useState<SchemaIssue[]>([])
	const [saving, setSaving] = useState(false)
	const [notice, setNotice] = useState<string>()
	const [error, setError] = useState<string>()
	const [theirs, setTheirs] = useState<{ text: string, version: string, why: 'conflict' | 'changed' }>()
	const dirty = base !== undefined && draft !== base.text
	const state = useRef({ base, draft })
	state.current = { base, draft }

	useEffect(() => { onDirty?.(dirty) }, [dirty])

	const load = useCallback(async (initial: boolean) => {
		try {
			const file = await admin.readSchema(schema)
			const { base, draft } = state.current
			if (initial || base === undefined) {
				setBase(file)
				setDraft(file.text)
				return
			}
			if (file.version === base.version) return
			if (draft === base.text) {
				setBase(file)
				setDraft(file.text)
				setNotice(m.updatedFromGateway)
			} else {
				setTheirs({ ...file, why: 'changed' })
			}
		} catch (e: any) {
			setError(e?.message ?? String(e))
		}
	}, [admin, schema])

	useEffect(() => { load(true) }, [load])
	// the gateway serves another version: read it again
	const seen = useRef(revision)
	useEffect(() => {
		if (seen.current === revision) return
		seen.current = revision
		load(false)
	}, [revision, load])

	// validated while typed (not on every key)
	useEffect(() => {
		if (base === undefined) return
		const timer = setTimeout(() => {
			admin.validate(draft).then(result => setIssues(result.issues), () => undefined)
		}, 400)
		return () => clearTimeout(timer)
	}, [draft, base === undefined])

	useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(undefined), 5000); return () => clearTimeout(t) }, [notice])

	const save = async (over?: string) => {
		const { base, draft } = state.current
		if (!base || saving || !writable) return
		setSaving(true)
		setError(undefined)
		try {
			const result = await admin.writeSchema(schema, draft, over ?? base.version)
			setBase({ text: draft, version: result.version })
			setIssues(result.issues)
			setTheirs(undefined)
			setNotice(m.saved)
		} catch (e: any) {
			if (statusOf(e) === 412 && e.details?.text !== undefined) setTheirs({ text: e.details.text, version: e.details.version, why: 'conflict' })
			else if (statusOf(e) === 422 && Array.isArray(e.details?.issues)) {
				setIssues(e.details.issues)
				setError(m.invalidNotSaved)
			} else setError(e?.message ?? String(e))
		} finally {
			setSaving(false)
		}
	}

	const takeTheirs = () => {
		if (!theirs) return
		setBase({ text: theirs.text, version: theirs.version })
		setDraft(theirs.text)
		setTheirs(undefined)
	}

	const errors = issues.filter(i => i.severity === 'error').length
	const warnings = issues.length - errors
	const keys = (e: React.KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault()
			save()
		}
	}

	return (
		<section className="lw-schema-editor" aria-label={`${m.schemaFile} — ${schema || '/'}`} onKeyDownCapture={keys}>
			<div className="lw-toolbar">
				<strong>{m.schemaFile}</strong>
				<span className={`lw-type ${errors ? 'lw-error-text' : ''}`} role="status">
					{base === undefined ? '' : errors ? format(m.errorsCount, { n: errors }) : warnings ? format(m.warningsCount, { n: warnings }) : m.noIssues}
				</span>
				{dirty && <span className="lw-type">• {m.unsaved}</span>}
				<span className="lw-spacer" />
				{writable
					? <button type="button" onClick={() => save()} disabled={!dirty || saving}>{saving ? m.saving : m.save}</button>
					: <span className="lw-type">{m.readOnlySchema}</span>}
			</div>
			{pending && <div className="lw-notice lw-schema-pending" role="note">{pending}</div>}
			{notice && <div className="lw-notice lw-toast" role="status">{notice}</div>}
			{error && <div className="lw-notice" role="alert">{error}</div>}
			{theirs && (
				<div className="lw-conflict" role="alert">
					<p>{theirs.why === 'conflict' ? m.conflict : m.changedOnGateway}</p>
					<div className="lw-conflict-sides">
						<div>
							<strong>{m.theirs}</strong>
							<CodeEditor value={theirs.text} onChange={() => undefined} language="yaml" readOnly height={260} theme={theme} ariaLabel={m.theirs} />
						</div>
						<div>
							<strong>{m.mine}</strong>
							<CodeEditor value={draft} onChange={setDraft} language="yaml" height={260} theme={theme} ariaLabel={m.mine} />
						</div>
					</div>
					<div className="lw-actions">
						{writable && <button type="button" onClick={() => save(theirs.version)}>{m.keepMine}</button>}
						<button type="button" onClick={takeTheirs}>{m.takeTheirs}</button>
					</div>
				</div>
			)}
			{base !== undefined && !theirs && (
				<CodeEditor value={draft} onChange={setDraft} language="yaml" readOnly={!writable} markers={markersOf(issues)} height="calc(100vh - 220px)" theme={theme} ariaLabel={m.schemaFile} completion={schemaCompletions} />
			)}
			{!error && issues.length > 0 && (
				<ul className="lw-issues">
					{issues.map((i, n) => <li key={n} className={i.severity === 'error' ? 'lw-error-text' : 'lw-warning-text'}>{i.line ? `${i.line}: ` : ''}{i.message}</li>)}
				</ul>
			)}
		</section>
	)
}
