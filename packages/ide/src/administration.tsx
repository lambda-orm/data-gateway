import React, { useCallback, useEffect, useState } from 'react'
import { Check, Minus } from 'lucide-react'
import { ManagementClient } from './management'
import { usePrefs } from './shared'

// ─── what the gateway says ──────────────────────────────────────────────────

/** A role as the administration lists it (docs/ROLE_SCOPES.md §5): of the configuration, or kept in the state */
export interface ListedRole {
	name: string
	/** of a role kept for one schema by 4.4: it doesn't apply (ignored), it is listed to remove it */
	schema?: string
	ignored?: boolean
	source: 'yaml' | 'state'
	config: RoleBody & { view?: string, scope?: string }
	locked?: boolean
	updatedAt?: string
	updatedBy?: string
}

/** A role in one schema: the views and stages it may use there, and the ones of who doesn't choose */
interface SchemaEntry { views?: string[], stages?: string[], view?: string, stage?: string }
interface RoleBody { permissions?: string[], schemas?: Record<string, SchemaEntry>, views?: string[], stages?: string[], maxRows?: number, approval?: string }

/** what a level adds to the entry of a schema: more views and stages; its defaults when it says them (as the gateway) */
const extendEntry = (base: SchemaEntry | undefined, more: SchemaEntry | undefined): SchemaEntry => {
	const union = (a?: string[], b?: string[]) => a || b ? [...new Set([...(a ?? []), ...(b ?? [])])] : undefined
	const views = union(base?.views, more?.views)
	const stages = union(base?.stages, more?.stages)
	const view = more?.view ?? base?.view
	const stage = more?.stage ?? base?.stage
	return { ...(views ? { views } : {}), ...(stages ? { stages } : {}), ...(view ? { view } : {}), ...(stage ? { stage } : {}) }
}

/** A role as it applies: its configuration and its state together (the state adds, unless the role is locked) */
const roleAsApplies = (yaml: RoleBody | undefined, stored: RoleBody | undefined): RoleBody => {
	const union = (a?: string[], b?: string[]) => a || b ? [...new Set([...(a ?? []), ...(b ?? [])])] : undefined
	const schemas = !yaml ? stored?.schemas : !yaml.schemas ? undefined : !stored?.schemas ? yaml.schemas
		: Object.fromEntries([...new Set([...Object.keys(yaml.schemas), ...Object.keys(stored.schemas)])].map(path => [path, extendEntry(yaml.schemas![path], stored.schemas![path])]))
	const permissions = union(yaml?.permissions, stored?.permissions)
	const views = union(yaml?.views, stored?.views)
	const stages = union(yaml?.stages, stored?.stages)
	const maxRows = stored?.maxRows ?? yaml?.maxRows
	const approval = stored?.approval ?? yaml?.approval
	return { ...(permissions ? { permissions } : {}), ...(schemas ? { schemas } : {}), ...(views ? { views } : {}), ...(stages ? { stages } : {}), ...(maxRows !== undefined ? { maxRows } : {}), ...(approval ? { approval } : {}) }
}

/** A local credential as the administration shows it: who it is and its roles, never its secret */
interface DescribedCredential { name: string, username?: string, roles: string[], context?: Record<string, string | number | boolean> }

/** An authentication of the configuration (GET /admin/access): what it takes, never a secret */
interface DescribedAuthentication {
	where?: { level: 'global' } | { level: 'transport', transport: string } | { level: 'schema', schema: string }
	adapter: 'none' | 'local' | 'jwt' | 'methods'
	type?: 'apikey' | 'bearer' | 'basic'
	header?: string
	credentials?: DescribedCredential[]
	jwt?: { issuer: string, audience: string[], name: string, roles?: string, context: Record<string, string> }
	methods?: DescribedAuthentication[]
}

