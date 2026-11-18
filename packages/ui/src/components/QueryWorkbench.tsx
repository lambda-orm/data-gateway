import React, { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ALL_OPERATIONS, Operation } from '../domain/operations'
import { QueryResult } from '../domain/results'
import { HistoryPort, QueryApiPort } from '../application/ports'
import { WorkbenchController } from '../application/workbench'
import { localize, Locale, messagesOf } from '../domain/i18n'
import { SavedQueryContent } from '../domain/savedItems'
import { HeadersProvider, RestQueryApi } from '../infrastructure/restQueryApi'
import { LocalStorageHistory } from '../infrastructure/localStorageHistory'
import { setSchemaTypings } from '../infrastructure/monaco/monacoSetup'
import { CodeEditor } from './CodeEditor'
import { ResultViewer } from './ResultViewer'

export interface QueryWorkbenchProps {
	/** URL of the data-gateway (its REST transport); or api */
	baseUrl?: string
	/** Another way to reach the gateway (a backend of your own) */
	api?: QueryApiPort
	/** Fixed schema; without it, a selector of the ready schemas */
	schema?: string
	/** How to authenticate every request; the library keeps no credential */
	headers?: HeadersProvider
	/** Actions offered (all by default) */
	operations?: Operation[]
	theme?: 'light' | 'dark'
	/** History per schema; false to keep none */
	history?: HistoryPort | false
	/** Rows shown in the tree and the table */
	maxViewRows?: number
	onResult?: (result: QueryResult) => void
	/** First text of the query editor */
	initialQuery?: string
	/** Schema chosen at the start in the selector (it can be changed); schema fixes one instead */
	initialSchema?: string
	/** First content of the editors (a saved query); initialQuery is the query alone */
	initial?: Partial<SavedQueryContent>
	/** Every change of the content or the schema (to save it, to know it changed) */
	onContentChange?: (content: SavedQueryContent & { schema?: string }) => void
	/** Buttons of the application next to the mode (Save) */
	toolbar?: React.ReactNode
	/** Who the credential is, next to the mode (default true; false when the application shows it) */
	showWho?: boolean
	/** Language of the labels and messages (default English); the names of the actions stay the API's */
	locale?: Locale
}

const LABELS: Record<Operation, string> = {
	plan: 'plan', metadata: 'metadata', model: 'model', parameters: 'parameters', constraints: 'constraints', execute: 'execute', executeQueued: 'execute queued', executeScript: 'execute script'
}

const NONE = '\u0000none'

export const SchemaSelector: React.FC<{ schemas: { path: string }[], value?: string, onChange: (schema: string) => void, locale?: Locale }> = ({ schemas, value, onChange, locale }) => (
	<label className="lw-field">
		<span>{messagesOf(locale).schema}</span>
		{/* the schema at the root has the path "": the placeholder needs another value */}
		<select aria-label="schema" value={value ?? NONE} onChange={e => onChange(e.target.value)}>
			<option value={NONE} disabled>{messagesOf(locale).choose}</option>
			{schemas.map(s => <option key={s.path} value={s.path}>{s.path || '/'}</option>)}
		</select>
	</label>
)

/**
 * Write, check and run λORM queries and scripts against a schema of a data-gateway: editor with the domain's
 * autocompletion, data and options, the eight actions (enabled by the credential's permissions) and the result.
 */
