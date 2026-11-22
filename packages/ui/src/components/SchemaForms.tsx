import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminApiPort } from '../application/ports'
import { adminMessagesOf, format } from '../domain/adminI18n'
import { fromYaml } from '../domain/results'

export interface SchemaFormsProps {
	admin: AdminApiPort
	schema: string
	/** the credential may change it (schemaWrite) */
	writable: boolean
	/** changes when the gateway serves another version: read again */
	revision?: string
	locale?: string
}

type Json = any
type Section = 'entities' | 'enums' | 'sources' | 'mappings' | 'stages'

const SECTIONS: { key: Section, at: string[] }[] = [
	{ key: 'entities', at: ['domain', 'entities'] },
	{ key: 'enums', at: ['domain', 'enums'] },
	{ key: 'sources', at: ['infrastructure', 'sources'] },
	{ key: 'mappings', at: ['infrastructure', 'mappings'] },
	{ key: 'stages', at: ['infrastructure', 'stages'] }
]

const TYPES = ['string', 'text', 'integer', 'decimal', 'number', 'boolean', 'date', 'dateTime', 'time', 'uuid']
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

/** A table of rows of an element (properties, relations, values…): each cell a field */
const Rows: React.FC<{
	rows: Json[]
	columns: { key: string, kind?: 'text' | 'number' | 'check' | 'select' | 'fields', options?: string[] }[]
	readOnly: boolean
	addLabel: string
	onChange: (rows: Json[]) => void
	label: string
}> = ({ rows, columns, readOnly, addLabel, onChange, label }) => {
	const set = (i: number, key: string, value: unknown) => onChange(rows.map((row, k) => k === i ? { ...row, [key]: value } : row))
	return (
		<table className="lw-table lw-form-rows" aria-label={label}>
			<thead><tr>{columns.map(c => <th key={c.key}>{c.key}</th>)}<th /></tr></thead>
			<tbody>
				{rows.map((row, i) => (
					<tr key={i}>
						{columns.map(c => (
							<td key={c.key}>
								{c.kind === 'check'
									? <input type="checkbox" aria-label={`${row.name ?? i} ${c.key}`} disabled={readOnly} checked={row[c.key] === true} onChange={e => set(i, c.key, e.target.checked ? true : undefined)} />
									: c.kind === 'select'
										? (
											<select aria-label={`${row.name ?? i} ${c.key}`} disabled={readOnly} value={row[c.key] ?? ''} onChange={e => set(i, c.key, e.target.value || undefined)}>
												<option value="" />
												{(c.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
											</select>
											)
										: (
											<input aria-label={`${row.name ?? i} ${c.key}`} readOnly={readOnly} size={c.kind === 'number' ? 5 : 12}
												value={c.kind === 'fields' ? fieldsText(row[c.key]) : row[c.key] ?? ''}
												onChange={e => set(i, c.key, c.kind === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : c.kind === 'fields' ? textFields(e.target.value) : e.target.value)} />
											)}
							</td>
						))}
						<td>{!readOnly && <button type="button" aria-label={`remove ${row.name ?? i}`} onClick={() => onChange(rows.filter((_, k) => k !== i))}>×</button>}</td>
					</tr>
				))}
			</tbody>
			{!readOnly && <tfoot><tr><td colSpan={columns.length + 1}><button type="button" onClick={() => onChange([...rows, {}])}>{addLabel}</button></td></tr></tfoot>}
		</table>
	)
}

/**
 * The schema as forms (docs/DATA_GATEWAY_ADMIN_PLAN.md §3.3): each section of the lambdaORM.yaml and each of its
 * elements, to create, change, rename and remove without writing YAML. Each save is one change of one element, sent
 * with the element as it was read: someone else's change to another element doesn't collide; to the same one, the
 * form shows what it has now. The gateway writes it keeping the comments and the rest of the file.
 */
export const SchemaForms: React.FC<SchemaFormsProps> = ({ admin, schema, writable, revision, locale }) => {
	const m = adminMessagesOf(locale)
	const [doc, setDoc] = useState<Json>()
	const [selected, setSelected] = useState<{ section: Section, name?: string }>()
	const [draft, setDraft] = useState<Json>()
	const [read, setRead] = useState<Json>()
	const [error, setError] = useState<string>()
	const [notice, setNotice] = useState<string>()
	const [busy, setBusy] = useState(false)
	const [removing, setRemoving] = useState<string[]>()
	const [renaming, setRenaming] = useState<string>()

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

	const names = useMemo(() => Object.fromEntries(SECTIONS.map(s => [s.key, listAt(doc, s.at).map((e: Json) => e?.name).filter(Boolean)])) as Record<Section, string[]>, [doc])

	const attempt = async (action: () => Promise<void>) => {
		setBusy(true)
		setError(undefined)
		try { await action() } catch (e: any) {
			if (e?.status === 412 && e.details?.current) {
				setRead(e.details.current)
				setDraft(JSON.parse(JSON.stringify(e.details.current)))
				setError(m.changedMeanwhile)
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
		} else {
			await admin.patchSchema(schema, { op: 'set', at: [...at, selected.name], value: clean(draft), expected: read })
		}
		setNotice(m.saved)
		await load()
	})

	const rename = () => attempt(async () => {
		const to = renaming?.trim()
		if (!selected?.name || !to || to === selected.name) return
		await admin.patchSchema(schema, { op: 'rename', at: [...sectionAt(selected.section), selected.name], to, expected: read })
		setRenaming(undefined)
		setDraft(undefined)
		setSelected({ section: selected.section, name: to })
		await load()
	})

	const askRemove = () => attempt(async () => {
		if (!selected?.name) return
		setRemoving((await admin.references(schema, [...sectionAt(selected.section), selected.name])).references)
	})

	const remove = () => attempt(async () => {
		if (!selected?.name) return
		await admin.patchSchema(schema, { op: 'remove', at: [...sectionAt(selected.section), selected.name], expected: read })
		setRemoving(undefined)
		setSelected(undefined)
		setDraft(undefined)
		await load()
	})

	const field = (key: string, input: React.ReactNode) => <label className="lw-form-field"><span>{key}</span>{input}</label>
	const text = (key: string, opts: { fields?: boolean } = {}) => field(key, (
		<input aria-label={key} readOnly={!writable} value={opts.fields ? fieldsText(draft?.[key]) : draft?.[key] ?? ''}
			onChange={e => setDraft({ ...draft, [key]: opts.fields ? textFields(e.target.value, false) : e.target.value || undefined })} />
	))
	const check = (key: string) => field(key, <input type="checkbox" aria-label={key} disabled={!writable} checked={draft?.[key] === true} onChange={e => setDraft({ ...draft, [key]: e.target.checked ? true : undefined })} />)
	const select = (key: string, options: string[]) => field(key, (
		<select aria-label={key} disabled={!writable} value={draft?.[key] ?? ''} onChange={e => setDraft({ ...draft, [key]: e.target.value || undefined })}>
			<option value="" />
			{options.map(o => <option key={o} value={o}>{o}</option>)}
		</select>
	))
	const rows = (key: string, columns: Parameters<typeof Rows>[0]['columns']) => (
		<fieldset className="lw-form-group"><legend>{key}</legend>
			<Rows label={key} rows={Array.isArray(draft?.[key]) ? draft[key] : []} columns={columns} readOnly={!writable} addLabel={m.addRow}
				onChange={value => setDraft({ ...draft, [key]: value })} />
		</fieldset>
	)

	const form = () => {
		if (!selected || !draft) return <p className="lw-type">{m.nothingSelected}</p>
		const isNew = selected.name === undefined
		switch (selected.section) {
		case 'entities':
			return (
				<>
					{isNew && text('name')}
					{select('extends', names.entities.filter(n => n !== draft.name))}
					{check('abstract')}
					{check('view')}
					{text('primaryKey', { fields: true })}
					{text('uniqueKey', { fields: true })}
					{rows('properties', [{ key: 'name' }, { key: 'type', kind: 'select', options: TYPES }, { key: 'length', kind: 'number' }, { key: 'required', kind: 'check' }, { key: 'autoIncrement', kind: 'check' }, { key: 'default' }, { key: 'enum', kind: 'select', options: names.enums }])}
					{rows('relations', [{ key: 'name' }, { key: 'type', kind: 'select', options: RELATION_TYPES }, { key: 'from', kind: 'fields' }, { key: 'entity', kind: 'select', options: names.entities }, { key: 'to', kind: 'fields' }, { key: 'target' }, { key: 'weak', kind: 'check' }])}
					{rows('indexes', [{ key: 'name' }, { key: 'fields', kind: 'fields' }])}
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
						<input aria-label="connection" readOnly={!writable} value={typeof draft.connection === 'string' ? draft.connection : draft.connection ? JSON.stringify(draft.connection) : ''}
							placeholder="${MY_CONNECTION}" onChange={e => setDraft({ ...draft, connection: e.target.value || undefined })} />
					))}
				</>
			)
		case 'mappings':
			return <>{isNew && text('name')}{select('extends', names.mappings.filter(n => n !== draft.name))}{rows('entities', [{ key: 'name', kind: 'select', options: names.entities }, { key: 'mapping' }])}</>
		case 'stages':
			return (
				<>
					{isNew && text('name')}
					<fieldset className="lw-form-group"><legend>sources</legend>
						{names.sources.map(source => (
							<label key={source} className="lw-type">
								<input type="checkbox" disabled={!writable} checked={(draft.sources ?? []).some((s: Json) => s?.name === source)}
									onChange={e => setDraft({ ...draft, sources: e.target.checked ? [...(draft.sources ?? []), { name: source }] : (draft.sources ?? []).filter((s: Json) => s?.name !== source) })} /> {source}
							</label>
						))}
					</fieldset>
				</>
			)
		}
	}

	const changed = draft !== undefined && JSON.stringify(clean(draft)) !== JSON.stringify(clean(read ?? {}))

	return (
		<section className="lw-schema-forms" aria-label={`${m.forms} — ${schema || '/'}`}>
			<nav className="lw-forms-tree" aria-label={m.forms}>
				{SECTIONS.map(s => (
					<div key={s.key}>
						<div className="lw-forms-section">
							<strong>{m[s.key]}</strong>
							{writable && <button type="button" aria-label={format(m.newNamed, { name: m[s.key] })} title={format(m.newNamed, { name: m[s.key] })}
								onClick={() => { setSelected({ section: s.key }); setRead(undefined); setDraft({}) }}>+</button>}
						</div>
						<ul>
							{names[s.key].map(name => (
								<li key={name}>
									<button type="button" className={selected?.section === s.key && selected.name === name ? 'lw-active' : undefined}
										onClick={() => { setSelected({ section: s.key, name }); setDraft(undefined); setRenaming(undefined); setRemoving(undefined); setError(undefined) }}>{name}</button>
								</li>
							))}
						</ul>
					</div>
				))}
			</nav>
			<div className="lw-forms-element">
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
						{writable && <button type="button" className="lw-primary" disabled={busy || !changed || (selected.name === undefined && !draft?.name)} onClick={save}>{m.save}</button>}
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
				<div className="lw-element-form">{form()}</div>
			</div>
		</section>
	)
}
