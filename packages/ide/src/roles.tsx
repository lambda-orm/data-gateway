import React, { useCallback, useEffect, useState } from 'react'
import { ManagementClient } from './management'
import { usePrefs } from './shared'

/** A role as the administration lists it (docs/ROLE_SCOPES.md §5): of the configuration, or kept in the state */
export interface ListedRole {
	name: string
	/** of a role kept for one schema by 4.4: it doesn't apply (ignored), it is listed to remove it */
	schema?: string
	ignored?: boolean
	source: 'yaml' | 'state'
	config: { permissions?: string[], schemas?: string[], views?: string[], view?: string, stages?: string[], maxRows?: number, approval?: string, scope?: string }
	locked?: boolean
	updatedAt?: string
	updatedBy?: string
}

interface RoleChange { id: string, key: string, before?: unknown, after?: unknown, by: string, at: string, reason?: string }

const list = (text: string): string[] | undefined => {
	const items = text.split(',').map(s => s.trim()).filter(Boolean)
	return items.length ? items : undefined
}
const text = (items?: string[]) => (items ?? []).join(', ')

interface Draft { name: string, schemas: string, permissions: string, views: string, stages: string, maxRows: string, reason: string }
const EMPTY: Draft = { name: '', schemas: '', permissions: '', views: '', stages: '', maxRows: '', reason: '' }

/**
 * The roles of a gateway, in its configuration (with the permission roles): those of its configuration, read only, and
 * those of its state, which add a role or extend one (more schemas, views, stages, permissions). A role is of the
 * gateway and says the schemas where it applies. Each change says who and when; a change applies to the requests at
 * once (in the other replicas within state.refresh).
 */
