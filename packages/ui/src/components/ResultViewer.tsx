import React, { useMemo, useState } from 'react'
import { cellText, columnsOf, formatBytes, isTable, QueryResult, toJson, toYaml } from '../domain/results'

type View = 'tree' | 'table' | 'json' | 'yaml'

export interface ResultViewerProps {
	result?: QueryResult
	/** Rows shown in the tree and the table (the download has all of them) */
	maxRows?: number
	/** File name of the downloads, without extension */
	fileName?: string
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
export const ResultViewer: React.FC<ResultViewerProps> = ({ result, maxRows = 200, fileName = 'result' }) => {
	const table = result?.ok && isTable(result.value)
	const [chosen, setView] = useState<View>('tree')
	const view: View = chosen === 'table' && !table ? 'tree' : chosen
	const json = useMemo(() => result?.ok ? toJson(result.value) : '', [result])
	const yaml = useMemo(() => result?.ok && view === 'yaml' ? toYaml(result.value) : '', [result, view])
	if (!result) return <div className="lw-result lw-empty">Run an action to see its result.</div>
	const meta = (
		<div className="lw-meta" role="status">
			<span className={result.ok ? 'lw-ok' : 'lw-error'}>{result.status ?? (result.ok ? 200 : 'error')}</span>
			<span>{result.operation}</span>
			<span>{Math.round(result.durationMs)} ms</span>
			{result.rows !== undefined && <span>{result.rows} rows</span>}
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
				<button onClick={() => navigator.clipboard?.writeText(view === 'yaml' ? yaml : json)}>copy</button>
				<button onClick={() => download(json, `${fileName}.json`, 'application/json')}>.json</button>
				<button onClick={() => download(toYaml(value), `${fileName}.yaml`, 'application/yaml')}>.yaml</button>
			</div>
			{cut && (view === 'tree' || view === 'table') && <div className="lw-notice">Showing {maxRows} of {(value as unknown[]).length} rows: the downloads have all of them.</div>}
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
