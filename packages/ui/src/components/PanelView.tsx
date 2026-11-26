import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { QueryApiPort } from '../application/ports'
import { newId } from '../domain/savedItems'
import { chartOf, numberOf, PANEL_FORMS, PanelCard, PanelContent, PanelForm, formatNumber } from '../domain/panels'
import { explorerMessagesOf } from '../domain/explorerI18n'
import { BarChart, LineChart, PieChart } from './charts'

export interface PanelViewProps {
	api: QueryApiPort
	schema: string
	content: PanelContent
	/** keeps the cards and the refresh (the workbench, or the browser) */
	onSave: (content: PanelContent) => Promise<void>
	locale?: string
	culture?: string
}

type Outcome = { loading: true } | { result: unknown } | { error: string }

const REFRESHES = [0, 30, 60, 300, 900]

const textOfCell = (v: unknown) => v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)

/**
 * A panel (docs/FILES_AND_PANELS.md §2): its cards in a grid, each its query run with the credential of the connection
 * and shown as a number, a table, bars, lines or a pie. Edited in place (a card at a time); refreshed by hand or every
 * so often; saved as a whole.
 */
export const PanelView: React.FC<PanelViewProps> = ({ api, schema, content, onSave, locale, culture }) => {
	const m = explorerMessagesOf(locale)
	const [cards, setCards] = useState<PanelCard[]>(content.cards)
	const [refresh, setRefresh] = useState<number>(content.refresh ?? 0)
	const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
	const [editing, setEditing] = useState<string>()
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string>()
	const dirty = JSON.stringify({ cards, refresh }) !== JSON.stringify({ cards: content.cards, refresh: content.refresh ?? 0 })

	const runCard = useCallback(async (card: PanelCard) => {
		if (!card.query.trim()) return
		setOutcomes(o => ({ ...o, [card.id]: { loading: true } }))
		try {
			const data = card.data?.trim() ? JSON.parse(card.data) : undefined
			const result = await api.execute(schema, card.query, data)
			setOutcomes(o => ({ ...o, [card.id]: { result } }))
		} catch (e: any) {
			setOutcomes(o => ({ ...o, [card.id]: { error: e?.message ?? String(e) } }))
		}
	}, [api, schema])

	const runAll = useCallback(() => { for (const card of cards) runCard(card) }, [cards, runCard])
	// the cards run when the panel opens (not while a card is edited) and every `refresh` seconds
	const signature = useMemo(() => cards.map(c => `${c.id}:${c.query}:${c.data ?? ''}`).join('|'), [cards])
	useEffect(() => { if (!editing) runAll() }, [signature, editing])
	useEffect(() => {
		if (!refresh) return
		const timer = setInterval(runAll, refresh * 1000)
		return () => clearInterval(timer)
	}, [refresh, runAll])

	const change = (id: string, patch: Partial<PanelCard>) => setCards(cs => cs.map(c => c.id === id ? { ...c, ...patch } : c))
	const add = () => {
		const card: PanelCard = { id: newId(), title: `${m.cardTitle} ${cards.length + 1}`, query: '', form: 'table' }
		setCards([...cards, card])
		setEditing(card.id)
	}
	const save = async () => {
		setSaving(true)
		try {
			await onSave({ cards, ...(refresh ? { refresh } : {}) })
			setError(undefined)
		} catch (e: any) { setError(e?.message ?? String(e)) } finally { setSaving(false) }
	}
	const formLabel: Record<PanelForm, string> = { number: m.formNumber, table: m.formTable, bar: m.formBar, line: m.formLine, pie: m.formPie }

	const body = (card: PanelCard) => {
		const outcome = outcomes[card.id]
		if (!card.query.trim()) return <span className="lw-muted">—</span>
		if (!outcome || 'loading' in outcome) return <span className="lw-muted">{m.loading}</span>
		if ('error' in outcome) return <div className="lw-error-text" role="alert">{outcome.error}</div>
		const { result } = outcome
		if (card.form === 'number') {
			const value = numberOf(result)
			return <div className="lw-card-number">{typeof value === 'number' ? formatNumber(value, culture) : textOfCell(value)}</div>
		}
		if (card.form === 'table') {
			const rows = Array.isArray(result) ? result : [result]
			const columns = rows.length && rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0] as object) : ['value']
			return (
				<div className="lw-card-table">
					<table className="lw-table" aria-label={card.title}>
						<thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
						<tbody>{rows.slice(0, 200).map((r: any, i) => <tr key={i}>{columns.map(c => <td key={c}>{textOfCell(r && typeof r === 'object' ? r[c] : r)}</td>)}</tr>)}</tbody>
					</table>
				</div>
			)
		}
		const data = chartOf(result, card.label, card.values)
		if (card.form === 'bar') return <BarChart data={data} culture={culture} title={card.title} />
		if (card.form === 'line') return <LineChart data={data} culture={culture} title={card.title} />
		return <PieChart data={data} culture={culture} title={card.title} />
	}

	return (
		<div className="lw-panel-view">
			<div className="lw-header">
				<button type="button" onClick={runAll}>↻ {m.refresh}</button>
				<label className="lw-inline">{m.refreshEvery}
					<select aria-label={m.refreshEvery} value={refresh} onChange={e => setRefresh(Number(e.target.value))}>
						{REFRESHES.map(s => <option key={s} value={s}>{s === 0 ? m.byHand : s < 60 ? `${s} s` : `${s / 60} min`}</option>)}
					</select>
				</label>
				<button type="button" onClick={add}>{m.addCard}</button>
				<span className="lw-spacer" />
				<button type="button" className="lw-primary" onClick={save} disabled={!dirty || saving}>{m.save}</button>
				{!dirty && <span className="lw-muted">{m.saved}</span>}
			</div>
			{error && <div className="lw-notice lw-error-text" role="alert">{error}</div>}
			{cards.length === 0 && <p className="lw-muted">{m.noCards}</p>}
			<div className="lw-panel-grid">
				{cards.map(card => (
					<section key={card.id} className={`lw-card${card.width === 2 ? ' lw-card-wide' : ''}`} aria-label={card.title}>
						<header>
							<strong>{card.title}</strong>
							<span className="lw-spacer" />
							<button type="button" className="lw-icon-button" aria-label={`${m.edit} ${card.title}`} title={m.edit} onClick={() => setEditing(editing === card.id ? undefined : card.id)}>✎</button>
						</header>
						{editing === card.id
							? (
								<div className="lw-form lw-card-form">
									<label>{m.cardTitle}<input value={card.title} onChange={e => change(card.id, { title: e.target.value })} /></label>
									<label>{m.cardQuery}<textarea rows={3} spellCheck={false} value={card.query} onChange={e => change(card.id, { query: e.target.value })} placeholder="Orders.map(p => ({ total: count(1) }))" /></label>
									<label>{m.data}<input spellCheck={false} value={card.data ?? ''} onChange={e => change(card.id, { data: e.target.value })} placeholder="{}" /></label>
									<label>{m.cardForm}
										<select value={card.form} onChange={e => change(card.id, { form: e.target.value as PanelForm })}>
											{PANEL_FORMS.map(f => <option key={f} value={f}>{formLabel[f]}</option>)}
										</select>
									</label>
									{['bar', 'line', 'pie'].includes(card.form) && (
										<>
											<label>{m.cardLabel}<input value={card.label ?? ''} onChange={e => change(card.id, { label: e.target.value || undefined })} /></label>
											<label>{m.cardValues}<input value={(card.values ?? []).join(', ')} onChange={e => change(card.id, { values: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })} /></label>
										</>
									)}
									<label className="lw-inline"><input type="checkbox" checked={card.width === 2} onChange={e => change(card.id, { width: e.target.checked ? 2 : 1 })} /> {m.cardWide}</label>
									<div className="lw-form-actions">
										<button type="button" className="lw-danger" onClick={() => { setCards(cards.filter(c => c.id !== card.id)); setEditing(undefined) }}>{m.removeCard}</button>
										<button type="button" className="lw-primary" onClick={() => { setEditing(undefined); runCard(card) }}>{m.done}</button>
									</div>
								</div>
								)
							: body(card)}
					</section>
				))}
			</div>
		</div>
	)
}
