import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AdminApiPort, StageRouting } from '../application/ports'
import { adminMessagesOf } from '../domain/adminI18n'
import { format, messagesOf } from '../domain/i18n'
import { DiagramOutline } from './DiagramOutline'
import { ExpressionView } from './ExpressionView'
import { Icons } from './dialogs'

/** How a stage diagram was left: where the gateway goes, what each source shows, where each box was put by hand */
export interface StageView {
	orientation?: 'top' | 'left'
	detail?: 'tables' | 'names'
	/** the boxes moved by hand: the gateway (GATEWAY_KEY) and each source by its name */
	positions?: Record<string, { x: number, y: number }>
}

export interface StageDiagramProps {
	admin: AdminApiPort
	schema: string
	stage: string
	theme?: 'light' | 'dark'
	locale?: string
	/** it changes when the schema is reloaded: the routing is read again */
	revision?: number | string
	/** how it was left (kept with its tab), and each change of it */
	view?: StageView
	onViewChange?: (view: StageView) => void
	/** what goes first in its toolbar (the IDE: save it) */
	toolbar?: React.ReactNode
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
const GATEWAY_SIZE = { width: 240, height: 56 }
/** the key of the gateway among the positions (a source can't be named so) */
export const GATEWAY_KEY = '@gateway'
/** the room between the gateway and the sources, for the arrows */
const REACH = 150

type Source = StageRouting['sources'][number]
type Messages = ReturnType<typeof adminMessagesOf>
interface Point { x: number, y: number }
interface Row { table: string, note: string, visitor?: true }
interface Box { key: string, width: number, height: number, rows: Row[], source?: Source, order?: number }

/** A row of a source: its table, the entity when it is named otherwise, and where its reads or writes go */
const rowText = (e: Source['entities'][number], m: Messages): Row => ({
	table: e.table,
	note: [
		e.table !== e.entity ? e.entity : '',
		e.view ? 'view' : '',
		e.read ? format(m.stageReads, { source: e.read }) : '',
		e.write ? format(m.stageWrites, { source: e.write }) : ''
	].filter(Boolean).join(' · ')
})

/** The tables whose reads or writes a source takes while they live in another one (a replica for reading) */
const visitorsOf = (routing: StageRouting, source: Source, m: Messages): Row[] =>
	routing.sources.filter(other => other !== source).flatMap(other => other.entities
		.filter(e => e.read === source.name || e.write === source.name)
		.map(e => ({
			table: e.table,
			note: [e.read === source.name ? m.stageReadsHere : '', e.write === source.name ? m.stageWritesHere : '', format(m.stageLivesIn, { source: other.name })].filter(Boolean).join(' · '),
			visitor: true as const
		})))

const sourceBox = (routing: StageRouting, source: Source, m: Messages, order: number, names: boolean): Box => {
	const rows = names ? [] : [...source.entities.map(e => rowText(e, m)), ...visitorsOf(routing, source, m)]
	const title = `${order}. ${source.name}`.length * 8 + 24
	const sub = [source.dialect, source.mapping, format(m.stageTables, { n: source.entities.length })].filter(Boolean).join(' · ').length * 6.6 + 24
	const width = Math.ceil(Math.max(200, title, sub, ...rows.map(r => (r.table.length + (r.note ? r.note.length + 2 : 0)) * CHAR + 24)))
	return { key: source.name, width, height: names ? HEADER : HEADER + 6 + Math.max(1, rows.length) * ROW + 6, rows, source, order }
}

/** Where each box goes by itself: the gateway on top (the sources in a row under it) or on the left (in a column) */
const autoLayout = (boxes: Box[], gateway: Box, orientation: 'top' | 'left'): Record<string, Point> => {
	const at: Record<string, Point> = {}
	if (orientation === 'top') {
		let x = MARGIN
		for (const b of boxes) { at[b.key] = { x, y: MARGIN + gateway.height + REACH }; x += b.width + GAP }
		const span = Math.max(x - GAP - MARGIN, gateway.width)
		at[GATEWAY_KEY] = { x: MARGIN + span / 2 - gateway.width / 2, y: MARGIN }
	} else {
		let y = MARGIN
		for (const b of boxes) { at[b.key] = { x: MARGIN + gateway.width + REACH * 1.6, y }; y += b.height + GAP / 2 }
		const span = Math.max(y - GAP / 2 - MARGIN, gateway.height)
		at[GATEWAY_KEY] = { x: MARGIN, y: MARGIN + span / 2 - gateway.height / 2 }
	}
	return at
}

/** The point of a cubic Bézier at t */
const bezier = (p: Point[], t: number): Point => {
	const u = 1 - t
	return {
		x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
		y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y
	}
}

/**
 * The diagram of a stage: the Data Gateway and each source of the stage in its order with the tables that live in it (by
 * its mapping), on top and below, or on the left and on the right. Each source has an arrow to the gateway; a click on
 * it shows its condition below, in the colours of the editor. Its toolbar zooms, selects or moves the view, shows the
 * tables or only the names of the sources, and turns it; the boxes are put where one wants by dragging them.
 */
export const StageDiagram: React.FC<StageDiagramProps> = ({ admin, schema, stage, theme = 'light', locale, revision, view: kept, onViewChange, toolbar }) => {
	const m = adminMessagesOf(locale)
	const d = messagesOf(locale)
	const colors = PALETTES[theme]
	const [routing, setRouting] = useState<StageRouting>()
	const [error, setError] = useState<string>()
	const [chosen, setChosen] = useState<number>()
	const [orientation, setOrientation] = useState<'top' | 'left'>(kept?.orientation ?? 'top')
	const [detail, setDetail] = useState<'tables' | 'names'>(kept?.detail ?? 'tables')
	const [moved, setMoved] = useState<Record<string, Point>>(kept?.positions ?? {})
	const [tool, setTool] = useState<'select' | 'move'>('select')
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const [view, setView] = useState({ x: 0, y: 0, k: 1 })
	const [band, setBand] = useState<{ from: Point, to: Point }>()
	// the outline of the drawing: hidden until its button shows it
	const [outline, setOutline] = useState(false)
	const canvas = useRef<HTMLDivElement>(null)
	const drag = useRef<{ kind: 'pan' | 'boxes' | 'band', start: Point, view: { x: number, y: number, k: number }, origin: Record<string, Point>, moved: boolean }>()
	const fitted = useRef(false)

	useEffect(() => {
		let alive = true
		if (!admin.stageRouting) { setError(m.stageNoRouting); return }
		admin.stageRouting(schema, stage)
			.then(r => { if (alive) { setRouting(r); setError(undefined) } })
			// a gateway before 4.1.0 has no such route
			.catch((e: any) => { if (alive) setError(e?.status === 404 && /not a route/.test(String(e?.message)) ? m.stageNoRouting : e?.message ?? String(e)) })
		return () => { alive = false }
	}, [admin, schema, stage, revision])

	const tell = (next: Partial<StageView>) => onViewChange?.({ orientation, detail, positions: moved, ...next })

	// the boxes and where each one is: by itself, or where it was put
	const layout = useMemo(() => {
		if (!routing) return undefined
		const gateway: Box = { key: GATEWAY_KEY, width: GATEWAY_SIZE.width, height: GATEWAY_SIZE.height, rows: [] }
		const boxes = routing.sources.map((source, i) => sourceBox(routing, source, m, i + 1, detail === 'names'))
		const auto = autoLayout(boxes, gateway, orientation)
		const at = (key: string): Point => moved[key] ?? auto[key]
		return { gateway, boxes, at }
	}, [routing, locale, detail, orientation, moved])

	// the drawing as a whole: what fit shows
	const bounds = () => {
		if (!layout) return undefined
		const all = [layout.gateway, ...layout.boxes].map(b => ({ ...layout.at(b.key), w: b.width, h: b.height }))
		const x0 = Math.min(...all.map(b => b.x)); const y0 = Math.min(...all.map(b => b.y))
		const x1 = Math.max(...all.map(b => b.x + b.w)); const y1 = Math.max(...all.map(b => b.y + b.h))
		return { x0, y0, x1, y1 }
	}
	const fit = () => {
		const box = canvas.current?.getBoundingClientRect()
		const b = bounds()
		if (!box || !b || box.width === 0) return
		const k = Math.min(1.25, Math.max(0.05, Math.min((box.width - 2 * MARGIN) / (b.x1 - b.x0), (box.height - 2 * MARGIN) / (b.y1 - b.y0))))
		setView({ k, x: (box.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (box.height - (b.y1 - b.y0) * k) / 2 - b.y0 * k })
	}
	// shown whole the first time it can be measured (and after turning it or changing what it shows)
	useEffect(() => {
		if (fitted.current || !layout) return
		const box = canvas.current?.getBoundingClientRect()
		if (!box || box.width === 0) return
		fitted.current = true
		fit()
	})
	const zoomBy = (factor: number, around?: Point) => {
		const box = canvas.current?.getBoundingClientRect()
		const c = around ?? { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 }
		setView(v => { const k = Math.min(3, Math.max(0.05, v.k * factor)); return { k, x: c.x - (c.x - v.x) * (k / v.k), y: c.y - (c.y - v.y) * (k / v.k) } })
	}
	// the wheel zooms where the pointer is (not the page)
	useEffect(() => {
		const el = canvas.current
		if (!el) return
		const wheel = (e: WheelEvent) => {
			e.preventDefault()
			const r = el.getBoundingClientRect()
			zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, { x: e.clientX - r.left, y: e.clientY - r.top })
		}
		el.addEventListener('wheel', wheel, { passive: false })
		return () => el.removeEventListener('wheel', wheel)
	}, [routing])

	const local = (e: React.PointerEvent): Point => {
		const r = canvas.current!.getBoundingClientRect()
		return { x: e.clientX - r.left, y: e.clientY - r.top }
	}
	// the pointer stays with the drawing while it is dragged (a browser without capture still drags inside it)
	const capture = (e: React.PointerEvent) => { try { canvas.current?.setPointerCapture?.(e.pointerId) } catch { /* no capture */ } }
	const world = (p: Point): Point => ({ x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k })

	const backgroundDown = (e: React.PointerEvent) => {
		if (!layout || (e.button !== 0 && e.button !== 1)) return
		capture(e)
		const p = local(e)
		if (tool === 'move' || e.button === 1) drag.current = { kind: 'pan', start: p, view, origin: {}, moved: false }
		else {
			if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setSelected(new Set())
			drag.current = { kind: 'band', start: p, view, origin: {}, moved: false }
			setBand({ from: world(p), to: world(p) })
		}
	}
	const boxDown = (key: string) => (e: React.PointerEvent) => {
		if (!layout || e.button !== 0) return
		e.stopPropagation()
		if (tool === 'move') { backgroundDown(e); return }
		capture(e)
		let now = selected
		if (e.shiftKey || e.ctrlKey || e.metaKey) { now = new Set(selected); if (now.has(key)) now.delete(key); else now.add(key) } else if (!selected.has(key)) now = new Set([key])
		setSelected(now)
		const origin = Object.fromEntries([...now].map(k => [k, layout.at(k)]))
		drag.current = { kind: 'boxes', start: local(e), view, origin, moved: false }
	}
	const pointerMove = (e: React.PointerEvent) => {
		const g = drag.current
		if (!g || !layout) return
		const p = local(e)
		const dx = p.x - g.start.x; const dy = p.y - g.start.y
		if (Math.abs(dx) + Math.abs(dy) > 2) g.moved = true
		if (g.kind === 'pan') setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy })
		else if (g.kind === 'boxes') setMoved(all => ({ ...all, ...Object.fromEntries(Object.entries(g.origin).map(([k, at]) => [k, { x: at.x + dx / view.k, y: at.y + dy / view.k }])) }))
		else setBand(b => b && { ...b, to: world(p) })
	}
	const pointerUp = () => {
		const g = drag.current
		drag.current = undefined
		if (!g || !layout) return
		if (g.kind === 'boxes' && g.moved) tell({ positions: { ...moved } })
		if (g.kind === 'band' && band) {
			const x0 = Math.min(band.from.x, band.to.x); const x1 = Math.max(band.from.x, band.to.x)
			const y0 = Math.min(band.from.y, band.to.y); const y1 = Math.max(band.from.y, band.to.y)
			const inside = [layout.gateway, ...layout.boxes].filter(b => { const at = layout.at(b.key); return at.x < x1 && at.x + b.width > x0 && at.y < y1 && at.y + b.height > y0 })
			if (g.moved) setSelected(s => new Set([...s, ...inside.map(b => b.key)]))
			setBand(undefined)
		}
	}
	const keys = (e: React.KeyboardEvent) => {
		if (!layout) return
		if (e.key === 'Escape') setSelected(new Set())
		else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(new Set([GATEWAY_KEY, ...layout.boxes.map(b => b.key)])) }
	}

	const turn = (next: 'top' | 'left') => { setOrientation(next); setMoved({}); fitted.current = false; tell({ orientation: next, positions: {} }) }
	const show = (next: 'tables' | 'names') => { setDetail(next); fitted.current = false; tell({ detail: next }) }
	const relayout = () => { setMoved({}); fitted.current = false; tell({ positions: {} }) }

	if (error) return <div className="lw-stage-diagram"><p className="lw-error-text" role="alert">{error}</p></div>
	if (!routing || !layout) return <div className="lw-stage-diagram"><p className="lw-muted">…</p></div>

	const { gateway, boxes, at } = layout
	const g = at(GATEWAY_KEY)
	const selectedSource = chosen !== undefined ? routing.sources[chosen] : undefined
	// the arrows reach the side of the gateway that faces the sources, each one at its own place, in the order of the sources
	const along = (b: Box) => orientation === 'top' ? at(b.key).x + b.width / 2 : at(b.key).y + b.height / 2
	const order = [...boxes].sort((a, b) => along(a) - along(b))
	const arrowOf = (b: Box): Point[] => {
		const p = at(b.key)
		const slot = (order.indexOf(b) + 1) / (boxes.length + 1)
		if (orientation === 'top') {
			const from = { x: p.x + b.width / 2, y: p.y }
			const to = { x: g.x + gateway.width * slot, y: g.y + gateway.height + 2 }
			const bend = Math.max(40, Math.abs(from.y - to.y) / 2)
			return [from, { x: from.x, y: from.y - bend }, { x: to.x, y: to.y + bend }, to]
		}
		const from = { x: p.x, y: p.y + b.height / 2 }
		const to = { x: g.x + gateway.width + 2, y: g.y + gateway.height * slot }
		const bend = Math.max(40, Math.abs(from.x - to.x) / 2)
		return [from, { x: from.x - bend, y: from.y }, { x: to.x + bend, y: to.y }, to]
	}
	const isSelected = (key: string) => selected.has(key)
	// the drawing: in the view, and small in the outline
	const drawing = (
		<>
			{/* an arrow from each source to the gateway: a click shows its condition */}
			{boxes.map((b, i) => {
				const p = arrowOf(b)
				const path = `M${p[0].x},${p[0].y} C${p[1].x},${p[1].y} ${p[2].x},${p[2].y} ${p[3].x},${p[3].y}`
				const on = chosen === i
				const label = b.source!.condition ? m.condition : m.theRest
				const mid = bezier(p, 0.5)
				return (
					<g key={b.key} role="button" tabIndex={0} aria-pressed={on} aria-label={`${m.condition} ${i + 1}. ${b.key}`} className="lw-stage-arrow"
						onPointerDown={e => e.stopPropagation()}
						onClick={() => setChosen(on ? undefined : i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChosen(on ? undefined : i) } }}>
						<path d={path} fill="none" stroke="transparent" strokeWidth={16} />
						<path d={path} fill="none" stroke={on ? colors.accent : b.source!.error ? colors.warn : colors.line} strokeWidth={on ? 2.5 : 1.5}
							strokeDasharray={b.source!.condition ? undefined : '6 4'} markerEnd={`url(#${on ? 'lw-stage-arrow-on' : 'lw-stage-arrow'})`} />
						<rect x={mid.x - label.length * 3.6 - 8} y={mid.y - 9} width={label.length * 7.2 + 16} height={18} rx={9} fill={colors.box} stroke={on ? colors.accent : colors.border} />
						<text x={mid.x} y={mid.y + 4} textAnchor="middle" fontFamily={SANS} fontSize={11} fill={on ? colors.accent : colors.muted}>{label}</text>
					</g>
				)
			})}
			{/* the gateway */}
			<g transform={`translate(${g.x},${g.y})`} data-box={GATEWAY_KEY} className="lw-movable" onPointerDown={boxDown(GATEWAY_KEY)}>
				<rect width={gateway.width} height={gateway.height} rx={10} fill={colors.gateway} stroke={colors.accent} strokeWidth={isSelected(GATEWAY_KEY) ? 3 : 1.5} />
				<text x={gateway.width / 2} y={24} textAnchor="middle" fontFamily={SANS} fontSize={14} fontWeight={700} fill={colors.text}>{m.stageGateway}</text>
				<text x={gateway.width / 2} y={42} textAnchor="middle" fontFamily={MONO} fontSize={11} fill={colors.muted}>{`${schema || '/'} · ${stage}`}</text>
			</g>
			{/* each source with its tables */}
			{boxes.map((b, i) => {
				const p = at(b.key)
				const on = chosen === i || isSelected(b.key)
				return (
					<g key={b.key} transform={`translate(${p.x},${p.y})`} data-source={b.key} className="lw-movable" onPointerDown={boxDown(b.key)}>
						<rect width={b.width} height={b.height} rx={6} fill={colors.box} stroke={on ? colors.accent : colors.border} strokeWidth={on ? 2 : 1} />
						<rect width={b.width} height={detail === 'names' ? b.height : HEADER} rx={6} fill={colors.header} />
						{detail !== 'names' && <rect y={HEADER - 6} width={b.width} height={6} fill={colors.header} />}
						{detail !== 'names' && <line x1={0} x2={b.width} y1={HEADER} y2={HEADER} stroke={colors.border} />}
						<rect width={b.width} height={b.height} rx={6} fill="none" stroke={on ? colors.accent : colors.border} strokeWidth={on ? 2 : 1} />
						<text x={10} y={18} fontFamily={SANS} fontSize={13} fontWeight={700} fill={colors.text}>{`${b.order}. ${b.key}`}</text>
						<text x={10} y={35} fontFamily={SANS} fontSize={11} fill={colors.muted}>{[b.source!.dialect, b.source!.mapping, format(m.stageTables, { n: b.source!.entities.length })].filter(Boolean).join(' · ')}</text>
						{b.rows.map((r, k) => (
							<text key={k} x={10} y={HEADER + 6 + k * ROW + 13} fontFamily={MONO} fontSize={12} fill={r.visitor ? colors.muted : colors.text} fontStyle={r.visitor ? 'italic' : undefined}>
								{r.table}{r.note && <tspan fill={colors.muted}>{`  ${r.note}`}</tspan>}
							</text>
						))}
					</g>
				)
			})}
		</>
	)
	const whole = bounds()
	const outlineTo = (p: Point) => {
		const box = canvas.current
		if (!box) return
		setView(v => ({ k: v.k, x: box.clientWidth / 2 - p.x * v.k, y: box.clientHeight / 2 - p.y * v.k }))
	}

	return (
		<div className={`lw-stage-diagram lw-diagram lw-workbench lw-${theme}`}>
			<div className="lw-header">
				{toolbar}
				<span className="lw-tool-group" role="group" aria-label={d.toolSelect}>
					<button className="lw-tool" aria-label={d.toolSelect} title={d.toolSelect} aria-pressed={tool === 'select'} onClick={() => setTool('select')}><Icons.pointer size={18} /></button>
					<button className="lw-tool" aria-label={d.toolMove} title={d.toolMove} aria-pressed={tool === 'move'} onClick={() => setTool('move')}><Icons.hand size={18} /></button>
				</span>
				<span className="lw-tool-group" role="group" aria-label={d.zoomIn}>
					<button className="lw-tool" aria-label={d.zoomOut} title={d.zoomOut} onClick={() => zoomBy(1 / 1.25)}><Icons.zoomOut size={18} /></button>
					<span className="lw-zoom" aria-live="polite">{Math.round(view.k * 100)}%</span>
					<button className="lw-tool" aria-label={d.zoomIn} title={d.zoomIn} onClick={() => zoomBy(1.25)}><Icons.zoomIn size={18} /></button>
				</span>
				<button onClick={fit}>{d.fit}</button>
				<button className="lw-tool" aria-label={d.outline} title={d.outline} aria-pressed={outline} onClick={() => setOutline(o => !o)}><Icons.outline size={18} /></button>
				<label className="lw-check">{m.stageShow}{' '}
					<select aria-label={m.stageShow} value={detail} onChange={e => show(e.target.value as 'tables' | 'names')}>
						<option value="tables">{m.stageShowTables}</option>
						<option value="names">{m.stageShowNames}</option>
					</select>
				</label>
				<span className="lw-tool-group" role="group" aria-label={m.stageGatewayTop}>
					<button className="lw-tool" aria-label={m.stageGatewayTop} title={m.stageGatewayTop} aria-pressed={orientation === 'top'} onClick={() => turn('top')}><Icons.gatewayTop size={18} /></button>
					<button className="lw-tool" aria-label={m.stageGatewayLeft} title={m.stageGatewayLeft} aria-pressed={orientation === 'left'} onClick={() => turn('left')}><Icons.gatewayLeft size={18} /></button>
				</span>
				<button onClick={relayout} disabled={Object.keys(moved).length === 0}>{d.relayout}</button>
			</div>
			{routing.unrouted.length > 0 && <p className="lw-hint lw-warning-text" role="status">{format(m.stageUnrouted, { names: routing.unrouted.join(', ') })}</p>}
			<div ref={canvas} className={`lw-stage-canvas ${tool === 'move' ? 'lw-tool-move' : ''}`} style={{ background: colors.canvas }} tabIndex={0} onKeyDown={keys}
				onPointerDown={backgroundDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
				<svg width="100%" height="100%" role="img" aria-label={format(m.stageDiagramOf, { name: stage })} style={{ display: 'block' }}>
					<defs>
						<marker id="lw-stage-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
							<path d="M0,0 L10,5 L0,10 z" fill={colors.line} />
						</marker>
						<marker id="lw-stage-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
							<path d="M0,0 L10,5 L0,10 z" fill={colors.accent} />
						</marker>
					</defs>
					<g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
						{drawing}
						{band && (
							<rect x={Math.min(band.from.x, band.to.x)} y={Math.min(band.from.y, band.to.y)} width={Math.abs(band.to.x - band.from.x)} height={Math.abs(band.to.y - band.from.y)}
								fill={colors.accent} fillOpacity={0.08} stroke={colors.accent} strokeDasharray="4 3" />
						)}
					</g>
				</svg>
				{outline && whole && (
					<DiagramOutline bounds={{ x: whole.x0, y: whole.y0, width: whole.x1 - whole.x0, height: whole.y1 - whole.y0 }} view={view}
						viewport={{ width: canvas.current?.clientWidth ?? 0, height: canvas.current?.clientHeight ?? 0 }} colors={colors} label={d.outline} onCenter={outlineTo}>{drawing}</DiagramOutline>
				)}
			</div>
			<div className="lw-stage-condition-panel" aria-live="polite">
				{selectedSource
					? (
						<>
							<div className="lw-stage-condition-title"><strong>{`${chosen! + 1}. ${selectedSource.name}`}</strong> <span className="lw-muted">{[selectedSource.dialect, selectedSource.mapping].filter(Boolean).join(' · ')}</span></div>
							<div className="lw-stage-condition-code" aria-label={m.condition}>
								<ExpressionView expression={selectedSource.condition ?? ''} empty={m.theRest} />
							</div>
							{selectedSource.error && <p className="lw-hint lw-error-text">{format(m.stageConditionError, { error: selectedSource.error })}</p>}
						</>
						)
					: <p className="lw-hint">{m.stageChoose}</p>}
			</div>
		</div>
	)
}