export const QueryWorkbench: React.FC<QueryWorkbenchProps> = props => {
	const { schema: fixedSchema, operations = ALL_OPERATIONS, theme = 'light', maxViewRows, onResult, locale } = props
	const m = messagesOf(locale)
	const api = useMemo(() => props.api ?? new RestQueryApi(props.baseUrl ?? '', props.headers), [props.api, props.baseUrl, props.headers])
	const controller = useMemo(
		() => new WorkbenchController(api, props.history === false ? undefined : props.history ?? new LocalStorageHistory(), { query: props.initialQuery ?? '', ...props.initial }, onResult),
		// a new gateway (or credential) is a new workbench
		[api]
	)
	const s = useSyncExternalStore(controller.subscribe, controller.getState)

	useEffect(() => {
		if (fixedSchema !== undefined) controller.selectSchema(fixedSchema)
		else controller.loadSchemas().then(() => { if (props.initialSchema !== undefined) controller.selectSchema(props.initialSchema) })
		// the initial schema only counts at the start
	}, [controller, fixedSchema])

	useEffect(() => { setSchemaTypings(s.typings).catch(() => undefined) }, [s.typings])
	const contentChange = props.onContentChange
	useEffect(() => {
		contentChange?.({ mode: s.mode, query: s.query, script: s.script, data: s.data, options: s.options, schema: s.schema })
	}, [contentChange, s.mode, s.query, s.script, s.data, s.options, s.schema])

	const queryActions = operations.filter(o => o !== 'executeScript')
	const actions = s.mode === 'query' ? queryActions : operations.filter(o => o === 'executeScript')
	const main: Operation = s.mode === 'query' ? 'execute' : 'executeScript'
	const run = (operation: Operation) => operation === 'parameters' ? controller.fillParameters() : controller.run(operation)

	return (
		<div className={`lw-workbench lw-${theme}`}>
			<div className="lw-header">
				{fixedSchema === undefined && <SchemaSelector schemas={s.schemas} value={s.schema} onChange={schema => controller.selectSchema(schema)} locale={locale} />}
				<div className="lw-modes" role="radiogroup" aria-label="mode" title={m.mode}>
					<button role="radio" aria-checked={s.mode === 'query'} className={s.mode === 'query' ? 'lw-active' : ''} onClick={() => controller.update({ mode: 'query' })}>{m.query}</button>
					{operations.includes('executeScript') && (
						<button role="radio" aria-checked={s.mode === 'script'} className={s.mode === 'script' ? 'lw-active' : ''} onClick={() => controller.update({ mode: 'script' })}>{m.script}</button>
					)}
				</div>
				{props.toolbar}
				{s.whoami && props.showWho !== false && <span className="lw-who">{s.whoami.name} · {s.whoami.permissions.join(', ')}</span>}
			</div>
			{s.notice && <div className="lw-notice" role="alert">{localize(s.notice, m)}</div>}
			{s.mode === 'query'
				? <CodeEditor ariaLabel="query" language="typescript" theme={theme} value={s.query} markers={s.markers}
					onChange={query => { controller.update({ query }); controller.scheduleValidation() }} onRun={() => run(main)} />
				: <CodeEditor ariaLabel="script" language="javascript" theme={theme} value={s.script} onChange={script => controller.update({ script })} onRun={() => run(main)} height={220} />}
			<div className="lw-row">
				<div className="lw-col">
					<div className="lw-label">{m.data}</div>
					<CodeEditor ariaLabel="data" language="json" theme={theme} value={s.data} onChange={data => controller.update({ data })} height={110} />
				</div>
				<div className="lw-col">
					<div className="lw-label">{m.options}</div>
					<CodeEditor ariaLabel="options" language="json" theme={theme} value={s.options} onChange={options => controller.update({ options })} height={110} />
					{s.mode === 'query' && operations.includes('executeQueued') && (
						<div className="lw-queue">
							<input aria-label="topic" placeholder={m.topic} value={s.topic} onChange={e => controller.update({ topic: e.target.value })} />
							<input aria-label="chunk" placeholder={m.chunk} inputMode="numeric" value={s.chunk} onChange={e => controller.update({ chunk: e.target.value })} />
						</div>
					)}
				</div>
			</div>
			<div className="lw-actions">
				{actions.map(operation => {
					const { enabled, reason } = controller.available(operation)
					return (
						<button key={operation} className={operation === main ? 'lw-primary' : ''} disabled={!enabled || s.schema === undefined || s.running !== undefined}
							title={enabled ? (operation === main ? m.runShortcut : undefined) : localize(reason, m)} onClick={() => run(operation)}>
							{s.running === operation ? `${LABELS[operation]}…` : LABELS[operation]}
						</button>
					)
				})}
			</div>
			<ResultViewer result={s.result} maxRows={maxViewRows} locale={locale} fileName={s.result ? `${(s.schema || 'root').replace(/\//g, '-')}-${s.result.operation}` : undefined} />
			{s.history.length > 0 && (
				<details className="lw-history">
					<summary>{m.history} ({s.history.length})</summary>
					<ul>
						{s.history.map((entry, i) => (
							<li key={i}><button className="lw-link" onClick={() => controller.restore(entry)}>{entry.mode}: {entry.text.slice(0, 120)}</button></li>
						))}
					</ul>
					<button onClick={() => controller.clearHistory()}>{m.clearHistory}</button>
				</details>
			)}
		</div>
	)
}