export const RolesPanel: React.FC<{ client: ManagementClient, onChange?: () => void }> = ({ client, onChange }) => {
	const { t, culture } = usePrefs()
	const [roles, setRoles] = useState<ListedRole[]>([])
	const [changes, setChanges] = useState<RoleChange[]>([])
	const [error, setError] = useState<string>()
	const [draft, setDraft] = useState<Draft>()
	const [busy, setBusy] = useState(false)
	const when = (iso: string) => new Date(iso).toLocaleString(culture, { dateStyle: 'short', timeStyle: 'short' })
	const failed = async (response: Response) => (await response.json().catch(() => undefined))?.message ?? `HTTP ${response.status}`
	const load = useCallback(async () => {
		try {
			const [r, c] = await Promise.all([client.fetch(`${client.base}/admin/roles`), client.fetch(`${client.base}/admin/roles/changes?limit=20`)])
			if (!r.ok) throw new Error(await failed(r))
			setRoles(await r.json())
			setChanges(c.ok ? await c.json() : [])
			setError(undefined)
		} catch (e: any) { setError(e?.message ?? String(e)) }
	}, [client])
	useEffect(() => { load() }, [load])

	const save = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!draft?.name.trim()) return
		setBusy(true)
		try {
			const config = {
				...(list(draft.permissions) ? { permissions: list(draft.permissions) } : {}),
				...(list(draft.schemas) ? { schemas: list(draft.schemas) } : {}),
				...(list(draft.views) ? { views: list(draft.views) } : {}),
				...(list(draft.stages) ? { stages: list(draft.stages) } : {}),
				...(draft.maxRows.trim() ? { maxRows: Number(draft.maxRows) } : {})
			}
			const response = await client.fetch(`${client.base}/admin/roles/${encodeURIComponent(draft.name.trim())}`, {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ config, ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}) })
			})
			if (!response.ok) { setError(await failed(response)); return }
			setDraft(undefined)
			await load()
			onChange?.()
		} finally { setBusy(false) }
	}
	const remove = async (role: ListedRole) => {
		setBusy(true)
		try {
			const query = role.schema !== undefined ? `?schema=${encodeURIComponent(role.schema || '~')}` : ''
			const response = await client.fetch(`${client.base}/admin/roles/${encodeURIComponent(role.name)}${query}`, { method: 'DELETE' })
			if (!response.ok) setError(await failed(response))
			await load()
			onChange?.()
		} finally { setBusy(false) }
	}
	const edit = (role?: ListedRole) => setDraft(role
		? { ...EMPTY, name: role.name, ...(role.source === 'state' ? { schemas: text(role.config.schemas), permissions: text(role.config.permissions), views: text(role.config.views), stages: text(role.config.stages), maxRows: role.config.maxRows ? String(role.config.maxRows) : '' } : {}) }
		: { ...EMPTY })
	const field = (key: keyof Draft, label: string, hint?: string) => (
		<label className="dg-field">
			<span>{label}</span>
			<input aria-label={label} value={draft![key]} onChange={e => setDraft({ ...draft!, [key]: e.target.value })} spellCheck={false} />
			{hint && <span className="dg-muted">{hint}</span>}
		</label>
	)

	return (
		<section className="dg-card dg-roles">
			<h3>{t.gatewayRoles}</h3>
			<p className="dg-muted">{t.gatewayRolesNote}</p>
			{error && <div className="dg-error" role="alert">{error}</div>}
			<div className="dg-table-scroll"><table className="dg-table">
				<thead>
					<tr><th>{t.roleName}</th><th>{t.roleSchemas}</th><th>{t.permissions}</th><th>{t.roleViews}</th><th>{t.roleStages}</th><th>{t.roleSource}</th><th /></tr>
				</thead>
				<tbody>
					{roles.map(role => (
						<tr key={`${role.source}:${role.name}@${role.schema ?? ''}`} aria-label={`${role.name}${role.schema ? `@${role.schema}` : ''}`}>
							<td><strong>{role.name}</strong>{role.locked && <span className="dg-chip">{t.roleLocked}</span>}{role.ignored && <span className="dg-chip" title={t.roleIgnored}>{role.schema || '/'}: {t.roleIgnored}</span>}</td>
							<td>{text(role.config.schemas) || <span className="dg-muted">{t.roleEverySchema}</span>}</td>
							<td>{text(role.config.permissions)}</td>
							<td>{text(role.config.views ?? (role.config.view ? [role.config.view] : undefined)) || <span className="dg-muted">{t.roleOfSchema}</span>}</td>
							<td>{text(role.config.stages) || <span className="dg-muted">{t.roleOfSchema}</span>}</td>
							<td className="dg-muted">{role.source === 'yaml' ? t.roleFromConfig : `${role.updatedBy} · ${when(role.updatedAt!)}`}</td>
							<td>
								<span className="dg-form-actions">
									{!role.locked && !role.ignored && <button type="button" disabled={busy} onClick={() => edit(role)}>{role.source === 'yaml' ? t.extendRole : t.editRole}</button>}
									{role.source === 'state' && <button type="button" className="dg-danger" disabled={busy} onClick={() => remove(role)}>{t.removeRole}</button>}
								</span>
							</td>
						</tr>
					))}
				</tbody>
			</table></div>
			{draft
				? (
					<form className="dg-form" onSubmit={save} aria-label={t.saveRole}>
						{field('name', t.roleName)}
						{field('schemas', t.roleSchemas, `${t.roleListHint}; ${t.roleSchemasHint}`)}
						{field('permissions', t.permissions, t.roleListHint)}
						{field('views', t.roleViews, t.roleListHint)}
						{field('stages', t.roleStages, t.roleListHint)}
						{field('maxRows', t.roleMaxRows)}
						{field('reason', t.roleReason)}
						<span className="dg-form-actions">
							<button type="button" onClick={() => setDraft(undefined)}>{t.cancel}</button>
							<button type="submit" className="dg-primary" disabled={busy || !draft.name.trim()}>{t.saveRole}</button>
						</span>
					</form>
					)
				: <button type="button" onClick={() => edit()}>{t.addRole}</button>}
			{changes.length > 0 && (
				<details>
					<summary>{t.roleChanges}</summary>
					<ul className="dg-list">
						{changes.map(c => (
							<li key={c.id}><code>{c.key}</code> · {c.by} · {when(c.at)}{c.reason ? ` · ${c.reason}` : ''}{c.after === undefined ? ` · ${t.removeRole}` : ''}</li>
						))}
					</ul>
				</details>
			)}
		</section>
	)
}
