import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { boxSize, DiagramEdge, DomainInfo, edgesOf, EntityInfo, foreignKeysOf, HEADER, hubOf, neighbourhood, Placed, routeOrthogonal, ROW, typeText } from '../domain/diagram'
import { format, Locale, messagesOf } from '../domain/i18n'
import { QueryApiPort, SchemaInfo } from '../application/ports'
import { elkLayout, LayoutPort, LayoutResult, Point } from '../infrastructure/elkLayout'
import { HeadersProvider, RestQueryApi } from '../infrastructure/restQueryApi'
import { SchemaSelector } from './QueryWorkbench'
import { Icons, MenuButton, Modal } from './dialogs'
import { DiagramOutline } from './DiagramOutline'
import { pdfOfJpeg } from '../infrastructure/pdf'
import { diagramQuery } from '../domain/queryFormat'
import { DiagramDetail } from '../domain/savedItems'

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
	/** The query that reads what the diagram shows (a button of its bar): the Workspace opens it in a tab */
	onQueryText?: (schema: string, query: string) => void
	/** Several out at once: the selected boxes (Delete, or the button of the bar) */
	onRemoveEntities?: (entities: string[]) => void
	/** Names only at the start (detail 'name') */
	compact?: boolean
	onCompactChange?: (compact: boolean) => void
	/** What each box shows: all its properties, the keys (PK and FK), the primary key, or its name */
	detail?: DiagramDetail
	onDetailChange?: (detail: DiagramDetail) => void
	/** A + on each box that has related tables out of the diagram adds them (editable); from: the box of the + */
	onAddEntities?: (entities: string[], from?: string) => void
	/** The query wizard: a check on each field of each box; a click on a field chooses it or leaves it */
	fieldSelection?: { chosen: Record<string, string[]>, onToggle: (entity: string, field: string) => void, onToggleAll?: (entity: string) => void }
	/** An entity that can't be taken out (the one the wizard starts from) */
	keep?: string
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
	onClick: (e: React.MouseEvent) => void, onDoubleClick: () => void, onPointerDown?: (e: React.PointerEvent) => void
	/** A × in the title that takes the box out of the diagram */
	onRemove?: () => void, removeLabel?: string
	/** A + in the title that adds its related tables out of the diagram */
	onAddRelated?: () => void, addRelatedLabel?: string
	/** the fields chosen (the wizard), and a click on a field */
	chosen?: Set<string>, onToggleField?: (field: string) => void
	/** the check of the title: every field (no map), and a click on it */
	allChosen?: boolean, onToggleAll?: () => void, allLabel?: string
}> = ({ entity, at, compact, focused, foreignKeys, colors, onClick, onDoubleClick, onPointerDown, onRemove, removeLabel, onAddRelated, addRelatedLabel, chosen, onToggleField, allChosen, onToggleAll, allLabel }) => {
	const { width, height } = boxSize(entity, compact, !!onToggleAll)
	const keys = new Set(entity.primaryKey ?? [])
	return (
		<g transform={`translate(${at.x},${at.y})`} className={`lw-entity ${onPointerDown ? 'lw-movable' : ''}`} data-entity={entity.name} onClick={onClick} onDoubleClick={onDoubleClick} onPointerDown={onPointerDown}>
			<title>{entity.name}</title>
			<rect width={width} height={height} rx={6} fill={colors.box} stroke={focused ? colors.accent : colors.border} strokeWidth={focused ? 2 : 1} />
			<rect width={width} height={HEADER} rx={6} fill={colors.header} />
			{!compact && <rect y={HEADER - 6} width={width} height={6} fill={colors.header} />}
			{!compact && <line x1={0} x2={width} y1={HEADER} y2={HEADER} stroke={colors.border} />}
			<rect width={width} height={height} rx={6} fill="none" stroke={focused ? colors.accent : colors.border} strokeWidth={focused ? 2 : 1} />
			{onToggleAll && (
				<g role="checkbox" aria-checked={!!allChosen} aria-label={`${entity.name}: ${allLabel ?? 'all properties'}`} className="lw-field-row"
					onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onToggleAll() }} onDoubleClick={e => e.stopPropagation()}>
					<title>{allLabel}</title>
					<rect x={9} y={7} width={12} height={12} rx={2} fill={allChosen ? colors.accent : colors.box} stroke={allChosen ? colors.accent : colors.border} />
					{allChosen && <path d="M11.5 13l2.5 2.5 4.5 -5" fill="none" stroke="#fff" strokeWidth={1.8} />}
				</g>
			)}
			<text x={onToggleAll ? 28 : 10} y={17} fontFamily={SANS} fontSize={13} fontWeight={700} fontStyle={entity.abstract ? 'italic' : undefined} fill={colors.text}>
				{entity.name}{entity.extends && <tspan fill={colors.muted} fontWeight={400}> : {entity.extends}</tspan>}
			</text>
			{!compact && (entity.properties ?? []).map((property, i) => {
				const y = HEADER + 4 + i * ROW + 13
				const tag = keys.has(property.name) ? 'PK' : foreignKeys?.has(property.name) ? 'FK' : ''
				if (onToggleField) {
					// the wizard: a check instead of the tag (a key keeps its colour), the whole row chooses it
					const on = chosen?.has(property.name) ?? false
					return (
						<g key={property.name} fontFamily={MONO} fontSize={12} role="checkbox" aria-checked={on} aria-label={`${entity.name}.${property.name}`} className="lw-field-row"
							onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onToggleField(property.name) }} onDoubleClick={e => e.stopPropagation()}>
							<rect x={1} y={y - 13} width={width - 2} height={ROW} fill={on ? colors.accent : 'transparent'} fillOpacity={on ? 0.14 : 0} />
							<rect x={9} y={y - 10} width={12} height={12} rx={2} fill={on ? colors.accent : colors.box} stroke={on ? colors.accent : colors.border} />
							{on && <path d={`M11.5 ${y - 4}l2.5 2.5 4.5 -5`} fill="none" stroke="#fff" strokeWidth={1.8} />}
							<text x={32} y={y} fill={tag === 'PK' ? colors.pk : tag === 'FK' ? colors.fk : colors.text} fontWeight={property.required ? 700 : 400}>{property.name}</text>
							<text x={width - 8} y={y} textAnchor="end" fill={colors.muted}>{typeText(property)}</text>
						</g>
					)
				}
				return (
					<g key={property.name} fontFamily={MONO} fontSize={12}>
						{tag && <text x={8} y={y} fontSize={9} fontWeight={700} fill={tag === 'PK' ? colors.pk : colors.fk}>{tag}</text>}
						<text x={32} y={y} fill={foreignKeys?.has(property.name) ? colors.fk : colors.text} fontWeight={property.required ? 700 : 400}>{property.name}</text>
						<text x={width - 8} y={y} textAnchor="end" fill={colors.muted}>{typeText(property)}</text>
					</g>
				)
			})}
			{onAddRelated && (
				<g className="lw-box-remove lw-box-add" role="button" aria-label={`${addRelatedLabel ?? 'add related'} ${entity.name}`} transform={`translate(${width - (onRemove ? 40 : 20)},4)`}
					onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onAddRelated() }} onDoubleClick={e => e.stopPropagation()}>
					<title>{addRelatedLabel}</title>
					<rect width={16} height={16} rx={3} fill={colors.box} stroke={colors.border} />
					<path d="M8 4v8M4 8h8" stroke={colors.accent} strokeWidth={1.8} />
				</g>
			)}
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
	// the boxes of the wizard have a check in their title (every field)
	const checks = !!props.fieldSelection?.onToggleAll
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
	const [detailState, setDetailState] = useState<DiagramDetail>(props.detail ?? (props.compact ? 'name' : 'all'))
	const detail: DiagramDetail = props.detail ?? (props.compact !== undefined && !props.onDetailChange ? (props.compact ? 'name' : (detailState === 'name' ? 'all' : detailState)) : detailState)
	const compact = detail === 'name'
	const setDetail = (value: DiagramDetail) => { setDetailState(value); props.onDetailChange?.(value); props.onCompactChange?.(value === 'name') }
	// the places while a box is dragged (the saved ones come back in positions)
	const [moving, setMoving] = useState<Record<string, { x: number, y: number }>>()
	const [movingBends, setMovingBends] = useState<Record<string, number>>()
	const lineDrag = useRef<{ id: string, all: Record<string, number>, moved: boolean }>()
	const [namesState, setNamesState] = useState(props.relationNames ?? false)
	const relationNames = props.relationNames ?? namesState
	const setRelationNames = (value: boolean) => { setNamesState(value); props.onRelationNamesChange?.(value) }
	const boxDrag = useRef<{ name: string, x: number, y: number, from: { x: number, y: number }, all: Record<string, { x: number, y: number }>, moved: boolean, group: string[], starts: Record<string, { x: number, y: number }> }>()
	const [laid, setLaid] = useState<LayoutResult>()
	const [drawing, setDrawing] = useState(false)
	const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
	// the outline of the drawing: hidden until its button shows it
	const [outline, setOutline] = useState(false)
	const viewport = useRef<HTMLDivElement>(null)
	const svg = useRef<SVGSVGElement>(null)
	const pendingFit = useRef(false)
	const drag = useRef<{ x: number, y: number, view: View, moved: boolean }>()
	// the boxes selected (editable): moved together, removed together
	const [selected, setSelected] = useState<Set<string>>(new Set())
	// what dragging the background does: move the drawing, or select the boxes it encloses (Shift: select with any)
	const [tool, setTool] = useState<'move' | 'select'>('move')
	const [band, setBand] = useState<{ x0: number, y0: number, x1: number, y1: number, add: boolean }>()
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
	// what a box shows of its entity: its keys only (PK, and FK), or all its properties
	const detailed = useCallback((e: EntityInfo): EntityInfo => detail === 'all' || detail === 'name'
		? e
		: { ...e, properties: (e.properties ?? []).filter(p => (e.primaryKey ?? []).includes(p.name) || (detail === 'keys' && !!foreignKeys.get(e.name)?.has(p.name))) }, [detail, foreignKeys])
	const shownEntities = useMemo(() => domain?.entities.filter(e => visible.has(e.name)).map(detailed) ?? [], [domain, visible, detailed])
	// the related tables of each entity not in the diagram yet, with what relates them (relations, an inheritance)
	const outside = useMemo(() => {
		const map = new Map<string, Map<string, string[]>>()
		const add = (a: string, b: string, how: string) => {
			if (visible.has(b) || a === b) return
			const of = map.get(a) ?? map.set(a, new Map()).get(a)!
			of.set(b, [...new Set([...(of.get(b) ?? []), how])])
		}
		for (const e of edges) {
			const how = e.kind === 'extends' ? 'extends' : e.names.join(', ')
			add(e.parent, e.child, how)
			add(e.child, e.parent, how)
		}
		return map
	}, [edges, visible])
	// the related tables of a box being chosen (its +)
	const [adding, setAdding] = useState<{ entity: string, chosen: Set<string> }>()
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
			const size = boxSize(entity, compact, checks)
			setView({ k: READABLE, x: box.clientWidth / 2 - (at.x + size.width / 2) * READABLE, y: MARGIN - Math.max(0, at.y * READABLE - box.clientHeight / 3) })
			return
		}
		setView({ k, x: (box.clientWidth - result.width * k) / 2, y: Math.max(MARGIN, (box.clientHeight - result.height * k) / 2) })
	}, [laid, focus, domain, depth, compact, only])

	const [base, setBase] = useState<LayoutResult>()
	const entityMap = useMemo(() => new Map((domain?.entities ?? []).map(e => [e.name, detailed(e)])), [domain, detailed])
	const placed = moving ?? positions
	const bends = movingBends ?? props.bends
	// with places by hand (saved or while dragging), the boxes go there and the lines are routed between them
	useEffect(() => {
		if (!base) { setLaid(undefined); return }
		if (!placed && !bends) { setLaid(base); return }
		const boxes = new Map<string, Placed>()
		for (const e of shownEntities) {
			const at = placed?.[e.name] ?? base.nodes.get(e.name)
			if (at) boxes.set(e.name, { ...at, ...boxSize(e, compact, checks) })
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
			nodes: shownEntities.map(e => ({ id: e.name, ...boxSize(e, compact, checks) })),
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
				const size = boxSize(e, compact, checks)
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
		const size = boxSize(entity, compact, checks)
		setView(v => ({ k: v.k, x: box.clientWidth / 2 - (at.x + size.width / 2) * v.k, y: box.clientHeight / 2 - (at.y + Math.min(size.height, 200) / 2) * v.k }))
	}
	const choose = (name: string) => {
		setSearch('')
		if (depth === 'all') { setFocus(name); centerOn(name) } else setFocus(name)
	}
	const click = (name: string, e?: React.MouseEvent) => {
		if (drag.current?.moved) return
		if (editable && e && (e.shiftKey || e.ctrlKey || e.metaKey)) {
			// one more, or one less, in the selection
			setSelected(s => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n })
			return
		}
		if (editable) setSelected(new Set([name]))
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
		// a selected box moves with the others selected; another one alone
		const group = selected.has(name) && !(e.shiftKey || e.ctrlKey || e.metaKey) ? [...selected].filter(n => all[n]) : [name]
		boxDrag.current = { name, x: e.clientX, y: e.clientY, from: all[name], all, moved: false, group, starts: Object.fromEntries(group.map(n => [n, all[n]])) }
		;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
	}
	const boxMove = (e: React.PointerEvent): boolean => {
		const d = boxDrag.current
		if (!d) return false
		const dx = (e.clientX - d.x) / view.k
		const dy = (e.clientY - d.y) / view.k
		if (!d.moved && Math.hypot(dx, dy) < 3) return true
		d.moved = true
		// the group keeps its shape: the move stops where the first of them would leave the drawing
		const minX = Math.min(...d.group.map(n => d.starts[n].x))
		const minY = Math.min(...d.group.map(n => d.starts[n].y))
		const mx = Math.max(-minX, dx)
		const my = Math.max(-minY, dy)
		d.all = { ...d.all, ...Object.fromEntries(d.group.map(n => [n, { x: Math.round(d.starts[n].x + mx), y: Math.round(d.starts[n].y + my) }])) }
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

	const exportAs = (kind: 'svg' | 'png' | 'pdf') => {
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
			if (kind === 'pdf') {
				// a page of the size of the diagram (1 px = 1 pt) with its image, on white (JPEG has no transparency)
				const flat = document.createElement('canvas')
				flat.width = canvas.width
				flat.height = canvas.height
				const paper = flat.getContext('2d')
				if (!paper) return
				paper.fillStyle = colors.canvas
				paper.fillRect(0, 0, flat.width, flat.height)
				paper.drawImage(canvas, 0, 0)
				const jpeg = atob(flat.toDataURL('image/jpeg', 0.92).split(',')[1])
				const bytes = Uint8Array.from(jpeg, c => c.charCodeAt(0))
				const blobUrl = URL.createObjectURL(new Blob([pdfOfJpeg(bytes, flat.width, flat.height, width, h)], { type: 'application/pdf' }))
				download(blobUrl, `${name}.pdf`)
				setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
				return
			}
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
		// select by a rectangle: the select tool, or Shift with any (the middle button always moves the drawing)
		if (editable && e.button === 0 && (tool === 'select' || e.shiftKey)) {
			const rect = viewport.current!.getBoundingClientRect()
			const x = e.clientX - rect.left
			const y = e.clientY - rect.top
			setBand({ x0: x, y0: y, x1: x, y1: y, add: e.shiftKey || e.ctrlKey || e.metaKey })
			;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
			return
		}
		drag.current = { x: e.clientX, y: e.clientY, view, moved: false }
	}
	const pointerMove = (e: React.PointerEvent) => {
		if (boxMove(e) || lineMove(e)) return
		if (band) {
			const rect = viewport.current!.getBoundingClientRect()
			setBand({ ...band, x1: e.clientX - rect.left, y1: e.clientY - rect.top })
			return
		}
		const start = drag.current
		if (!start || (e.buttons & (1 | 4)) === 0) return
		const dx = e.clientX - start.x
		const dy = e.clientY - start.y
		if (!start.moved && Math.hypot(dx, dy) < 4) return
		if (!start.moved) { start.moved = true; (e.currentTarget as Element).setPointerCapture?.(e.pointerId) }
		setView({ ...start.view, x: start.view.x + dx, y: start.view.y + dy })
	}
	const bandUp = (): boolean => {
		if (!band) return false
		setBand(undefined)
		if (!laid) return true
		// the rectangle in the coordinates of the drawing: the boxes it touches
		const left = (Math.min(band.x0, band.x1) - view.x) / view.k
		const right = (Math.max(band.x0, band.x1) - view.x) / view.k
		const top = (Math.min(band.y0, band.y1) - view.y) / view.k
		const bottom = (Math.max(band.y0, band.y1) - view.y) / view.k
		const tiny = Math.abs(band.x1 - band.x0) < 3 && Math.abs(band.y1 - band.y0) < 3
		const inside = tiny ? [] : shownEntities.filter(entity => {
			const at = laid.nodes.get(entity.name)
			if (!at) return false
			const size = boxSize(entity, compact, checks)
			return at.x < right && at.x + size.width > left && at.y < bottom && at.y + size.height > top
		}).map(e => e.name)
		setSelected(s => new Set([...(band.add ? s : []), ...inside]))
		drag.current = { x: 0, y: 0, view, moved: true }
		setTimeout(() => { drag.current = undefined }, 0)
		return true
	}
	const pointerUp = () => {
		if (bandUp()) return
		const plain = drag.current && !drag.current.moved && !boxDrag.current && !lineDrag.current
		boxUp(); lineUp()
		// a click on the background: nothing selected
		if (plain) setSelected(new Set())
		setTimeout(() => { drag.current = undefined }, 0)
	}
	// the buttons of the zoom: around the middle of the drawing
	const zoomBy = (factor: number) => {
		const box = viewport.current
		if (!box) return
		const cx = box.clientWidth / 2
		const cy = box.clientHeight / 2
		setView(v => { const k = Math.min(3, Math.max(0.05, v.k * factor)); return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) } })
	}
	// the selected ones out of the diagram (at least one box stays)
	const removable = [...selected].filter(n => visible.has(n))
	const canRemoveSelected = editable && !!(props.onRemoveEntities || props.onRemoveEntity) && removable.length > 0 && removable.length < shownEntities.length
	const removeSelected = () => {
		if (!canRemoveSelected) return
		if (props.onRemoveEntities) props.onRemoveEntities(removable)
		else props.onRemoveEntity!(removable[0])
		setSelected(new Set())
	}

	const relations = shownEdges.filter(e => e.kind === 'relation').length
	// the drawing: in the view, and small in the outline
	const world = (
		<>
			{laid && shownEdges.map(edge => (
				<Line key={edge.id} edge={edge} points={laid.edges.get(edge.id) ?? []} colors={colors} highlighted={edge.parent === focus || edge.child === focus}
					showName={relationNames} onPointerDown={editable && edge.kind === 'relation' ? lineDown(edge.id) : undefined} onReset={() => resetLine(edge.id)} />
			))}
			{laid && shownEntities.map(entity => {
				const at = laid.nodes.get(entity.name)
				return at && (
					<Box key={entity.name} entity={entity} at={at} compact={compact} focused={entity.name === focus || selected.has(entity.name)} foreignKeys={foreignKeys.get(entity.name)}
						colors={colors} onClick={e => click(entity.name, e)} onDoubleClick={() => doubleClick(entity)} onPointerDown={editable ? boxDown(entity.name) : undefined}
						onRemove={props.onRemoveEntity && shownEntities.length > 1 && entity.name !== props.keep ? () => props.onRemoveEntity!(entity.name) : undefined} removeLabel={m.removeFromDiagram}
						onAddRelated={props.onAddEntities && outside.get(entity.name)?.size ? () => setAdding({ entity: entity.name, chosen: new Set() }) : undefined} addRelatedLabel={m.addRelated}
						// no field chosen: every field (no map), all of them ticked
						chosen={props.fieldSelection ? new Set(props.fieldSelection.chosen[entity.name]?.length ? props.fieldSelection.chosen[entity.name] : (entity.properties ?? []).map(p => p.name)) : undefined}
						onToggleField={props.fieldSelection ? field => props.fieldSelection!.onToggle(entity.name, field) : undefined}
						allChosen={props.fieldSelection ? !props.fieldSelection.chosen[entity.name]?.length : undefined}
						onToggleAll={props.fieldSelection?.onToggleAll ? () => props.fieldSelection!.onToggleAll!(entity.name) : undefined} allLabel={m.detailAll} />
				)
			})}
		</>
	)
	// the drawing as a whole, for the outline
	const outlineBounds = (() => {
		if (!laid) return undefined
		const rects = shownEntities.flatMap(e => { const at = laid.nodes.get(e.name); return at ? [{ ...at, ...boxSize(e, compact, checks) }] : [] })
		if (!rects.length) return undefined
		const x0 = Math.min(...rects.map(r => r.x)); const y0 = Math.min(...rects.map(r => r.y))
		return { x: x0, y: y0, width: Math.max(...rects.map(r => r.x + r.width)) - x0, height: Math.max(...rects.map(r => r.y + r.height)) - y0 }
	})()
	const outlineTo = (p: { x: number, y: number }) => {
		const box = viewport.current
		if (!box) return
		setView(v => ({ k: v.k, x: box.clientWidth / 2 - p.x * v.k, y: box.clientHeight / 2 - p.y * v.k }))
	}
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
				<label className="lw-check">{m.detail}{' '}
					<select aria-label={m.detail} value={detail} onChange={e => setDetail(e.target.value as DiagramDetail)}>
						<option value="all">{m.detailAll}</option>
						<option value="keys">{m.detailKeys}</option>
						<option value="pk">{m.detailPk}</option>
						<option value="name">{m.detailName}</option>
					</select>
				</label>
				<label className="lw-check"><input type="checkbox" checked={relationNames} onChange={e => setRelationNames(e.target.checked)} /> {m.relationNames}</label>
				<span className="lw-tool-group" role="group" aria-label={m.zoomIn}>
					{editable && (
						<>
							<button className="lw-tool" aria-label={m.toolSelect} title={m.toolSelect} aria-pressed={tool === 'select'} onClick={() => setTool('select')}><Icons.pointer size={18} /></button>
							<button className="lw-tool" aria-label={m.toolMove} title={m.toolMove} aria-pressed={tool === 'move'} onClick={() => setTool('move')}><Icons.hand size={18} /></button>
						</>
					)}
					<button className="lw-tool" aria-label={m.zoomOut} title={m.zoomOut} onClick={() => zoomBy(1 / 1.25)}><Icons.zoomOut size={18} /></button>
					<span className="lw-zoom" aria-live="polite">{Math.round(view.k * 100)}%</span>
					<button className="lw-tool" aria-label={m.zoomIn} title={m.zoomIn} onClick={() => zoomBy(1.25)}><Icons.zoomIn size={18} /></button>
				</span>
				<button onClick={() => fit()}>{m.fit}</button>
				<button className="lw-tool" aria-label={m.outline} title={m.outline} aria-pressed={outline} onClick={() => setOutline(o => !o)}><Icons.outline size={18} /></button>
				{props.onQueryText && (
					<button className="lw-tool" aria-label={m.diagramQuery} title={m.diagramQuery} disabled={!domain || shownEntities.length === 0}
						onClick={() => {
							// its root: the box selected (one), or the most connected
							const chosen = [...selected].filter(n => visible.has(n))
							props.onQueryText!(schema ?? '', diagramQuery(domain!, shownEntities.map(e => e.name), chosen.length === 1 ? chosen[0] : undefined))
						}}><Icons.query size={18} /></button>
				)}
				{canRemoveSelected && <button onClick={removeSelected}><Icons.trash /> {format(m.removeSelected, { n: removable.length })}</button>}
				{editable && <button onClick={relayout} disabled={!positions && !props.bends}>{m.relayout}</button>}
				<MenuButton label={m.exportAs} icon={<Icons.download />} disabled={!laid} text items={[
					{ label: 'PDF', onClick: () => exportAs('pdf') },
					{ label: 'PNG', onClick: () => exportAs('png') },
					{ label: 'SVG', onClick: () => exportAs('svg') }
				]} />
				<span className="lw-who">{domain && format(m.summary, { entities: shownEntities.length, relations })}</span>
			</div>
			{adding && outside.get(adding.entity) && (() => {
				const options = [...outside.get(adding.entity)!].sort(([a], [b]) => a.localeCompare(b))
				const all = options.length > 0 && options.every(([name]) => adding.chosen.has(name))
				const flip = (name: string) => { const chosen = new Set(adding.chosen); if (chosen.has(name)) chosen.delete(name); else chosen.add(name); setAdding({ ...adding, chosen }) }
				return (
					<Modal title={format(m.relatedTitle, { name: adding.entity })} onClose={() => setAdding(undefined)} theme={theme}>
						<div className="lw-related">
							<label className="lw-related-all"><input type="checkbox" checked={all} onChange={() => setAdding({ ...adding, chosen: all ? new Set() : new Set(options.map(([name]) => name)) })} /> {m.allNone}</label>
							<ul>
								{options.map(([name, how]) => (
									<li key={name}>
										<label><input type="checkbox" checked={adding.chosen.has(name)} onChange={() => flip(name)} /> <strong>{name}</strong> <span className="lw-type">{how.join(' · ')}</span></label>
									</li>
								))}
							</ul>
						</div>
						<div className="lw-form-actions">
							<button type="button" onClick={() => setAdding(undefined)}>{m.cancelAdd}</button>
							<button type="button" className="lw-primary" disabled={adding.chosen.size === 0}
								onClick={() => { props.onAddEntities!([...adding.chosen], adding.entity); setAdding(undefined) }}>{m.addChosen} ({adding.chosen.size})</button>
						</div>
					</Modal>
				)
			})()}
			{error && <div className="lw-notice" role="alert">{error}</div>}
			<div ref={viewport} className="lw-diagram-view" style={{ height, background: colors.canvas }} tabIndex={editable ? 0 : undefined}
				data-tool={tool}
				onKeyDown={editable ? e => {
					if (e.key === 'Escape') { setSelected(new Set()); return }
					if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(new Set(shownEntities.map(x => x.name))); return }
					if (e.key !== 'Delete' && e.key !== 'Backspace') return
					if (canRemoveSelected && removable.length > 1) { e.preventDefault(); removeSelected(); return }
					if (props.onRemoveEntity && focus && visible.has(focus) && shownEntities.length > 1) { e.preventDefault(); props.onRemoveEntity(focus); setSelected(new Set()) }
				} : undefined}
				onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
				{(drawing || (!laid && !error)) && <div className="lw-diagram-status">{m.loadingModel}</div>}
				<svg ref={svg} className="lw-diagram-svg" role="img" aria-label={m.model}>
					<g data-view="" transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
						{world}
					</g>
					{band && (
						<rect className="lw-band" x={Math.min(band.x0, band.x1)} y={Math.min(band.y0, band.y1)} width={Math.abs(band.x1 - band.x0)} height={Math.abs(band.y1 - band.y0)}
							fill={colors.accent} fillOpacity={0.08} stroke={colors.accent} strokeDasharray="4 3" />
					)}
				</svg>
				{outline && outlineBounds && (
					<DiagramOutline bounds={outlineBounds} view={view} viewport={{ width: viewport.current?.clientWidth ?? 0, height: viewport.current?.clientHeight ?? 0 }}
						colors={colors} label={m.outline} onCenter={outlineTo}>{world}</DiagramOutline>
				)}
			</div>
			<div className="lw-hint">{editable ? `${m.diagramEditHint} · ${m.selectHint}` : m.diagramHint}</div>
		</div>
	)
}
