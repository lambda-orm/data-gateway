import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { functionsOf, lambdaCompletions } from '../domain/lambdaCompletion'
import { formatQuery } from '../domain/queryFormat'
import { Icons } from './dialogs'
import type { DomainInfo } from '../domain/diagram'
import { QUERYABLE_DECLARATIONS } from '../infrastructure/monaco/queryableDeclarations.generated'

/** the functions of the λORM expressions, as the editor declares them */
const LAMBDA_FUNCTIONS = functionsOf(QUERYABLE_DECLARATIONS)
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
import { OptionsForm, optionsSummary } from './OptionsForm'
import { Modal } from './dialogs'
import { optionsMessagesOf } from '../domain/optionsI18n'
import { ResultViewer } from './ResultViewer'
import { applySuggestion } from '../domain/workspace'

export interface QueryWorkbenchProps {
	/** The domain of a schema, for the suggestions (the Workspace gives the one it keeps); by default api.domain */
	loadDomain?: (schema: string) => Promise<DomainInfo>
	/** The culture of the numbers and dates of the results (es-AR, en-US…); without it, as they came */
	culture?: string
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
	/** Changes when a schema is added, removed or reloaded (the Workspace watches /schemas): the list and typings again */
	schemasRevision?: string
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
	// what the editor suggests: the domain of the schema (its entities, the types of their properties) and the functions
	const [domain, setDomain] = useState<DomainInfo>()
	const [copied, setCopied] = useState(false)
	// the data folds while it is empty (more room for the query); it opens when something fills it (parameters, a saved query)
	const emptyData = (text: string) => text.replace(/\s+/g, '') === '{}' || text.trim() === ''
	const [dataOpen, setDataOpen] = useState(() => !emptyData(s.data))
	useEffect(() => { if (!emptyData(s.data)) setDataOpen(true) }, [s.data])
	const [editingOptions, setEditingOptions] = useState(false)
	useEffect(() => {
		setDomain(undefined)
		const read = props.loadDomain ?? (api.domain ? (schema: string) => api.domain!(schema) : undefined)
		if (s.schema === undefined || !read) return
		let alive = true
		read(s.schema).then(d => { if (alive) setDomain(d) }, () => undefined)
		return () => { alive = false }
	}, [api, s.schema, props.loadDomain])
	const suggest = useCallback((text: string, line: number, column: number) => {
		const lines = text.split('\n')
		const before = [...lines.slice(0, line - 1), (lines[line - 1] ?? '').slice(0, column - 1)].join('\n')
		return lambdaCompletions(before, domain, LAMBDA_FUNCTIONS)
	}, [domain])

	useEffect(() => {
		if (fixedSchema !== undefined) controller.selectSchema(fixedSchema)
		else {
			controller.loadSchemas().then(() => {
				const { schemas, schema } = controller.getState()
				if (props.initialSchema !== undefined) controller.selectSchema(props.initialSchema)
				// a single ready schema: nothing to choose
				else if (schema === undefined && schemas.length === 1) controller.selectSchema(schemas[0].path)
			})
		}
		// the initial schema only counts at the start
	}, [controller, fixedSchema])

	// the schemas changed (one added, removed or reloaded): the list again, and the typings of the one chosen
	const revisionSeen = useRef(props.schemasRevision)
	useEffect(() => {
		if (revisionSeen.current === props.schemasRevision) return
		revisionSeen.current = props.schemasRevision
		if (fixedSchema === undefined) controller.loadSchemas()
		controller.refreshSchema()
	}, [controller, fixedSchema, props.schemasRevision])

	useEffect(() => { setSchemaTypings(s.typings).catch(() => undefined) }, [s.typings])
	const contentChange = props.onContentChange
	useEffect(() => {
		contentChange?.({ mode: s.mode, query: s.query, script: s.script, data: s.data, options: s.options, schema: s.schema })
	}, [contentChange, s.mode, s.query, s.script, s.data, s.options, s.schema])