export interface Access { permissions: string[], authentications: DescribedAuthentication[] }

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '')
const contextText = (context?: Record<string, unknown>) => Object.entries(context ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(', ')
const listOf = (text: string): string[] | undefined => {
	const items = text.split(',').map(s => s.trim()).filter(Boolean)
	return items.length ? [...new Set(items)] : undefined
}
const textOf = (items?: string[]) => (items ?? []).join(', ')
const failed = async (response: Response) => (await response.json().catch(() => undefined))?.message ?? `HTTP ${response.status}`

/** Reads a resource of the administration (again when asked): its value, or why it couldn't */
const useAdmin = <T, >(client: ManagementClient, path: string, refresh = 0): { value?: T, error?: string, reload: () => void } => {
	const [value, setValue] = useState<T>()
	const [error, setError] = useState<string>()
	const [n, setN] = useState(0)
	useEffect(() => {
		let alive = true
		client.fetch(`${client.base}${path}`)
			.then(async r => { if (!r.ok) throw new Error(await failed(r)); return r.json() })
			.then(v => { if (alive) { setValue(v); setError(undefined) } }, e => { if (alive) setError(e?.message ?? String(e)) })
		return () => { alive = false }
	}, [client, path, refresh, n])
	return { value, error, reload: useCallback(() => setN(x => x + 1), []) }
}

/** A role as it applies: its configuration and its state together (the state adds, unless the role is locked) */
const effective = (roles: ListedRole[]): { name: string, permissions: Set<string>, schemas?: string[], source: 'yaml' | 'state', locked: boolean }[] => {
	const byName = new Map<string, { name: string, permissions: Set<string>, schemas?: string[], everywhere: boolean, locked: boolean, source: 'yaml' | 'state' }>()
	for (const role of roles.filter(r => !r.ignored)) {
		const current = byName.get(role.name)
		const schemas = role.config.schemas ? Object.keys(role.config.schemas) : undefined
		if (!current) {
			byName.set(role.name, { name: role.name, permissions: new Set(role.config.permissions ?? []), schemas, everywhere: !schemas, locked: !!role.locked, source: role.source })
			continue
		}
		if (current.locked) continue
		for (const p of role.config.permissions ?? []) current.permissions.add(p)
		// an extension adds schemas to a role that names some; one that applies everywhere keeps applying everywhere
		if (!current.everywhere && schemas) current.schemas = [...new Set([...(current.schemas ?? []), ...schemas])]
	}
	return [...byName.values()].map(r => ({ name: r.name, permissions: r.permissions, ...(r.schemas ? { schemas: r.schemas } : {}), source: r.source, locked: r.locked }))
}

/** The names of the roles of a gateway, for its tree: each once, in their order */
export const roleNamesOf = (roles: ListedRole[]): string[] => [...new Set(roles.filter(r => !r.ignored).map(r => r.name))]

// ─── Roles ──────────────────────────────────────────────────────────────────

/**
 * Roles: every role of the gateway (its configuration and its state), what each may do (a role by row, a permission
 * by column) and in which schemas; a click on one opens it, Add role a new one.
 */
export const RolesPage: React.FC<{ client: ManagementClient, refresh: number, onOpenRole: (name: string) => void, onAddRole: () => void, onChanged: () => void }> = ({ client, refresh, onOpenRole, onAddRole, onChanged }) => {
	const { t, culture } = usePrefs()
	const roles = useAdmin<ListedRole[]>(client, '/admin/roles', refresh)
	const access = useAdmin<Access>(client, '/admin/access', refresh)
	const changes = useAdmin<{ id: string, key: string, by: string, at: string, reason?: string, after?: unknown }[]>(client, '/admin/roles/changes?limit=20', refresh)
	const when = (iso: string) => new Date(iso).toLocaleString(culture, { dateStyle: 'short', timeStyle: 'short' })
	const rows = effective(roles.value ?? [])
	const permissions = access.value?.permissions ?? [...new Set(rows.flatMap(r => [...r.permissions]))]
	const ignored = (roles.value ?? []).filter(r => r.ignored)
	const removeIgnored = async (role: ListedRole) => {
		const response = await client.fetch(`${client.base}/admin/roles/${encodeURIComponent(role.name)}?schema=${encodeURIComponent(role.schema || '~')}`, { method: 'DELETE' })
		if (response.ok) { roles.reload(); onChanged() }
	}
	return (
		<div className="dg-pane">
			<h2>{t.roles}</h2>
			<p className="dg-muted">{t.gatewayRolesNote}</p>
			{(roles.error ?? access.error) && <div className="dg-error" role="alert">{roles.error ?? access.error}</div>}
			<section className="dg-card">
				<div className="dg-card-head"><h3>{t.rolePermissionsTitle}</h3><span className="dg-spacer" /><button type="button" className="dg-primary" onClick={onAddRole}>{t.addRole}</button></div>
				<p className="dg-muted">{t.rolePermissionsNote}</p>
				<div className="dg-table-scroll"><table className="dg-table dg-matrix">
					<thead>
						<tr><th>{t.roleName}</th><th>{t.roleSchemas}</th>{permissions.map(p => <th key={p}><code>{p}</code></th>)}</tr>
					</thead>
					<tbody>
						{rows.map(r => (
							<tr key={r.name} aria-label={r.name}>
								<td><button type="button" className="dg-link" onClick={() => onOpenRole(r.name)}><strong>{r.name}</strong></button>{r.locked && <span className="dg-chip">{t.roleLocked}</span>}</td>
								<td>{r.schemas?.join(', ') ?? <span className="dg-muted">{t.roleEverySchema}</span>}</td>
								{permissions.map(p => (
									<td key={p} className={r.permissions.has(p) ? 'dg-granted' : 'dg-denied'} aria-label={`${r.name} ${p}`}>
										{r.permissions.has(p) ? <Check size={16} aria-label={p} /> : <Minus size={16} aria-hidden="true" />}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table></div>
			</section>
			{ignored.length > 0 && (
				<section className="dg-card">
					<h3>{t.roleIgnored}</h3>
					<ul className="dg-list">
						{ignored.map(r => <li key={`${r.name}@${r.schema}`}><code>{r.name}</code> · {r.schema || '/'} <button type="button" className="dg-danger" onClick={() => removeIgnored(r)}>{t.removeRole}</button></li>)}
					</ul>
				</section>
			)}
			{(changes.value?.length ?? 0) > 0 && (
				<details className="dg-card">
					<summary>{t.roleChanges}</summary>
					<ul className="dg-list">
						{changes.value!.map(c => <li key={c.id}><code>{c.key}</code> · {c.by} · {when(c.at)}{c.reason ? ` · ${c.reason}` : ''}{c.after === undefined ? ` · ${t.removeRole}` : ''}</li>)}
					</ul>
				</details>
			)}
		</div>
	)
}

/** What a schema has, for a role to be given in it (GET /admin/scopes) */
interface SchemaScopes { path: string, views: string[], stages: string[] }

interface SchemaDraft { on: boolean, views: Set<string>, stages: Set<string>, view: string, stage: string }
interface RoleDraft {
	name: string
	permissions: Set<string>
	/** every schema (no schemas), or these */
	everywhere: boolean
	schemas: Record<string, SchemaDraft>
	/** every schema: its views and stages (by name, they may differ from one schema to another) */
	views: string
	stages: string
	maxRows: string
	approval: boolean
	reason: string
}

/** A list with its default first and marked */
const Defaulted: React.FC<{ items?: string[], chosen?: string, none: string, title: string }> = ({ items, chosen, none, title }) => {
	const list = chosen ? [chosen, ...(items ?? []).filter(x => x !== chosen)] : items ?? []
	return list.length
		? <>{list.map((x, i) => <span key={x} className={i === 0 ? 'dg-chip dg-chip-default' : 'dg-chip'} title={i === 0 ? title : undefined}>{x}</span>)}</>
		: <span className="dg-muted">{none}</span>
}

/**
 * A role: all it gives (its permissions, the schemas where it applies with their views and stages and the defaults,
 * its limits), with Edit and Remove. Edit changes what is kept in the state of the gateway: one of the configuration is
 * extended (what the configuration gives stays, marked); a new one when name is none starts editing.
 */
export const RolePage: React.FC<{ client: ManagementClient, name?: string, refresh: number, onSaved: (name: string) => void, onRemoved: () => void }> = ({ client, name, refresh, onSaved, onRemoved }) => {
	const { t, culture } = usePrefs()
	const roles = useAdmin<ListedRole[]>(client, '/admin/roles', refresh)
	const access = useAdmin<Access>(client, '/admin/access', refresh)
	const scopes = useAdmin<SchemaScopes[]>(client, '/admin/scopes', refresh)
	const yaml = roles.value?.find(r => r.name === name && r.source === 'yaml')
	const stored = roles.value?.find(r => r.name === name && r.source === 'state' && !r.ignored)
	const role = roleAsApplies(yaml?.config, yaml?.locked ? undefined : stored?.config)
	const [draft, setDraft] = useState<RoleDraft>()
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const [removing, setRemoving] = useState(false)
	const when = (iso: string) => new Date(iso).toLocaleString(culture, { dateStyle: 'short', timeStyle: 'short' })
	const permissions = access.value?.permissions ?? []
	const given = (key: 'permissions', x: string) => !!yaml?.config[key]?.includes(x)
	const givenIn = (path: string, key: 'views' | 'stages', x: string) => !!yaml?.config.schemas?.[path]?.[key]?.includes(x)
	const editing = draft !== undefined
	const startEditing = () => {
		const c: RoleBody = stored?.config ?? {}
		const paths = [...new Set([...(scopes.value ?? []).map(s => s.path), ...Object.keys(role.schemas ?? {})])]
		setDraft({
			name: name ?? '',
			permissions: new Set(c.permissions ?? []),
			everywhere: !role.schemas,
			schemas: Object.fromEntries(paths.map(path => {
				const e = role.schemas?.[path]
				return [path, { on: !!e, views: new Set(e?.views ?? []), stages: new Set(e?.stages ?? []), view: e?.view ?? '', stage: e?.stage ?? '' }]
			})),
			views: textOf(c.views), stages: textOf(c.stages), maxRows: c.maxRows ? String(c.maxRows) : '', approval: c.approval === 'writes', reason: ''
		})
		setError(undefined)
	}
	// a new role: editing at once
	useEffect(() => { if (!name && roles.value && scopes.value && !draft) startEditing() }, [name, roles.value, scopes.value])
	const save = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!draft?.name.trim()) return
		setBusy(true)
		try {
			// what the state keeps: what is added to the configuration (the configuration's stays as it is)
			const schemas = draft.everywhere ? undefined : Object.fromEntries(Object.entries(draft.schemas).filter(([, d]) => d.on).map(([path, d]) => {
				const views = [...d.views].filter(v => !givenIn(path, 'views', v))
				const stages = [...d.stages].filter(v => !givenIn(path, 'stages', v))
				return [path, { ...(views.length ? { views } : {}), ...(stages.length ? { stages } : {}), ...(d.view ? { view: d.view } : {}), ...(d.stage ? { stage: d.stage } : {}) }]
			}))
			const added = [...draft.permissions].filter(p => !given('permissions', p))
			const config: RoleBody = {
				...(added.length ? { permissions: added } : {}),
				...(schemas && Object.keys(schemas).length ? { schemas } : {}),
				...(draft.everywhere && listOf(draft.views) ? { views: listOf(draft.views) } : {}),
				...(draft.everywhere && listOf(draft.stages) ? { stages: listOf(draft.stages) } : {}),
				...(draft.maxRows.trim() ? { maxRows: Number(draft.maxRows) } : {}),
				...(draft.approval ? { approval: 'writes' } : {})
			}
			const response = await client.fetch(`${client.base}/admin/roles/${encodeURIComponent(draft.name.trim())}`, {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ config, ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}) })
			})
			if (!response.ok) { setError(await failed(response)); return }
			setError(undefined)
			setDraft(undefined)
			onSaved(draft.name.trim())
		} finally { setBusy(false) }
	}
	const remove = async () => {
		setBusy(true)
		try {
			const response = await client.fetch(`${client.base}/admin/roles/${encodeURIComponent(name!)}`, { method: 'DELETE' })
			if (!response.ok) { setError(await failed(response)); return }
			onRemoved()
		} finally { setBusy(false); setRemoving(false) }
	}
	if (name && roles.value && !yaml && !stored) return <div className="dg-pane"><h2>{t.roleName}: {name}</h2><p className="dg-muted">{t.roleGone}</p></div>
	const problem = roles.error ?? access.error ?? error
	const setSchema = (path: string, patch: Partial<SchemaDraft>) => setDraft({ ...draft!, schemas: { ...draft!.schemas, [path]: { ...draft!.schemas[path], ...patch } } })
	const toggle = (set: Set<string>, x: string, on: boolean) => { const next = new Set(set); if (on) next.add(x); else next.delete(x); return next }

	// ─── what it gives ───
	const details = (
		<>
			<section className="dg-card">
				<h3>{t.permissions}</h3>
				<ul className="dg-permission-grid">
					{permissions.map(p => (
						<li key={p} className={role.permissions?.includes(p) ? 'dg-granted' : 'dg-denied'}>
							{role.permissions?.includes(p) ? <Check size={14} aria-label={p} /> : <Minus size={14} aria-hidden="true" />} <code>{p}</code>
						</li>
					))}
				</ul>
			</section>
			<section className="dg-card">
				<h3>{t.roleSchemas}</h3>
				{role.schemas
					? (
						<div className="dg-table-scroll"><table className="dg-table">
							<thead><tr><th>{t.roleSchemas}</th><th>{t.roleViews}</th><th>{t.roleStages}</th></tr></thead>
							<tbody>
								{Object.entries(role.schemas).map(([path, e]) => (
									<tr key={path} aria-label={path}>
										<td><strong>{path || '/'}</strong></td>
										<td><Defaulted items={e.views ?? role.views} chosen={e.view} none={t.roleOfSchema} title={t.meDefault} /></td>
										<td><Defaulted items={e.stages ?? role.stages} chosen={e.stage} none={t.roleOfSchema} title={t.meDefault} /></td>
									</tr>
								))}
							</tbody>
						</table></div>
						)
					: (
						<dl className="dg-facts">
							<dt>{t.roleSchemas}</dt><dd><span className="dg-muted">{t.roleEverySchema}</span></dd>
							<dt>{t.roleViews}</dt><dd><Defaulted items={role.views} none={t.roleOfSchema} title={t.meDefault} /></dd>
							<dt>{t.roleStages}</dt><dd><Defaulted items={role.stages} none={t.roleOfSchema} title={t.meDefault} /></dd>
						</dl>
						)}
			</section>
			<section className="dg-card">
				<dl className="dg-facts">
					<dt>{t.roleMaxRows}</dt><dd>{role.maxRows ?? '—'}</dd>
					<dt>{t.roleApproval}</dt><dd>{role.approval === 'writes' ? '✓' : '—'}</dd>
					<dt>{t.roleSource}</dt>
					<dd>{[yaml ? t.roleFromConfig : undefined, stored?.updatedBy ? fill(t.obsChangedBy, { name: stored.updatedBy, time: when(stored.updatedAt!) }) : undefined].filter(Boolean).join(' · ')}</dd>
				</dl>
				{yaml && !yaml.locked && <p className="dg-muted">{t.roleFromConfigNote}</p>}
				{yaml?.locked && <p className="dg-muted">{t.roleLockedNote}</p>}
			</section>
		</>
	)

	// ─── editing ───
	const form = draft && (
		<form className="dg-form dg-role-form" onSubmit={save} aria-label={t.saveRole}>
			{!name && <label>{t.roleName}<input aria-label={t.roleName} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} spellCheck={false} autoFocus /></label>}
			<fieldset className="dg-permission-boxes">
				<legend>{t.permissions}</legend>
				{permissions.map(p => (
					<label key={p} className="dg-check" title={given('permissions', p) ? t.roleFromConfig : undefined}>
						<input type="checkbox" checked={given('permissions', p) || draft.permissions.has(p)} disabled={given('permissions', p)}
							onChange={e => setDraft({ ...draft, permissions: toggle(draft.permissions, p, e.target.checked) })} />
						<code>{p}</code>
					</label>
				))}
			</fieldset>
			<fieldset className="dg-schema-boxes">
				<legend>{t.roleSchemas}</legend>
				<label className="dg-check">
					<input type="radio" name="where" checked={draft.everywhere} disabled={!!yaml?.config.schemas} onChange={() => setDraft({ ...draft, everywhere: true })} /> {t.roleEverySchema}
				</label>
				<label className="dg-check">
					<input type="radio" name="where" checked={!draft.everywhere} disabled={!!yaml && !yaml.config.schemas} onChange={() => setDraft({ ...draft, everywhere: false })} /> {t.roleTheseSchemas}
				</label>
				{draft.everywhere && (
					<>
						<label>{t.roleViews}<input aria-label={t.roleViews} value={draft.views} onChange={e => setDraft({ ...draft, views: e.target.value })} spellCheck={false} /><span className="dg-muted">{t.roleListHint}; {t.roleFirstDefault}</span></label>
						<label>{t.roleStages}<input aria-label={t.roleStages} value={draft.stages} onChange={e => setDraft({ ...draft, stages: e.target.value })} spellCheck={false} /><span className="dg-muted">{t.roleListHint}; {t.roleFirstDefault}</span></label>
					</>
				)}
				{!draft.everywhere && Object.entries(draft.schemas).map(([path, d]) => {
					const scope = scopes.value?.find(s => s.path === path)
					const fromConfig = !!yaml?.config.schemas?.[path]
					const views = [...new Set([...(scope?.views ?? []), ...d.views])]
					const stages = [...new Set([...(scope?.stages ?? []), ...d.stages])]
					const chosenViews = views.filter(v => d.views.has(v) || givenIn(path, 'views', v))
					const chosenStages = stages.filter(v => d.stages.has(v) || givenIn(path, 'stages', v))
					return (
						<div key={path} className="dg-schema-scope" aria-label={path}>
							<label className="dg-check">
								<input type="checkbox" checked={d.on || fromConfig} disabled={fromConfig} onChange={e => setSchema(path, { on: e.target.checked })} />
								<strong>{path || '/'}</strong>
							</label>
							{(d.on || fromConfig) && (
								<div className="dg-schema-scope-body">
									<div>
										<span className="dg-muted">{t.roleViews}</span>
										{views.map(v => (
											<label key={v} className="dg-check">
												<input type="checkbox" checked={d.views.has(v) || givenIn(path, 'views', v)} disabled={givenIn(path, 'views', v)} onChange={e => setSchema(path, { views: toggle(d.views, v, e.target.checked) })} /> {v}
											</label>
										))}
										<label>{t.roleDefaultView}
											<select aria-label={`${path} ${t.roleDefaultView}`} value={d.view} onChange={e => setSchema(path, { view: e.target.value })}>
												<option value="">{chosenViews.length ? `— (${chosenViews[0]})` : `— (${t.roleOfSchema})`}</option>
												{chosenViews.map(v => <option key={v} value={v}>{v}</option>)}
											</select>
										</label>
										{!chosenViews.length && <span className="dg-muted">{t.roleNoneOfSchema}</span>}
									</div>
									<div>
										<span className="dg-muted">{t.roleStages}</span>
										{stages.map(v => (
											<label key={v} className="dg-check">
												<input type="checkbox" checked={d.stages.has(v) || givenIn(path, 'stages', v)} disabled={givenIn(path, 'stages', v)} onChange={e => setSchema(path, { stages: toggle(d.stages, v, e.target.checked) })} /> {v}
											</label>
										))}
										<label>{t.roleDefaultStage}
											<select aria-label={`${path} ${t.roleDefaultStage}`} value={d.stage} onChange={e => setSchema(path, { stage: e.target.value })}>
												<option value="">{chosenStages.length ? `— (${chosenStages[0]})` : `— (${t.roleOfSchema})`}</option>
												{chosenStages.map(v => <option key={v} value={v}>{v}</option>)}
											</select>
										</label>
										{!chosenStages.length && <span className="dg-muted">{t.roleNoneOfSchema}</span>}
									</div>
								</div>
							)}
						</div>
					)
				})}
			</fieldset>
			<label>{t.roleMaxRows}<input aria-label={t.roleMaxRows} value={draft.maxRows} onChange={e => setDraft({ ...draft, maxRows: e.target.value })} /></label>
			<label className="dg-check"><input type="checkbox" checked={draft.approval} onChange={e => setDraft({ ...draft, approval: e.target.checked })} /> {t.roleApproval}</label>
			<label>{t.roleReason}<input aria-label={t.roleReason} value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} /></label>
			<span className="dg-form-actions">
				<span className="dg-spacer" />
				{name && <button type="button" onClick={() => { setDraft(undefined); setError(undefined) }}>{t.cancel}</button>}
				<button type="submit" className="dg-primary" disabled={busy || !draft.name.trim()}>{t.saveRole}</button>
			</span>
		</form>
	)

	return (
		<div className="dg-pane">
			<div className="dg-card-head">
				<h2>{name ? `${t.roleName}: ${name}` : t.newRole}{yaml?.locked && <span className="dg-badge">{t.roleLocked}</span>}</h2>
				<span className="dg-spacer" />
				{name && !editing && (
					<span className="dg-form-actions">
						{!yaml?.locked && <button type="button" className="dg-primary" disabled={!roles.value || !scopes.value} onClick={startEditing}>{t.editRole}</button>}
						{stored && (removing
							? <><span className="dg-muted">{yaml ? t.roleRemoveExtension : t.confirmRemove}</span><button type="button" onClick={() => setRemoving(false)}>{t.cancel}</button><button type="button" className="dg-danger" disabled={busy} onClick={remove}>{t.removeRole}</button></>
							: <button type="button" className="dg-danger" onClick={() => setRemoving(true)}>{t.removeRole}</button>)}
						{!stored && yaml && <button type="button" className="dg-danger" disabled title={t.roleFromConfigNote}>{t.removeRole}</button>}
					</span>
				)}
			</div>
			{problem && <div className="dg-error" role="alert">{problem}</div>}
			{editing ? form : roles.value && details}
		</div>
	)
}

