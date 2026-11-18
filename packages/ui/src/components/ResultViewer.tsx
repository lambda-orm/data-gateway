import React, { useEffect, useMemo, useRef, useState } from 'react'
import { format, Locale, messagesOf } from '../domain/i18n'
import { cellText, columnsOf, formatBytes, isTable, QueryResult, toJson, toTsv, toYaml } from '../domain/results'

export type View = 'tree' | 'table' | 'json' | 'yaml'

export interface ResultViewerProps {
	result?: QueryResult
	/** Rows shown in the tree and the table (the download has all of them) */
	maxRows?: number
	/** File name of the downloads, without extension */
	fileName?: string
	/** Language of the labels (default English) */
	locale?: Locale
	/** The view at the start (default tree) */
	initialView?: View
}

const download = (text: string, name: string, type: string) => {
	const url = URL.createObjectURL(new Blob([text], { type }))
	const link = document.createElement('a')
	link.href = url
	link.download = name
	document.body.appendChild(link)
	link.click()
	link.remove()
	URL.revokeObjectURL(url)
}

const CopyIcon: React.FC = () => (
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
	</svg>
)
const CheckIcon: React.FC = () => (
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<path d="M20 6 9 17l-5-5" />
	</svg>
)

type Format = 'json' | 'yaml' | 'tsv'

/** Export: a button that opens the formats; a click outside or Escape closes it */
const ExportMenu: React.FC<{ label: string, formats: { format: Format, label: string }[], onChoose: (format: Format) => void }> = ({ label, formats, onChoose }) => {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!open) return
		const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
		const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
		document.addEventListener('mousedown', outside)
		document.addEventListener('keydown', escape)
		return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
	}, [open])
	return (
		<div className="lw-menu" ref={ref}>
			<button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{label} ▾</button>
			{open && (
				<div role="menu" className="lw-menu-list">
					{formats.map(f => <button key={f.format} role="menuitem" onClick={() => { setOpen(false); onChoose(f.format) }}>{f.label}</button>)}
				</div>
			)}
		</div>
	)
}

const Tree: React.FC<{ value: unknown, name?: string, depth?: number }> = ({ value, name, depth = 0 }) => {
	const label = name !== undefined ? <span className="lw-key">{name}: </span> : null
	if (value === null || typeof value !== 'object') {
		const kind = value === null ? 'null' : typeof value
		return <div className="lw-leaf">{label}<span className={`lw-${kind}`}>{JSON.stringify(value)}</span></div>
	}
	const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as object)
	const summary = Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`
	return (
		<details className="lw-node" open={depth < 2}>
			<summary>{label}<span className="lw-summary">{summary}</span></summary>
			{entries.map(([key, child]) => <Tree key={key} name={key} value={child} depth={depth + 1} />)}
		</details>
	)
}

/** The result of an action: tree, table, JSON and YAML views, copy and download, status / time / rows / size */
export const ResultViewer: React.FC<ResultViewerProps> = ({ result, maxRows = 200, fileName = 'result', locale, initialView = 'tree' }) => {
	const m = messagesOf(locale)
	const [copied, setCopied] = useState(false)
	useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(timer) }, [copied])
	const table = result?.ok && isTable(result.value)
	const [chosen, setView] = useState<View>(initialView)
	const view: View = chosen === 'table' && !table ? 'tree' : chosen
	const json = useMemo(() => result?.ok ? toJson(result.value) : '', [result])
	const yaml = useMemo(() => result?.ok && view === 'yaml' ? toYaml(result.value) : '', [result, view])
	if (!result) return <div className="lw-result lw-empty">{m.runToSee}</div>
	const meta = (
		<div className="lw-meta" role="status">
			<span className={result.ok ? 'lw-ok' : 'lw-error'}>{result.status ?? (result.ok ? 200 : 'error')}</span>
			<span>{result.operation}</span>
			<span>{Math.round(result.durationMs)} ms</span>
			{result.rows !== undefined && <span>{format(m.rows, { n: result.rows })}</span>}
			{result.ok && <span>{formatBytes(result.bytes)}</span>}
		</div>
	)
	if (!result.ok) {
		return (
			<div className="lw-result">
				{meta}
				<div className="lw-error-box" role="alert">
					<strong>{result.error?.name}</strong>{result.error?.code ? ` (${result.error.code})` : ''}: {result.error?.message}
				</div>
			</div>
		)
	}
	const value = result.value
	const cut = Array.isArray(value) && value.length > maxRows
	const shown = cut ? (value as unknown[]).slice(0, maxRows) : value
	return (
		<div className="lw-result">
			{meta}
			<div className="lw-toolbar" role="tablist">
				{(['tree', 'table', 'json', 'yaml'] as View[]).filter(v => v !== 'table' || table).map(v => (
					<button key={v} role="tab" aria-selected={view === v} className={view === v ? 'lw-active' : ''} onClick={() => setView(v)}>{v}</button>
				))}
				<span className="lw-spacer" />
				<button className="lw-icon" aria-label={copied ? m.copied : m.copy} title={copied ? m.copied : m.copy}
					onClick={() => navigator.clipboard?.writeText(view === 'yaml' ? yaml : view === 'table' ? toTsv(value) : json).then(() => setCopied(true), () => undefined)}>
					{copied ? <CheckIcon /> : <CopyIcon />}
				</button>
				<ExportMenu label={m.export}
					formats={[{ format: 'json', label: 'JSON' }, { format: 'yaml', label: 'YAML' }, { format: 'tsv', label: m.tsv }]}
					onChoose={format => {
						if (format === 'json') download(json, `${fileName}.json`, 'application/json')
						else if (format === 'yaml') download(toYaml(value), `${fileName}.yaml`, 'application/yaml')
						else download(toTsv(value), `${fileName}.txt`, 'text/tab-separated-values')
					}} />
			</div>
			{cut && (view === 'tree' || view === 'table') && <div className="lw-notice">{format(m.showing, { shown: maxRows, total: (value as unknown[]).length })}</div>}
			<div className="lw-view">
				{view === 'tree' && <Tree value={shown} />}
				{view === 'table' && table && (
					<table className="lw-table">
						<thead><tr>{columnsOf(shown as Record<string, unknown>[]).map(c => <th key={c}>{c}</th>)}</tr></thead>
						<tbody>
							{(shown as Record<string, unknown>[]).map((row, i) => (
								<tr key={i}>{columnsOf(shown as Record<string, unknown>[]).map(c => <td key={c}>{cellText(row[c])}</td>)}</tr>
							))}
						</tbody>
					</table>
				)}
				{view === 'json' && <pre className="lw-code">{json}</pre>}
				{view === 'yaml' && <pre className="lw-code">{yaml}</pre>}
			</div>
		</div>
	)
}
