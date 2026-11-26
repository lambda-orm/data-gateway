import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FileProperty, QueryApiPort } from '../application/ports'
import { EntityInfo, PropertyInfo } from '../domain/diagram'
import { cellOf, deleteRow, insertRow, isPoint, mapUrlOf, pageQuery, pointOf, textOf, updateCell, valueOf } from '../domain/dataEditing'
import { columnsOf, toCsv, toXlsx } from '../domain/exporters'
import { explorerMessagesOf, format } from '../domain/explorerI18n'
import { Modal } from './dialogs'

export interface DataTableProps {
	api: QueryApiPort
	schema: string
	entity: EntityInfo
	/** the credential may write: the table is editable */
	canWrite: boolean
	locale?: string
	pageSize?: number
	/** the rows that "export all" brings at most */
	exportLimit?: number
}

type Row = Record<string, unknown>

/** what can't be edited in a cell: the key, what is calculated (view, readExp), a vector (in the form of the row) */
const editable = (property: PropertyInfo, primaryKey: string[]): boolean =>
	!primaryKey.includes(property.name) && !property.view && !property.readExp && !property.autoIncrement && property.type !== 'vector'

/** The value of a property from its input (a point: its longitude and latitude) */
const parse = (property: PropertyInfo | undefined, text: string, lat?: string) =>
	property?.type === 'point' ? pointOf(text, lat ?? '') : valueOf(text, property?.type, property?.length)

/** What an input of a point starts with: its longitude and latitude */
const coordinatesOf = (value: unknown): [string, string] => isPoint(value) ? [String(value.coordinates[0]), String(value.coordinates[1])] : ['', '']

