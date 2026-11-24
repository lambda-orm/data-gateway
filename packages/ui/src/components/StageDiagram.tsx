import React, { useEffect, useMemo, useState } from 'react'
import { AdminApiPort, StageRouting } from '../application/ports'
import { adminMessagesOf } from '../domain/adminI18n'
import { format } from '../domain/i18n'
import { ExpressionView } from './ExpressionView'

export interface StageDiagramProps {
	admin: AdminApiPort
	schema: string
	stage: string
	theme?: 'light' | 'dark'
	locale?: string
	/** it changes when the schema is reloaded: the routing is read again */
	revision?: number | string
}

/** The colours are in the drawing, as in the diagram of the domain */
const PALETTES = {
	light: { canvas: '#f6f7f9', box: '#ffffff', header: '#e8eefc', gateway: '#dbe7ff', border: '#9aa4b2', text: '#1d1f23', muted: '#6b7280', line: '#7c8594', accent: '#2563eb', warn: '#b54708' },
	dark: { canvas: '#16181d', box: '#1e2128', header: '#263049', gateway: '#24365c', border: '#4a515c', text: '#e6e8eb', muted: '#9aa1ab', line: '#7d8590', accent: '#6ea0ff', warn: '#f5b971' }
}
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif'
const CHAR = 7.2
const ROW = 18
const HEADER = 44
const GAP = 56
const MARGIN = 24
const GATEWAY = { width: 240, height: 56 }
/** where the boxes of the sources start: under the gateway, with room for the arrows */
const SOURCES_Y = MARGIN + GATEWAY.height + 110

type Source = StageRouting['sources'][number]

/** A row of a source: its table, the entity when it is named otherwise, and where its reads or writes go */
const rowText = (e: Source['entities'][number], m: ReturnType<typeof adminMessagesOf>): { table: string, note: string } => ({
	table: e.table,
	note: [
		e.table !== e.entity ? e.entity : '',
		e.view ? 'view' : '',
		e.read ? format(m.stageReads, { source: e.read }) : '',
		e.write ? format(m.stageWrites, { source: e.write }) : ''
	].filter(Boolean).join(' · ')
})

/** The tables whose reads or writes a source takes while they live in another one (a replica for reading) */
const visitorsOf = (routing: StageRouting, source: Source, m: ReturnType<typeof adminMessagesOf>): { table: string, note: string, visitor: true }[] =>
	routing.sources.filter(other => other !== source).flatMap(other => other.entities
		.filter(e => e.read === source.name || e.write === source.name)
		.map(e => ({
			table: e.table,
			note: [e.read === source.name ? m.stageReadsHere : '', e.write === source.name ? m.stageWritesHere : '', format(m.stageLivesIn, { source: other.name })].filter(Boolean).join(' · '),
			visitor: true as const
		})))

const boxOf = (routing: StageRouting, source: Source, m: ReturnType<typeof adminMessagesOf>, order: number) => {
	const rows: { table: string, note: string, visitor?: true }[] = [...source.entities.map(e => rowText(e, m)), ...visitorsOf(routing, source, m)]
	const title = (`${order}. ${source.name}`.length) * 8 + 24
	const sub = ([source.dialect, source.mapping].filter(Boolean).join(' · ').length) * 6.6 + 24
	const width = Math.ceil(Math.max(200, title, sub, ...rows.map(r => (r.table.length + (r.note ? r.note.length + 2 : 0)) * CHAR + 24)))
	return { width, height: HEADER + 6 + Math.max(1, rows.length) * ROW + 6, rows }
}

/**
 * The diagram of a stage: the Data Gateway on top and, under it, each source of the stage in its order with the tables
 * that live in it (by its mapping). Each source has an arrow to the gateway; a click on it shows its condition below, in
 * the colours of the editor. Where each entity goes is told by the gateway, as λORM routes a sentence.
 */
