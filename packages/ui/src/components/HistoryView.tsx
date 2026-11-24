import React, { useCallback, useEffect, useState } from 'react'
import { AdminApiPort, JsonPatchOperation, SchemaChange } from '../application/ports'
import { adminMessagesOf } from '../domain/adminI18n'

export interface HistoryViewProps {
	admin: AdminApiPort
	schema: string
	/** only the changes of an element and what it holds: domain/entities/Customers */
	target?: string
	locale?: string
	/** when it changes, the history is read again (a Refresh, a change of another session) */
	revision?: string | number
	pageSize?: number
}

const show = (value: unknown): string => value === undefined ? '' : JSON.stringify(value)

/** A JSON Patch as lines of a diff: + added, - removed, ~ replaced */
const patchLines = (diff: JsonPatchOperation[]): { sign: string, className: string, text: string }[] =>
	diff.map(p => {
		if (p.op === 'add') return { sign: '+', className: 'lw-diff-add', text: `${p.path}: ${show(p.value)}` }
		if (p.op === 'remove') return { sign: '-', className: 'lw-diff-remove', text: p.path }
		if (p.op === 'replace') return { sign: '~', className: 'lw-diff-add', text: `${p.path}: ${show(p.value)}` }
		return { sign: ' ', className: '', text: `${p.op} ${p.from ?? ''} → ${p.path}` }
	})

const pretty = (value: unknown): string => JSON.stringify(value, null, 2)

/**
 * The history of a schema, or of an element of it (docs/OBSERVABILITY.md §5.3 of core): who changed what and when (the
 * IDE, the CLI, the gateway), the newest first; a change shows its diff and the element before and after.
 */
export const HistoryView: React.FC<HistoryViewProps> = ({ admin, schema, target, locale, revision, pageSize = 50 }) => {
	const m = adminMessagesOf(locale)
	const [items, setItems] = useState<SchemaChange[]>([])
	const [cursor, setCursor] = useState<string>()
	const [open, setOpen] = useState<string>()
	const [error, setError] = useState<string>()
	const [loading, setLoading] = useState(false)

	const read = useCallback(async (after?: string) => {
		if (!admin.history) return
		setLoading(true)
		setError(undefined)
		try {
			const page = await admin.history(schema, { target, limit: pageSize, cursor: after })
			setItems(current => after ? [...current, ...page.items] : page.items)
			setCursor(page.nextCursor)
		} catch (e: any) {
			setError(e?.message ?? String(e))
		} finally {
			setLoading(false)
		}
	}, [admin, schema, target, pageSize])

	useEffect(() => { read() }, [read, revision])

	if (!admin.history) return <div className="lw-notice" role="note">{m.historyUnavailable}</div>
	const when = (time: string) => {
		const date = new Date(time)
		return Number.isNaN(date.getTime()) ? time : date.toLocaleString(locale)
	}
	return (
		<div className="lw-view lw-history">
			{error && <div className="lw-notice" role="alert">{error}</div>}
			{!error && !loading && items.length === 0 && <div className="lw-muted" role="note">{m.historyEmpty}</div>}
			{items.length > 0 && (
				<table className="lw-table">
					<thead><tr><th>{m.historyWhen}</th><th>{m.historyWho}</th><th>{m.historyWhat}</th></tr></thead>
					<tbody>
						{items.map(change => (
							<React.Fragment key={change.id}>
								<tr className={open === change.id ? 'lw-active' : undefined} onClick={() => setOpen(open === change.id ? undefined : change.id)} style={{ cursor: 'pointer' }}>
									<td>{when(change.time)}</td>
									<td>
										{change.actor?.credential ?? change.actor?.user ?? '-'}
										{change.actor?.client && <span className="lw-muted"> · {change.actor.client}</span>}
									</td>
									<td>
										<code>{change.kind}</code>{change.op ? ` ${change.op}` : ''}{change.target ? ` ${change.target}` : ''}
										{change.result === 'error' && <span className="lw-badge lw-danger"> {change.error ?? 'error'}</span>}
									</td>
								</tr>
								{open === change.id && (
									<tr>
										<td colSpan={3}>
											{change.diff && change.diff.length > 0 && (
												<>
													<div className="lw-muted">{m.historyChanges}</div>
													<pre className="lw-sentences lw-diff" aria-label={m.historyChanges}>
														{patchLines(change.diff).map((line, i) => <span key={i} className={line.className}>{`${line.sign} ${line.text}\n`}</span>)}
													</pre>
												</>
											)}
											{(change.before !== undefined || change.after !== undefined) && (
												<div className="lw-conflict-sides">
													<div><div className="lw-muted">{m.historyBefore}</div><pre className="lw-sentences">{change.before === undefined ? '' : pretty(change.before)}</pre></div>
													<div><div className="lw-muted">{m.historyAfter}</div><pre className="lw-sentences">{change.after === undefined ? '' : pretty(change.after)}</pre></div>
												</div>
											)}
											{change.ddl && change.ddl.length > 0 && (
												<ul>{change.ddl.map(p => <li key={p.file}><code>{p.file}</code> ({p.source}, {p.sentences})</li>)}</ul>
											)}
											{change.actor && <div className="lw-muted">{[change.actor.session && `session ${change.actor.session}`, change.actor.ip].filter(Boolean).join(' · ')}</div>}
										</td>
									</tr>
								)}
							</React.Fragment>
						))}
					</tbody>
				</table>
			)}
			{cursor && <button disabled={loading} onClick={() => read(cursor)}>{m.historyMore}</button>}
		</div>
	)
}
