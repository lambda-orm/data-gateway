import React, { useRef } from 'react'

export interface OutlineBounds { x: number, y: number, width: number, height: number }
interface View { x: number, y: number, k: number }

export interface DiagramOutlineProps {
	/** the drawing as a whole, in its own units */
	bounds: OutlineBounds
	/** what the view shows: its translation and zoom, and its size on the screen */
	view: View
	viewport: { width: number, height: number }
	colors: { canvas: string, border: string, accent: string }
	label: string
	/** a point of the drawing to bring to the centre of the view (a click or a drag on the outline) */
	onCenter: (point: { x: number, y: number }) => void
	/** the drawing again, small (not used: only seen) */
	children: React.ReactNode
}

const WIDTH = 220
const MAX_HEIGHT = 180
const PAD = 16

/**
 * The outline of a diagram: the whole drawing small, in a corner of the view, with a frame on what the view shows. A
 * click or a drag on it moves the view there.
 */
export const DiagramOutline: React.FC<DiagramOutlineProps> = ({ bounds, view, viewport, colors, label, onCenter, children }) => {
	const svg = useRef<SVGSVGElement>(null)
	const dragging = useRef(false)
	const box = { x: bounds.x - PAD, y: bounds.y - PAD, width: Math.max(1, bounds.width + 2 * PAD), height: Math.max(1, bounds.height + 2 * PAD) }
	const height = Math.min(MAX_HEIGHT, Math.max(60, WIDTH * box.height / box.width))
	// the frame: what the view shows, in the units of the drawing
	const frame = { x: -view.x / view.k, y: -view.y / view.k, width: viewport.width / view.k, height: viewport.height / view.k }

	const toDrawing = (e: React.PointerEvent): { x: number, y: number } | undefined => {
		const el = svg.current
		const matrix = el?.getScreenCTM?.()
		if (!el || !matrix) return undefined
		const point = el.createSVGPoint()
		point.x = e.clientX
		point.y = e.clientY
		const at = point.matrixTransform(matrix.inverse())
		return { x: at.x, y: at.y }
	}
	const move = (e: React.PointerEvent) => { const at = toDrawing(e); if (at) onCenter(at) }

	return (
		<div className="lw-outline" role="group" aria-label={label} style={{ width: WIDTH, height, background: colors.canvas, borderColor: colors.border }}
			onPointerDown={e => {
				e.stopPropagation()
				if (e.button !== 0) return
				dragging.current = true
				try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId) } catch { /* no capture */ }
				move(e)
			}}
			onPointerMove={e => { if (dragging.current) { e.stopPropagation(); move(e) } }}
			onPointerUp={e => { dragging.current = false; e.stopPropagation() }}
			onPointerCancel={() => { dragging.current = false }}
			onWheel={e => e.stopPropagation()}>
			<svg ref={svg} width="100%" height="100%" viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
				<g pointerEvents="none">{children}</g>
				<rect className="lw-outline-frame" x={frame.x} y={frame.y} width={frame.width} height={frame.height}
					fill={colors.accent} fillOpacity={0.12} stroke={colors.accent} strokeWidth={Math.max(1, box.width / WIDTH) * 1.5} vectorEffect="non-scaling-stroke" />
			</svg>
		</div>
	)
}
