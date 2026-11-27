import React, { useCallback, useEffect, useState } from 'react'
import { Check, Minus } from 'lucide-react'
import { ManagementClient } from './management'
import { usePrefs } from './shared'
import { ListedRole, RolesPanel } from './roles'

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

interface Access { permissions: string[], authentications: DescribedAuthentication[] }

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '')
const contextText = (context?: Record<string, unknown>) => Object.entries(context ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(', ')

/** The methods of an authentication, one by one (methods: several, in order) */
const methodsOf = (a: DescribedAuthentication): DescribedAuthentication[] => a.adapter === 'methods' ? a.methods ?? [] : [a]

/** Who may come in, by level (global, a transport, a schema): each key with its roles and context; a jwt, its claims */
const AccessPanel: React.FC<{ access: Access }> = ({ access }) => {
	const { t } = usePrefs()
	const whereOf = (a: DescribedAuthentication) => !a.where || a.where.level === 'global'
		? t.accessGlobal
		: a.where.level === 'transport' ? fill(t.accessTransport, { name: a.where.transport }) : fill(t.accessSchema, { name: a.where.schema || '/' })
	const methodName = (m: DescribedAuthentication) => m.adapter === 'jwt' ? 'JWT' : m.adapter === 'none' ? t.none : m.type === 'apikey' ? `${t.apikey}${m.header ? ` (${m.header})` : ''}` : m.type === 'bearer' ? t.bearer : t.basic
	const rows = access.authentications.flatMap(a => methodsOf(a).flatMap((m, i) => {
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
				<td>{c.roles.map(r => <span key={r} className="dg-chip">{r}</span>)}</td>
				<td>{contextText(c.context)}</td>
			</tr>
		))
	}))
	return (
		<section className="dg-card">
			<h3>{t.accessTitle}</h3>
			<p className="dg-muted">{t.accessNote}</p>
			<div className="dg-table-scroll"><table className="dg-table">
				<thead><tr><th>{t.accessWhere}</th><th>{t.accessMethod}</th><th>{t.accessCredential}</th><th>{t.roles}</th><th>{t.accessContext}</th></tr></thead>
				<tbody>{rows}</tbody>
			</table></div>
		</section>
	)
}

/** A role as it applies: its configuration and its state together (the state adds, unless the role is locked) */
const effective = (roles: ListedRole[]): { name: string, permissions: Set<string>, schemas?: string[] }[] => {
	const byName = new Map<string, { name: string, permissions: Set<string>, schemas?: string[], everywhere: boolean, locked: boolean }>()
	for (const role of roles.filter(r => !r.ignored)) {
		const current = byName.get(role.name)
		if (!current) {
			byName.set(role.name, { name: role.name, permissions: new Set(role.config.permissions ?? []), schemas: role.config.schemas, everywhere: !role.config.schemas, locked: !!role.locked })
			continue
		}
		if (current.locked) continue
		for (const p of role.config.permissions ?? []) current.permissions.add(p)
		// an extension adds schemas to a role that names some; one that applies everywhere keeps applying everywhere
		if (!current.everywhere && role.config.schemas) current.schemas = [...new Set([...(current.schemas ?? []), ...role.config.schemas])]
	}
	return [...byName.values()].map(({ name, permissions, schemas }) => ({ name, permissions, ...(schemas ? { schemas } : {}) }))
}

/** What each role may do: a role by row, a permission by column, and the schemas where it applies */
const RolePermissionsPanel: React.FC<{ roles: ListedRole[], permissions: string[] }> = ({ roles, permissions }) => {
	const { t } = usePrefs()
	const rows = effective(roles)
	return (
		<section className="dg-card">
			<h3>{t.rolePermissionsTitle}</h3>
			<p className="dg-muted">{t.rolePermissionsNote}</p>
			<div className="dg-table-scroll"><table className="dg-table dg-matrix">
				<thead>
					<tr><th>{t.roleName}</th><th>{t.roleSchemas}</th>{permissions.map(p => <th key={p}><code>{p}</code></th>)}</tr>
				</thead>
				<tbody>
					{rows.map(r => (
						<tr key={r.name} aria-label={r.name}>
							<td><strong>{r.name}</strong></td>
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
	)
}

/**
 * The configuration of a gateway, in the page of a connection (with the permission roles): its roles, who may come in
 * (the keys and tokens with their roles and context) and what each role may do. It never shows a secret.
 */
export const GatewayConfigPanel: React.FC<{ client: ManagementClient }> = ({ client }) => {
	const { t } = usePrefs()
	const [roles, setRoles] = useState<ListedRole[]>([])
	const [access, setAccess] = useState<Access>()
	const [error, setError] = useState<string>()
	const load = useCallback(async () => {
		try {
			const [r, a] = await Promise.all([client.fetch(`${client.base}/admin/roles`), client.fetch(`${client.base}/admin/access`)])
			if (!r.ok) throw new Error((await r.json().catch(() => undefined))?.message ?? `HTTP ${r.status}`)
			setRoles(await r.json())
			// a gateway before 5.0 has no /admin/access: the roles alone
			setAccess(a.ok ? await a.json() : undefined)
			setError(undefined)
		} catch (e: any) { setError(e?.message ?? String(e)) }
	}, [client])
	useEffect(() => { load() }, [load])
	return (
		<>
			<p className="dg-muted">{t.gatewayConfigNote}</p>
			{error && <div className="dg-error" role="alert">{error}</div>}
			<RolesPanel client={client} onChange={load} />
			{access && <AccessPanel access={access} />}
			{access && <RolePermissionsPanel roles={roles} permissions={access.permissions} />}
		</>
	)
}
