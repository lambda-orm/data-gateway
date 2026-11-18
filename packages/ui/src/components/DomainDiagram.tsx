import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { boxSize, DiagramEdge, DomainInfo, edgesOf, EntityInfo, foreignKeysOf, HEADER, hubOf, neighbourhood, Placed, routeOrthogonal, ROW, typeText } from '../domain/diagram'
import { format, Locale, messagesOf } from '../domain/i18n'
import { QueryApiPort, SchemaInfo } from '../application/ports'
import { elkLayout, LayoutPort, LayoutResult, Point } from '../infrastructure/elkLayout'
import { HeadersProvider, RestQueryApi } from '../infrastructure/restQueryApi'
import { SchemaSelector } from './QueryWorkbench'

export interface DomainDiagramProps {
	/** URL of the data-gateway (its REST transport); or api */
	baseUrl?: string
	api?: QueryApiPort
	/** Fixed schema; without it, a selector of the ready schemas (the first one at the start) */
	schema?: string
	headers?: HeadersProvider
	theme?: 'light' | 'dark'
	locale?: Locale
	/** A double click on an entity: query it (QueryTabs opens a tab with it) */
	onQuery?: (schema: string, entity: string) => void
	/** A double click on an entity, instead of onQuery (the Workspace opens its form) */
	onOpenEntity?: (schema: string, entity: string) => void
	/** Only these entities, always (a saved diagram); without it, an entity and its neighbours, or the whole model */
	entities?: string[]
	/** The entity to start on (default: the most connected one) */
	focus?: string
	/** Where the boxes were left; the ones without a place are laid out */
	positions?: Record<string, { x: number, y: number }>
	/** The boxes can be dragged; every move gives all the places (undefined: lay them out again) */
	onPositionsChange?: (positions: Record<string, { x: number, y: number }> | undefined) => void
	/** Where the lines moved by hand have their vertical stretch, by line (editable) */
	bends?: Record<string, number>
	onBendsChange?: (bends: Record<string, number> | undefined) => void
	/** The names of the relations on their lines */
	relationNames?: boolean
	onRelationNamesChange?: (show: boolean) => void
	/** A × on each box (and the Delete key on the chosen one) takes an entity out of the diagram (editable) */
	onRemoveEntity?: (entity: string) => void
	/** Names only at the start */
	compact?: boolean
	onCompactChange?: (compact: boolean) => void
	/** Buttons of the application in the bar (Save) */
	toolbar?: React.ReactNode
	/** File name of the exports, without extension */
	exportName?: string
	/** Where the boxes go (ELK by default) */
	layout?: LayoutPort
	/** Height of the drawing (default 70vh) */
	height?: number | string
}

type Depth = 1 | 2 | 'all'
interface View { x: number, y: number, k: number }

/** The colours are in the drawing (not in CSS): the exported SVG and PNG look the same as the screen */
const PALETTES = {
	light: { canvas: '#f6f7f9', box: '#ffffff', header: '#e8eefc', border: '#9aa4b2', text: '#1d1f23', muted: '#6b7280', pk: '#b54708', fk: '#2563eb', line: '#7c8594', accent: '#2563eb' },
	dark: { canvas: '#16181d', box: '#1e2128', header: '#263049', border: '#4a515c', text: '#e6e8eb', muted: '#9aa1ab', pk: '#f5b971', fk: '#6ea0ff', line: '#7d8590', accent: '#6ea0ff' }
}
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif'
const MARGIN = 24
/** The smallest zoom where the properties can be read */
const READABLE = 0.75

const download = (url: string, name: string) => {
	const link = document.createElement('a')
	link.href = url
	link.download = name
	document.body.appendChild(link)
	link.click()
	link.remove()
}

/** The drawing as a standalone SVG: the whole diagram at scale 1, with its background */
const standaloneSvg = (svg: SVGSVGElement, laid: LayoutResult, background: string): { text: string, width: number, height: number } => {
	const width = Math.ceil(laid.width + MARGIN * 2)
	const height = Math.ceil(laid.height + MARGIN * 2)
	const copy = svg.cloneNode(true) as SVGSVGElement
	copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
	copy.setAttribute('width', String(width))
	copy.setAttribute('height', String(height))
	copy.setAttribute('viewBox', `0 0 ${width} ${height}`)
	copy.removeAttribute('class')
	copy.removeAttribute('style')
	copy.querySelector('[data-view]')?.setAttribute('transform', `translate(${MARGIN},${MARGIN})`)
	// the controls of the screen are not part of the drawing
	copy.querySelectorAll('.lw-box-remove, .lw-line-handle').forEach(control => control.remove())
	const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
	rect.setAttribute('width', '100%')
	rect.setAttribute('height', '100%')
	rect.setAttribute('fill', background)
	copy.insertBefore(rect, copy.firstChild)
	return { text: new XMLSerializer().serializeToString(copy), width, height }
}