// ─── Access ─────────────────────────────────────────────────────────────────

/** The methods of an authentication, one by one (methods: several, in order) */
const methodsOf = (a: DescribedAuthentication): DescribedAuthentication[] => a.adapter === 'methods' ? a.methods ?? [] : [a]

/** Who may come in, by level (global, a transport, a schema): each key with its roles and context; a jwt, its claims */
export const AccessPage: React.FC<{ client: ManagementClient, onOpenRole: (name: string) => void }> = ({ client, onOpenRole }) => {
	const { t } = usePrefs()
	const access = useAdmin<Access>(client, '/admin/access')
	const whereOf = (a: DescribedAuthentication) => !a.where || a.where.level === 'global'
		? t.accessGlobal
		: a.where.level === 'transport' ? fill(t.accessTransport, { name: a.where.transport }) : fill(t.accessSchema, { name: a.where.schema || '/' })
	const methodName = (m: DescribedAuthentication) => m.adapter === 'jwt' ? 'JWT' : m.adapter === 'none' ? t.none : m.type === 'apikey' ? `${t.apikey}${m.header ? ` (${m.header})` : ''}` : m.type === 'bearer' ? t.bearer : t.basic
	const rows = (access.value?.authentications ?? []).flatMap(a => methodsOf(a).flatMap((m, i) => {
		const where = whereOf(a)
		const key = `${where}:${i}`
		if (m.adapter === 'none') return [<tr key={key}><td>{where}</td><td>{methodName(m)}</td><td colSpan={3} className="dg-muted">{t.accessNone}</td></tr>]
		if (m.adapter === 'jwt' && m.jwt) {
			return [<tr key={key}><td>{where}</td><td>{methodName(m)}</td><td className="dg-muted">{fill(t.accessJwt, { issuer: m.jwt.issuer, claim: m.jwt.roles ?? '—' })}</td><td /><td>{contextText(m.jwt.context)}</td></tr>]
		}
		return (m.credentials ?? []).map(c => (
			<tr key={`${key}:${c.name}`} aria-label={c.name}>
				<td>{where}</td>
				<td>{methodName(m)}</td>
				<td><strong>{c.name}</strong>{c.username && c.username !== c.name ? <span className="dg-muted"> ({c.username})</span> : null}</td>
				<td>{c.roles.map(r => <button key={r} type="button" className="dg-chip dg-link" onClick={() => onOpenRole(r)}>{r}</button>)}</td>
				<td>{contextText(c.context)}</td>
			</tr>
		))
	}))
	return (
		<div className="dg-pane">
			<h2>{t.accessTitle}</h2>
			<p className="dg-muted">{t.accessNote}</p>
			{access.error && <div className="dg-error" role="alert">{access.error}</div>}
			<section className="dg-card">
				<div className="dg-table-scroll"><table className="dg-table">
					<thead><tr><th>{t.accessWhere}</th><th>{t.accessMethod}</th><th>{t.accessCredential}</th><th>{t.roles}</th><th>{t.accessContext}</th></tr></thead>
					<tbody>{rows}</tbody>
				</table></div>
			</section>
		</div>
	)
}

