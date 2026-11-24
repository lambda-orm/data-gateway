import React, { useCallback, useMemo, useState } from 'react'
import { QueryApiPort } from '../application/ports'
import { DomainInfo } from '../domain/diagram'
import { functionsOf, lambdaCompletions } from '../domain/lambdaCompletion'
import { QUERYABLE_DECLARATIONS } from '../infrastructure/monaco/queryableDeclarations.generated'
import { columnsOf, emptyWizard, joinOf, queryOf, WizardReading, WizardState, withoutTable } from '../domain/queryWizard'
import { wizardMessagesOf } from '../domain/wizardI18n'
import { format, Locale } from '../domain/i18n'
import { CodeEditor } from './CodeEditor'
import { DomainDiagram } from './DomainDiagram'
import { Modal } from './dialogs'
import type { LayoutPort } from '../infrastructure/elkLayout'

const LAMBDA_FUNCTIONS = functionsOf(QUERYABLE_DECLARATIONS)

export interface QueryWizardProps {
	api: QueryApiPort
	schema: string
	domain: DomainInfo
	/** the wizard as it was left (a query written by it); without it, a new one */
	initial?: WizardState
	/** the entity to start from when there is no wizard yet (the one the query of the tab reads) */
	start?: string
	/** the query of the tab read as a wizard (not written by one, or edited by hand since): it starts there, and tells what it couldn't read */
	reading?: WizardReading
	/** the query of the tab as it is now: edited by hand since the wizard wrote it, updating it replaces it */
	current?: string
	theme?: 'light' | 'dark'
	locale?: string
	onClose: () => void
	onAccept: (state: WizardState, query: string) => void
	/** where the boxes go (ELK by default) */
	layout?: LayoutPort
}

/**
 * The query wizard: the tables as in a diagram, each field with a check; the + of a table adds its related ones, the ×
 * takes one out (not the one it starts from). A filter on the entity it starts from (with its suggestions), the order
 * by the columns of the result and the page; what is left empty is not applied. The query is shown as it is written.
 */