/** Where a cardinality goes: just off the end of the line, above it */
const labelAt = (from: Point, toward: Point): Point => {
	const dx = toward.x - from.x
	const dy = toward.y - from.y
	const length = Math.hypot(dx, dy) || 1
	return { x: from.x + (dx / length) * 12 + (dy / length) * 8, y: from.y + (dy / length) * 12 - (dx / length) * 8 + 4 }
}

const Box: React.FC<{
	entity: EntityInfo, at: Point, compact: boolean, focused: boolean, foreignKeys?: Set<string>, colors: typeof PALETTES.light
	onClick: () => void, onDoubleClick: () => void, onPointerDown?: (e: React.PointerEvent) => void
	/** A × in the title that takes the box out of the diagram */
	onRemove?: () => void, removeLabel?: string
}> = ({ entity, at, compact, focused, foreignKeys, colors, onClick, onDoubleClick, onPointerDown, onRemove, removeLabel }) => {
	const { width, height } = boxSize(entity, compact)
	const keys = new Set(entity.primaryKey ?? [])
	return (
		<g transform={`translate(${at.x},${at.y})`} className={`lw-entity ${onPointerDown ? 'lw-movable' : ''}`} data-entity={entity.name} onClick={onClick} onDoubleClick={onDoubleClick} onPointerDown={onPointerDown}>
			<title>{entity.name}</title>
			<rect width={width} height={height} rx={6} fill={colors.box} stroke={focused ? colors.accent : colors.border} strokeWidth={focused ? 2 : 1} />
			<rect width={width} height={HEADER} rx={6} fill={colors.header} />
			{!compact && <rect y={HEADER - 6} width={width} height={6} fill={colors.header} />}
			{!compact && <line x1={0} x2={width} y1={HEADER} y2={HEADER} stroke={colors.border} />}
			<rect width={width} height={height} rx={6} fill="none" stroke={focused ? colors.accent : colors.border} strokeWidth={focused ? 2 : 1} />
			<text x={10} y={17} fontFamily={SANS} fontSize={13} fontWeight={700} fontStyle={entity.abstract ? 'italic' : undefined} fill={colors.text}>
				{entity.name}{entity.extends && <tspan fill={colors.muted} fontWeight={400}> : {entity.extends}</tspan>}
			</text>
			{!compact && (entity.properties ?? []).map((property, i) => {
				const y = HEADER + 4 + i * ROW + 13
				const tag = keys.has(property.name) ? 'PK' : foreignKeys?.has(property.name) ? 'FK' : ''
				return (
					<g key={property.name} fontFamily={MONO} fontSize={12}>
						{tag && <text x={8} y={y} fontSize={9} fontWeight={700} fill={tag === 'PK' ? colors.pk : colors.fk}>{tag}</text>}
						<text x={32} y={y} fill={foreignKeys?.has(property.name) ? colors.fk : colors.text} fontWeight={property.required ? 700 : 400}>{property.name}</text>
						<text x={width - 8} y={y} textAnchor="end" fill={colors.muted}>{typeText(property)}</text>
					</g>
				)
			})}
			{onRemove && (
				<g className="lw-box-remove" role="button" aria-label={`${removeLabel ?? 'remove'} ${entity.name}`} transform={`translate(${width - 20},4)`}
					onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onRemove() }} onDoubleClick={e => e.stopPropagation()}>
					<title>{removeLabel}</title>
					<rect width={16} height={16} rx={3} fill={colors.box} stroke={colors.border} />
					<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke={colors.muted} strokeWidth={1.6} />
				</g>
			)}
		</g>
	)
}

/** The longest stretch of a line: where its name goes */
const middleOf = (points: Point[]): Point => {
	let best = { x: points[0].x, y: points[0].y }
	let length = -1
	for (let i = 1; i < points.length; i++) {
		const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
		if (l > length) { length = l; best = { x: (points[i].x + points[i - 1].x) / 2, y: (points[i].y + points[i - 1].y) / 2 } }
	}
	return best
}