// ─── Observability ──────────────────────────────────────────────────────────

type Raw = Record<string, any>

/** The observability of a gateway as the administration shows it (GET /admin/observability) */
interface ObservabilityView { yaml?: Raw, override?: Raw, effective?: Raw, updatedAt?: string, updatedBy?: string, prometheus: boolean }

export type Signal = 'metrics' | 'logs' | 'traces'

/** Where a person sees a signal in Grafana: its Explore with its datasource */
const exploreUrl = (explore: Raw | undefined, signal: Signal): string | undefined => {
	if (!explore?.grafana) return undefined
	const uid = signal === 'traces' ? explore.tempo ?? 'tempo' : signal === 'metrics' ? explore.prometheus ?? 'prometheus' : explore.loki ?? 'loki'
	const queries = signal === 'traces'
		? [{ refId: 'A', datasource: { type: 'tempo', uid }, queryType: 'traceql', query: '{ resource.service.name = "data-gateway" }' }]
		: signal === 'metrics'
			? [{ refId: 'A', datasource: { type: 'prometheus', uid }, expr: 'sum by (http_route) (rate(http_server_request_duration_seconds_count[5m]))' }]
			: [{ refId: 'A', datasource: { type: 'loki', uid }, expr: '{service_name="data-gateway"}' }]
	const panes = { dg: { datasource: uid, queries, range: { from: 'now-1h', to: 'now' } } }
	return `${explore.grafana}/explore?schemaVersion=1&orgId=${explore.orgId ?? 1}&panes=${encodeURIComponent(JSON.stringify(panes))}`
}