const save = (data: BlobPart, name: string, type: string) => {
	const url = URL.createObjectURL(new Blob([data], { type }))
	const link = document.createElement('a')
	link.href = url
	link.download = name
	document.body.appendChild(link)
	link.click()
	link.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The data of an entity as a backoffice (docs/BACKOFFICE.md): its rows by pages, sorted by a column and filtered by a
 * condition; with write, a cell changed by a double click (only while it has what was read), a row added and a row
 * deleted; the page or every row exported as CSV, JSON or Excel. Everything through execute, with the credential of the
 * connection: its permissions, its view and the audit of the gateway.
 */
export const DataTable: React.FC<DataTableProps> = ({ api, schema, entity, canWrite, locale, pageSize = 50, exportLimit = 100000 }) => {
	const m = explorerMessagesOf(locale)
	const primaryKey = entity.primaryKey ?? []
	const properties = entity.properties ?? []
	const writable = canWrite && primaryKey.length > 0 && !entity.abstract
	const [page, setPage] = useState(1)
	const [sort, setSort] = useState<{ field: string, desc: boolean }>()
	const [filter, setFilter] = useState('')
	const [applied, setApplied] = useState('')
	const [rows, setRows] = useState<Row[]>()
	const [error, setError] = useState<string>()
	const [notice, setNotice] = useState<string>()
	const [editing, setEditing] = useState<{ row: number, field: string, text: string, lat?: string }>()
	const [adding, setAdding] = useState<Record<string, string>>()
	const [deleting, setDeleting] = useState<Row>()
	const [exporting, setExporting] = useState<{ rows: number }>()
	const exportCancel = React.useRef(false)
	// the properties that keep files (docs/FILES_AND_PANELS.md): their value is the key of an object of a storage
	const [files, setFiles] = useState<Record<string, FileProperty>>({})
	const [uploading, setUploading] = useState<string>()
	useEffect(() => {
		let live = true
		api.files?.(schema).then(list => { if (live) setFiles(Object.fromEntries(list.filter(f => f.entity === entity.name).map(f => [f.property, f]))) }).catch(() => undefined)
		return () => { live = false }
	}, [api, schema, entity.name])

	const load = useCallback(async () => {
		setError(undefined)
		try {
			setRows(await api.execute(schema, pageQuery(entity.name, { page, size: pageSize, sort, filter: applied })) as Row[])
		} catch (e: any) {
			setRows([])
			setError(e?.message ?? String(e))
		}
	}, [api, schema, entity.name, page, pageSize, sort, applied])

	useEffect(() => { load() }, [load])

	const columns = useMemo(() => {
		const declared = properties.map(p => p.name)
		return [...declared, ...columnsOf(rows ?? []).filter(c => !declared.includes(c))]
	}, [properties, rows])

	const run = async (query: { query: string, data: Record<string, unknown> }): Promise<unknown> => api.execute(schema, query.query, query.data)

	/** the file a row keeps, in another tab: a URL signed for it, of short life */
	const openFile = async (field: string, key: string) => {
		try {
			const { url } = await api.fileUrl!(schema, entity.name, field, key)
			window.open(url, '_blank', 'noopener,noreferrer')
		} catch (e: any) { setError(e?.message ?? String(e)) }
	}

	/** a file to the storage (a URL signed by the gateway, the bytes straight to it), then its key in the row */
	const uploadFile = async (row: Row, field: string, file: File) => {
		const id = `${primaryKey.map(k => textOf(row[k])).join('|')}:${field}`
		setUploading(id)
		setError(undefined)
		try {
			const signed = await api.fileUpload!(schema, entity.name, field, { name: file.name, type: file.type || 'application/octet-stream', size: file.size })
			const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: file })
			if (!put.ok) throw new Error(`the storage answered ${put.status} ${put.statusText}`)
			const changed = await run(updateCell(entity.name, primaryKey, row, field, signed.key))
			setNotice(Number(changed) === 0 ? m.changedMeanwhile : undefined)
			await load()
		} catch (e: any) {
			setError(e?.message ?? String(e))
		} finally {
			setUploading(undefined)
		}
	}

	const removeFile = async (row: Row, field: string) => {
		try {
			const changed = await run(updateCell(entity.name, primaryKey, row, field, null))
			setNotice(Number(changed) === 0 ? m.changedMeanwhile : undefined)
			await load()
		} catch (e: any) { setError(e?.message ?? String(e)) }
	}

	const commit = async () => {
		if (!editing || !rows) return
		const row = rows[editing.row]
		const property = properties.find(p => p.name === editing.field)
		const parsed = parse(property, editing.text, editing.lat)
		if (parsed.error) { setError(`${editing.field}: ${parsed.error}`); return }
		setEditing(undefined)
		try {
			const changed = await run(updateCell(entity.name, primaryKey, row, editing.field, parsed.value))
			setNotice(Number(changed) === 0 ? m.changedMeanwhile : undefined)
			await load()
		} catch (e: any) {
			setError(e?.message ?? String(e))
		}
	}

	const add = async () => {
		if (!adding) return
		const row: Row = {}
		for (const property of properties) {
			const text = adding[property.name] ?? ''
			const lat = adding[`${property.name}.lat`] ?? ''
			if (text === '' && (property.type !== 'point' || lat === '')) continue
			const parsed = parse(property, text, lat)
			if (parsed.error) { setError(`${property.name}: ${parsed.error}`); return }
			row[property.name] = parsed.value
		}
		try {
			await run(insertRow(entity.name, row))
			setAdding(undefined)
			setError(undefined)
			await load()
		} catch (e: any) {
			setError(e?.message ?? String(e))
		}
	}

	const remove = async () => {
		if (!deleting) return
		try {
			await run(deleteRow(entity.name, primaryKey, deleting))
			setDeleting(undefined)
			await load()
		} catch (e: any) {
			setDeleting(undefined)
			setError(e?.message ?? String(e))
		}
	}

	/** the rows to export: the page, or every page up to the limit (with progress, cancellable) */
	const collect = async (all: boolean): Promise<Row[] | undefined> => {
		if (!all) return rows ?? []
		const collected: Row[] = []
		setExporting({ rows: 0 })
		const size = 1000
		try {
			for (let n = 1; collected.length < exportLimit; n++) {
				const got = await api.execute(schema, pageQuery(entity.name, { page: n, size, sort, filter: applied })) as Row[]
				collected.push(...got)
				setExporting({ rows: collected.length })
				if (exportCancel.current) return undefined
				if (got.length < size) break
			}
		} finally {
			setExporting(undefined)
			exportCancel.current = false
		}
		if (collected.length >= exportLimit) setNotice(format(m.exportLimit, { n: exportLimit }))
		return collected.slice(0, exportLimit)
	}

	const exportAs = async (kind: 'csv' | 'json' | 'xlsx', all: boolean) => {
		try {
			const data = await collect(all)
			if (!data) return
			const name = `${entity.name}${all ? '' : `-page-${page}`}`
			if (kind === 'csv') save(toCsv(data), `${name}.csv`, 'text/csv;charset=utf-8')
			else if (kind === 'json') save(JSON.stringify(data, null, 2), `${name}.json`, 'application/json')
			else save(toXlsx(data, entity.name), `${name}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
		} catch (e: any) {
			setError(e?.message ?? String(e))
		}
	}

	const header = (column: string) => {
		const on = sort?.field === column
		return (
			<th key={column}>
				<button type="button" className="lw-link" aria-label={`sort by ${column}`} onClick={() => { setPage(1); setSort(on && !sort!.desc ? { field: column, desc: true } : on ? undefined : { field: column, desc: false }) }}>
					{column}{on ? (sort!.desc ? ' ▼' : ' ▲') : ''}
				</button>
			</th>
		)
	}

	return (
		<div className="lw-data-table">
			<div className="lw-header">
				<button onClick={() => setPage(page - 1)} disabled={page === 1}>◀ {m.previous}</button>
				<span>{format(m.page, { n: page })}</span>
				<button onClick={() => setPage(page + 1)} disabled={(rows?.length ?? 0) < pageSize}>{m.next} ▶</button>
				<input aria-label={m.rowFilter} placeholder={m.rowFilter} value={filter} spellCheck={false} onChange={e => setFilter(e.target.value)}
					onKeyDown={e => { if (e.key === 'Enter') { setPage(1); setApplied(filter) } }} />
				<button onClick={() => { setPage(1); setApplied(filter) }}>{m.applyFilter}</button>
				{writable && <button className="lw-primary" onClick={() => setAdding({})}>+ {m.addRow}</button>}
				<span className="lw-spacer" />
				{(['csv', 'json', 'xlsx'] as const).map(kind => (
					<span key={kind}>
						<button title={m.exportPage} aria-label={`${m.exportPage} ${kind}`} onClick={() => exportAs(kind, false)}>{kind.toUpperCase()}</button>
						<button title={m.exportAll} aria-label={`${m.exportAll} ${kind}`} onClick={() => exportAs(kind, true)} disabled={!!exporting}>{kind.toUpperCase()} ∀</button>
					</span>
				))}
			</div>
			<div className="lw-muted">{writable ? m.dataEditHint : canWrite && !primaryKey.length ? m.dataNoKey : m.readOnlyData}</div>
			{exporting && (
				<div role="status">{format(m.exportingRows, { n: exporting.rows })} <button onClick={() => { exportCancel.current = true }}>{m.cancel}</button></div>
			)}
			{notice && <div className="lw-notice" role="status">{notice}</div>}
			{error && <div className="lw-notice lw-error-text" role="alert">{error}</div>}
			{!rows
				? <span className="lw-muted">{m.loading}</span>
				: (
					<table className="lw-table" aria-label={entity.name}>
						<thead><tr>{columns.map(header)}{writable && <th />}</tr></thead>
						<tbody>
							{rows.map((row, r) => (
								<tr key={primaryKey.length ? primaryKey.map(k => textOf(row[k])).join('|') : r}>
									{columns.map(column => {
										const property = properties.find(p => p.name === column)
										const canEdit = writable && !!property && editable(property, primaryKey)
										const keys = (e: React.KeyboardEvent) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(undefined) }
										if (editing?.row === r && editing.field === column) {
											return (
												<td key={column}>
													{property?.type === 'point'
														? (
															<span className="lw-point-input" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setEditing(undefined) }}>
																<input autoFocus aria-label={`${column} ${m.longitude}`} placeholder={m.longitude} value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} onKeyDown={keys} />
																<input aria-label={`${column} ${m.latitude}`} placeholder={m.latitude} value={editing.lat ?? ''} onChange={e => setEditing({ ...editing, lat: e.target.value })} onKeyDown={keys} />
															</span>
															)
														: <input autoFocus aria-label={`${column} value`} value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} onKeyDown={keys} onBlur={() => setEditing(undefined)} />}
												</td>
											)
										}
										const value = row[column]
										if (files[column]) {
											const key = typeof value === 'string' && value ? value : undefined
											const id = `${primaryKey.map(k => textOf(row[k])).join('|')}:${column}`
											const accept = files[column].types?.join(',')
											return (
												<td key={column} className="lw-file-cell">
													{key && <button type="button" className="lw-link" title={key} aria-label={`${column} ${m.openFile}`} onClick={() => openFile(column, key)}>📎 {key.split('/').pop()}</button>}
													{writable && canEdit && (uploading === id
														? <span className="lw-muted"> {m.uploading}</span>
														: (
															<>
																<label className="lw-file-upload" title={m.uploadFile}>
																	<input type="file" aria-label={`${column} ${m.uploadFile}`} accept={accept} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadFile(row, column, f) }} />
																	⤒
																</label>
																{key && <button type="button" className="lw-link" aria-label={`${column} ${m.removeFile}`} title={m.removeFile} onClick={() => removeFile(row, column)}>✕</button>}
															</>
															))}
												</td>
											)
										}
										const start = () => {
											if (property?.type === 'point') { const [lng, lat] = coordinatesOf(value); setEditing({ row: r, field: column, text: lng, lat }) } else setEditing({ row: r, field: column, text: textOf(value) })
										}
										return (
											<td key={column} className={canEdit ? 'lw-editable' : undefined} onDoubleClick={canEdit ? start : undefined} title={property?.type === 'vector' && Array.isArray(value) ? textOf(value) : undefined}>
												{cellOf(value, property?.type)}
												{isPoint(value) && <> <a className="lw-map-link" href={mapUrlOf(value)} target="_blank" rel="noopener noreferrer" title={m.onMap} aria-label={`${column} ${m.onMap}`} onDoubleClick={e => e.stopPropagation()}>↗</a></>}
											</td>
										)
									})}
									{writable && <td><button className="lw-danger" aria-label={`${m.deleteRow} ${r + 1}`} title={m.deleteRow} onClick={() => setDeleting(row)}>✕</button></td>}
								</tr>
							))}
						</tbody>
					</table>
					)}
			{adding && (
				<Modal title={`${m.addRow} · ${entity.name}`} onClose={() => setAdding(undefined)}>
					<div className="lw-form">
						{properties.filter(p => !p.view && !p.autoIncrement).map(p => (
							<label key={p.name}>{p.name}{p.required ? ' *' : ''} <span className="lw-type">{p.type ?? 'string'}{p.type === 'vector' && p.length ? `(${p.length})` : ''}</span>
								{p.type === 'point'
									? (
										<span className="lw-point-input">
											<input aria-label={`${p.name} ${m.longitude}`} placeholder={m.longitude} value={adding[p.name] ?? ''} onChange={e => setAdding({ ...adding, [p.name]: e.target.value })} />
											<input aria-label={`${p.name} ${m.latitude}`} placeholder={m.latitude} value={adding[`${p.name}.lat`] ?? ''} onChange={e => setAdding({ ...adding, [`${p.name}.lat`]: e.target.value })} />
										</span>
										)
									: p.type === 'vector'
										? <textarea aria-label={p.name} rows={3} spellCheck={false} placeholder={format(m.vectorHint, { n: p.length ?? 'n' })} value={adding[p.name] ?? ''} onChange={e => setAdding({ ...adding, [p.name]: e.target.value })} />
										: <input aria-label={p.name} value={adding[p.name] ?? ''} onChange={e => setAdding({ ...adding, [p.name]: e.target.value })} />}
							</label>
						))}
						<div className="lw-form-actions">
							<button onClick={() => setAdding(undefined)}>{m.cancel}</button>
							<button className="lw-primary" onClick={add}>{m.create}</button>
						</div>
					</div>
				</Modal>
			)}
			{deleting && (
				<Modal title={m.deleteRow} onClose={() => setDeleting(undefined)}>
					<p>{m.confirmDeleteRow}</p>
					<pre className="lw-sentences">{JSON.stringify(Object.fromEntries(primaryKey.map(k => [k, deleting[k]])))}</pre>
					<div className="lw-form-actions">
						<button onClick={() => setDeleting(undefined)}>{m.cancel}</button>
						<button className="lw-danger" onClick={remove}>{m.deleteRow}</button>
					</div>
				</Modal>
			)}
		</div>
	)
}