	const queryActions = operations.filter(o => o !== 'executeScript')
	const actions = s.mode === 'query' ? queryActions : operations.filter(o => o === 'executeScript')
	const main: Operation = s.mode === 'query' ? 'execute' : 'executeScript'
	const om = optionsMessagesOf(locale)
	const summary = optionsSummary(s.options, locale)
	const dataPreview = s.data.replace(/\s+/g, ' ').trim().slice(0, 120)
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
				<span className="lw-tool-group">
					<button className="lw-tool" aria-label={m.copyQuery} title={copied ? m.copiedQuery : m.copyQuery} disabled={!(s.mode === 'query' ? s.query : s.script).trim()}
						onClick={() => navigator.clipboard?.writeText(s.mode === 'query' ? s.query : s.script).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => undefined)}>
						<Icons.copy size={18} />
					</button>
					{s.mode === 'query' && (
						<button className="lw-tool" aria-label={m.formatQueryText} title={m.formatQueryText} disabled={!s.query.trim()}
							onClick={() => { controller.update({ query: formatQuery(s.query) }); controller.scheduleValidation() }}>
							<Icons.format size={18} />
						</button>
					)}
					{copied && <span className="lw-type" role="status">{m.copiedQuery}</span>}
				</span>
				{props.toolbar}
				{s.whoami && props.showWho !== false && <span className="lw-who">{s.whoami.name} · {s.whoami.permissions.join(', ')}</span>}
			</div>
			{s.notice && <div className="lw-notice" role="alert">{localize(s.notice, m)}</div>}
			{s.mode === 'query'
				? <CodeEditor ariaLabel="query" language="typescript" theme={theme} value={s.query} markers={s.markers} lambda completion={suggest} triggerCharacters={['.']}
					onChange={query => { controller.update({ query }); controller.scheduleValidation() }} onRun={() => run(main)} height={260} />
				: <CodeEditor ariaLabel="script" language="javascript" theme={theme} value={s.script} lambda completion={suggest} triggerCharacters={['.']} onChange={script => controller.update({ script })} onRun={() => run(main)} height={300} />}
			{/* the data, folded while it is empty: more room for the query */}
			<details className="lw-data" open={dataOpen} onToggle={e => setDataOpen((e.currentTarget as HTMLDetailsElement).open)}>
				<summary>
					<span className="lw-label">{m.data}</span>
					{!dataOpen && <code className="lw-data-preview">{dataPreview}</code>}
				</summary>
				{dataOpen && <CodeEditor ariaLabel="data" language="json" theme={theme} value={s.data} onChange={data => controller.update({ data })} height={110} />}
			</details>
			{/* the options in one line; Edit opens them as a form or JSON */}
			<div className="lw-options-line">
				<span className="lw-label">{m.options}</span>
				<span className={summary.invalid ? 'lw-options-summary lw-error-text' : 'lw-options-summary'} title={summary.text}>{summary.text}</span>
				<button type="button" onClick={() => setEditingOptions(true)}>{om.edit}</button>
				{s.mode === 'query' && operations.includes('executeQueued') && (
					<span className="lw-queue">
						<input aria-label="topic" placeholder={m.topic} value={s.topic} onChange={e => controller.update({ topic: e.target.value })} />
						<input aria-label="chunk" placeholder={m.chunk} inputMode="numeric" value={s.chunk} onChange={e => controller.update({ chunk: e.target.value })} />
					</span>
				)}
			</div>
			{editingOptions && (
				<Modal title={m.options} theme={theme} onClose={() => setEditingOptions(false)}>
					<OptionsForm label={m.options} heading={false} value={s.options} onChange={options => controller.update({ options })} api={api} schema={s.schema} mode={s.mode} theme={theme} locale={locale} />
					<div className="lw-form-actions"><button type="button" className="lw-primary" onClick={() => setEditingOptions(false)}>{om.done}</button></div>
				</Modal>
			)}
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
			<ResultViewer result={s.result} maxRows={maxViewRows} locale={locale} theme={theme} culture={props.culture} fileName={s.result ? `${(s.schema || 'root').replace(/\//g, '-')}-${s.result.operation}` : undefined}
				onSuggestion={s.mode === 'query' ? (name, replacement) => { controller.update({ query: applySuggestion(s.query, name, replacement) }); controller.scheduleValidation() } : undefined} />
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
