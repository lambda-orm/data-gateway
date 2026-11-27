import { changedByText } from '../domain/changedBy'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdminApiPort, SchemaVariable } from '../application/ports'
import { adminMessagesOf, format } from '../domain/adminI18n'
import { explorerMessagesOf } from '../domain/explorerI18n'
import { fromYaml, toYaml } from '../domain/results'
import { ExpressionDialog } from './ExpressionDialog'
import { ExpressionInput } from './ExpressionInput'
import { ExpressionView } from './ExpressionView'
import { EXPRESSION_HELP, PROPERTY_EXPRESSIONS, propertiesIn } from '../domain/diagram'
import { Icons } from './dialogs'
import { CodeEditor } from './CodeEditor'
import { inheritanceOf, inheritedByBase } from '../domain/inheritance'

export interface SchemaFormsProps {
	admin: AdminApiPort
	theme?: 'light' | 'dark'
	schema: string
	/** the credential may change it (schemaWrite) */
	writable: boolean
	/** changes when the gateway serves another version: read again */
	revision?: string
	locale?: string
	/** the credential may set the variables of the connections (schemaAdmin) */
	canAdmin?: boolean
	/** one element only (a tab of the explorer): without the tree of sections, read first and Edit to change it */
	focus?: FormFocus
	/** an element renamed or removed: the explorer follows it */
	onChanged?: (focus: FormFocus | undefined) => void
	/** When it was asked to edit (Edit): it opens in edit, and goes to edit when this changes */
	editRequest?: number
	/** Opened by Edit, its Cancel or its Save is done with it: back to what was being viewed */
	onDone?: () => void
	/** When its removal was asked (Remove in the view of the element): what uses it, and its confirmation */
	removeRequest?: number
	/** The schema itself removed (its Remove, next to Edit in what it is) */
	onRemoveSchema?: () => void
}

/** The variables of the connections (.env): defined or not, and where used; a value is set, never shown */
const Variables: React.FC<{ admin: AdminApiPort, schema: string, canAdmin: boolean, locale?: string, revision?: string }> = ({ admin, schema, canAdmin, locale, revision }) => {
	const m = adminMessagesOf(locale)
	const [variables, setVariables] = useState<SchemaVariable[]>()
	const [values, setValues] = useState<Record<string, string>>({})
	const [added, setAdded] = useState('')
	const [error, setError] = useState<string>()
	const load = useCallback(() => { admin.variables(schema).then(r => setVariables(r.variables), e => setError(e?.message ?? String(e))) }, [admin, schema])
	useEffect(load, [load, revision])
	const change = async (change: { set?: Record<string, string>, remove?: string[] }) => {
		setError(undefined)
		try {
			setVariables((await admin.setVariables(schema, change)).variables)
			setValues({})
			setAdded('')
		} catch (e: any) { setError(e?.message ?? String(e)) }
	}
	const rows = [...(variables ?? []), ...(added && !(variables ?? []).some(v => v.name === added) ? [{ name: added, defined: false, usedBy: [], used: false }] : [])]
	return (
		<div>
			<p className="lw-type">{m.variablesNote}</p>
			{error && <div className="lw-notice" role="alert">{error}</div>}
			<table className="lw-table lw-form-rows" aria-label={m.variables}>
				<thead>
					<tr>
						<th>{m.varName}</th><th>{m.varState}</th><th>{m.varUsedIn}</th>
						{canAdmin && <><th>{m.varValue}</th><th /></>}
					</tr>
				</thead>
				<tbody>
					{rows.map(v => (
						<tr key={v.name}>
							<td><code>{v.name}</code></td>
							<td className={v.defined ? undefined : 'lw-warning-text'}>{v.defined ? m.defined : m.notDefined}</td>
							<td className="lw-type">{v.usedBy.join(', ')}</td>
							{canAdmin && (
								<>
									<td><input type="password" autoComplete="off" aria-label={`${v.name} ${m.newValue}`} placeholder={m.newValue} value={values[v.name] ?? ''} onChange={e => setValues({ ...values, [v.name]: e.target.value })} /></td>
									<td>
										<button type="button" disabled={!values[v.name]} onClick={() => change({ set: { [v.name]: values[v.name] } })}>{m.setValue}</button>
										{v.defined && <button type="button" onClick={() => change({ remove: [v.name] })}>{m.remove}</button>}
									</td>
								</>
							)}
						</tr>
					))}
				</tbody>
			</table>
			{canAdmin && <label className="lw-form-field"><span>{m.addRow}</span><input aria-label="new variable" placeholder="MY_CONNECTION" value={added} onChange={e => setAdded(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} /></label>}
		</div>
	)
}

type Json = any
type Section = 'entities' | 'enums' | 'sources' | 'mappings' | 'stages'
/** What a tab of one element shows: an element of a section, the application section as YAML, or the variables */
export type FormFocus = { section: Section, name?: string } | { section: 'application' } | { section: 'variables' } | { section: 'about' }

const SECTIONS: { key: Section, at: string[] }[] = [
	{ key: 'entities', at: ['domain', 'entities'] },
	{ key: 'enums', at: ['domain', 'enums'] },
	{ key: 'sources', at: ['infrastructure', 'sources'] },
	{ key: 'mappings', at: ['infrastructure', 'mappings'] },
	{ key: 'stages', at: ['infrastructure', 'stages'] }
]

const TYPES = ['string', 'text', 'integer', 'decimal', 'number', 'boolean', 'date', 'dateTime', 'time', 'uuid', 'json', 'vector', 'point']
/** the kinds of an index of the engine (docs/VECTOR_POINT_SQLJS.md §1): vectors (hnsw, ivfflat) and points (spatial) */
const INDEX_TYPES = ['hnsw', 'ivfflat', 'spatial']
const INDEX_DISTANCES = ['cosine', 'l2', 'ip']
const DIALECTS = ['PostgreSQL', 'MySQL', 'MariaDB', 'SqlServer', 'Oracle', 'MongoDB', 'SQLjs']
const RELATION_TYPES = ['oneToMany', 'manyToOne', 'oneToOne']

const listAt = (doc: Json, at: string[]): Json[] => {
	const value = at.reduce((v, k) => v?.[k], doc)
	return Array.isArray(value) ? value : []
}

/** "a, b" ↔ ['a', 'b'] (one field: a string, as λORM writes it) */
const fieldsText = (value: unknown): string => Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : ''
const textFields = (text: string, single = true): string | string[] | undefined => {
	const fields = text.split(',').map(s => s.trim()).filter(Boolean)
	if (fields.length === 0) return undefined
	return single && fields.length === 1 ? fields[0] : fields
}

/** Without the keys left empty (a form leaves "" where the schema had nothing) */
const clean = (value: Json): Json => {
	if (Array.isArray(value)) return value.map(clean)
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, clean(v)]))
	}
	return value
}

