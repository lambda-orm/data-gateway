import { Explore, tracesOfEntity } from './observability'
import { OidcSettings, OidcTokens, renew, signIn, signOut as oidcSignOut } from './oidc'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdministrationNode, BrowserSessionStore, Workspace } from '@lambdaorm/ui'
import { Activity, BarChart3, Cable, ClipboardCheck, KeyRound, Plus, ScrollText, Settings, Shield, UserCog, Users, Waypoints, Wrench } from 'lucide-react'
import { ConnectionPage, ConnectionTools, Credential, CredentialFields, getJson, headersOf, Kind, PreferencesPage, usePrefs, Who } from './shared'
import { AppMenu } from './appMenu'
import { ManagementClient, ManagementState, testConnection } from './management'
import { SessionsPanel } from './sessions'
import { ApprovalsPanel } from './approvals'
import { AccessPage, ListedRole, MeCard, ObservabilityPage, RolePage, RolesPage, roleNamesOf, Signal } from './administration'
import { endpointsOf, McpTab, SwaggerTab, useTransports, WebSocketTab } from './tools'
import { forbiddenTarget, unreachable, viaProxy } from './proxy'

/**
 * The IDE (its own image): no home, no login. It connects to data-gateways, each with the URL of its management and its
 * credential; their schemas, workspaces and projects stay in them, as a database IDE connects to databases. What it
 * keeps of each connection is in this browser: where it is and how it authenticates (the key only if asked to be
 * remembered; else in this tab, asked again after closing it). Every request goes through the backend of the IDE, which
 * reaches the gateway at that URL (docs/DATA_GATEWAY.md §11.9).
 */
export interface IdeConnection {
	id: string
	name: string
	protocol: 'http' | 'https'
	/** host, port and base path of its management, as the backend of the IDE reaches it: data-gateway:9292 */
	address: string
	kind: Kind
	header: string
	user: string
	/** kept only when remember */
	secret?: string
	remember: boolean
	/** the URLs of its REST, WebSocket and MCP when the backend of the IDE doesn't reach them at the ports the gateway
	 * tells, on its host (a proxy in front, another network) */
	restUrl?: string
	webSocketUrl?: string
	mcpUrl?: string
	/** OpenID Connect (kind oidc, docs/OIDC_LOGIN.md): its identity provider and its public client */
	issuer?: string
	clientId?: string
	scopes?: string
}

const CONNECTIONS = 'data-gateway-ide.connections'
const SECRETS = 'data-gateway-ide.secrets'
/** the tokens of the logins of the connections (OpenID Connect): in the tab only */
const OIDC_TOKENS = 'data-gateway-ide.oidc'
const read = <T, >(storage: () => Storage, key: string, empty: T): T => { try { const text = storage().getItem(key); return text ? JSON.parse(text) : empty } catch { return empty } }
const write = (storage: () => Storage, key: string, value: unknown) => { try { storage().setItem(key, JSON.stringify(value)) } catch { /* private window */ } }
const local = () => window.localStorage
const tab = () => window.sessionStorage

export const urlOf = (c: Pick<IdeConnection, 'protocol' | 'address'>) => `${c.protocol}://${c.address.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '')}`
const credentialOf = (c: IdeConnection, secrets: Record<string, string>): Credential => ({ kind: c.kind, header: c.header, user: c.user, secret: c.secret ?? secrets[c.id] ?? '' })
const hasSecret = (c: IdeConnection, secrets: Record<string, string>) => c.kind === 'none' || !!(c.secret ?? secrets[c.id])
/** Its management, through the backend of the IDE */
const apiOf = (c: Pick<IdeConnection, 'protocol' | 'address'>) => viaProxy(urlOf(c))
const fixedOf = (c: IdeConnection) => ({ rest: c.restUrl, webSocket: c.webSocketUrl, mcp: c.mcpUrl })
/** What failed, said to the person: a target the IDE may not reach, a credential refused, a gateway not reached */
const problemOf = (e: any, t: { invalid: string, unreachable: string }): string =>
	forbiddenTarget(e) ? e.message : e?.status === 401 || e?.status === 403 ? t.invalid : unreachable(e) ? `${t.unreachable} ${e?.message ?? ''}`.trim() : (e?.message ?? String(e))