interface ObservabilityDraft {
	exporterEndpoint: string
	exporterProtocol: string
	enabled: boolean
	// metrics
	exportIntervalMs: string
	entityAttribute: boolean
	// logs
	level: string
	otelLogs: boolean
	consoleLogs: boolean
	// traces
	ratio: string
	parentBased: boolean
	queryText: string
	// explore
	grafana: string
	datasource: string
	orgId: string
}

const draftOf = (view: ObservabilityView, signal: Signal): ObservabilityDraft => {
	const e = view.effective ?? {}
	const section: Raw = e[signal] ?? {}
	const adapters: Raw[] = e.logs?.adapters ?? []
	const otlp = (section.exporters as Raw[] | undefined)?.find(x => x.type === 'opentelemetry')
	return {
		exporterEndpoint: e.exporter?.endpoint ?? '',
		exporterProtocol: e.exporter?.protocol ?? '',
		enabled: signal === 'logs' ? adapters.some(a => a.type === 'opentelemetry') : !!section.enabled,
		exportIntervalMs: otlp?.exportIntervalMs ? String(otlp.exportIntervalMs) : '',
		entityAttribute: section.entityAttribute !== false,
		level: e.logs?.level ?? '',
		otelLogs: adapters.some(a => a.type === 'opentelemetry'),
		consoleLogs: adapters.some(a => a.type === 'console'),
		ratio: section.sampler?.ratio !== undefined ? String(section.sampler.ratio) : '',
		parentBased: section.sampler?.parentBased !== false,
		queryText: section.queryText ?? '',
		grafana: e.explore?.grafana ?? '',
		datasource: e.explore?.[signal === 'traces' ? 'tempo' : signal === 'metrics' ? 'prometheus' : 'loki'] ?? '',
		orgId: e.explore?.orgId ? String(e.explore.orgId) : ''
	}
}