export const QueryWizard: React.FC<QueryWizardProps> = ({ api, schema, domain, initial, start, reading, current, theme = 'light', locale, onClose, onAccept, layout }) => {
	const m = wizardMessagesOf(locale)
	const names = useMemo(() => domain.entities.map(e => e.name).sort((a, b) => a.localeCompare(b)), [domain])
	const [state, setState] = useState<WizardState>(() => reading?.state ?? initial ?? emptyWizard(start && names.includes(start) ? start : names[0] ?? ''))
	const [notice, setNotice] = useState<string>()
	// what of the query of the tab the wizard can't show: told until the wizard starts from another entity
	const [unread, setUnread] = useState<string[]>(() => reading?.unread ?? [])
	const query = useMemo(() => state.root ? queryOf(state, domain) : '', [state, domain])
	const columns = useMemo(() => columnsOf(state, domain), [state, domain])
	// read again from the tab, the edits are in the wizard: only what it couldn't read is told (unread)
	const edited = !reading && !!initial && current !== undefined && current.trim() !== queryOf(initial, domain).trim()

	/** the order only by columns the result still has */
	const tidy = (next: WizardState): WizardState => {
		const valid = new Set(columnsOf(next, domain).map(c => c.alias))
		return { ...next, sort: next.sort.filter(s => valid.has(s.column)) }
	}
	const propertiesOf = (entity: string) => domain.entities.find(e => e.name === entity)?.properties?.map(p => p.name) ?? []
	/**
	 * A field ticked or unticked. No field chosen means every field (no map), all of them ticked: unticking one leaves
	 * the others; ticking them all again is no map. The last field ticked stays (a table without fields reads nothing).
	 */
	const toggle = (entity: string, field: string) => setState(s => {
		const order = propertiesOf(entity)
		const chosen = s.fields[entity]?.length ? s.fields[entity] : order
		const next = chosen.includes(field) ? chosen.filter(f => f !== field) : order.filter(f => f === field || chosen.includes(f))
		if (!next.length) return s
		const fields = { ...s.fields, [entity]: next }
		if (next.length === order.length) delete fields[entity]
		return tidy({ ...s, fields })
	})
	/** The check of the title: every field (no map), or else only its primary key (its first field without one) */
	const toggleAll = (entity: string) => setState(s => {
		const fields = { ...s.fields }
		if (s.fields[entity]?.length) delete fields[entity]
		else {
			const order = propertiesOf(entity)
			const keys = (domain.entities.find(e => e.name === entity)?.primaryKey ?? []).filter(k => order.includes(k))
			const only = keys.length ? keys : order.slice(0, 1)
			if (!only.length || only.length === order.length) return s
			fields[entity] = only
		}
		return tidy({ ...s, fields })
	})
	const addEntities = (entities: string[], from?: string) => {
		let next = state
		const refused: string[] = []
		for (const entity of entities) {
			const join = joinOf(domain, next, entity, from)
			if (join) next = { ...next, tables: [...next.tables, join] }
			else if (entity !== next.root && !next.tables.some(t => t.entity === entity)) refused.push(entity)
		}
		setState(next)
		setNotice(refused.length ? format(m.cantJoin, { entity: refused.join(', ') }) : undefined)
	}
	const remove = (entity: string) => removeAll([entity])
	// several boxes selected and removed at once: each one, and those reached from it
	const removeAll = (gone: string[]) => setState(s => {
		const next = gone.reduce(withoutTable, s)
		const positions = next.positions && Object.fromEntries(Object.entries(next.positions).filter(([name]) => name === next.root || next.tables.some(t => t.entity === name)))
		return { ...next, positions }
	})

	// the filter is the body of a lambda on the root: its suggestions as if it were written in the query
	const suggest = useCallback((text: string, line: number, column: number) => {
		const lines = text.split('\n')
		const before = [...lines.slice(0, line - 1), (lines[line - 1] ?? '').slice(0, column - 1)].join('\n')
		return lambdaCompletions(`${state.root}.filter(p => ${before}`, domain, LAMBDA_FUNCTIONS)
	}, [state.root, domain])

	const entities = [state.root, ...state.tables.map(t => t.entity)]
	const setSort = (index: number, patch: Partial<WizardState['sort'][number]>) =>
		setState(s => ({ ...s, sort: s.sort.map((item, i) => i === index ? { ...item, ...patch } : item) }))
	const unsorted = columns.filter(c => !state.sort.some(s => s.column === c.alias))

	return (
		<Modal title={m.title} onClose={onClose} theme={theme}>
			<div className="lw-wizard-top">
				<div className="lw-wizard-start">
					<label className="lw-wizard-field">
						<span>{m.startFrom}</span>
						<select aria-label={m.startFrom} value={state.root} onChange={e => { setState(emptyWizard(e.target.value)); setNotice(undefined); setUnread([]) }}>
							{names.map(name => <option key={name} value={name}>{name}</option>)}
						</select>
					</label>
					<span className="lw-hint">{m.tablesHint}</span>
				</div>
			</div>
			<div className="lw-wizard">
				<div className="lw-wizard-diagram">
					{state.root && (
						<DomainDiagram key={state.root} api={api} schema={schema} theme={theme} locale={locale as Locale | undefined} entities={entities} keep={state.root}
							positions={state.positions} onPositionsChange={positions => setState(s => ({ ...s, positions }))}
							fieldSelection={{ chosen: state.fields, onToggle: toggle, onToggleAll: toggleAll }} onAddEntities={addEntities} onRemoveEntity={remove} onRemoveEntities={removeAll} detail="all" height="100%" layout={layout} />
					)}
					{notice && <div className="lw-hint lw-error-text" role="status">{notice}</div>}
				</div>
				<div className="lw-wizard-side">
					<div className="lw-wizard-field lw-wizard-grow">
						<span>{m.query}</span>
						<div className="lw-wizard-query">
							<CodeEditor ariaLabel={m.query} language="typescript" theme={theme} value={query} readOnly lambda compact onChange={() => undefined} height="100%" />
						</div>
					</div>
					{edited && <div className="lw-hint lw-warning-text" role="alert">{m.edited}</div>}
					{unread.length > 0 && (
						<div className="lw-hint lw-warning-text lw-wizard-unread" role="status">
							{m.unread}
							<ul>{unread.map((part, i) => <li key={i}><code>{part}</code></li>)}</ul>
						</div>
					)}
					<div className="lw-wizard-field">
						<span>{m.filter}</span>
						<div className="lw-wizard-filter">
							<code aria-hidden="true">{state.root}.filter(p =&gt;</code>
							<CodeEditor ariaLabel={m.filter} language="typescript" theme={theme} value={state.filter} lambda compact completion={suggest} triggerCharacters={['.']}
								onChange={filter => setState(s => ({ ...s, filter }))} height={80} />
						</div>
						<div className="lw-hint">{format(m.filterHint, { entity: state.root })}</div>
					</div>
					<div className="lw-wizard-field">
						<span>{m.sort}</span>
						{state.sort.map((item, index) => (
							<div key={index} className="lw-option-pair">
								<select aria-label={`${m.sort} ${index + 1}`} value={item.column} onChange={e => setSort(index, { column: e.target.value })}>
									{columns.filter(c => c.alias === item.column || !state.sort.some(s => s.column === c.alias)).map(c => <option key={c.alias} value={c.alias}>{c.alias}</option>)}
								</select>
								<select aria-label={`${m.sort} ${index + 1} · ${m.descending}`} value={item.desc ? 'desc' : 'asc'} onChange={e => setSort(index, { desc: e.target.value === 'desc' })}>
									<option value="asc">{m.ascending}</option>
									<option value="desc">{m.descending}</option>
								</select>
								<button type="button" className="lw-icon" aria-label={m.removeSort} title={m.removeSort} onClick={() => setState(s => ({ ...s, sort: s.sort.filter((_, i) => i !== index) }))}>×</button>
							</div>
						))}
						<button type="button" disabled={!unsorted.length} onClick={() => setState(s => ({ ...s, sort: [...s.sort, { column: unsorted[0].alias, desc: false }] }))}>+ {m.addSort}</button>
						<div className="lw-hint">{m.sortHint}</div>
					</div>
					<div className="lw-wizard-field">
						<span>{m.page}</span>
						<div className="lw-option-pair">
							<input aria-label={m.pageNumber} placeholder={m.pageNumber} inputMode="numeric" value={state.page.number} onChange={e => setState(s => ({ ...s, page: { ...s.page, number: e.target.value } }))} />
							<input aria-label={m.pageSize} placeholder={m.pageSize} inputMode="numeric" value={state.page.size} onChange={e => setState(s => ({ ...s, page: { ...s.page, size: e.target.value } }))} />
						</div>
						<div className="lw-hint">{m.pageHint}</div>
					</div>
				</div>
			</div>
			<div className="lw-form-actions lw-wizard-actions">
				<button type="button" onClick={onClose}>{m.cancel}</button>
				<button type="button" className="lw-primary" disabled={!state.root} onClick={() => onAccept(state, query)}>{initial ? m.update : m.create}</button>
			</div>
		</Modal>
	)
}
