import React, { useEffect, useMemo, useState } from 'react'
import { QueryApiPort } from '../application/ports'
import { cardinalityOf, constraintsOf, DomainInfo, edgesOf, EntityInfo, EXPRESSION_HELP, expressionsOf, propertiesIn, referencesTo } from '../domain/diagram'
import { explorerMessagesOf, format } from '../domain/explorerI18n'
import { Locale } from '../domain/i18n'
import { measure, failure, QueryResult } from '../domain/results'
import { DomainDiagram } from './DomainDiagram'
import { ExpressionView } from './ExpressionView'
import { ResultViewer } from './ResultViewer'

export interface EntityViewProps {
	api: QueryApiPort
	schema: string
	entity: string
	/** The domain of the schema (it is read once for the explorer and the forms) */
	domain: () => Promise<DomainInfo>
	theme?: 'light' | 'dark'
	locale?: Locale
	/** Another entity of the schema (a relation, a reference) */
	onOpenEntity: (schema: string, entity: string) => void
	/** A query tab with this entity */
	onQuery: (schema: string, entity: string) => void
	/** The culture of the numbers and dates of its data */
	culture?: string
	/** The query of its diagram (the Workspace opens it in a tab) */
	onQueryText?: (schema: string, query: string) => void
	/** Its form, to change it (when the credential may write the schema) */
	onEdit?: (schema: string, entity: string) => void
	/** the text of the button of onEdit */
	editLabel?: string
	/** Its removal (what uses it, and a confirmation), when the credential may write the schema */
	onRemove?: (schema: string, entity: string) => void
	/** the text of the button of onRemove */
	removeLabel?: string
	/** Rows per page of the data (default 50) */
	pageSize?: number
}

type Section = 'properties' | 'relations' | 'keys' | 'constraints' | 'data' | 'diagram'

const Check: React.FC<{ on?: boolean }> = ({ on }) => <>{on ? '✓' : ''}</>

/**
 * The form of an entity, as a database IDE shows a table: its properties (type, length, required, primary key,
 * auto, default, enum, what each foreign key references, expressions), its relations and what references it, its
 * keys, indexes and constraints, its rows (read only, by pages) and its diagram with its neighbours.
 */