/** The sections a draft says of a signal, on top of what the override already has (the other signals stay as they are) */
const overrideOf = (view: ObservabilityView, signal: Signal, d: ObservabilityDraft): Raw => {
	const e = view.effective ?? {}
	const next: Raw = { ...(view.override ?? {}) }
	next.exporter = d.exporterEndpoint.trim()
		? { ...(e.exporter ?? {}), type: 'otlp', endpoint: d.exporterEndpoint.trim(), ...(d.exporterProtocol ? { protocol: d.exporterProtocol } : {}) }
		: null
	if (!d.exporterProtocol && next.exporter) delete next.exporter.protocol
	if (signal === 'metrics') {
		const others = ((e.metrics?.exporters ?? []) as Raw[]).filter(x => x.type !== 'opentelemetry')
		next.metrics = {
			...(e.metrics ?? {}),
			enabled: d.enabled,
			entityAttribute: d.entityAttribute,
			exporters: [...others, ...(d.enabled ? [{ type: 'opentelemetry', ...(d.exportIntervalMs.trim() ? { exportIntervalMs: Number(d.exportIntervalMs) } : {}) }] : [])]
		}
	} else if (signal === 'logs') {
		const others = ((e.logs?.adapters ?? []) as Raw[]).filter(a => a.type !== 'opentelemetry' && a.type !== 'console')
		next.logs = {
			...(e.logs ?? {}),
			...(d.level ? { level: d.level } : {}),
			adapters: [...others, ...(d.consoleLogs ? [{ type: 'console' }] : []), ...(d.otelLogs ? [{ type: 'opentelemetry' }] : [])]
		}
		if (!d.level) delete next.logs.level
	} else {
		next.traces = {
			...(e.traces ?? {}),
			enabled: d.enabled,
			...(d.ratio.trim() ? { sampler: { ratio: Number(d.ratio), parentBased: d.parentBased } } : {}),
			...(d.queryText ? { queryText: d.queryText } : {})
		}
		if (!d.ratio.trim()) delete next.traces.sampler
		if (!d.queryText) delete next.traces.queryText
	}
	const uidKey = signal === 'traces' ? 'tempo' : signal === 'metrics' ? 'prometheus' : 'loki'
	if (d.grafana.trim()) {
		next.explore = { ...(e.explore ?? {}), grafana: d.grafana.trim(), ...(d.datasource.trim() ? { [uidKey]: d.datasource.trim() } : {}), ...(d.orgId.trim() ? { orgId: Number(d.orgId) } : {}) }
		if (!d.datasource.trim()) delete next.explore[uidKey]
	} else next.explore = null
	return next
}