const Line: React.FC<{
	edge: DiagramEdge, points: Point[], highlighted: boolean, colors: typeof PALETTES.light, showName?: boolean
	/** The line can be dragged sideways (and a double click puts it back) */
	onPointerDown?: (e: React.PointerEvent) => void, onReset?: () => void
}> = ({ edge, points, highlighted, colors, showName, onPointerDown, onReset }) => {
	if (points.length < 2) return null
	const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
	const stroke = highlighted ? colors.accent : colors.line
	const first = points[0]
	const last = points[points.length - 1]
	const title = edge.kind === 'extends'
		? `${edge.child} extends ${edge.parent}`
		: `${edge.names.join(', ')}\n${edge.parent}.${edge.parentField} 1 — ${edge.childCardinality} ${edge.child}.${edge.childField}`
	if (edge.kind === 'extends') {
		// a hollow triangle at the parent, as in a class diagram
		const next = points[1]
		const angle = Math.atan2(next.y - first.y, next.x - first.x)
		const tip = (a: number, r: number) => `${first.x + Math.cos(angle + a) * r},${first.y + Math.sin(angle + a) * r}`
		return (
			<g data-edge={edge.id}>
				<title>{title}</title>
				<path d={d} fill="none" stroke={stroke} strokeWidth={highlighted ? 2 : 1.2} strokeDasharray="6 4" />
				<polygon points={`${first.x},${first.y} ${tip(0.45, 12)} ${tip(-0.45, 12)}`} fill={colors.box} stroke={stroke} />
			</g>
		)
	}
	const one = labelAt(first, points[1])
	const many = labelAt(last, points[points.length - 2])
	return (
		<g data-edge={edge.id}>
			<title>{title}</title>
			<path d={d} fill="none" stroke={stroke} strokeWidth={highlighted ? 2 : 1.2} />
			{onPointerDown && <path d={d} fill="none" stroke="transparent" strokeWidth={10} className="lw-line-handle" onPointerDown={onPointerDown} onDoubleClick={onReset} />}
			<circle cx={last.x} cy={last.y} r={2.5} fill={stroke} />
			{showName && (() => {
				const at = middleOf(points)
				return <text x={at.x + 4} y={at.y - 4} fontFamily={SANS} fontSize={11} fill={stroke} stroke={colors.canvas} strokeWidth={4} paintOrder="stroke" className="lw-line-name">{edge.names.map(n => n.slice(n.indexOf('.') + 1)).join(' / ')}</text>
			})()}
			<text x={one.x} y={one.y} fontFamily={SANS} fontSize={11} fontWeight={700} fill={stroke} textAnchor="middle">1</text>
			<text x={many.x} y={many.y} fontFamily={SANS} fontSize={11} fontWeight={700} fill={stroke} textAnchor="middle">{edge.childCardinality}</text>
		</g>
	)
}

/**
 * The domain of a schema as a diagram (classes / entity-relationship): a box per entity with its properties, types,
 * primary (PK) and foreign (FK) keys, required ones in bold; a line per relation with its cardinality (1 — N), dashed
 * for an inheritance. It starts on the most connected entity and its neighbours (the whole model can be drawn too);
 * click centres on an entity, double click queries it, the wheel zooms, dragging moves; SVG and PNG export.
 */
