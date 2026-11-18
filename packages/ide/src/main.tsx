import './monacoWorkers'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Locale, LOCALES, Workspace } from '@lambdaorm/ui'
import '@lambdaorm/ui/styles.css'
import './app.css'
import { Texts, textsOf } from './texts'

type Kind = 'bearer' | 'apikey' | 'basic' | 'none'
type Page = 'home' | 'login' | 'queries'
type Theme = 'system' | 'light' | 'dark'

interface Credential { kind: Kind, header: string, user: string, secret: string }
interface Who { name: string, permissions: string[] }
interface SchemaState { path: string, status: string, reason?: string }

/** The REST API is the same origin, under the base path the UI is served at ({basePath}/ui/) */
const baseUrl = window.location.origin + window.location.pathname.replace(/\/ui\/?.*$/, '')
const docsUrl = `${baseUrl}/doc/`

const headersOf = (c: Credential): Record<string, string> => {
	switch (c.kind) {
	case 'bearer': return { Authorization: `Bearer ${c.secret}` }
	case 'apikey': return { [c.header]: c.secret }
	case 'basic': return { Authorization: `Basic ${btoa(`${c.user}:${c.secret}`)}` }
	default: return {}
	}
}

const pageOf = (hash: string): Page => hash === '#/login' ? 'login' : hash === '#/queries' ? 'queries' : 'home'
const go = (page: Page) => { window.location.hash = page === 'home' ? '#/' : `#/${page}` }

/** The choices of the viewer (theme, language) stay in the browser; the credential never does */
const stored = (key: string): string | undefined => { try { return window.localStorage.getItem(`data-gateway.${key}`) ?? undefined } catch { return undefined } }
const store = (key: string, value: string) => { try { window.localStorage.setItem(`data-gateway.${key}`, value) } catch { /* private window */ } }
const isLocale = (code: string | undefined): code is Locale => LOCALES.some(l => l.code === code)
const firstLocale = (): Locale => {
	const saved = stored('locale')
	if (isLocale(saved)) return saved
	const browser = (navigator.languages ?? [navigator.language]).map(l => l.slice(0, 2).toLowerCase()).find(isLocale)
	return browser ?? 'en'
}
const firstTheme = (): Theme => { const saved = stored('theme'); return saved === 'light' || saved === 'dark' ? saved : 'system' }

interface Prefs { t: Texts, locale: Locale, setLocale: (l: Locale) => void, theme: Theme, setTheme: (t: Theme) => void }
const PrefsContext = createContext<Prefs>(undefined as unknown as Prefs)
const usePrefs = () => useContext(PrefsContext)

const getJson = async (path: string, headers: Record<string, string> = {}) => {
	const response = await fetch(baseUrl + path, { headers })
	if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
	return response.json()
}