/**
 * A signal of the observability of the gateway (metrics, logs, traces): where it goes (the OTLP exporter, shared by
 * the three), what is sent, and where a person sees it (Grafana). Saved over the configuration of the gateway, which
 * applies it at once: its edge restarts, and the schemas whose telemetry changed reload.
 */
export const ObservabilityPage: React.FC<{ client: ManagementClient, signal: Signal }> = ({ client, signal }) => {
	const { t, culture } = usePrefs()
	const [refresh, setRefresh] = useState(0)
	const view = useAdmin<ObservabilityView>(client, '/admin/observability', refresh)
	const [draft, setDraft] = useState<ObservabilityDraft>()
	const [error, setError] = useState<string>()
	const [notice, setNotice] = useState<string>()
	const [busy, setBusy] = useState(false)
	useEffect(() => { if (view.value) setDraft(draftOf(view.value, signal)) }, [view.value, signal])
	const title = signal === 'metrics' ? t.obsMetrics : signal === 'logs' ? t.obsLogs : t.obsTraces
	const link = exploreUrl(view.value?.effective?.explore, signal)
	const changed = view.value?.override && Object.keys(view.value.override).length > 0
	const when = (iso: string) => new Date(iso).toLocaleString(culture, { dateStyle: 'short', timeStyle: 'short' })
	const send = async (init: RequestInit) => {
		setBusy(true)
		try {
			const response = await client.fetch(`${client.base}/admin/observability`, init)
			if (!response.ok) { setError(await failed(response)); return }
			setError(undefined)
			setNotice(t.obsApplied)
			// the edge restarts: what it answers now, a moment later
			setTimeout(() => setRefresh(n => n + 1), 3000)
		} catch (e: any) {
			setError(e?.message ?? String(e))
		} finally { setBusy(false) }
	}
	const save = (event: React.FormEvent) => {
		event.preventDefault()
		if (!draft || !view.value) return
		send({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: overrideOf(view.value, signal, draft) }) })
	}
	const set = (patch: Partial<ObservabilityDraft>) => { setDraft({ ...draft!, ...patch }); setNotice(undefined) }
	const text = (key: keyof ObservabilityDraft, label: string, placeholder?: string, hint?: string) => (
		<label>
			{label}
			<input aria-label={label} value={draft![key] as string} placeholder={placeholder} onChange={e => set({ [key]: e.target.value } as Partial<ObservabilityDraft>)} spellCheck={false} />
			{hint && <span className="dg-muted">{hint}</span>}
		</label>
	)
	const check = (key: keyof ObservabilityDraft, label: string) => (
		<label className="dg-check"><input type="checkbox" aria-label={label} checked={draft![key] as boolean} onChange={e => set({ [key]: e.target.checked } as Partial<ObservabilityDraft>)} /> {label}</label>
	)
	return (
		<div className="dg-pane">
			<h2>{t.obsTitle}: {title}</h2>
			<p className="dg-muted">{t.obsNote}</p>
			{view.error && <div className="dg-error" role="alert">{view.error}</div>}
			{error && <div className="dg-error" role="alert">{error}</div>}
			{notice && <div className="dg-ok" role="status">{notice}</div>}
			{view.value && (
				<p className="dg-muted">
					{changed && view.value.updatedBy ? fill(t.obsChangedBy, { name: view.value.updatedBy, time: when(view.value.updatedAt!) }) : t.obsFromConfig}
					{link && <> · <a href={link} target="_blank" rel="noreferrer">{t.obsOpenGrafana}</a></>}
				</p>
			)}
			{draft && (
				<form className="dg-form dg-observability-form" onSubmit={save} aria-label={title}>
					<section className="dg-card">
						<h3>{title}</h3>
						{signal === 'metrics' && (
							<>
								<p className="dg-muted">{view.value?.prometheus ? t.obsScrape : t.obsNoScrape}</p>
								{check('enabled', t.obsSendOtlp)}
								{text('exportIntervalMs', t.obsInterval, '60000')}
								{check('entityAttribute', t.obsEntityAttribute)}
							</>
						)}
						{signal === 'logs' && (
							<>
								{check('otelLogs', t.obsSendOtlp)}
								{check('consoleLogs', t.obsConsole)}
								<label>{t.obsLevel}
									<select aria-label={t.obsLevel} value={draft.level} onChange={e => set({ level: e.target.value })}>
										<option value="">—</option>
										{['debug', 'info', 'warn', 'error'].map(l => <option key={l} value={l}>{l}</option>)}
									</select>
								</label>
							</>
						)}
						{signal === 'traces' && (
							<>
								{check('enabled', t.obsSendOtlp)}
								{text('ratio', t.obsRatio, '1', t.obsRatioHint)}
								{check('parentBased', t.obsParentBased)}
								<label>{t.obsQueryText}
									<select aria-label={t.obsQueryText} value={draft.queryText} onChange={e => set({ queryText: e.target.value })}>
										<option value="">—</option>
										{['none', 'sanitized', 'full'].map(l => <option key={l} value={l}>{l}</option>)}
									</select>
								</label>
							</>
						)}
					</section>
					<section className="dg-card">
						<h3>{t.obsExporter}</h3>
						<p className="dg-muted">{t.obsExporterNote}</p>
						{text('exporterEndpoint', t.obsEndpoint, 'http://alloy:4318')}
						<label>{t.protocol}
							<select aria-label={t.protocol} value={draft.exporterProtocol} onChange={e => set({ exporterProtocol: e.target.value })}>
								<option value="">http/protobuf</option>
								<option value="http/json">http/json</option>
							</select>
						</label>
					</section>
					<section className="dg-card">
						<h3>{t.obsWhereSeen}</h3>
						{text('grafana', t.obsGrafana, 'https://grafana.example.com')}
						{text('datasource', signal === 'traces' ? t.obsTempo : signal === 'metrics' ? t.obsPrometheus : t.obsLoki, signal === 'traces' ? 'tempo' : signal === 'metrics' ? 'prometheus' : 'loki')}
						{text('orgId', t.obsOrgId, '1')}
					</section>
					<span className="dg-form-actions">
						{changed && <button type="button" disabled={busy} onClick={() => send({ method: 'DELETE' })}>{t.obsReset}</button>}
						<span className="dg-spacer" />
						<button type="submit" className="dg-primary" disabled={busy}>{t.obsSave}</button>
					</span>
				</form>
			)}
		</div>
	)
}