export const DomainDiagram: React.FC<DomainDiagramProps> = props => {
	const { schema: fixedSchema, theme = 'light', locale, onQuery, onOpenEntity, layout = elkLayout, height = '70vh', entities: only, positions, onPositionsChange, toolbar } = props
	const editable = onPositionsChange !== undefined
	const m = messagesOf(locale)
	const colors = PALETTES[theme]
	const api = useMemo(() => props.api ?? new RestQueryApi(props.baseUrl ?? '', props.headers), [props.api, props.baseUrl, props.headers])
	const [schemas, setSchemas] = useState<SchemaInfo[]>([])
	const [schema, setSchema] = useState<string | undefined>(fixedSchema)
	const [domain, setDomain] = useState<DomainInfo>()
	const [error, setError] = useState<string>()
	const [focus, setFocus] = useState<string>()
	const [search, setSearch] = useState('')
	const [depth, setDepth] = useState<Depth>(1)
	const [compactState, setCompactState] = useState(props.compact ?? false)
	const compact = props.compact ?? compactState
	const setCompact = (value: boolean) => { setCompactState(value); props.onCompactChange?.(value) }
	// the places while a box is dragged (the saved ones come back in positions)
	const [moving, setMoving] = useState<Record<string, { x: number, y: number }>>()
	const [movingBends, setMovingBends] = useState<Record<string, number>>()
	const lineDrag = useRef<{ id: string, all: Record<string, number>, moved: boolean }>()
	const [namesState, setNamesState] = useState(props.relationNames ?? false)
	const relationNames = props.relationNames ?? namesState
	const setRelationNames = (value: boolean) => { setNamesState(value); props.onRelationNamesChange?.(value) }
	const boxDrag = useRef<{ name: string, x: number, y: number, from: { x: number, y: number }, all: Record<string, { x: number, y: number }>, moved: boolean }>()
	const [laid, setLaid] = useState<LayoutResult>()
	const [drawing, setDrawing] = useState(false)
	const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
	const viewport = useRef<HTMLDivElement>(null)
	const svg = useRef<SVGSVGElement>(null)
	const pendingFit = useRef(false)
	const drag = useRef<{ x: number, y: number, view: View, moved: boolean }>()
	const clickTimer = useRef<ReturnType<typeof setTimeout>>()

	useEffect(() => {
		if (fixedSchema !== undefined) { setSchema(fixedSchema); return }
		api.schemas().then(all => {
			const ready = all.filter(s => s.status === 'ready')
			setSchemas(ready)
			setSchema(current => current ?? ready[0]?.path)
		}, e => setError(e?.message ?? String(e)))
	}, [api, fixedSchema])

	useEffect(() => {
		if (schema === undefined) return
		if (!api.domain) { setError(m.noDomain); return }
		let live = true
		setDomain(undefined)
		setLaid(undefined)
		setError(undefined)
		api.domain(schema).then(d => { if (live) { setDomain({ entities: d.entities ?? [], enums: d.enums ?? [] }) } }, e => { if (live) setError(`${e?.name ?? 'Error'}: ${e?.message ?? e}`) })
		return () => { live = false }
	}, [api, schema])

	const edges = useMemo(() => domain ? edgesOf(domain) : [], [domain])
	const foreignKeys = useMemo(() => foreignKeysOf(edges), [edges])
	useEffect(() => { if (domain) setFocus(props.focus && domain.entities.some(e => e.name === props.focus) ? props.focus : only?.[0] ?? hubOf(domain, edges)) }, [domain, edges, props.focus])

	const onlyKey = only?.join('\n')
	const visible = useMemo(() => !domain ? new Set<string>() : only ? new Set(only) : neighbourhood(domain, edges, focus, depth),
		// only changes by its content
		[domain, edges, focus, depth, onlyKey])
	const shownEntities = useMemo(() => domain?.entities.filter(e => visible.has(e.name)) ?? [], [domain, visible])
	const shownEdges = useMemo(() => edges.filter(e => visible.has(e.parent) && visible.has(e.child)), [edges, visible])

	const fit = useCallback((result: LayoutResult | undefined = laid) => {
		const box = viewport.current
		if (!result || !box || box.clientWidth === 0) { pendingFit.current = true; return }
		pendingFit.current = false
		const k = Math.min(1, (box.clientWidth - MARGIN * 2) / Math.max(1, result.width), (box.clientHeight - MARGIN * 2) / Math.max(1, result.height))
		const at = focus !== undefined ? result.nodes.get(focus) : undefined
		const entity = domain?.entities.find(e => e.name === focus)
		if (depth !== 'all' && !only && k < READABLE && at && entity) {
			// the neighbours don't fit readable: readable, on the entity in focus (the wheel shows the rest)
			const size = boxSize(entity, compact)
			setView({ k: READABLE, x: box.clientWidth / 2 - (at.x + size.width / 2) * READABLE, y: MARGIN - Math.max(0, at.y * READABLE - box.clientHeight / 3) })
			return
		}
		setView({ k, x: (box.clientWidth - result.width * k) / 2, y: Math.max(MARGIN, (box.clientHeight - result.height * k) / 2) })
	}, [laid, focus, domain, depth, compact, only])

	const [base, setBase] = useState<LayoutResult>()
	const entityMap = useMemo(() => new Map((domain?.entities ?? []).map(e => [e.name, e])), [domain])
	const placed = moving ?? positions
	const bends = movingBends ?? props.bends
	// with places by hand (saved or while dragging), the boxes go there and the lines are routed between them
	useEffect(() => {
		if (!base) { setLaid(undefined); return }
		if (!placed && !bends) { setLaid(base); return }
		const boxes = new Map<string, Placed>()
		for (const e of shownEntities) {
			const at = placed?.[e.name] ?? base.nodes.get(e.name)
			if (at) boxes.set(e.name, { ...at, ...boxSize(e, compact) })
		}
		let width = 0
		let height = 0
		for (const b of boxes.values()) { width = Math.max(width, b.x + b.width); height = Math.max(height, b.y + b.height) }
		setLaid({ nodes: new Map([...boxes].map(([name, b]) => [name, { x: b.x, y: b.y }])), edges: routeOrthogonal(shownEdges, boxes, entityMap, compact, bends), width, height })
	}, [base, placed, bends, shownEntities, shownEdges, compact, entityMap])

	useEffect(() => {
		if (!shownEntities.length) { setBase(undefined); return }
		let live = true
		setDrawing(true)
		layout({
			nodes: shownEntities.map(e => ({ id: e.name, ...boxSize(e, compact) })),
			edges: shownEdges.map(e => ({ id: e.id, source: e.parent, target: e.child }))
		}).then(result => {
			if (!live) return
			setBase(result)
			if (!positions) { fit(result); return }
			// saved places: fit what will be drawn there
			const nodes = new Map(shownEntities.map(e => [e.name, positions[e.name] ?? result.nodes.get(e.name) ?? { x: 0, y: 0 }]))
			let width = 0
			let height = 0
			for (const e of shownEntities) {
				const at = nodes.get(e.name)!
				const size = boxSize(e, compact)
				width = Math.max(width, at.x + size.width)
				height = Math.max(height, at.y + size.height)
			}
			fit({ ...result, nodes, width, height })
		}, e => { if (live) setError(String(e?.message ?? e)) })
			.finally(() => { if (live) setDrawing(false) })
		return () => { live = false }
		// fit changes with laid: not a reason to lay out again
	}, [shownEntities, shownEdges, compact, layout])

	// a hidden tab has no size: fit when it shows
	useEffect(() => {
		const box = viewport.current
		if (!box || typeof ResizeObserver === 'undefined') return
		const observer = new ResizeObserver(() => { if (pendingFit.current) fit() })
		observer.observe(box)
		return () => observer.disconnect()
	}, [fit])

	// the wheel zooms around the pointer (a passive listener could not stop the page from scrolling)
	useEffect(() => {
		const box = viewport.current
		if (!box) return
		const wheel = (e: WheelEvent) => {
			e.preventDefault()
			const rect = box.getBoundingClientRect()
			const cx = e.clientX - rect.left
			const cy = e.clientY - rect.top
			setView(v => {
				const k = Math.min(3, Math.max(0.05, v.k * Math.exp(-e.deltaY * 0.0015)))
				return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) }
			})
		}
		box.addEventListener('wheel', wheel, { passive: false })
		return () => box.removeEventListener('wheel', wheel)
	}, [])

	const centerOn = (name: string) => {
		const at = laid?.nodes.get(name)
		const entity = domain?.entities.find(e => e.name === name)
		const box = viewport.current
		if (!at || !entity || !box) return
		const size = boxSize(entity, compact)
		setView(v => ({ k: v.k, x: box.clientWidth / 2 - (at.x + size.width / 2) * v.k, y: box.clientHeight / 2 - (at.y + Math.min(size.height, 200) / 2) * v.k }))
	}
	const choose = (name: string) => {
		setSearch('')
		if (depth === 'all') { setFocus(name); centerOn(name) } else setFocus(name)
	}
	const click = (name: string) => {
		if (drag.current?.moved) return
		clearTimeout(clickTimer.current)
		clickTimer.current = setTimeout(() => choose(name), 220)
	}
	const doubleClick = (entity: EntityInfo) => {
		clearTimeout(clickTimer.current)
		if (schema === undefined) return
		if (onOpenEntity) onOpenEntity(schema, entity.name)
		else if (!entity.abstract) onQuery?.(schema, entity.name)
	}
	// a box dragged by hand (editable): its place follows the pointer at the zoom of the drawing
	const boxDown = (name: string) => (e: React.PointerEvent) => {
		if (!editable || !laid || e.button !== 0) return
		e.stopPropagation()
		const all: Record<string, { x: number, y: number }> = {}
		for (const [n, at] of laid.nodes) all[n] = { x: at.x, y: at.y }
		boxDrag.current = { name, x: e.clientX, y: e.clientY, from: all[name], all, moved: false }
		;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
	}
	const boxMove = (e: React.PointerEvent): boolean => {
		const d = boxDrag.current
		if (!d) return false
		const dx = (e.clientX - d.x) / view.k
		const dy = (e.clientY - d.y) / view.k
		if (!d.moved && Math.hypot(dx, dy) < 3) return true
		d.moved = true
		d.all = { ...d.all, [d.name]: { x: Math.max(0, Math.round(d.from.x + dx)), y: Math.max(0, Math.round(d.from.y + dy)) } }
		setMoving(d.all)
		return true
	}
	const boxUp = (): boolean => {
		const d = boxDrag.current
		if (!d) return false
		boxDrag.current = undefined
		// a drag is not a click on the box
		if (d.moved) { onPositionsChange?.(d.all); drag.current = { x: 0, y: 0, view, moved: true } }
		setMoving(undefined)
		return true
	}
	// a line dragged sideways: its vertical stretch follows the pointer; the boxes stay where they are drawn
	const lineDown = (id: string) => (e: React.PointerEvent) => {
		if (!editable || !laid || e.button !== 0) return
		e.stopPropagation()
		lineDrag.current = { id, all: { ...(props.bends ?? {}) }, moved: false }
		;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
	}
	const lineMove = (e: React.PointerEvent): boolean => {
		const d = lineDrag.current
		if (!d) return false
		const rect = viewport.current?.getBoundingClientRect()
		const x = Math.round((e.clientX - (rect?.left ?? 0) - view.x) / view.k)
		d.moved = true
		d.all = { ...d.all, [d.id]: x }
		setMovingBends(d.all)
		return true
	}
	const lineUp = (): boolean => {
		const d = lineDrag.current
		if (!d) return false
		lineDrag.current = undefined
		if (d.moved && laid) {
			if (!positions) {
				const all: Record<string, { x: number, y: number }> = {}
				for (const [n, at] of laid.nodes) all[n] = { x: Math.round(at.x), y: Math.round(at.y) }
				onPositionsChange?.(all)
			}
			props.onBendsChange?.(d.all)
			drag.current = { x: 0, y: 0, view, moved: true }
		}
		setMovingBends(undefined)
		return true
	}
	const resetLine = (id: string) => {
		if (props.bends?.[id] === undefined) return
		const rest = Object.fromEntries(Object.entries(props.bends).filter(([key]) => key !== id))
		props.onBendsChange?.(Object.keys(rest).length ? rest : undefined)
	}
	const relayout = () => { setMoving(undefined); setMovingBends(undefined); onPositionsChange?.(undefined); props.onBendsChange?.(undefined) }
	useEffect(() => () => clearTimeout(clickTimer.current), [])

	const exportAs = (kind: 'svg' | 'png') => {
		if (!svg.current || !laid) return
		const { text, width, height: h } = standaloneSvg(svg.current, laid, colors.canvas)
		const name = props.exportName ?? `${(schema || 'root').replace(/\//g, '-')}-model`
		const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
		if (kind === 'svg') { download(url, `${name}.svg`); return }
		const image = new Image()
		image.onload = () => {
			const scale = Math.min(2, 16000 / width, 16000 / h)
			const canvas = document.createElement('canvas')
			canvas.width = Math.round(width * scale)
			canvas.height = Math.round(h * scale)
			const context = canvas.getContext('2d')
			if (!context) return
			context.scale(scale, scale)
			context.drawImage(image, 0, 0)
			canvas.toBlob(blob => {
				if (!blob) return
				const blobUrl = URL.createObjectURL(blob)
				download(blobUrl, `${name}.png`)
				setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
			}, 'image/png')
		}
		image.src = url
	}

	const pointerDown = (e: React.PointerEvent) => {
		drag.current = { x: e.clientX, y: e.clientY, view, moved: false }
	}
	const pointerMove = (e: React.PointerEvent) => {
		if (boxMove(e) || lineMove(e)) return
		const start = drag.current
		if (!start || (e.buttons & 1) === 0) return
		const dx = e.clientX - start.x
		const dy = e.clientY - start.y
		if (!start.moved && Math.hypot(dx, dy) < 4) return
		if (!start.moved) { start.moved = true; (e.currentTarget as Element).setPointerCapture?.(e.pointerId) }
		setView({ ...start.view, x: start.view.x + dx, y: start.view.y + dy })
	}
	const pointerUp = () => { boxUp(); lineUp(); setTimeout(() => { drag.current = undefined }, 0) }

	const relations = shownEdges.filter(e => e.kind === 'relation').length
	return (
		<div className={`lw-diagram lw-workbench lw-${theme}`}>
			<div className="lw-header">
				{toolbar}
				{fixedSchema === undefined && <SchemaSelector schemas={schemas} value={schema} onChange={setSchema} locale={locale} />}
				{!only && <label className="lw-field">
					<span>{m.entity}</span>
					<input aria-label="entity" list="lw-diagram-entities" placeholder={focus} value={search}
						onChange={e => { setSearch(e.target.value); if (domain?.entities.some(x => x.name === e.target.value)) choose(e.target.value) }} />
					<datalist id="lw-diagram-entities">{domain?.entities.map(e => <option key={e.name} value={e.name} />)}</datalist>
				</label>}
				{!only && <select aria-label="depth" value={String(depth)} onChange={e => setDepth(e.target.value === 'all' ? 'all' : Number(e.target.value) as Depth)}>
					<option value="1">{m.depth1}</option>
					<option value="2">{m.depth2}</option>
					<option value="all">{m.wholeModel}</option>
				</select>}
				<label className="lw-check"><input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)} /> {m.namesOnly}</label>
				<label className="lw-check"><input type="checkbox" checked={relationNames} onChange={e => setRelationNames(e.target.checked)} /> {m.relationNames}</label>
				<button onClick={() => fit()}>{m.fit}</button>
				{editable && <button onClick={relayout} disabled={!positions && !props.bends}>{m.relayout}</button>}
				<button onClick={() => exportAs('svg')} disabled={!laid}>SVG</button>
				<button onClick={() => exportAs('png')} disabled={!laid}>PNG</button>
				<span className="lw-who">{domain && format(m.summary, { entities: shownEntities.length, relations })}</span>
			</div>
			{error && <div className="lw-notice" role="alert">{error}</div>}
			<div ref={viewport} className="lw-diagram-view" style={{ height, background: colors.canvas }} tabIndex={props.onRemoveEntity ? 0 : undefined}
				onKeyDown={props.onRemoveEntity ? e => {
					if ((e.key === 'Delete' || e.key === 'Backspace') && focus && visible.has(focus) && shownEntities.length > 1) { e.preventDefault(); props.onRemoveEntity!(focus) }
				} : undefined}
				onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
				{(drawing || (!laid && !error)) && <div className="lw-diagram-status">{m.loadingModel}</div>}
				<svg ref={svg} className="lw-diagram-svg" role="img" aria-label={m.model}>
					<g data-view="" transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
						{laid && shownEdges.map(edge => (
							<Line key={edge.id} edge={edge} points={laid.edges.get(edge.id) ?? []} colors={colors} highlighted={edge.parent === focus || edge.child === focus}
								showName={relationNames} onPointerDown={editable && edge.kind === 'relation' ? lineDown(edge.id) : undefined} onReset={() => resetLine(edge.id)} />
						))}
						{laid && shownEntities.map(entity => {
							const at = laid.nodes.get(entity.name)
							return at && (
								<Box key={entity.name} entity={entity} at={at} compact={compact} focused={entity.name === focus} foreignKeys={foreignKeys.get(entity.name)}
									colors={colors} onClick={() => click(entity.name)} onDoubleClick={() => doubleClick(entity)} onPointerDown={editable ? boxDown(entity.name) : undefined}
									onRemove={props.onRemoveEntity && shownEntities.length > 1 ? () => props.onRemoveEntity!(entity.name) : undefined} removeLabel={m.removeFromDiagram} />
							)
						})}
					</g>
				</svg>
			</div>
			<div className="lw-hint">{editable ? m.diagramEditHint : m.diagramHint}</div>
		</div>
	)
}
