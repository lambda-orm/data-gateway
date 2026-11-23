import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Workspace } from '@lambdaorm/ui'
import { endpointsOf, McpTab, SwaggerTab, useTransports, WebSocketTab } from './tools'
import { Cable, CircleUser, LogOut, Settings } from 'lucide-react'
import { Credential, ConnectionPage, ConnectionTools, Dialog, getJson, Header, HeaderMenu, headersOf, Kind, OUT, PreferencesPage, SchemaState, usePrefs, Who, whoIs, wikiUrl } from './shared'

/**
 * The IDE served by a data-gateway at {basePath}/ui (embedded mode): its home, its login, and the workspace on the
 * gateway that serves it, its one connection (the current one).
 */
type Page = 'home' | 'login' | 'queries'

/** The REST API is the same origin, under the base path the UI is served at ({basePath}/ui/) */
const baseUrl = window.location.origin + window.location.pathname.replace(/\/ui\/?.*$/, '')
const docsUrl = `${baseUrl}/doc/`
/** the name of its connection: where the gateway is (shown with the mark of the current one) */
const hostName = window.location.host

const pageOf = (hash: string): Page => hash === '#/login' ? 'login' : hash === '#/queries' ? 'queries' : 'home'
const go = (page: Page) => { window.location.hash = page === 'home' ? '#/' : `#/${page}` }

/**
 * The credential stays in this tab (sessionStorage: a reload keeps it, closing the tab forgets it), or in the browser
 * when the viewer asks to be remembered (localStorage)
 */
const CREDENTIAL = 'data-gateway.credential'
const keptCredential = (): Credential | undefined => {
	for (const storage of [() => window.sessionStorage, () => window.localStorage]) {
		try {
			const text = storage().getItem(CREDENTIAL)
			const value = text ? JSON.parse(text) : undefined
			if (value && typeof value.secret === 'string' && typeof value.kind === 'string') return value
		} catch { /* no storage */ }
	}
	return undefined
}
const keepCredential = (credential: Credential | undefined, remember = false) => {
	for (const [storage, here] of [[() => window.sessionStorage, !remember], [() => window.localStorage, remember]] as const) {
		try { if (credential && here) storage().setItem(CREDENTIAL, JSON.stringify(credential)); else storage().removeItem(CREDENTIAL) } catch { /* private window */ }
	}
}

/** The menu of the header: the connection (when logged in), the preferences, logout */
const Menu: React.FC<{ session?: { who: Who, onLogout: () => void }, onOpenPage?: (page: string) => void, credential?: Credential }> = ({ session, onOpenPage, credential }) => {
	const { t } = usePrefs()
	const [showing, setShowing] = useState<'connection' | 'preferences'>()
	const open = (page: 'connection' | 'preferences') => { if (onOpenPage) onOpenPage(page === 'connection' ? 'connection:current' : page); else setShowing(page) }
	return (
		<>
			<HeaderMenu label={t.account} icon={<CircleUser size={20} strokeWidth={1.75} aria-hidden="true" />} name={session?.who.name} title={session?.who.name ?? t.notLoggedIn}
				items={[
					...(session ? [{ label: t.connection, icon: <Cable size={16} aria-hidden="true" />, onClick: () => open('connection') }] : []),
					{ label: t.preferences, icon: <Settings size={16} aria-hidden="true" />, onClick: () => open('preferences') },
					...(session ? [{ label: t.logout, icon: <LogOut size={16} aria-hidden="true" />, onClick: session.onLogout }] : [])
				]} />
			{showing === 'connection' && session && credential && <Dialog title={t.connection} onClose={() => setShowing(undefined)}><ConnectionPage name={hostName} url={baseUrl} credential={credential} who={session.who} current /></Dialog>}
			{showing === 'preferences' && <Dialog title={t.preferences} onClose={() => setShowing(undefined)}><PreferencesPage /></Dialog>}
		</>
	)
}