/** The form of a connection: where it is, how it authenticates; test it, save it, remove it; then who it is */
const ConnectionEditor: React.FC<{
	initial?: IdeConnection
	secret: string
	who?: Who
	problem?: string
	onSave: (connection: IdeConnection, secret: string) => void
	onRemove?: () => void
	/** its session of management: who it is there (its user and its roles) */
	client?: ManagementClient
	/** OpenID Connect: who signed in and until when; sign in, sign out */
	oidc?: { user?: string, expiresAt?: number, signIn: () => Promise<void>, signOut: () => void }
}> = ({ initial, secret: givenSecret, who, problem, onSave, onRemove, client, oidc }) => {
	const { t } = usePrefs()
	const [draft, setDraft] = useState<IdeConnection>(initial ?? { id: '', name: '', protocol: 'http', address: '', kind: 'apikey', header: 'X-Api-Key', user: '', remember: false })
	const [secret, setSecret] = useState(givenSecret)
	const [tested, setTested] = useState<{ ok: boolean, text: string }>()
	const [busy, setBusy] = useState(false)
	const [removing, setRemoving] = useState(false)
	const credential: Credential = { kind: draft.kind, header: draft.header, user: draft.user, secret }
	const set = (patch: Partial<IdeConnection>) => { setDraft({ ...draft, ...patch }); setTested(undefined) }
	const test = async () => {
		setBusy(true)
		try {
			const version = await getJson(apiOf(draft), '/version').catch(() => undefined)
			// a session opened and closed at once: the credential works on its management
			const found = await testConnection(urlOf(draft), credential)
			setTested({ ok: true, text: `${t.connectedAs.replace('{name}', found.name)}${version?.version ? ` · data-gateway ${version.version}` : ''}` })
		} catch (e: any) {
			setTested({ ok: false, text: problemOf(e, t) })
		} finally { setBusy(false) }
	}
	const valid = draft.name.trim() && draft.address.trim() && (draft.kind !== 'oidc' || (!!draft.issuer?.trim() && !!draft.clientId?.trim()))
	const [signing, setSigning] = useState(false)
	const [signError, setSignError] = useState<string>()
	const { culture } = usePrefs()
	const signIn = async () => {
		if (!oidc) return
		setSigning(true)
		setSignError(undefined)
		try { await oidc.signIn() } catch (e: any) { setSignError(t.signInFailed.replace('{error}', e?.message ?? String(e))) } finally { setSigning(false) }
	}
	const form = (
		<section className="dg-card">
			<form className="dg-form dg-connection-form" onSubmit={e => { e.preventDefault(); if (valid) onSave({ ...draft, name: draft.name.trim() }, secret) }}>
				<label>{t.connectionName}<input aria-label={t.connectionName} value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="local" autoFocus={!initial} /></label>
				<span className="dg-url">
					<label>{t.protocol}
						<select aria-label={t.protocol} value={draft.protocol} onChange={e => set({ protocol: e.target.value as 'http' | 'https' })}>
							<option value="http">REST · http</option>
							<option value="https">REST · https</option>
						</select>
					</label>
					<label>{t.address}<input aria-label={t.address} value={draft.address} onChange={e => set({ address: e.target.value })} placeholder="host:port/base-path" spellCheck={false} /></label>
				</span>
				<CredentialFields allowOidc credential={credential} onChange={patch => { if (patch.secret !== undefined) { setSecret(patch.secret); setTested(undefined) } else set(patch as Partial<IdeConnection>) }} />
				{draft.kind === 'oidc' && (
					<>
						<label>{t.issuer}<input aria-label={t.issuer} value={draft.issuer ?? ''} onChange={e => set({ issuer: e.target.value.trim() || undefined })} placeholder="https://idp.example.com/realms/shop" spellCheck={false} /></label>
						<span className="dg-url">
							<label>{t.clientId}<input aria-label={t.clientId} value={draft.clientId ?? ''} onChange={e => set({ clientId: e.target.value.trim() || undefined })} placeholder="data-gateway-ide" spellCheck={false} /></label>
							<label>{t.scopes}<input aria-label={t.scopes} value={draft.scopes ?? ''} onChange={e => set({ scopes: e.target.value || undefined })} placeholder="openid profile" spellCheck={false} /></label>
						</span>
						<span className="dg-muted">{t.oidcNote}</span>
						{initial && oidc && (
							<span className="dg-form-actions dg-signin">
								{oidc.user
									? <><span className="dg-ok">{t.signedInAs.replace('{name}', oidc.user).replace('{time}', new Date(oidc.expiresAt ?? Date.now()).toLocaleTimeString(culture, { timeStyle: 'short' }))}</span><button type="button" onClick={oidc.signOut}>{t.signOut}</button></>
									: <><span className="dg-muted">{t.notSignedIn}</span><button type="button" className="dg-primary" disabled={signing} onClick={signIn}>{t.signIn}</button></>}
							</span>
						)}
						{signError && <div className="dg-error" role="alert">{signError}</div>}
					</>
				)}
				{draft.kind !== 'none' && draft.kind !== 'oidc' && <label className="dg-check"><input type="checkbox" checked={draft.remember} onChange={e => set({ remember: e.target.checked })} /> {t.rememberKey}</label>}
				<details className="dg-advanced">
					<summary>{t.publicUrls}</summary>
					<span className="dg-muted">{t.publicUrlsNote}</span>
					<label>{t.restUrl}<input aria-label={t.restUrl} value={draft.restUrl ?? ''} onChange={e => set({ restUrl: e.target.value || undefined })} placeholder="http://host:port" spellCheck={false} /></label>
					<label>{t.webSocketUrl}<input aria-label={t.webSocketUrl} value={draft.webSocketUrl ?? ''} onChange={e => set({ webSocketUrl: e.target.value || undefined })} placeholder="ws://host:port" spellCheck={false} /></label>
					<label>{t.mcpUrl}<input aria-label={t.mcpUrl} value={draft.mcpUrl ?? ''} onChange={e => set({ mcpUrl: e.target.value || undefined })} placeholder="http://host:port" spellCheck={false} /></label>
				</details>
				<span className="dg-muted">{t.connectionNote}</span>
				{tested && <div className={tested.ok ? 'dg-ok' : 'dg-error'} role="status">{tested.text}</div>}
				{!tested && problem && <div className="dg-error" role="alert">{problem}</div>}
				<span className="dg-form-actions">
					{onRemove && (removing
						? <><span className="dg-muted">{t.confirmRemove}</span><button type="button" onClick={() => setRemoving(false)}>{t.cancel}</button><button type="button" className="dg-danger" onClick={onRemove}>{t.removeConnection}</button></>
						: <button type="button" className="dg-danger" onClick={() => setRemoving(true)}>{t.removeConnection}</button>)}
					<span className="dg-spacer" />
					<button type="button" onClick={test} disabled={busy || !valid}>{busy ? t.checking : t.test}</button>
					<button type="submit" className="dg-primary" disabled={!valid}>{initial ? t.saveConnection : t.addConnection}</button>
				</span>
			</form>
		</section>
	)
	return initial
		? <ConnectionPage name={initial.name} url={urlOf(initial)} credential={credentialOf(initial, { [initial.id]: givenSecret })} who={who}
			account={client && who && <MeCard client={client} />}>{form}</ConnectionPage>
		: <div className="dg-pane"><h2>{t.newConnection}</h2>{form}</div>
}