export const EntityView: React.FC<EntityViewProps> = ({ api, schema, entity: name, domain: loadDomain, theme = 'light', locale, onOpenEntity, onQuery, onQueryText, onEdit, culture, editLabel = 'Edit', onRemove, removeLabel = 'Remove', pageSize = 50 }) => {
	const m = explorerMessagesOf(locale)
	const [domain, setDomain] = useState<DomainInfo>()
	const [error, setError] = useState<string>()
	const [section, setSection] = useState<Section>('properties')
	const [page, setPage] = useState(1)
	const [result, setResult] = useState<QueryResult>()
	// the property whose expressions are shown under the table
	const [expressionsShown, setExpressionsShown] = useState<string>()

	useEffect(() => { loadDomain().then(setDomain, e => setError(e?.message ?? String(e))) }, [loadDomain])

	const entity: EntityInfo | undefined = domain?.entities.find(e => e.name === name)
	const references = useMemo(() => {
		const map = new Map<string, string>()
		if (!domain) return map
		for (const edge of edgesOf(domain)) {
			if (edge.kind === 'relation' && edge.child === name && edge.childField) map.set(edge.childField, `${edge.parent}.${edge.parentField}`)
		}
		return map
	}, [domain, name])
	const referencedBy = useMemo(() => domain ? referencesTo(domain, name) : [], [domain, name])
	// the variables of its expressions: its properties (colored apart)
	const names = useMemo(() => (entity?.properties ?? []).map(p => p.name), [entity])

	useEffect(() => {
		if (section !== 'data' || !entity || entity.abstract) return
		let live = true
		const query = `${name}.page(${page}, ${pageSize})`
		const started = performance.now()
		setResult(undefined)
		api.execute(schema, query).then(
			value => { if (live) setResult(measure('execute', value, performance.now() - started)) },
			e => { if (live) setResult(failure('execute', { name: e?.name ?? 'Error', message: e?.message ?? String(e), status: e?.status, code: e?.code }, performance.now() - started)) }
		)
		return () => { live = false }
	}, [section, page, entity, name, schema, api, pageSize])

	if (error) return <div className={`lw-workbench lw-${theme}`}><div className="lw-notice" role="alert">{error}</div></div>
	if (!domain) return <div className={`lw-workbench lw-${theme}`}><span className="lw-muted">{m.loading}</span></div>
	if (!entity) return <div className={`lw-workbench lw-${theme}`}><div className="lw-notice" role="alert">{name}?</div></div>

	const keys = new Set(entity.primaryKey ?? [])
	const unique = new Set(entity.uniqueKey ?? [])
	const link = (target: string) => <button className="lw-link" onClick={() => onOpenEntity(schema, target)}>{target}</button>
	const shown = entity.properties?.find(p => p.name === expressionsShown)
	const rows = Array.isArray(result?.value) ? (result!.value as unknown[]).length : 0

	return (
		<div className={`lw-entity-view lw-workbench lw-${theme}`}>
			<div className="lw-header">
				<h2 className="lw-entity-title">{entity.name}</h2>
				<code>/{schema}</code>
				{entity.abstract && <span className="lw-badge">{m.abstract}</span>}
				{entity.view && <span className="lw-badge">{m.viewEntity}</span>}
				{entity.extends && <span className="lw-badge">{format(m.extendsEntity, { name: entity.extends })}</span>}
				<span className="lw-spacer" />
				{onRemove && <button className="lw-danger" onClick={() => onRemove(schema, entity.name)}>{removeLabel}</button>}
				{onEdit && <button onClick={() => onEdit(schema, entity.name)}>{editLabel}</button>}
				{!entity.abstract && <button className="lw-primary" onClick={() => onQuery(schema, entity.name)}>{m.queryIt}</button>}
			</div>
			<div className="lw-toolbar" role="tablist" aria-label={entity.name}>
				{([['properties', `${m.properties} (${entity.properties?.length ?? 0})`], ['relations', `${m.relations} (${(entity.relations?.length ?? 0) + referencedBy.length})`],
					['keys', m.keysIndexes], ['constraints', `${m.constraints} (${entity.constraints?.length ?? 0})`], ...(entity.abstract ? [] : [['data', m.data]]), ['diagram', m.diagram]] as [Section, string][]).map(([key, label]) => (
					<button key={key} role="tab" aria-selected={section === key} className={section === key ? 'lw-active' : ''} onClick={() => setSection(key)}>{label}</button>
				))}
			</div>

			{section === 'properties' && (
				<div className="lw-view">
					<table className="lw-table lw-form-table">
						<thead><tr><th>#</th><th>{m.name}</th><th>{m.type}</th><th>{m.length}</th><th>{m.required}</th><th>PK</th><th>{m.auto}</th><th>{m.defaultValue}</th><th>{m.references}</th><th>{m.expressions}</th></tr></thead>
						<tbody>
							{(entity.properties ?? []).map((p, i) => (
								<tr key={p.name} className={expressionsShown === p.name ? 'lw-active' : undefined}>
									<td className="lw-muted">{i + 1}</td>
									<td className={keys.has(p.name) ? 'lw-pk' : ''}>{p.name}</td>
									<td>{p.enum ? `${p.enum} (enum)` : p.type ?? 'string'}</td>
									<td>{p.length ?? ''}</td>
									<td><Check on={p.required} /></td>
									<td><Check on={keys.has(p.name)} />{unique.has(p.name) ? ' U' : ''}</td>
									<td><Check on={p.autoIncrement} /></td>
									<td><code>{p.default ?? ''}</code></td>
									<td>{references.has(p.name) && link(references.get(p.name)!.split('.')[0])}{references.has(p.name) && <span className="lw-muted">.{references.get(p.name)!.split('.').slice(1).join('.')}</span>}</td>
									<td>{(expressionsOf(p).length > 0 || constraintsOf(entity, p.name).length > 0) && (
										<button type="button" className="lw-link lw-expression-toggle" aria-pressed={expressionsShown === p.name}
											title={[...expressionsOf(p), ...(constraintsOf(entity, p.name).length ? [`${m.constraints} (${constraintsOf(entity, p.name).length})`] : [])].join(', ')}
											onClick={() => setExpressionsShown(expressionsShown === p.name ? undefined : p.name)}>ƒ {m.expression}</button>
									)}</td>
								</tr>
							))}
						</tbody>
					</table>
					{shown && (
						<section className="lw-expression-detail" aria-label={format(m.expressionsOf, { name: shown.name })}>
							<h4>{format(m.expressionsOf, { name: shown.name })}</h4>
							{expressionsOf(shown).map(k => (
								<div key={k} className="lw-expression-item">
									<p className="lw-expression-label"><code>{k}</code>: {m[EXPRESSION_HELP[k]]}</p>
									<ExpressionView expression={shown[k]!} variables={names} />
								</div>
							))}
							{constraintsOf(entity, shown.name).length > 0 && (
								<div className="lw-validations">
									<p className="lw-expression-label"><code>constraints</code>: {m.validationsHint}</p>
									{constraintsOf(entity, shown.name).map((c, i) => (
										<div key={i} className="lw-expression-item">
											<p className="lw-constraint-message">{c.message}</p>
											<ExpressionView expression={c.condition} variables={names} />
										</div>
									))}
								</div>
							)}
						</section>
					)}
				</div>
			)}

			{section === 'relations' && (
				<div className="lw-view">
					<h4>{m.relations}</h4>
					{(entity.relations ?? []).length === 0 ? <p className="lw-muted">{m.none}</p> : (
						<table className="lw-table lw-form-table">
							<thead><tr><th>{m.name}</th><th>{m.type}</th><th>{m.entity}</th><th>{m.from}</th><th>{m.to}</th><th>{m.cardinality}</th><th>{m.weak}</th></tr></thead>
							<tbody>
								{(entity.relations ?? []).map(r => (
									<tr key={r.name}><td>{r.name}</td><td>{r.type}</td><td>{link(r.entity)}</td><td>{r.from}</td><td>{r.to}</td><td>{cardinalityOf(r)}</td><td><Check on={r.weak} /></td></tr>
								))}
							</tbody>
						</table>
					)}
					<h4>{m.referencedBy}</h4>
					{referencedBy.length === 0 ? <p className="lw-muted">{m.none}</p> : (
						<table className="lw-table lw-form-table">
							<thead><tr><th>{m.entity}</th><th>{m.name}</th><th>{m.type}</th><th>{m.from}</th><th>{m.to}</th><th>{m.cardinality}</th></tr></thead>
							<tbody>
								{referencedBy.map(({ entity: other, relation: r }) => (
									<tr key={`${other}.${r.name}`}><td>{link(other)}</td><td>{r.name}</td><td>{r.type}</td><td>{r.from}</td><td>{r.to}</td><td>{cardinalityOf(r)}</td></tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			)}

			{section === 'keys' && (
				<div className="lw-view">
					<h4>{m.primaryKey}</h4>
					<p>{entity.primaryKey?.length ? <code>{entity.primaryKey.join(', ')}</code> : <span className="lw-muted">{m.none}</span>}</p>
					<h4>{m.uniqueKey}</h4>
					<p>{entity.uniqueKey?.length ? <code>{entity.uniqueKey.join(', ')}</code> : <span className="lw-muted">{m.none}</span>}</p>
					<h4>{m.indexes}</h4>
					{entity.indexes?.length ? (
						<table className="lw-table lw-form-table"><thead><tr><th>{m.name}</th><th>{m.fields}</th></tr></thead>
							<tbody>{entity.indexes.map(i => <tr key={i.name}><td>{i.name}</td><td><code>{i.fields.join(', ')}</code></td></tr>)}</tbody></table>
					) : <p className="lw-muted">{m.none}</p>}
				</div>
			)}

			{section === 'constraints' && (
				<div className="lw-view">
					<p className="lw-muted">{m.validationsHint}</p>
					{entity.constraints?.length ? (
						<table className="lw-table lw-form-table" aria-label={m.constraints}>
							<thead><tr><th>#</th><th>{m.message}</th><th>{m.condition}</th><th>{m.usesProperties}</th></tr></thead>
							<tbody>
								{entity.constraints.map((c, i) => (
									<tr key={i}>
										<td className="lw-muted">{i + 1}</td>
										<td>{c.message}</td>
										<td className="lw-condition"><ExpressionView expression={c.condition} variables={names} /></td>
										<td>{propertiesIn(c.condition, names).map(n => <code key={n} className="lw-uses">{n}</code>)}</td>
									</tr>
								))}
							</tbody>
						</table>
					) : <p className="lw-muted">{m.none}</p>}
				</div>
			)}

			{section === 'data' && (
				<>
					<div className="lw-header">
						<button onClick={() => setPage(page - 1)} disabled={page === 1}>◀ {m.previous}</button>
						<span>{format(m.page, { n: page })}</span>
						<button onClick={() => setPage(page + 1)} disabled={!result?.ok || rows < pageSize}>{m.next} ▶</button>
						<span className="lw-muted">{m.readOnlyData}</span>
					</div>
					{result ? <ResultViewer key={page} result={result} locale={locale} theme={theme} culture={culture} maxRows={pageSize} fileName={`${name}-page-${page}`} initialView="table" /> : <span className="lw-muted">{m.loading}</span>}
				</>
			)}

			{section === 'diagram' && (
				<DomainDiagram api={api} schema={schema} focus={entity.name} theme={theme} locale={locale} onOpenEntity={onOpenEntity} onQueryText={onQueryText} height="60vh" exportName={`${entity.name}-diagram`} />
			)}
		</div>
	)
}