/** A column of Rows: a field of each row; `expressions` is a button that shows, under the table, the expressions of the row */
type RowColumn = { key: string, kind?: 'text' | 'number' | 'check' | 'select' | 'fields' | 'expressions', options?: string[], placeholder?: string, keys?: readonly string[] }

/** A table of rows of an element (properties, relations, values…): each cell a field */
const Rows: React.FC<{
	rows: Json[]
	columns: RowColumn[]
	readOnly: boolean
	addLabel: string
	onChange: (rows: Json[]) => void
	label: string
	/** the button of a column of kind expressions */
	expressionLabel?: string
	/** what is shown under the table for the row whose expressions are open */
	detail?: (row: Json, set: (key: string, value: unknown) => void) => React.ReactNode
	/** a note after the first cell of a row (an own property that redefines an inherited one) */
	rowNote?: (row: Json) => string | undefined
}> = ({ rows, columns, readOnly, addLabel, onChange, label, expressionLabel = 'ƒ', detail, rowNote }) => {
	const [open, setOpen] = useState<number>()
	const set = (i: number, key: string, value: unknown) => onChange(rows.map((row, k) => k === i ? { ...row, [key]: value } : row))
	const has = (row: Json, keys: readonly string[] = []) => keys.filter(k => typeof row[k] === 'string' && row[k].trim() !== '')
	return (
		<>
			<table className="lw-table lw-form-rows" aria-label={label}>
				<thead><tr>{columns.map(c => <th key={c.key} className={`lw-col-${c.kind ?? 'text'}`}>{c.key}</th>)}{!readOnly && <th className="lw-col-remove" />}</tr></thead>
				<tbody>
					{rows.map((row, i) => (
						<tr key={i} className={open === i ? 'lw-active' : undefined}>
							{columns.map((c, ci) => (
								<td key={c.key} className={`lw-col-${c.kind ?? 'text'}`}>
									{ci === 0 && rowNote?.(row) && <span className="lw-badge lw-row-note">{rowNote(row)}</span>}
									{c.kind === 'check'
										? <input type="checkbox" aria-label={`${row.name ?? i} ${c.key}`} disabled={readOnly} checked={row[c.key] === true} onChange={e => set(i, c.key, e.target.checked ? true : undefined)} />
										: c.kind === 'expressions'
											? (
												<button type="button" className={`lw-expression-toggle${has(row, c.keys).length ? ' lw-has' : ''}`} aria-pressed={open === i}
													aria-label={`${row.name ?? i} ${c.key}`} title={has(row, c.keys).join(', ') || c.key}
													disabled={readOnly && !has(row, c.keys).length} onClick={() => setOpen(open === i ? undefined : i)}>
													ƒ{has(row, c.keys).length ? ` ${has(row, c.keys).length}` : ''}{expressionLabel !== 'ƒ' && <span className="lw-sr-only"> {expressionLabel}</span>}
												</button>
												)
											: c.kind === 'select'
												? (
													<select aria-label={`${row.name ?? i} ${c.key}`} disabled={readOnly} value={row[c.key] ?? ''} onChange={e => set(i, c.key, e.target.value || undefined)}>
														<option value="">{c.placeholder ?? ''}</option>
														{(c.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
													</select>
													)
												: (
													<input aria-label={`${row.name ?? i} ${c.key}`} readOnly={readOnly} placeholder={c.placeholder}
														value={c.kind === 'fields' ? fieldsText(row[c.key]) : row[c.key] ?? ''}
														onChange={e => set(i, c.key, c.kind === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : c.kind === 'fields' ? textFields(e.target.value) : e.target.value)} />
													)}
								</td>
							))}
							{!readOnly && <td className="lw-col-remove"><button type="button" aria-label={`remove ${row.name ?? i}`} onClick={() => { onChange(rows.filter((_, k) => k !== i)); setOpen(undefined) }}>×</button></td>}
						</tr>
					))}
				</tbody>
				{!readOnly && <tfoot><tr><td colSpan={columns.length + 1}><button type="button" onClick={() => onChange([...rows, {}])}>{addLabel}</button></td></tr></tfoot>}
			</table>
			{detail && open !== undefined && rows[open] && detail(rows[open], (key, value) => set(open, key, value))}
		</>
	)
}

type EntityTab = 'properties' | 'relations' | 'indexes' | 'constraints'

const ABOUT = ['name', 'description', 'version'] as const
type About = Record<typeof ABOUT[number], string>

/**
 * The schema as forms (docs/DATA_GATEWAY_ADMIN_PLAN.md §3.3): each section of the lambdaORM.yaml and each of its
 * elements, to create, change, rename and remove without writing YAML. Each save is one change of one element, sent
 * with the element as it was read: someone else's change to another element doesn't collide; to the same one, the
 * form shows what it has now. The gateway writes it keeping the comments and the rest of the file.
 */
export const SchemaForms: React.FC<SchemaFormsProps> = ({ admin, theme, schema, writable, revision, locale, canAdmin = false, focus, onChanged, editRequest, onDone, removeRequest, onRemoveSchema }) => {
	const [showVariables, setShowVariables] = useState(focus?.section === 'variables')
	const [showApplication] = useState(focus?.section === 'application')
	// a focused element is read first: Edit to change it; the forms of the whole schema edit at once
	// a new element (focused on a section without a name) starts blank, in edit
	const creating = !!focus && focus.section !== 'application' && focus.section !== 'variables' && focus.section !== 'about' && (focus as any).name === undefined
	const [editing, setEditing] = useState(!focus || creating || editRequest !== undefined)
	useEffect(() => { if (editRequest !== undefined) setEditing(true) }, [editRequest])
	const m = adminMessagesOf(locale)
	const e = explorerMessagesOf(locale)
	// the tab of the form of an entity: its properties, relations, indexes or constraints
	const [entityTab, setEntityTab] = useState<EntityTab>('properties')
	const [doc, setDoc] = useState<Json>()
	const [selected, setSelected] = useState<{ section: Section, name?: string } | undefined>(
		focus && focus.section !== 'application' && focus.section !== 'variables' && focus.section !== 'about' ? { section: focus.section, name: (focus as any).name } : undefined)
	const [draft, setDraft] = useState<Json>(creating ? {} : undefined)
	const [read, setRead] = useState<Json>()
	const [error, setError] = useState<string>()
	const [notice, setNotice] = useState<string>()
	const [busy, setBusy] = useState(false)
	const [removing, setRemoving] = useState<string[]>()
	const [renaming, setRenaming] = useState<string>()
	// the source of the stage whose condition is being written (its form)
	const [conditionOf, setConditionOf] = useState<number>()

	const load = useCallback(async () => {
		try {
			const file = await admin.readSchema(schema)
			setDoc(fromYaml(file.text) ?? {})
			setError(undefined)
		} catch (e: any) { setError(e?.message ?? String(e)) }
	}, [admin, schema])
	useEffect(() => { load() }, [load, revision])
	useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(undefined), 4000); return () => clearTimeout(t) }, [notice])

	const sectionAt = (section: Section) => SECTIONS.find(s => s.key === section)!.at
	// the element chosen, as it is in the file now; what is being edited stays (a change of someone else to the same
	// element is shown when it is saved)
	useEffect(() => {
		if (!doc || !selected?.name) return
		const element = listAt(doc, sectionAt(selected.section)).find((e: Json) => e?.name === selected.name)
		setRead(element)
		setDraft((d: Json) => d !== undefined && d.name === selected.name ? d : element ? JSON.parse(JSON.stringify(element)) : undefined)
	}, [doc, selected])

	// what the entity being shown inherits (docs: λORM's extends), from the draft: a change of extends shows it at once
	const inheritance = useMemo(() => {
		if (selected?.section !== 'entities' || !draft) return inheritanceOf([], undefined)
		const name = typeof draft.name === 'string' && draft.name ? draft.name : selected.name ?? '\u0000'
		const others = listAt(doc, sectionAt('entities')).filter((x: Json) => x?.name !== selected.name && x?.name !== name)
		return inheritanceOf([...others, { ...draft, name }], name)
	}, [doc, draft, selected])

	const names = useMemo(() => Object.fromEntries(SECTIONS.map(s => [s.key, listAt(doc, s.at).map((e: Json) => e?.name).filter(Boolean)])) as Record<Section, string[]>, [doc])

	const attempt = async (action: () => Promise<void>) => {
		setBusy(true)
		setError(undefined)
		try { await action() } catch (e: any) {
			if (e?.status === 412 && e.details?.current) {
				setRead(e.details.current)
				setDraft(JSON.parse(JSON.stringify(e.details.current)))
				setError(changedByText(e.details.changedBy, locale, m.changedMeanwhile))
				await load()
			} else setError(e?.details?.issues ? e.details.issues.map((i: Json) => i.message).join('; ') : e?.message ?? String(e))
		} finally { setBusy(false) }
	}

	const save = () => attempt(async () => {
		if (!selected || !draft) return
		const at = sectionAt(selected.section)
		if (selected.name === undefined) {
			await admin.patchSchema(schema, { op: 'add', at, value: clean(draft) })
			setSelected({ section: selected.section, name: draft.name })
			onChanged?.({ section: selected.section, name: draft.name })
		} else {
			await admin.patchSchema(schema, { op: 'set', at: [...at, selected.name], value: clean(draft), expected: read })
		}
		setNotice(m.saved)
		if (focus) setEditing(false)
		await load()
		// opened by Edit: saved, back to the view
		if (editRequest !== undefined && selected.name !== undefined) onDone?.()
	})

	// what the schema is: its name, description and version (keys of the top of the lambdaORM.yaml)
	const showAbout = focus?.section === 'about'
	const aboutRead = useMemo(() => Object.fromEntries(ABOUT.map(k => [k, doc?.[k] === undefined || doc?.[k] === null ? '' : String(doc[k])])) as About, [doc])
	const [about, setAbout] = useState<About>()
	useEffect(() => { if (showAbout && doc && !editing) setAbout(aboutRead) }, [doc, showAbout, editing])
	const saveAbout = () => attempt(async () => {
		if (!about) return
		for (const key of ABOUT) {
			const value = about[key].trim()
			if (value === aboutRead[key]) continue
			const expected = doc?.[key]
			await admin.patchSchema(schema, value ? { op: 'set', at: [key], value, expected } : { op: 'remove', at: [key], expected })
		}
		setNotice(m.saved)
		setEditing(false)
		await load()
	})

	// the application section, as YAML (start tasks, listeners)
	const [appText, setAppText] = useState<string>()
	const appRead = doc?.application
	useEffect(() => { if (showApplication && appText === undefined && doc) setAppText(appRead === undefined ? '' : toYaml(appRead)) }, [doc, showApplication])
	const saveApplication = () => attempt(async () => {
		const value = appText?.trim() ? fromYaml(appText) : undefined
		if (value !== undefined && (typeof value !== 'object' || Array.isArray(value))) throw new Error('application is an object (start, listeners)')
		await admin.patchSchema(schema, value === undefined ? { op: 'remove', at: ['application'], expected: appRead } : { op: 'set', at: ['application'], value, expected: appRead })
		setNotice(m.saved)
		setEditing(false)
		setAppText(undefined)
		await load()
	})

	const rename = () => attempt(async () => {
		const to = renaming?.trim()
		if (!selected?.name || !to || to === selected.name) return
		await admin.patchSchema(schema, { op: 'rename', at: [...sectionAt(selected.section), selected.name], to, expected: read })
		setRenaming(undefined)
		setDraft(undefined)
		setSelected({ section: selected.section, name: to })
		onChanged?.({ section: selected.section, name: to })
		await load()
	})

	const askRemove = () => attempt(async () => {
		if (!selected?.name) return
		setRemoving((await admin.references(schema, [...sectionAt(selected.section), selected.name])).references)
	})

	// asked by Remove in the view of the element: once it is read, what uses it and the confirmation
	const removeAsked = useRef<number>()
	useEffect(() => {
		if (removeRequest === undefined || removeRequest === removeAsked.current || !read || !selected?.name) return
		removeAsked.current = removeRequest
		askRemove()
	}, [removeRequest, read])

	const remove = () => attempt(async () => {
		if (!selected?.name) return
		await admin.patchSchema(schema, { op: 'remove', at: [...sectionAt(selected.section), selected.name], expected: read })
		setRemoving(undefined)
		setSelected(undefined)
		setDraft(undefined)
		onChanged?.(undefined)
		await load()
	})

	const editable = writable && editing
	const field = (key: string, input: React.ReactNode) => <label className="lw-form-field"><span>{key}</span>{input}</label>
	const text = (key: string, opts: { fields?: boolean } = {}) => field(key, (
		<input aria-label={key} readOnly={!editable} value={opts.fields ? fieldsText(draft?.[key]) : draft?.[key] ?? ''}
			onChange={e => setDraft({ ...draft, [key]: opts.fields ? textFields(e.target.value, false) : e.target.value || undefined })} />
	))
	const check = (key: string) => field(key, <input type="checkbox" aria-label={key} disabled={!editable} checked={draft?.[key] === true} onChange={e => setDraft({ ...draft, [key]: e.target.checked ? true : undefined })} />)
	const select = (key: string, options: string[]) => field(key, (
		<select aria-label={key} disabled={!editable} value={draft?.[key] ?? ''} onChange={e => setDraft({ ...draft, [key]: e.target.value || undefined })}>
			<option value="" />
			{options.map(o => <option key={o} value={o}>{o}</option>)}
		</select>
	))
	const rows = (key: string, columns: RowColumn[], detail?: Parameters<typeof Rows>[0]['detail'], legend = true, rowNote?: (row: Json) => string | undefined) => (
		<fieldset className="lw-form-group">{legend && <legend>{key}</legend>}
			<Rows label={key} rows={Array.isArray(draft?.[key]) ? draft[key] : []} columns={columns} readOnly={!editable} addLabel={m.addRow}
				expressionLabel={m.expression} detail={detail} rowNote={rowNote} onChange={value => setDraft({ ...draft, [key]: value })} />
		</fieldset>
	)
	// an own property or relation with the name of an inherited one redefines it
	const redefinedNote = (key: 'properties' | 'relations') => (row: Json) => {
		const of = inheritance[key].find(i => i.row.name === row.name && i.redefines)
		return of ? format(e.redefines, { name: of.redefines! }) : undefined
	}
	const openBase = (base: string) => { setSelected({ section: 'entities', name: base }); setDraft(undefined); setRenaming(undefined); setRemoving(undefined); setError(undefined) }
	// what it inherits, by the base that declares it: read only, it is changed in that base
	const inheritedRows = (key: 'properties' | 'relations', columns: RowColumn[], detail?: Parameters<typeof Rows>[0]['detail']) => inheritedByBase(inheritance, key).map(([base, list]) => (
		<fieldset key={base} className="lw-form-group lw-inherited" aria-label={`${key} ${format(e.inheritedFrom, { name: base })}`}>
			<legend>
				{format(e.inheritedFrom, { name: base })}
				{!focus && <button type="button" className="lw-link" disabled={changed} onClick={() => openBase(base)}>{format(e.openNamed, { name: base })}</button>}
			</legend>
			<p className="lw-type">{format(e.inheritedHint, { name: base })}</p>
			<Rows label={`${key} ${base}`} rows={list} columns={columns} readOnly addLabel="" expressionLabel={m.expression} detail={detail} onChange={() => undefined} />
		</fieldset>
	))
	// the variables of its expressions: its properties, the inherited ones too
	const propertyNames = () => inheritance.properties.length
		? inheritance.properties.map(i => i.row.name)
		: (Array.isArray(draft?.properties) ? draft.properties : []).map((p: Json) => p?.name).filter(Boolean)

	// the expressions of a property, under the table: editors while editing, the colored expressions otherwise
	const propertyExpressions = (row: Json, set: (key: string, value: unknown) => void, readOnly = false) => {
		const canEdit = editable && !readOnly
		const variables = propertyNames()
		const title = format(m.expressionsOf, { name: row.name ?? '' })
		return (
			<section className="lw-expression-detail" aria-label={title}>
				<h4>{title}</h4>
				{PROPERTY_EXPRESSIONS.filter(k => canEdit || (typeof row[k] === 'string' && row[k].trim())).map(k => (
					<div key={k} className="lw-expression-item">
						<p className="lw-expression-label"><code>{k}</code>: {m[EXPRESSION_HELP[k]]}</p>
						{canEdit
							? <ExpressionInput admin={admin} value={typeof row[k] === 'string' ? row[k] : ''} onChange={value => set(k, value.trim() ? value : undefined)}
								variables={variables} height={52} ariaLabel={`${row.name ?? ''} ${k}`} theme={theme} locale={locale} />
							: <ExpressionView expression={row[k]} variables={variables} />}
					</div>
				))}
				{(() => {
					const uses = (Array.isArray(draft?.constraints) ? draft.constraints : [])
						.filter((c: Json) => typeof c?.condition === 'string' && row.name && propertiesIn(c.condition, variables).includes(row.name))
					return uses.length > 0 && (
						<div className="lw-validations">
							<p className="lw-expression-label"><code>constraints</code>: {m.validationsHint}</p>
							{uses.map((c: Json, i: number) => (
								<div key={i} className="lw-expression-item">
									<p className="lw-constraint-message">{c.message}</p>
									<ExpressionView expression={c.condition} variables={variables} />
								</div>
							))}
						</div>
					)
				})()}
			</section>
		)
	}

	// the condition of a validation (constraint), under its table: an editor while editing
	const constraintCondition = (row: Json, set: (key: string, value: unknown) => void) => {
		const variables = propertyNames()
		const title = row.message || m.condition
		return (
			<section className="lw-expression-detail" aria-label={title}>
				<h4>{title}</h4>
				<div className="lw-expression-item">
					<p className="lw-expression-label"><code>condition</code>: {m.validationsHint}</p>
					{editable
						? <ExpressionInput admin={admin} value={typeof row.condition === 'string' ? row.condition : ''} onChange={value => set('condition', value.trim() ? value : undefined)}
							variables={variables} height={52} ariaLabel={`${row.message ?? ''} condition`} theme={theme} locale={locale} />
						: <ExpressionView expression={row.condition ?? ''} variables={variables} />}
				</div>
			</section>
		)
	}

	const form = () => {
		if (!selected || !draft) return <p className="lw-type">{m.nothingSelected}</p>
		const isNew = selected.name === undefined
		switch (selected.section) {
		case 'entities':
			return (
				<>
					{isNew && text('name')}
					{select('extends', names.entities.filter(n => n !== draft.name))}
					<div className="lw-form-inline">{check('abstract')}{check('view')}</div>
					{(() => {
						const own = (key: string) => Array.isArray(draft?.[key]) ? draft[key].length : 0
						const inheritedCount = (key: string) => key === 'properties' || key === 'relations' ? inheritedByBase(inheritance, key).reduce((n, [, list]) => n + list.length, 0) : 0
						const count = (key: string) => inheritedCount(key) ? `${own(key)} + ${inheritedCount(key)}` : String(own(key))
						const propertyColumns: RowColumn[] = [{ key: 'name' }, { key: 'type', kind: 'select', options: TYPES, placeholder: 'string' }, { key: 'length', kind: 'number' }, { key: 'required', kind: 'check' }, { key: 'autoIncrement', kind: 'check' }, { key: 'default' }, { key: 'enum', kind: 'select', options: names.enums }, { key: 'expressions', kind: 'expressions', keys: PROPERTY_EXPRESSIONS }]
						const relationColumns: RowColumn[] = [{ key: 'name' }, { key: 'type', kind: 'select', options: RELATION_TYPES, placeholder: 'oneToMany' }, { key: 'from', kind: 'fields' }, { key: 'entity', kind: 'select', options: names.entities }, { key: 'to', kind: 'fields' }, { key: 'target' }, { key: 'weak', kind: 'check' }]
						// as the view of the entity: its keys and its indexes in one tab, which counts nothing (as there)
						const tabs: [EntityTab, string][] = [['properties', e.properties], ['relations', e.relations], ['indexes', e.keysIndexes], ['constraints', e.constraints]]
						return (
							<>
								<div className="lw-toolbar lw-entity-tabs" role="tablist" aria-label={draft.name ?? ''}>
									{tabs.map(([key, label]) => (
										<button key={key} type="button" role="tab" aria-selected={entityTab === key} className={entityTab === key ? 'lw-active' : ''} onClick={() => setEntityTab(key)}>{label}{key === 'indexes' ? '' : ` (${count(key)})`}</button>
									))}
								</div>
								{entityTab === 'properties' && rows('properties', propertyColumns, propertyExpressions, false, redefinedNote('properties'))}
								{entityTab === 'properties' && inheritedRows('properties', propertyColumns, (row, set) => propertyExpressions(row, set, true))}
								{entityTab === 'relations' && rows('relations', relationColumns, undefined, false, redefinedNote('relations'))}
								{entityTab === 'relations' && inheritedRows('relations', relationColumns)}
								{entityTab === 'indexes' && (
									<>
										{text('primaryKey', { fields: true })}
										{text('uniqueKey', { fields: true })}
										{rows('indexes', [{ key: 'name' }, { key: 'fields', kind: 'fields' }, { key: 'type', kind: 'select', options: INDEX_TYPES }, { key: 'distance', kind: 'select', options: INDEX_DISTANCES }], undefined, false)}
									</>
								)}
								{entityTab === 'constraints' && rows('constraints', [{ key: 'message' }, { key: 'condition', kind: 'expressions', keys: ['condition'] }], constraintCondition, false)}
							</>
						)
					})()}
				</>
			)
		case 'enums':
			return <>{isNew && text('name')}{rows('values', [{ key: 'name' }, { key: 'value' }])}</>
		case 'sources':
			return (
				<>
					{isNew && text('name')}
					{select('dialect', DIALECTS)}
					{select('mapping', names.mappings)}
					{field('connection', (
						<input aria-label="connection" readOnly={!editable} value={typeof draft.connection === 'string' ? draft.connection : draft.connection ? JSON.stringify(draft.connection) : ''}
							placeholder="${MY_CONNECTION}" onChange={e => setDraft({ ...draft, connection: e.target.value || undefined })} />
					))}
				</>
			)
		case 'mappings':
			return <>{isNew && text('name')}{select('extends', names.mappings.filter(n => n !== draft.name))}{rows('entities', [{ key: 'name', kind: 'select', options: names.entities }, { key: 'mapping' }])}</>
		case 'stages': {
			const list: Json[] = Array.isArray(draft.sources) ? draft.sources : []
			const setList = (next: Json[]) => setDraft({ ...draft, sources: next })
			const at = (i: number, patch: Json) => setList(list.map((x, j) => j === i ? { ...x, ...patch } : x))
			const move = (i: number, to: number) => { const next = [...list]; const [x] = next.splice(i, 1); next.splice(to, 0, x); setList(next) }
			const used = new Set(list.map(s => s?.name))
			return (
				<>
					{isNew && text('name')}
					<fieldset className="lw-form-group"><legend>sources</legend>
						<p className="lw-type">{m.stageSourcesNote}</p>
						<ol className="lw-stage-sources">
							{list.map((item, i) => (
								<li key={i} className="lw-stage-source">
									{editable
										? (
											<select aria-label={`source ${i + 1}`} value={item?.name ?? ''} onChange={e => at(i, { name: e.target.value })}>
												<option value="" disabled>—</option>
												{[...new Set([...names.sources, ...(item?.name ? [item.name] : [])])].map(s => <option key={s} value={s} disabled={s !== item?.name && used.has(s)}>{s}</option>)}
											</select>
											)
										: <strong aria-label={`source ${i + 1}`}>{item?.name}</strong>}
									<span className="lw-stage-condition" aria-label={`${m.condition} ${i + 1}`}>
										<ExpressionView expression={typeof item?.condition === 'string' ? item.condition : ''} empty={m.theRest} />
									</span>
									<span className="lw-row-actions">
										{writable && (
											<button type="button" className="lw-icon-button" aria-label={format(m.editCondition, { name: item?.name ?? i + 1 })} title={format(m.editCondition, { name: item?.name ?? i + 1 })}
												onClick={() => { if (!editing) setEditing(true); setConditionOf(i) }}><Icons.edit /></button>
										)}
										{editable && (
											<>
												<button type="button" className="lw-icon-button" aria-label={`${m.moveUp} ${i + 1}`} title={m.moveUp} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
												<button type="button" className="lw-icon-button" aria-label={`${m.moveDown} ${i + 1}`} title={m.moveDown} disabled={i === list.length - 1} onClick={() => move(i, i + 1)}>↓</button>
												<button type="button" className="lw-icon-button" aria-label={`${m.remove} ${i + 1}`} title={m.remove} onClick={() => setList(list.filter((_x, j) => j !== i))}><Icons.close /></button>
											</>
										)}
									</span>
								</li>
							))}
						</ol>
						{conditionOf !== undefined && list[conditionOf] && (
							<ExpressionDialog admin={admin} locale={locale} theme={theme} title={format(m.conditionOf, { name: list[conditionOf]?.name ?? '' })}
								value={typeof list[conditionOf]?.condition === 'string' ? list[conditionOf].condition : ''} entities={names.entities}
								onApply={value => at(conditionOf, { condition: value || undefined })} onClose={() => setConditionOf(undefined)} />
						)}
						{editable && (
							<button type="button" disabled={names.sources.every(s => used.has(s))}
								onClick={() => setList([...list, { name: names.sources.find(s => !used.has(s)) }])}>{m.addSource}</button>
						)}
					</fieldset>
				</>
			)
		}
		}
	}

	const changed = draft !== undefined && JSON.stringify(clean(draft)) !== JSON.stringify(clean(read ?? {}))

	return (
		<section className={focus ? 'lw-schema-forms lw-focused' : 'lw-schema-forms'} aria-label={`${m.forms} — ${schema || '/'}`}>
			{!focus && <nav className="lw-forms-tree" aria-label={m.forms}>
				{SECTIONS.map(s => (
					<div key={s.key}>
						<div className="lw-forms-section">
							<strong>{m[s.key]}</strong>
							{writable && <button type="button" aria-label={format(m.newNamed, { name: m[s.key] })} title={format(m.newNamed, { name: m[s.key] })}
								onClick={() => { setShowVariables(false); setSelected({ section: s.key }); setRead(undefined); setDraft({}); setEditing(true) }}>+</button>}
						</div>
						<ul>
							{names[s.key].map(name => (
								<li key={name}>
									<button type="button" className={selected?.section === s.key && selected.name === name ? 'lw-active' : undefined}
										onClick={() => { setShowVariables(false); setSelected({ section: s.key, name }); setDraft(undefined); setRenaming(undefined); setRemoving(undefined); setError(undefined) }}>{name}</button>
								</li>
							))}
						</ul>
					</div>
				))}
				<div className="lw-forms-section">
					<button type="button" className={showVariables ? 'lw-active' : undefined} onClick={() => { setShowVariables(true); setSelected(undefined) }}><strong>{m.variables}</strong></button>
				</div>
			</nav>}
			<div className="lw-forms-element">
				{showVariables && <Variables admin={admin} schema={schema} canAdmin={canAdmin} locale={locale} revision={revision} />}
				{showAbout && about && (
					<>
						<div className="lw-toolbar">
							<strong>{m.about}</strong>
							<span className="lw-spacer" />
							{onRemoveSchema && !editing && <button type="button" className="lw-danger" onClick={onRemoveSchema}>{m.remove}</button>}
							{writable && !editing && <button type="button" className="lw-primary" onClick={() => setEditing(true)}>{m.edit}</button>}
							{writable && editing && (
								<>
									<button type="button" onClick={() => { setEditing(false); setAbout(aboutRead); setError(undefined) }}>{m.cancel}</button>
									<button type="button" className="lw-primary" disabled={busy} onClick={saveAbout}>{m.save}</button>
								</>
							)}
						</div>
						<div className="lw-form">
							<label>{m.schemaName}<input aria-label={m.schemaName} value={about.name} readOnly={!editable} onChange={e => setAbout({ ...about, name: e.target.value })} /></label>
							<label>{m.schemaDescription}<textarea aria-label={m.schemaDescription} rows={4} value={about.description} readOnly={!editable} onChange={e => setAbout({ ...about, description: e.target.value })} /></label>
							<label>{m.schemaVersion}<input aria-label={m.schemaVersion} value={about.version} readOnly={!editable} onChange={e => setAbout({ ...about, version: e.target.value })} size={12} /></label>
						</div>
					</>
				)}
				{showApplication && (
					<>
						<div className="lw-toolbar">
							<strong>{m.application}</strong>
							<span className="lw-spacer" />
							{writable && !editing && <button type="button" className="lw-primary" onClick={() => setEditing(true)}>{m.edit}</button>}
							{writable && editing && (
								<>
									<button type="button" onClick={() => { setEditing(false); setAppText(appRead === undefined ? '' : toYaml(appRead)) }}>{m.cancel}</button>
									<button type="button" className="lw-primary" disabled={busy} onClick={saveApplication}>{m.save}</button>
								</>
							)}
						</div>
						{appText !== undefined && (
							<CodeEditor key={editing ? 'editing' : 'reading'} value={appText} onChange={setAppText} language="yaml" readOnly={!editable} height={360} ariaLabel={m.application} />
						)}
						{appText === '' && !editing && <p className="lw-type">{m.empty}</p>}
					</>
				)}
				{selected && (
					<div className="lw-toolbar">
						<strong>{m[selected.section]}{selected.name ? ` / ${selected.name}` : ''}</strong>
						<span className="lw-spacer" />
						{writable && selected.name && renaming === undefined && <button type="button" disabled={busy} onClick={() => setRenaming(selected.name)}>{m.rename}</button>}
						{renaming !== undefined && (
							<>
								<input aria-label={m.rename} value={renaming} onChange={e => setRenaming(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setRenaming(undefined) }} />
								<button type="button" disabled={busy || !renaming.trim() || renaming.trim() === selected.name} onClick={rename}>{m.rename}</button>
								<button type="button" onClick={() => setRenaming(undefined)}>{m.cancel}</button>
							</>
						)}
						{writable && selected.name && <button type="button" className="lw-danger" disabled={busy} onClick={askRemove}>{m.remove}</button>}
						{writable && !editing && <button type="button" className="lw-primary" onClick={() => setEditing(true)}>{m.edit}</button>}
						{writable && editing && focus && selected.name && (
							<button type="button" onClick={() => { setEditing(false); setDraft(read ? JSON.parse(JSON.stringify(read)) : undefined); setError(undefined); if (editRequest !== undefined) onDone?.() }}>{m.cancel}</button>
						)}
						{writable && editing && <button type="button" className="lw-primary" disabled={busy || !changed || (selected.name === undefined && !draft?.name)} onClick={save}>{m.save}</button>}
					</div>
				)}
				{error && <div className="lw-notice" role="alert">{error}</div>}
				{notice && <div className="lw-notice lw-toast" role="status">{notice}</div>}
				{removing && selected?.name && (
					<div className="lw-preview" role="alert">
						{removing.length > 0 && <><p>{format(m.usedBy, { name: selected.name })}</p><ul>{removing.map(r => <li key={r}><code>{r}</code></li>)}</ul></>}
						<div className="lw-actions">
							<button type="button" onClick={() => setRemoving(undefined)}>{m.cancel}</button>
							<button type="button" className="lw-danger" disabled={busy} onClick={remove}>{m.remove}</button>
						</div>
					</div>
				)}
				{!showAbout && !showApplication && !showVariables && <div className="lw-element-form">{form()}</div>}
			</div>
		</section>
	)
}