export const StageDiagram: React.FC<StageDiagramProps> = ({ admin, schema, stage, theme = 'light', locale, revision }) => {
	const m = adminMessagesOf(locale)
	const colors = PALETTES[theme]
	const [routing, setRouting] = useState<StageRouting>()
	const [error, setError] = useState<string>()
	const [chosen, setChosen] = useState<number>()

	useEffect(() => {
		let alive = true
		if (!admin.stageRouting) { setError(m.stageNoRouting); return }
		admin.stageRouting(schema, stage)
			.then(r => { if (alive) { setRouting(r); setError(undefined) } })
			// a gateway before 4.1.0 has no such route
			.catch((e: any) => { if (alive) setError(e?.status === 404 && /not a route/.test(String(e?.message)) ? m.stageNoRouting : e?.message ?? String(e)) })
		return () => { alive = false }
	}, [admin, schema, stage, revision])

	const layout = useMemo(() => {
		if (!routing) return undefined
		let x = MARGIN
		const boxes = routing.sources.map((source, i) => {
			const box = boxOf(routing, source, m, i + 1)
			const at = { x, y: SOURCES_Y }
			x += box.width + GAP
			return { source, ...box, ...at }
		})
		const width = Math.max(x - GAP + MARGIN, GATEWAY.width + 2 * MARGIN)
		const height = Math.max(SOURCES_Y + 40, ...boxes.map(b => b.y + b.height)) + MARGIN
		const gateway = { x: width / 2 - GATEWAY.width / 2, y: MARGIN }
		return { boxes, width, height, gateway }
	}, [routing, locale])

	if (error) return <div className="lw-stage-diagram"><p className="lw-error-text" role="alert">{error}</p></div>
	if (!routing || !layout) return <div className="lw-stage-diagram"><p className="lw-muted">…</p></div>

	const { boxes, width, height, gateway } = layout
	const selected = chosen !== undefined ? routing.sources[chosen] : undefined
	return (
		<div className="lw-stage-diagram">
			{routing.unrouted.length > 0 && <p className="lw-hint lw-warning-text" role="status">{format(m.stageUnrouted, { names: routing.unrouted.join(', ') })}</p>}
			<div className="lw-stage-canvas" style={{ background: colors.canvas }}>
				<svg width={width} height={height} role="img" aria-label={format(m.stageDiagramOf, { name: stage })} style={{ display: 'block' }}>
					<defs>
						<marker id="lw-stage-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
							<path d="M0,0 L10,5 L0,10 z" fill={colors.line} />
						</marker>
						<marker id="lw-stage-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
							<path d="M0,0 L10,5 L0,10 z" fill={colors.accent} />
						</marker>
					</defs>
					{/* the gateway */}
					<g transform={`translate(${gateway.x},${gateway.y})`}>
						<rect width={GATEWAY.width} height={GATEWAY.height} rx={10} fill={colors.gateway} stroke={colors.accent} strokeWidth={1.5} />
						<text x={GATEWAY.width / 2} y={24} textAnchor="middle" fontFamily={SANS} fontSize={14} fontWeight={700} fill={colors.text}>{m.stageGateway}</text>
						<text x={GATEWAY.width / 2} y={42} textAnchor="middle" fontFamily={MONO} fontSize={11} fill={colors.muted}>{`${schema || '/'} · ${stage}`}</text>
					</g>
					{/* an arrow from each source to the gateway: a click shows its condition */}
					{boxes.map((b, i) => {
						const from = { x: b.x + b.width / 2, y: b.y }
						const to = { x: gateway.x + GATEWAY.width * (i + 1) / (boxes.length + 1), y: gateway.y + GATEWAY.height }
						const d = `M${from.x},${from.y} C${from.x},${from.y - 60} ${to.x},${to.y + 60} ${to.x},${to.y + 2}`
						const on = chosen === i
						const label = b.source.condition ? m.condition : m.theRest
						const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + 6 }
						return (
							<g key={b.source.name} role="button" tabIndex={0} aria-pressed={on} aria-label={`${m.condition} ${i + 1}. ${b.source.name}`} className="lw-stage-arrow"
								onClick={() => setChosen(on ? undefined : i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChosen(on ? undefined : i) } }}>
								<path d={d} fill="none" stroke="transparent" strokeWidth={16} />
								<path d={d} fill="none" stroke={on ? colors.accent : b.source.error ? colors.warn : colors.line} strokeWidth={on ? 2.5 : 1.5}
									strokeDasharray={b.source.condition ? undefined : '6 4'} markerEnd={`url(#${on ? 'lw-stage-arrow-on' : 'lw-stage-arrow'})`} />
								<rect x={mid.x - label.length * 3.6 - 8} y={mid.y - 13} width={label.length * 7.2 + 16} height={18} rx={9}
									fill={colors.box} stroke={on ? colors.accent : colors.border} />
								<text x={mid.x} y={mid.y} textAnchor="middle" fontFamily={SANS} fontSize={11} fill={on ? colors.accent : colors.muted}>{label}</text>
							</g>
						)
					})}
					{/* each source with its tables */}
					{boxes.map((b, i) => (
						<g key={b.source.name} transform={`translate(${b.x},${b.y})`} data-source={b.source.name}>
							<rect width={b.width} height={b.height} rx={6} fill={colors.box} stroke={chosen === i ? colors.accent : colors.border} strokeWidth={chosen === i ? 2 : 1} />
							<rect width={b.width} height={HEADER} rx={6} fill={colors.header} />
							<rect y={HEADER - 6} width={b.width} height={6} fill={colors.header} />
							<line x1={0} x2={b.width} y1={HEADER} y2={HEADER} stroke={colors.border} />
							<text x={10} y={18} fontFamily={SANS} fontSize={13} fontWeight={700} fill={colors.text}>{`${i + 1}. ${b.source.name}`}</text>
							<text x={10} y={35} fontFamily={SANS} fontSize={11} fill={colors.muted}>{[b.source.dialect, b.source.mapping, format(m.stageTables, { n: b.source.entities.length })].filter(Boolean).join(' · ')}</text>
							{b.rows.map((r, k) => (
								<text key={k} x={10} y={HEADER + 6 + k * ROW + 13} fontFamily={MONO} fontSize={12} fill={r.visitor ? colors.muted : colors.text} fontStyle={r.visitor ? 'italic' : undefined}>
									{r.table}{r.note && <tspan fill={colors.muted}>{`  ${r.note}`}</tspan>}
								</text>
							))}
						</g>
					))}
				</svg>
			</div>
			<div className="lw-stage-condition-panel" aria-live="polite">
				{selected
					? (
						<>
							<div className="lw-stage-condition-title"><strong>{`${chosen! + 1}. ${selected.name}`}</strong> <span className="lw-muted">{[selected.dialect, selected.mapping].filter(Boolean).join(' · ')}</span></div>
							<div className="lw-stage-condition-code" aria-label={m.condition}>
								<ExpressionView expression={selected.condition ?? ''} empty={m.theRest} />
							</div>
							{selected.error && <p className="lw-hint lw-error-text">{format(m.stageConditionError, { error: selected.error })}</p>}
						</>
						)
					: <p className="lw-hint">{m.stageChoose}</p>}
			</div>
		</div>
	)
}
