import React, { useCallback, useEffect, useState } from 'react'
import { ManagementClient } from './management'
import { usePrefs, Who } from './shared'

/** A session as the gateway lists it (docs/DATA_GATEWAY_SESSIONS_PLAN.md §3): never its token */
interface ListedSession {
	id: string
	credential: string
	current: boolean
	connected: boolean
	createdAt: string
	lastSeenAt: string
	expiresAt: string
	ip?: string
	client?: { app?: string, version?: string, kind?: string, userAgent?: string }
	activity?: { schema?: string, tab?: string }
}

/** The browser or app of a session, short: "data-gateway-ide 1.0.0 · web · Firefox" */
const clientOf = (s: ListedSession): string => {
	const ua = s.client?.userAgent ?? ''
	const browser = /Electron\//.test(ua) ? 'Electron' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ua ? ua.split(' ')[0] : ''
	return [s.client?.app && `${s.client.app}${s.client.version ? ` ${s.client.version}` : ''}`, s.client?.kind, browser].filter(Boolean).join(' · ') || '—'
}

/**
 * The sessions of a connection, in its page: its own (close one, close the others) and, with sessionAdmin, every one of
 * the gateway by credential (revoke one, revoke all of a credential). Read again every 10 s while shown.
 */
export const SessionsPanel: React.FC<{ client: ManagementClient, who: Who }> = ({ client, who }) => {
	const { t, culture } = usePrefs()
	const admin = who.permissions.includes('sessionAdmin')
	const [mine, setMine] = useState<ListedSession[]>([])
	const [all, setAll] = useState<ListedSession[]>([])
	const [error, setError] = useState<string>()
	const [confirming, setConfirming] = useState<string>()
	const when = (iso: string) => new Date(iso).toLocaleString(culture, { dateStyle: 'short', timeStyle: 'short' })
	const get = useCallback(async (path: string) => {
		const response = await client.fetch(`${client.base}${path}`)
		if (!response.ok) throw new Error((await response.json().catch(() => undefined))?.message ?? `HTTP ${response.status}`)
		return response.json()
	}, [client])
	const load = useCallback(async () => {
		try {
			setMine(await get('/sessions'))
			if (admin) setAll(await get('/sessions?all=true'))
			setError(undefined)
		} catch (e: any) { setError(e?.message ?? String(e)) }
	}, [get, admin])
	useEffect(() => {
		load()
		const timer = setInterval(load, 10000)
		return () => clearInterval(timer)
	}, [load])
	const remove = async (path: string) => {
		const response = await client.fetch(`${client.base}${path}`, { method: 'DELETE' })
		if (!response.ok) setError((await response.json().catch(() => undefined))?.message ?? `HTTP ${response.status}`)
		setConfirming(undefined)
		await load()
	}
	const others = mine.filter(s => !s.current)
	const row = (s: ListedSession, action: React.ReactNode) => (
		<tr key={s.id}>
			<td><span className={s.connected ? 'dg-ready' : 'dg-muted'} title={s.connected ? t.connected : t.notConnected}>●</span> {clientOf(s)}{s.current && <span className="dg-chip">{t.thisSession}</span>}</td>
			<td>{s.ip ?? '—'}</td>
			<td>{s.activity?.schema || s.activity?.tab ? <span className="dg-muted">{t.lookingAt} </span> : null}{[s.activity?.schema, s.activity?.tab].filter(Boolean).join(' · ')}</td>
			<td title={`${t.lastActivity}: ${s.lastSeenAt}`}>{when(s.lastSeenAt)}</td>
			<td title={`${t.endsAt}: ${s.expiresAt}`}>{when(s.expiresAt)}</td>
			<td>{action}</td>
		</tr>
	)
	const head = (
		<thead><tr><th>{t.sessions}</th><th>IP</th><th /><th>{t.lastActivity}</th><th>{t.endsAt}</th><th /></tr></thead>
	)
	const byCredential = all.reduce<Record<string, ListedSession[]>>((groups, s) => { (groups[s.credential] ??= []).push(s); return groups }, {})
	return (
		<section className="dg-card dg-sessions">
			<h3>{t.mySessions}</h3>
			<p className="dg-muted">{t.sessionsNote}</p>
			{error && <div className="dg-error" role="alert">{error}</div>}
			<div className="dg-table-scroll">
				<table className="dg-table">
					{head}
					<tbody>{mine.map(s => row(s, s.current ? null : <button type="button" onClick={() => remove(`/sessions/${encodeURIComponent(s.id)}`)}>{t.closeSession}</button>))}</tbody>
				</table>
			</div>
			{others.length > 0
				? <span className="dg-form-actions"><button type="button" onClick={() => remove(`/sessions?credential=${encodeURIComponent(who.name)}&except=current`)}>{t.closeOthers}</button></span>
				: <p className="dg-muted">{t.noOtherSessions}</p>}
			{admin && (
				<>
					<h3>{t.activeSessions}</h3>
					{Object.entries(byCredential).map(([credential, sessions]) => (
						<div key={credential} className="dg-session-group">
							<div className="dg-session-credential">
								<strong>{credential}</strong> <span className="dg-muted">({sessions.length})</span>
								<span className="dg-spacer" />
								{confirming === credential
									? <><span className="dg-muted">{t.confirmRevokeAll.replace('{name}', credential)}</span>
										<button type="button" onClick={() => setConfirming(undefined)}>{t.cancel}</button>
										<button type="button" className="dg-danger" onClick={() => remove(`/sessions?credential=${encodeURIComponent(credential)}${credential === who.name ? '&except=current' : ''}`)}>{t.revokeAll}</button></>
									: <button type="button" className="dg-danger" onClick={() => setConfirming(credential)}>{t.revokeAll}</button>}
							</div>
							<div className="dg-table-scroll">
								<table className="dg-table">
									{head}
									<tbody>{sessions.map(s => row(s, s.current ? null : <button type="button" className="dg-danger" onClick={() => remove(`/sessions/${encodeURIComponent(s.id)}`)}>{t.revokeSession}</button>))}</tbody>
								</table>
							</div>
						</div>
					))}
				</>
			)}
		</section>
	)
}