/** The tools a connection may open: what its gateway exposes (GET /transports of its management), or the URLs it fixes */
const ToolsOf: React.FC<{ connection: IdeConnection, onOpen: (tool: 'swagger' | 'websocket' | 'mcp') => void }> = ({ connection, onOpen }) => {
	const transports = useTransports(urlOf(connection))
	const endpoints = endpointsOf(urlOf(connection), transports, fixedOf(connection))
	return <ConnectionTools available={{ swagger: !!endpoints.openapi, webSocket: !!endpoints.webSocket, mcp: !!endpoints.mcp }} onOpen={onOpen} />
}

/** A tool of a connection in its tab: where its transports are (they are read once the tab opens) */
const ToolTab: React.FC<{ connection: IdeConnection, tool: 'swagger' | 'websocket' | 'mcp', headers: () => Record<string, string>, theme: 'light' | 'dark' }> = ({ connection, tool, headers, theme }) => {
	const transports = useTransports(urlOf(connection))
	const endpoints = endpointsOf(urlOf(connection), transports, fixedOf(connection))
	return tool === 'swagger' ? <SwaggerTab endpoints={endpoints} headers={headers} /> : tool === 'websocket' ? <WebSocketTab endpoints={endpoints} headers={headers} theme={theme} /> : <McpTab endpoints={endpoints} headers={headers} theme={theme} />
}