const Home: React.FC<{ version?: string, schemas?: SchemaState[], loggedIn: boolean }> = ({ version, schemas, loggedIn }) => {
	const { t, locale } = usePrefs()
	return (
		<div className="dg-page">
			<Header brand="Data Gateway" version={version} menu={<Menu />}>
				<a className="dg-link" href={docsUrl} {...OUT}>{t.apiDocs}</a>
				<a className="dg-link" href={wikiUrl(locale)} {...OUT}>{t.documentation}</a>
				<button className="dg-primary" onClick={() => go(loggedIn ? 'queries' : 'login')}>{loggedIn ? t.queries : t.login}</button>
			</Header>
			<main className="dg-home">
				<section className="dg-hero">
					<h1>Data Gateway</h1>
					<p className="dg-lead">{t.lead}</p>
					<p>
						{t.queriesAre} <code>Orders.filter(o =&gt; o.customer.country == 'France').include(o =&gt; o.details)</code>. {t.translated}
					</p>
					<button className="dg-primary dg-big" onClick={() => go(loggedIn ? 'queries' : 'login')}>{loggedIn ? t.goToQueries : t.login}</button>
				</section>
				<section className="dg-cards">
					<div className="dg-card"><h3>{t.workbenchTitle}</h3><p>{t.workbenchText}</p></div>
					<div className="dg-card"><h3>REST API</h3><p>{t.restText} <a href={docsUrl} {...OUT}>{t.restDocs}</a>.</p></div>
					<div className="dg-card"><h3>{t.mcpTitle}</h3><p>{t.mcpText}</p></div>
				</section>
				<section className="dg-schemas">
					<h2>{t.schemas}</h2>
					{!schemas && <p className="dg-muted">{t.loading}</p>}
					{schemas && schemas.length === 0 && <p className="dg-muted">{t.noSchemas}</p>}
					{schemas && schemas.length > 0 && (
						<table>
							<thead><tr><th>{t.route}</th><th>{t.status}</th></tr></thead>
							<tbody>
								{schemas.map(s => (
									<tr key={s.path}>
										<td><code>/{s.path}</code></td>
										<td><span className={`dg-status dg-${s.status}`}>{s.status}</span>{s.reason && <span className="dg-muted"> {s.reason}</span>}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</section>
			</main>
		</div>
	)
}

/** The fields of a credential (the login here; each connection in the IDE) */
export const CredentialFields: React.FC<{ credential: Credential, onChange: (patch: Partial<Credential>) => void, autoFocus?: boolean }> = ({ credential, onChange, autoFocus }) => {
	const { t } = usePrefs()
	const [visible, setVisible] = useState(false)
	return (
		<>
			<label>{t.authentication}
				<select aria-label="authentication" value={credential.kind} onChange={e => onChange({ kind: e.target.value as Kind })}>
					<option value="apikey">{t.apikey}</option>
					<option value="bearer">{t.bearer}</option>
					<option value="basic">{t.basic}</option>
					<option value="none">{t.none}</option>
				</select>
			</label>
			{credential.kind === 'apikey' && <label>{t.header}<input aria-label="header" value={credential.header} onChange={e => onChange({ header: e.target.value })} /></label>}
			{credential.kind === 'basic' && <label>{t.user}<input aria-label="user" value={credential.user} onChange={e => onChange({ user: e.target.value })} autoComplete="username" /></label>}
			{credential.kind !== 'none' && (
				<label>{credential.kind === 'basic' ? t.password : credential.kind === 'apikey' ? t.key : t.token}
					<span className="dg-secret">
						<input aria-label="secret" type={visible ? 'text' : 'password'} value={credential.secret} onChange={e => onChange({ secret: e.target.value.trim() })} autoComplete="current-password" autoFocus={autoFocus} spellCheck={false} />
						<button type="button" aria-label={visible ? t.hide : t.show} aria-pressed={visible} title={visible ? t.hide : t.show} onClick={() => setVisible(!visible)}>{visible ? t.hide : t.show}</button>
					</span>
				</label>
			)}
		</>
	)
}

const Login: React.FC<{ version?: string, onLogin: (credential: Credential, who: Who, remember: boolean) => void }> = ({ version, onLogin }) => {
	const { t } = usePrefs()
	const [credential, setCredential] = useState<Credential>({ kind: 'apikey', header: 'X-Api-Key', user: '', secret: '' })
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const [remember, setRemember] = useState(false)
	const submit = async (event: React.FormEvent) => {
		event.preventDefault()
		setError(undefined)
		setBusy(true)
		try {
			onLogin(credential, await whoIs(baseUrl, credential, t.noReady), remember)
		} catch (e: any) {
			setError(e?.status === 401 || e?.status === 403 ? t.invalid : (e?.message ?? String(e)))
		} finally {
			setBusy(false)
		}
	}
	return (
		<div className="dg-page">
			<Header brand="Data Gateway" version={version} menu={<Menu />}><button onClick={() => go('home')}>{t.back}</button></Header>
			<main className="dg-login">
				<form onSubmit={submit} className="dg-form">
					<h1>{t.login}</h1>
					<p className="dg-muted">{t.loginNote}</p>
					<CredentialFields credential={credential} onChange={patch => setCredential({ ...credential, ...patch })} autoFocus />
					{credential.kind !== 'none' && (
						<label className="dg-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> {t.remember}</label>
					)}
					{error && <div className="dg-error" role="alert">{error}</div>}
					<button className="dg-primary dg-big" type="submit" disabled={busy}>{busy ? t.checking : t.login}</button>
				</form>
			</main>
		</div>
	)
}

/** The tools of this gateway: those it exposes */
const CurrentTools: React.FC<{ onOpen: (tool: 'swagger' | 'websocket' | 'mcp') => void }> = ({ onOpen }) => {
	const endpoints = endpointsOf(baseUrl, useTransports(baseUrl))
	return <ConnectionTools available={{ swagger: !!endpoints.openapi, webSocket: !!endpoints.webSocket, mcp: !!endpoints.mcp }} onOpen={onOpen} />
}
const CurrentTool: React.FC<{ tool: 'swagger' | 'websocket' | 'mcp', headers: () => Record<string, string>, theme: 'light' | 'dark' }> = ({ tool, headers, theme }) => {
	const endpoints = endpointsOf(baseUrl, useTransports(baseUrl))
	return tool === 'swagger' ? <SwaggerTab endpoints={endpoints} headers={headers} /> : tool === 'websocket' ? <WebSocketTab endpoints={endpoints} headers={headers} theme={theme} /> : <McpTab endpoints={endpoints} headers={headers} theme={theme} />
}

/** The workspace on this gateway: its one connection, the current one */
const Queries: React.FC<{ version?: string, credential: Credential, who: Who, onLogout: () => void, dark: boolean }> = ({ version, credential, who, onLogout, dark }) => {
	const { t, locale, culture } = usePrefs()
	const headers = useMemo(() => () => headersOf(credential), [credential])
	const [openPage, setOpenPage] = useState<{ key: string, at: number }>()
	const openOf = (key: string) => setOpenPage({ key, at: Date.now() })
	const pages = useMemo(() => ({
		'connection:current': { title: `${t.connection}: ${hostName}`, icon: <Cable size={14} aria-hidden="true" />, render: () => <ConnectionPage name={hostName} url={baseUrl} credential={credential} who={who} current tools={<CurrentTools onOpen={tool => openOf(`${tool}:current`)} />} /> },
		'swagger:current': { title: 'REST API', icon: <Cable size={14} aria-hidden="true" />, render: () => <CurrentTool tool="swagger" headers={headers} theme={dark ? 'dark' : 'light'} /> },
		'websocket:current': { title: 'WebSocket', icon: <Cable size={14} aria-hidden="true" />, render: () => <CurrentTool tool="websocket" headers={headers} theme={dark ? 'dark' : 'light'} /> },
		'mcp:current': { title: 'MCP', icon: <Cable size={14} aria-hidden="true" />, render: () => <CurrentTool tool="mcp" headers={headers} theme={dark ? 'dark' : 'light'} /> },
		preferences: { title: t.preferences, icon: <Settings size={14} aria-hidden="true" />, render: () => <PreferencesPage /> }
	}), [t, who, credential, headers, dark])
	// what is saved is kept per gateway and per user of the credential
	const connections = useMemo(() => [{
		id: 'current',
		name: hostName,
		description: baseUrl,
		current: true,
		baseUrl,
		headers,
		workspaceKey: `${baseUrl}|${who.name}`,
		actions: <button type="button" className="lw-icon-button" aria-label={`${t.connection} ${hostName}`} title={t.connection} onClick={() => openOf('connection:current')}><Cable size={14} aria-hidden="true" /></button>
	}], [t, headers, who])
	return (
		<div className="dg-page">
			<Header brand="Data Gateway" version={version} menu={<Menu session={{ who, onLogout }} credential={credential} onOpenPage={openOf} />}>
				<a className="dg-link" href={docsUrl} {...OUT}>{t.apiDocs}</a>
				<a className="dg-link" href={wikiUrl(locale)} {...OUT}>{t.documentation}</a>
			</Header>
			<Workspace connections={connections} theme={dark ? 'dark' : 'light'} locale={locale} culture={culture} pages={pages} openPage={openPage} />
		</div>
	)
}

export const EmbeddedApp: React.FC<{ dark: boolean }> = ({ dark }) => {
	const [page, setPage] = useState<Page>(pageOf(window.location.hash))
	const [session, setSession] = useState<{ credential: Credential, who: Who }>()
	const [version, setVersion] = useState<string>()
	const [schemas, setSchemas] = useState<SchemaState[]>()
	useEffect(() => {
		const onHash = () => setPage(pageOf(window.location.hash))
		window.addEventListener('hashchange', onHash)
		return () => window.removeEventListener('hashchange', onHash)
	}, [])
	useEffect(() => {
		getJson(baseUrl, '/version').then(v => setVersion(v.version), () => undefined)
		getJson(baseUrl, '/schemas').then(setSchemas, () => setSchemas([]))
	}, [])
	// a kept credential (a reload): checked again, and the page stays where it was
	const [resuming, setResuming] = useState(() => keptCredential() !== undefined)
	useEffect(() => {
		const credential = keptCredential()
		if (!credential) return
		whoIs(baseUrl, credential, 'no schema ready')
			.then(who => setSession({ credential, who }))
			.catch(e => { if (e?.status === 401 || e?.status === 403) keepCredential(undefined) })
			.finally(() => setResuming(false))
	}, [])
	// the queries need a session: without one (none kept, or no longer valid), the login
	useEffect(() => { if (page === 'queries' && !session && !resuming) go('login') }, [page, session, resuming])
	// the page changes with the session, not after the hashchange: else the queries see no session and send to login
	const login = useCallback((credential: Credential, who: Who, remember: boolean) => { keepCredential(credential, remember); setSession({ credential, who }); setPage('queries'); go('queries') }, [])
	const logout = useCallback(() => { keepCredential(undefined); setSession(undefined); setPage('home'); go('home') }, [])
	return (
		<>
			{page === 'home' && <Home version={version} schemas={schemas} loggedIn={!!session} />}
			{page === 'login' && <Login version={version} onLogin={login} />}
			{page === 'queries' && session && <Queries version={version} credential={session.credential} who={session.who} onLogout={logout} dark={dark} />}
		</>
	)
}