// ─── who I am ───────────────────────────────────────────────────────────────

interface MyRole { name: string, permissions: string[], schemas?: Record<string, SchemaEntry>, views?: string[], stages?: string[], maxRows?: number, approval?: string, unknown?: boolean }
interface Me { name: string, permissions: string[], context?: Record<string, unknown>, roles: MyRole[] }

/**
 * Who the connection is in its gateway (GET /admin/me): its user (its context), and each of its roles with its
 * permissions, its views and its stages (the first of each, the one used when nothing is chosen) and its schemas
 */
export const MeCard: React.FC<{ client: ManagementClient, fallback?: React.ReactNode }> = ({ client, fallback }) => {
	const { t } = usePrefs()
	const me = useAdmin<Me>(client, '/admin/me')
	// a gateway before 5.0 has no /admin/me: what its session says (its permissions)
	if (me.error) return <>{fallback ?? <div className="dg-error" role="alert">{me.error}</div>}</>
	if (!me.value) return null
	return (
		<section className="dg-card dg-me">
			<h3>{t.meTitle}</h3>
			<dl className="dg-facts">
				<dt>{t.meUser}</dt><dd><strong>{me.value.name}</strong></dd>
				{me.value.context && Object.keys(me.value.context).length > 0 && <><dt>{t.accessContext}</dt><dd>{contextText(me.value.context)}</dd></>}
			</dl>
			{me.value.roles.length > 0
				? (
					<div className="dg-table-scroll"><table className="dg-table">
						<thead><tr><th>{t.roleName}</th><th>{t.permissions}</th><th>{t.roleViews}</th><th>{t.roleStages}</th><th>{t.roleSchemas}</th></tr></thead>
						<tbody>
							{me.value.roles.flatMap(r => {
								// a row by schema where it applies, with its views and stages there; one when it applies everywhere
								const rows: [string | undefined, SchemaEntry][] = r.schemas ? Object.entries(r.schemas) : [[undefined, {}]]
								return rows.map(([path, e], i) => (
									<tr key={`${r.name}@${path ?? '*'}`} aria-label={path ? `${r.name} ${path}` : r.name}>
										<td>{i === 0 && <><strong>{r.name}</strong>{r.unknown && <span className="dg-chip">{t.meUnknownRole}</span>}</>}</td>
										<td className="dg-wrap">{i === 0 ? r.permissions.join(', ') || '—' : ''}</td>
										<td><Defaulted items={e.views ?? r.views} chosen={e.view} none={t.roleOfSchema} title={t.meDefault} /></td>
										<td><Defaulted items={e.stages ?? r.stages} chosen={e.stage} none={t.roleOfSchema} title={t.meDefault} /></td>
										<td>{path !== undefined ? <strong>{path || '/'}</strong> : <span className="dg-muted">{t.roleEverySchema}</span>}</td>
									</tr>
								))
							})}
						</tbody>
					</table></div>
					)
				: <p className="dg-muted">{t.meNoRoles}: {me.value.permissions.join(', ')}</p>}
			<p className="dg-muted">{t.meNote}</p>
		</section>
	)
}