export const IdeApp: React.FC<{ dark: boolean }> = ({ dark }) => {
	const { t, locale, culture } = usePrefs()
	const [connections, setConnections] = useState<IdeConnection[]>(() => read(local, CONNECTIONS, []))
	const [secrets, setSecrets] = useState<Record<string, string>>(() => read(tab, SECRETS, {}))
	const [oidcTokens, setOidcTokens] = useState<Record<string, OidcTokens>>(() => read(tab, OIDC_TOKENS, {}))
	useEffect(() => { write(tab, OIDC_TOKENS, oidcTokens) }, [oidcTokens])
	const [openPage, setOpenPage] = useState<{ key: string, at: number }>(() => ({ key: read<IdeConnection[]>(local, CONNECTIONS, []).length ? '' : 'connection:new', at: Date.now() }))
	const openOf = (key: string) => setOpenPage({ key, at: Date.now() })
	// the connection about to be removed (its confirmation)
	useEffect(() => { write(local, CONNECTIONS, connections) }, [connections])
	useEffect(() => { write(tab, SECRETS, secrets) }, [secrets])
	// a client of the management of each connection: its session, who it is, its events (docs/DATA_GATEWAY_SESSIONS_PLAN.md §8)
	const clients = useRef(new Map<string, { client: ManagementClient, signature: string }>())
	// the fetch of each connection, stable and from its first render: it waits for the client of its session (made in an
	// effect, after that render) and goes through it, so no request leaves without the session ("management needs a
	// session") and the workspace keeps one api per connection
	const waiting = useRef(new Map<string, ((client: ManagementClient) => void)[]>())
	const clientOf = (id: string): Promise<ManagementClient> => {
		const client = clients.current.get(id)?.client
		if (client) return Promise.resolve(client)
		return new Promise(resolve => waiting.current.set(id, [...(waiting.current.get(id) ?? []), resolve]))
	}
	const fetches = useRef(new Map<string, typeof fetch>())
	const fetchOf = (id: string): typeof fetch => {
		let f = fetches.current.get(id)
		if (!f) {
			f = (async (input: RequestInfo | URL, init?: RequestInit) => (await clientOf(id)).fetch(input, init)) as typeof fetch
			fetches.current.set(id, f)
		}
		return f
	}
	const [states, setStates] = useState<Record<string, ManagementState>>({})
	const now = useRef({ connections, secrets })
	now.current = { connections, secrets }
	/** connections saved again without changes: connect again (after a revocation, say) */
	const reconnecting = useRef(new Set<string>())
	useEffect(() => {
		const seen = new Set<string>()
		for (const c of connections) {
			seen.add(c.id)
			// a token of a login renewed is the same credential: its next login (when its session ends) takes the new one
			const signature = `${urlOf(c)}|${c.kind}|${c.header}|${c.user}|${hasSecret(c, secrets) ? (c.kind === 'oidc' ? 'signed in' : credentialOf(c, secrets).secret) : ''}`
			const existing = clients.current.get(c.id)
			if (existing && existing.signature === signature) {
				if (reconnecting.current.delete(c.id)) existing.client.reconnect().catch(() => undefined)
				continue
			}
			reconnecting.current.delete(c.id)
			// another gateway or credential: the session of the old one ends
			if (existing) { existing.client.logout().catch(() => undefined); existing.client.close() }
			const credential = () => {
				const current = now.current.connections.find(x => x.id === c.id)
				return current && hasSecret(current, now.current.secrets) ? credentialOf(current, now.current.secrets) : undefined
			}
			const client = new ManagementClient(c.id, urlOf(c), credential, { invalid: t.invalid, unreachable: t.unreachable, needsKey: c.kind === 'oidc' ? t.notSignedIn : t.needsKey, sessionEnded: t.sessionEnded })
			client.subscribe(state => setStates(all => ({ ...all, [c.id]: state })))
			clients.current.set(c.id, { client, signature })
			for (const resolve of waiting.current.get(c.id) ?? []) resolve(client)
			waiting.current.delete(c.id)
			;(existing ? client.reconnect() : client.start()).catch(() => undefined)
		}
		for (const [id, { client }] of clients.current) {
			if (seen.has(id)) continue
			client.logout().catch(() => undefined)
			client.close()
			clients.current.delete(id)
			fetches.current.delete(id)
		}
	}, [connections, secrets, t])
	useEffect(() => () => { for (const { client } of clients.current.values()) client.close() }, [])
	const whos = useMemo(() => Object.fromEntries(Object.entries(states).map(([id, state]) => [id, state.who])), [states])
	// where the traces of each gateway are seen: its configuration tells it (observability.explore), not the connection
	const [explores, setExplores] = useState<Record<string, Explore | undefined>>({})
	const addresses = connections.map(c => `${c.id}|${urlOf(c)}`).join(',')
	useEffect(() => {
		let alive = true
		for (const c of connections) {
			getJson(apiOf(c), '/observability').then((o: { explore?: Explore }) => o?.explore, () => undefined)
				.then(explore => { if (alive) setExplores(e => ({ ...e, [c.id]: explore })) })
		}
		return () => { alive = false }
	}, [addresses])
	// the roles of each gateway (with the permission roles): the children of Roles in its Administration
	const [adminRoles, setAdminRoles] = useState<Record<string, string[]>>({})
	const [adminRefresh, setAdminRefresh] = useState(0)
	const canRoles = connections.filter(c => whos[c.id]?.permissions.includes('roles')).map(c => c.id).join(',')
	const loadRoles = useCallback(async (id: string): Promise<void> => {
		const client = clients.current.get(id)?.client
		if (!client) return
		const response = await client.fetch(`${client.base}/admin/roles`).catch(() => undefined)
		const roles: ListedRole[] = response?.ok ? await response.json() : []
		setAdminRoles(all => ({ ...all, [id]: roleNamesOf(roles) }))
	}, [])
	useEffect(() => { for (const id of canRoles.split(',').filter(Boolean)) loadRoles(id).catch(() => undefined) }, [canRoles, adminRefresh, loadRoles])
	/** a role saved or removed: the tree and the pages read the roles again */
	const rolesChanged = async (id: string) => { await loadRoles(id); setAdminRefresh(n => n + 1) }
	const problems = useMemo(() => Object.fromEntries(Object.entries(states).map(([id, state]) => [id, state.problem ?? (state.expiring ? t.sessionExpiring : undefined)])), [states, t])
	const save = (existing: IdeConnection | undefined) => (connection: IdeConnection, secret: string) => {
		const id = existing?.id ?? `c${Date.now().toString(36)}`
		// a token of a login never stays beyond the tab
		const kept: IdeConnection = { ...connection, id, ...(connection.kind === 'oidc' ? { remember: false } : {}), secret: connection.kind !== 'oidc' && connection.remember && secret ? secret : undefined }
		setConnections(all => existing ? all.map(c => c.id === id ? kept : c) : [...all, kept])
		if (connection.kind !== 'oidc') setSecrets(s => ({ ...s, [id]: secret }))
		if (existing) reconnecting.current.add(id)
		if (!existing) openOf(`connection:${id}`)
	}
	const remove = (id: string) => {
		setConnections(all => all.filter(c => c.id !== id))
		setSecrets(s => { const n = { ...s }; delete n[id]; return n })
		setOidcTokens(s => { const n = { ...s }; delete n[id]; return n })
	}
	// OpenID Connect (docs/OIDC_LOGIN.md §2): the tokens of a login in the tab, its access token the secret of the connection
	const oidcSettingsOf = (c: IdeConnection): OidcSettings => ({ issuer: c.issuer ?? '', clientId: c.clientId ?? '', scopes: c.scopes })
	const keepTokens = (id: string, tokens: OidcTokens | undefined) => {
		setOidcTokens(all => { const n = { ...all }; if (tokens) n[id] = tokens; else delete n[id]; return n })
		setSecrets(s => { const n = { ...s }; if (tokens) n[id] = tokens.access; else delete n[id]; return n })
	}
	const oidcOf = (c: IdeConnection) => c.kind !== 'oidc' ? undefined : {
		user: oidcTokens[c.id]?.user,
		expiresAt: oidcTokens[c.id]?.expiresAt,
		signIn: async () => { keepTokens(c.id, await signIn(oidcSettingsOf(c))) },
		signOut: () => {
			const tokens = oidcTokens[c.id]
			keepTokens(c.id, undefined)
			if (tokens) oidcSignOut(oidcSettingsOf(c), tokens).catch(() => undefined)
		}
	}
	// a minute before its access token ends, the refresh token renews it; when it can't, sign in again
	useEffect(() => {
		const timers = Object.entries(oidcTokens).map(([id, tokens]) => {
			const c = connections.find(x => x.id === id)
			if (!c || c.kind !== 'oidc') return undefined
			return setTimeout(() => {
				renew(oidcSettingsOf(c), tokens).then(renewed => keepTokens(id, renewed), () => keepTokens(id, undefined))
			}, Math.max(5000, tokens.expiresAt - Date.now() - 60000))
		})
		return () => { for (const timer of timers) if (timer) clearTimeout(timer) }
	}, [oidcTokens, connections])
	/**
	 * The administration of a gateway in its explorer, by what its credential may do: its roles (and each one), who may
	 * come in, the sessions, the writes that wait, its tools and its observability (metrics, logs, traces)
	 */
	const administrationOf = (c: IdeConnection): { title: string, nodes: AdministrationNode[] } | undefined => {
		const who = whos[c.id]
		if (!who) return undefined
		const has = (p: string) => who.permissions.includes(p)
		const icon = (I: React.FC<any>) => <I size={14} aria-hidden="true" />
		const page = (key: string, label: string, I: React.FC<any>, extra: Partial<AdministrationNode> = {}): AdministrationNode => ({ key, label, icon: icon(I), onOpen: () => openOf(`admin:${key}:${c.id}`), ...extra })
		const nodes: AdministrationNode[] = []
		if (has('roles')) {
			nodes.push(page('roles', t.roles, Shield, {
				actions: [{ label: t.addRole, icon: icon(Plus), onClick: () => openOf(`admin:role-new:${c.id}`) }],
				children: (adminRoles[c.id] ?? []).map(name => ({ key: `role:${name}`, label: name, icon: icon(UserCog), onOpen: () => openOf(`admin:role:${c.id}:${name}`) }))
			}))
			nodes.push(page('access', t.accessTitle, KeyRound))
		}
		nodes.push(page('sessions', t.sessions, Users))
		if (has('approve')) nodes.push(page('approvals', t.approvals, ClipboardCheck))
		nodes.push(page('tools', t.tools, Wrench))
		if (has('observability')) {
			nodes.push({
				key: 'observability', label: t.obsTitle, icon: icon(Activity),
				children: [page('metrics', t.obsMetrics, BarChart3), page('logs', t.obsLogs, ScrollText), page('traces', t.obsTraces, Waypoints)]
			})
		}
		return { title: t.administration, nodes }
	}
	const specs = useMemo(() => connections.map(c => {
		return {
			administration: administrationOf(c),
			id: c.id,
			name: c.name,
			description: urlOf(c),
			baseUrl: apiOf(c),
			// its session in every request (the credential only in its login), and a new login when it expires
			fetch: fetchOf(c.id),
			// the gateway says what changed: read at once; the polling, slower while its events come
			changes: clients.current.get(c.id)?.client.changes,
			// its session: a change of another session is announced (with who), one's own is not
			session: clients.current.get(c.id)?.client.session,
			// the link of an entity to its traces, when its gateway says where Grafana is
			tracesUrl: explores[c.id] ? (_schema: string, entity: string) => tracesOfEntity(explores[c.id]!, entity) : undefined,
			refreshMs: states[c.id]?.live ? 60000 : undefined,
			// what is saved without the gateway's workspaces: per gateway and per user of the credential
			workspaceKey: `${urlOf(c)}|${whos[c.id]?.name ?? c.user ?? ''}`,
			problem: problems[c.id],
			// its page (edit, test, remove): a click on its name
			onOpen: () => openOf(`connection:${c.id}`)
		}
	}), [connections, states, problems, whos, explores, adminRoles, t])
	const pages = useMemo(() => ({
		preferences: { title: t.preferences, icon: <Settings size={14} aria-hidden="true" />, render: () => <PreferencesPage /> },
		'connection:new': { title: t.newConnection, icon: <Plus size={14} aria-hidden="true" />, render: () => <ConnectionEditor secret="" onSave={save(undefined)} /> },
		...Object.fromEntries(connections.map(c => [`connection:${c.id}`, {
			title: `${t.connection}: ${c.name}`,
			icon: <Cable size={14} aria-hidden="true" />,
			render: () => <ConnectionEditor key={c.id} initial={c} secret={credentialOf(c, secrets).secret} who={whos[c.id]} problem={problems[c.id]} onSave={save(c)} onRemove={() => remove(c.id)}
				client={clients.current.get(c.id)?.client} oidc={oidcOf(c)} />
		}])),
		// its administration (the nodes of its explorer), with its session
		...Object.fromEntries(connections.flatMap(c => {
			const client = clients.current.get(c.id)?.client
			const who = whos[c.id]
			if (!client || !who) return []
			const of = (key: string, title: string, icon: React.ReactNode, render: () => React.ReactNode) => [`admin:${key}:${c.id}`, { title: `${title} · ${c.name}`, icon, render }] as const
			const openRole = (name: string) => openOf(`admin:role:${c.id}:${name}`)
			const signal = (s: Signal, title: string, icon: React.ReactNode) => of(s, title, icon, () => <ObservabilityPage key={`${c.id}:${s}`} client={client} signal={s} />)
			return [
				of('roles', t.roles, <Shield size={14} aria-hidden="true" />, () => <RolesPage client={client} refresh={adminRefresh} onOpenRole={openRole} onAddRole={() => openOf(`admin:role-new:${c.id}`)} onChanged={() => { rolesChanged(c.id).catch(() => undefined) }} />),
				[`admin:role-new:${c.id}`, {
					title: `${t.newRole} · ${c.name}`,
					icon: <UserCog size={14} aria-hidden="true" />,
					render: () => <RolePage client={client} refresh={adminRefresh} onSaved={name => { rolesChanged(c.id).then(() => openRole(name), () => undefined) }} onRemoved={() => undefined} />
				}] as const,
				...(adminRoles[c.id] ?? []).map(name => [`admin:role:${c.id}:${name}`, {
					title: `${t.roleName}: ${name} · ${c.name}`,
					icon: <UserCog size={14} aria-hidden="true" />,
					render: () => <RolePage key={name} client={client} name={name} refresh={adminRefresh} onSaved={() => { rolesChanged(c.id).catch(() => undefined) }} onRemoved={() => { rolesChanged(c.id).catch(() => undefined) }} />
				}] as const),
				of('access', t.accessTitle, <KeyRound size={14} aria-hidden="true" />, () => <AccessPage client={client} onOpenRole={openRole} />),
				of('sessions', t.sessions, <Users size={14} aria-hidden="true" />, () => <div className="dg-pane"><h2>{t.sessions}</h2><SessionsPanel client={client} who={who} /></div>),
				of('approvals', t.approvals, <ClipboardCheck size={14} aria-hidden="true" />, () => <div className="dg-pane"><h2>{t.approvals}</h2><ApprovalsPanel client={client} self={who.name} /></div>),
				of('tools', t.tools, <Wrench size={14} aria-hidden="true" />, () => <div className="dg-pane"><ToolsOf connection={c} onOpen={tool => openOf(`${tool}:${c.id}`)} /></div>),
				signal('metrics', t.obsMetrics, <BarChart3 size={14} aria-hidden="true" />),
				signal('logs', t.obsLogs, <ScrollText size={14} aria-hidden="true" />),
				signal('traces', t.obsTraces, <Waypoints size={14} aria-hidden="true" />)
			]
		})),
		// its tools, with its credential
		...Object.fromEntries(connections.flatMap(c => (['swagger', 'websocket', 'mcp'] as const).map(tool => [`${tool}:${c.id}`, {
			title: `${tool === 'swagger' ? 'REST API' : tool === 'websocket' ? 'WebSocket' : 'MCP'} · ${c.name}`,
			icon: <Cable size={14} aria-hidden="true" />,
			render: () => <ToolTab connection={c} tool={tool} headers={() => headersOf(credentialOf(c, secrets))} theme={dark ? 'dark' : 'light'} />
		}])))
	}), [connections, secrets, whos, problems, t, dark, oidcTokens, adminRoles, adminRefresh])
	// where the IDE was (its tabs across the connections): in this browser; its active tab, told to the gateways as what
	// the person is looking at (session.activity)
	const session = useMemo(() => {
		const browser = new BrowserSessionStore('data-gateway-ide.session')
		return {
			load: () => browser.load(),
			save: (state: unknown) => {
				const kept = state as { tabs?: { kind: string, title: string, schema?: string }[], active?: number } | undefined
				const active = kept?.tabs?.[kept.active ?? -1]
				if (active) for (const { client } of clients.current.values()) client.activity({ schema: active.schema, tab: `${active.kind}: ${active.title}` })
				return browser.save(state)
			}
		}
	}, [])
	return (
		<div className="dg-page">
			<Workspace connections={specs} theme={dark ? 'dark' : 'light'} locale={locale} culture={culture} pages={pages} openPage={openPage} session={session}
				connectionsHeading={{
					title: t.connections,
					lead: <AppMenu onPreferences={() => openOf('preferences')} />,
					actions: <button type="button" className="lw-icon-button" aria-label={t.newConnection} title={t.newConnection} onClick={() => openOf('connection:new')}><Plus size={14} aria-hidden="true" /></button>
				}} />
		</div>
	)
}
