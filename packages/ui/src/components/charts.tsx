import React from 'react'
import { ChartData, formatNumber, niceMax } from '../domain/panels'

/**
 * The charts of a card of a panel (docs/FILES_AND_PANELS.md §2): SVG of its own, no library. The colours are the series
 * of the theme (--lw-series-1…6), the text and the grid those of the page, so they read on light and dark.
 */
const W = 480
const H = 220
const PAD = { left: 48, right: 12, top: 10, bottom: 36 }
const colour = (i: number) => `var(--lw-series-${(i % 6) + 1})`

const Legend: React.FC<{ names: string[] }> = ({ names }) => names.length > 1
	? <div className="lw-chart-legend">{names.map((n, i) => <span key={n}><i style={{ background: colour(i) }} />{n}</span>)}</div>
	: null

const Axis: React.FC<{ top: number, culture?: string }> = ({ top, culture }) => {
	const ticks = [0, 0.25, 0.5, 0.75, 1]
	const y = (f: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - f)
	return (
		<g className="lw-chart-axis">
			{ticks.map(f => (
				<g key={f}>
					<line x1={PAD.left} x2={W - PAD.right} y1={y(f)} y2={y(f)} />
					<text x={PAD.left - 6} y={y(f)} textAnchor="end" dominantBaseline="middle">{formatNumber(top * f, culture)}</text>
				</g>
			))}
		</g>
	)
}

const labelText = (text: string) => text.length > 10 ? `${text.slice(0, 9)}…` : text

export const BarChart: React.FC<{ data: ChartData, culture?: string, title: string }> = ({ data, culture, title }) => {
	const top = niceMax(Math.max(0, ...data.series.flatMap(s => s.values)))
	const plotW = W - PAD.left - PAD.right
	const plotH = H - PAD.top - PAD.bottom
	const group = plotW / Math.max(1, data.labels.length)
	const bar = Math.max(2, (group * 0.75) / Math.max(1, data.series.length))
	return (
		<figure className="lw-chart">
			<svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
				<Axis top={top} culture={culture} />
				{data.labels.map((label, i) => (
					<g key={i}>
						{data.series.map((s, k) => {
							const h = (s.values[i] / top) * plotH
							return <rect key={s.name} x={PAD.left + group * i + group * 0.125 + bar * k} y={PAD.top + plotH - h} width={bar - 1} height={Math.max(0, h)} rx={2} fill={colour(k)}><title>{`${label} · ${s.name}: ${formatNumber(s.values[i], culture)}`}</title></rect>
						})}
						<text className="lw-chart-label" x={PAD.left + group * (i + 0.5)} y={H - PAD.bottom + 14} textAnchor="middle">{labelText(label)}</text>
					</g>
				))}
			</svg>
			<Legend names={data.series.map(s => s.name)} />
		</figure>
	)
}

export const LineChart: React.FC<{ data: ChartData, culture?: string, title: string }> = ({ data, culture, title }) => {
	const top = niceMax(Math.max(0, ...data.series.flatMap(s => s.values)))
	const plotW = W - PAD.left - PAD.right
	const plotH = H - PAD.top - PAD.bottom
	const x = (i: number) => PAD.left + (data.labels.length > 1 ? (plotW * i) / (data.labels.length - 1) : plotW / 2)
	const y = (v: number) => PAD.top + plotH - (v / top) * plotH
	const every = Math.ceil(data.labels.length / 8)
	return (
		<figure className="lw-chart">
			<svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
				<Axis top={top} culture={culture} />
				{data.series.map((s, k) => (
					<g key={s.name}>
						<polyline fill="none" stroke={colour(k)} strokeWidth={2} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
						{s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={colour(k)}><title>{`${data.labels[i]} · ${s.name}: ${formatNumber(v, culture)}`}</title></circle>)}
					</g>
				))}
				{data.labels.map((label, i) => i % every === 0 && <text key={i} className="lw-chart-label" x={x(i)} y={H - PAD.bottom + 14} textAnchor="middle">{labelText(label)}</text>)}
			</svg>
			<Legend names={data.series.map(s => s.name)} />
		</figure>
	)
}

export const PieChart: React.FC<{ data: ChartData, culture?: string, title: string }> = ({ data, culture, title }) => {
	const values = data.series[0]?.values ?? []
	const total = values.reduce((a, b) => a + Math.max(0, b), 0)
	const r = 80
	const cx = 110
	const cy = H / 2
	let angle = -Math.PI / 2
	const slices = values.map((v, i) => {
		const part = total > 0 ? Math.max(0, v) / total : 0
		const from = angle
		angle += part * Math.PI * 2
		const large = part > 0.5 ? 1 : 0
		const p = (a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
		const d = part >= 0.9999 ? `M ${cx - r},${cy} a ${r},${r} 0 1,0 ${2 * r},0 a ${r},${r} 0 1,0 ${-2 * r},0` : `M ${cx},${cy} L ${p(from)} A ${r},${r} 0 ${large},1 ${p(angle)} Z`
		return { d, label: data.labels[i], value: v, part, i }
	})
	return (
		<figure className="lw-chart lw-pie">
			<svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
				{slices.map(s => <path key={s.i} d={s.d} fill={colour(s.i)} stroke="var(--lw-bg)" strokeWidth={1}><title>{`${s.label}: ${formatNumber(s.value, culture)} (${Math.round(s.part * 100)}%)`}</title></path>)}
				{slices.slice(0, 8).map(s => (
					<g key={s.i} transform={`translate(230, ${24 + s.i * 22})`}>
						<rect width={10} height={10} y={-5} rx={2} fill={colour(s.i)} />
						<text className="lw-chart-label" x={16} dominantBaseline="middle">{labelText(s.label)} · {formatNumber(s.value, culture)} ({Math.round(s.part * 100)}%)</text>
					</g>
				))}
			</svg>
		</figure>
	)
}
