import React, { useState } from 'react'
import { format, messagesOf } from '../domain/i18n'
import { QueryWorkbench, QueryWorkbenchProps } from './QueryWorkbench'
import { DomainDiagram } from './DomainDiagram'

export interface QueryTabsProps extends QueryWorkbenchProps {
	/** Name of a new tab, numbered (default "Query" in the locale) */
	tabName?: string
	/** At most this many tabs (default 10) */
	maxTabs?: number
	/** A first tab, fixed, with the diagram of the domain; a double click on an entity opens a tab that queries it */
	diagram?: boolean
}

interface Tab {
	id: number
	title: string
	schema?: string
	query?: string
}

const MODEL = 0

/**
 * Several QueryWorkbench side by side, one per tab, each with its own schema, query, data and result. The hidden tabs
 * stay mounted: switching never loses what was written or the last result. The tab bar adds (+), closes (×, the
 * last one stays) and renames (double click) the tabs.
 */
export const QueryTabs: React.FC<QueryTabsProps> = ({ tabName: name, maxTabs = 10, diagram = false, ...workbench }) => {
	const m = messagesOf(workbench.locale)
	const tabName = name ?? m.tabNamed
	const [tabs, setTabs] = useState<Tab[]>([{ id: 1, title: `${tabName} 1` }])
	const [active, setActive] = useState(1)
	const [next, setNext] = useState(2)
	const [editing, setEditing] = useState<number>()

	const add = (tab: Partial<Tab> = {}) => {
		if (tabs.length >= maxTabs) return
		setTabs([...tabs, { id: next, title: `${tabName} ${next}`, ...tab }])
		setActive(next)
		setNext(next + 1)
	}
	const query = (schema: string, entity: string) => add({ title: entity, schema, query: `${entity}.page(1, 10)` })
	const close = (id: number) => {
		if (tabs.length === 1) return
		const index = tabs.findIndex(t => t.id === id)
		const rest = tabs.filter(t => t.id !== id)
		setTabs(rest)
		if (active === id) setActive(rest[Math.max(0, index - 1)].id)
	}
	const rename = (id: number, title: string) => {
		setTabs(tabs.map(t => t.id === id ? { ...t, title: title.trim() || t.title } : t))
		setEditing(undefined)
	}

	return (
		<div className={`lw-tabs lw-${workbench.theme ?? 'light'}`}>
			<div className="lw-tabbar" role="tablist" aria-label="queries">
				{diagram && (
					<div className={`lw-tab lw-tab-model ${active === MODEL ? 'lw-active' : ''}`}>
						<button role="tab" aria-selected={active === MODEL} onClick={() => setActive(MODEL)}>{m.model}</button>
					</div>
				)}
				{tabs.map(tab => (
					<div key={tab.id} className={`lw-tab ${tab.id === active ? 'lw-active' : ''}`}>
						{editing === tab.id
							? <input aria-label="tab name" placeholder={m.tabName} autoFocus defaultValue={tab.title}
								onBlur={e => rename(tab.id, e.target.value)}
								onKeyDown={e => { if (e.key === 'Enter') rename(tab.id, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setEditing(undefined) }} />
							: <button role="tab" aria-selected={tab.id === active} onClick={() => setActive(tab.id)} onDoubleClick={() => setEditing(tab.id)}>{tab.title}</button>}
						{tabs.length > 1 && <button className="lw-tab-close" aria-label={`close ${tab.title}`} title={m.close} onClick={() => close(tab.id)}>×</button>}
					</div>
				))}
				<button className="lw-tab-add" aria-label="new tab" title={tabs.length >= maxTabs ? format(m.tabLimit, { n: maxTabs }) : m.newTab} disabled={tabs.length >= maxTabs} onClick={() => add()}>+</button>
			</div>
			{diagram && (
				<div role="tabpanel" aria-label={m.model} hidden={active !== MODEL}>
					<DomainDiagram baseUrl={workbench.baseUrl} api={workbench.api} headers={workbench.headers} schema={workbench.schema}
						theme={workbench.theme} locale={workbench.locale} onQuery={query} />
				</div>
			)}
			{tabs.map(tab => (
				<div key={tab.id} role="tabpanel" aria-label={tab.title} hidden={tab.id !== active}>
					<QueryWorkbench {...workbench} initialSchema={tab.schema} initialQuery={tab.query ?? workbench.initialQuery} />
				</div>
			))}
		</div>
	)
}