const Header: React.FC<{ version?: string, children?: React.ReactNode }> = ({ version, children }) => {
	const { t, locale, setLocale, theme, setTheme } = usePrefs()
	return (
		<header className="dg-header">
			<a className="dg-brand" href="#/">Data Gateway</a>
			{version && <span className="dg-version">{version}</span>}
			<span className="dg-spacer" />
			<select className="dg-pref" aria-label="theme" title={t.theme} value={theme} onChange={e => setTheme(e.target.value as Theme)}>
				<option value="system">{t.theme}: {t.themeSystem}</option>
				<option value="light">{t.theme}: {t.themeLight}</option>
				<option value="dark">{t.theme}: {t.themeDark}</option>
			</select>
			<select className="dg-pref" aria-label="language" title={t.language} value={locale} onChange={e => setLocale(e.target.value as Locale)}>
				{LOCALES.map(l => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
			</select>
			{children}
		</header>
	)
}

const Home: React.FC<{ version?: string, schemas?: SchemaState[], loggedIn: boolean }> = ({ version, schemas, loggedIn }) => {
	const { t } = usePrefs()
	return (
	<div className="dg-page">
		<Header version={version}>
			<a className="dg-link" href={docsUrl}>{t.apiDocs}</a>
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
				<div className="dg-card"><h3>REST API</h3><p>{t.restText} <a href={docsUrl}>{t.restDocs}</a>.</p></div>
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

const Login: React.FC<{ version?: string, onLogin: (credential: Credential, who: Who) => void }> = ({ version, onLogin }) => {
	const { t } = usePrefs()
	const [credential, setCredential] = useState<Credential>({ kind: 'apikey', header: 'X-Api-Key', user: '', secret: '' })
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const [visible, setVisible] = useState(false)
	const set = (patch: Partial<Credential>) => setCredential({ ...credential, ...patch })

	const submit = async (event: React.FormEvent) => {
		event.preventDefault()
		setError(undefined)
		setBusy(true)
		try {
			// the credential is checked against a schema that is ready (whoami needs one)
			const schemas: SchemaState[] = await getJson('/schemas')
			const schema = schemas.find(s => s.status === 'ready')
			if (!schema) throw new Error(t.noReady)
			const who: Who = await getJson(`${schema.path ? `/${schema.path}` : ''}/whoami`, headersOf(credential))
			onLogin(credential, who)
		} catch (e: any) {
			setError(e?.status === 401 || e?.status === 403 ? t.invalid : (e?.message ?? String(e)))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="dg-page">
			<Header version={version}><button onClick={() => go('home')}>{t.back}</button></Header>
			<main className="dg-login">
				<form onSubmit={submit} className="dg-form">
					<h1>{t.login}</h1>
					<p className="dg-muted">{t.loginNote}</p>
					<label>{t.authentication}
						<select aria-label="authentication" value={credential.kind} onChange={e => set({ kind: e.target.value as Kind })}>
							<option value="apikey">{t.apikey}</option>
							<option value="bearer">{t.bearer}</option>
							<option value="basic">{t.basic}</option>
							<option value="none">{t.none}</option>
						</select>
					</label>
					{credential.kind === 'apikey' && <label>{t.header}<input aria-label="header" value={credential.header} onChange={e => set({ header: e.target.value })} /></label>}
					{credential.kind === 'basic' && <label>{t.user}<input aria-label="user" value={credential.user} onChange={e => set({ user: e.target.value })} autoComplete="username" /></label>}
					{credential.kind !== 'none' && (
						<label>{credential.kind === 'basic' ? t.password : credential.kind === 'apikey' ? t.key : t.token}
							<span className="dg-secret">
								<input aria-label="secret" type={visible ? 'text' : 'password'} value={credential.secret} onChange={e => set({ secret: e.target.value.trim() })} autoComplete="current-password" autoFocus spellCheck={false} />
								<button type="button" aria-label={visible ? t.hide : t.show} aria-pressed={visible} title={visible ? t.hide : t.show} onClick={() => setVisible(!visible)}>{visible ? t.hide : t.show}</button>
							</span>
						</label>
					)}
					{error && <div className="dg-error" role="alert">{error}</div>}
					<button className="dg-primary dg-big" type="submit" disabled={busy}>{busy ? t.checking : t.login}</button>
				</form>
			</main>
		</div>
	)
}

const Queries: React.FC<{ version?: string, credential: Credential, who: Who, onLogout: () => void, dark: boolean }> = ({ version, credential, who, onLogout, dark }) => {
	const { t, locale } = usePrefs()
	const headers = useMemo(() => () => headersOf(credential), [credential])
	return (
		<div className="dg-page">
			<Header version={version}>
				<span className="dg-who">{who.name} · {who.permissions.join(', ')}</span>
				<a className="dg-link" href={docsUrl}>{t.apiDocs}</a>
				<button onClick={onLogout}>{t.logout}</button>
			</Header>
			{/* what is saved is kept per gateway and per user of the credential */}
			<Workspace baseUrl={baseUrl} headers={headers} theme={dark ? 'dark' : 'light'} locale={locale} workspaceKey={`${baseUrl}|${who.name}`} />
		</div>
	)
}

const App: React.FC = () => {
	const [page, setPage] = useState<Page>(pageOf(window.location.hash))
	const [session, setSession] = useState<{ credential: Credential, who: Who }>()
	const [version, setVersion] = useState<string>()
	const [schemas, setSchemas] = useState<SchemaState[]>()
	const [locale, setLocaleState] = useState<Locale>(firstLocale)
	const [theme, setThemeState] = useState<Theme>(firstTheme)
	const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
	const dark = theme === 'dark' || (theme === 'system' && systemDark)
	const prefs = useMemo<Prefs>(() => ({
		t: textsOf(locale),
		locale,
		setLocale: (l: Locale) => { setLocaleState(l); store('locale', l) },
		theme,
		setTheme: (t: Theme) => { setThemeState(t); store('theme', t) }
	}), [locale, theme])

	useEffect(() => { document.documentElement.lang = locale }, [locale])
	useEffect(() => {
		const query = window.matchMedia?.('(prefers-color-scheme: dark)')
		if (!query) return
		const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
		query.addEventListener('change', onChange)
		return () => query.removeEventListener('change', onChange)
	}, [])

	useEffect(() => {
		const onHash = () => setPage(pageOf(window.location.hash))
		window.addEventListener('hashchange', onHash)
		return () => window.removeEventListener('hashchange', onHash)
	}, [])
	useEffect(() => {
		getJson('/version').then(v => setVersion(v.version), () => undefined)
		getJson('/schemas').then(setSchemas, () => setSchemas([]))
	}, [])
	// the queries need a session: without one (a reload forgot it), the login
	useEffect(() => { if (page === 'queries' && !session) go('login') }, [page, session])

	// the page changes with the session, not after the hashchange: else the queries see no session and send to login
	const login = useCallback((credential: Credential, who: Who) => { setSession({ credential, who }); setPage('queries'); go('queries') }, [])
	const logout = useCallback(() => { setSession(undefined); setPage('home'); go('home') }, [])

	return (
		<PrefsContext.Provider value={prefs}>
		<div className={`dg-app ${dark ? 'dark' : ''}`}>
			{page === 'home' && <Home version={version} schemas={schemas} loggedIn={!!session} />}
			{page === 'login' && <Login version={version} onLogin={login} />}
			{page === 'queries' && session && <Queries version={version} credential={session.credential} who={session.who} onLogout={logout} dark={dark} />}
		</div>
		</PrefsContext.Provider>
	)
}

createRoot(document.getElementById('root')!).render(<App />)
