import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { culturePreview, Locale, LOCALES, validCulture } from '@lambdaorm/ui'
import { Check, Minus } from 'lucide-react'
import { CULTURES, THEMES, ThemeColors, themeOf, themeVariables } from './themes'
import { Texts, textsOf } from './texts'
import { ADMIN_PERMISSIONS, DATA_PERMISSIONS, permissionTextsOf } from './permissions'

/** How a credential authenticates to a data-gateway (the IDE: each connection its own; the gateway's UI: its login) */
export type Kind = 'bearer' | 'apikey' | 'basic' | 'none'
export type Theme = string
export interface Credential { kind: Kind, header: string, user: string, secret: string }
export interface Who { name: string, permissions: string[] }
export interface SchemaState { path: string, status: string, reason?: string }

/** The documentation of the data-gateway in the wiki, in the language of the page (or the nearest one it has) */
const WIKI_LANGUAGES: Record<string, string> = { en: '', es: 'es/', pt: 'pt/', de: 'de/', ca: 'es/', gl: 'es/', eu: 'es/' }
export const wikiUrl = (locale: string) => `https://lambda-orm.github.io/wiki/${WIKI_LANGUAGES[locale] ?? ''}data-gateway/`
/** a link that opens in another tab of the browser (the session of this one stays) */
export const OUT = { target: '_blank', rel: 'noopener noreferrer' } as const

export const headersOf = (c: Credential): Record<string, string> => {
	switch (c.kind) {
	case 'bearer': return { Authorization: `Bearer ${c.secret}` }
	case 'apikey': return { [c.header]: c.secret }
	case 'basic': return { Authorization: `Basic ${btoa(`${c.user}:${c.secret}`)}` }
	default: return {}
	}
}

/** The choices of the viewer (theme, language, culture) stay in this browser */
export const stored = (key: string): string | undefined => { try { return window.localStorage.getItem(`data-gateway.${key}`) ?? undefined } catch { return undefined } }
export const store = (key: string, value: string) => { try { window.localStorage.setItem(`data-gateway.${key}`, value) } catch { /* private window */ } }
const isLocale = (code: string | undefined): code is Locale => LOCALES.some(l => l.code === code)
const firstLocale = (): Locale => {
	const saved = stored('locale')
	if (isLocale(saved)) return saved
	const browser = (navigator.languages ?? [navigator.language]).map(l => l.slice(0, 2).toLowerCase()).find(isLocale)
	return browser ?? 'en'
}
const firstTheme = (): Theme => { const saved = stored('theme'); return saved && THEMES.some(t => t.id === saved) ? saved : 'system' }
/** the culture of the numbers and dates: the one chosen, else the browser's */
const firstCulture = (): string => { const saved = stored('culture'); return saved && validCulture(saved) ? saved : (validCulture(navigator.language) ? navigator.language : 'en-US') }

export interface Prefs { t: Texts, locale: Locale, setLocale: (l: Locale) => void, theme: Theme, setTheme: (t: Theme) => void, culture: string, setCulture: (c: string) => void }
const PrefsContext = createContext<Prefs>(undefined as unknown as Prefs)
export const usePrefs = () => useContext(PrefsContext)

/** A GET of a data-gateway (its base URL: http://host:port/{basePath}) */
export const getJson = async (base: string, path: string, headers: Record<string, string> = {}) => {
	const response = await fetch(base.replace(/\/+$/, '') + path, { headers })
	if (!response.ok) {
		// the error of the gateway, or of the backend of the IDE (a target it may not reach, a gateway it can't reach)
		const body = await response.json().catch(() => undefined)
		throw Object.assign(new Error(body?.message ?? `HTTP ${response.status}`), { status: response.status, error: body?.error })
	}
	return response.json()
}

/** A window over the page: its title, what it shows, Close (Escape or a click outside close it too) */
export const Dialog: React.FC<{ title: string, onClose: () => void, children: React.ReactNode }> = ({ title, onClose, children }) => {
	const { t } = usePrefs()
	useEffect(() => {
		const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
		document.addEventListener('keydown', escape)
		return () => document.removeEventListener('keydown', escape)
	}, [onClose])
	return (
		<div className="dg-dialog-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
			<div className="dg-dialog" role="dialog" aria-modal="true" aria-label={title}>
				<h2>{title}</h2>
				{children}
				<div className="dg-dialog-actions"><button onClick={onClose} autoFocus>{t.close}</button></div>
			</div>
		</div>
	)
}

/** The name of a culture in the language of the page (es-AR → español (Argentina)) */
const cultureName = (culture: string, locale: string): string => {
	try { return `${new Intl.DisplayNames([locale], { type: 'language' }).of(culture) ?? culture} · ${culture}` } catch { return culture }
}

/** How a credential authenticates, without its secret */
export const authenticationOf = (c: Credential, t: Texts): string =>
	c.kind === 'apikey' ? `${t.apikey} (${t.headerName} ${c.header})` : c.kind === 'basic' ? `${t.basic} (${c.user})` : c.kind === 'bearer' ? t.bearer : t.none

/** A theme previewed with its own colors (not those of the page): a card with a text, a muted line and a button */
const ThemeSwatch: React.FC<{ label: string, selected: boolean, colors: ThemeColors, split?: ThemeColors, onPick: () => void }> = ({ label, selected, colors, split, onPick }) => {
	const half = (c: ThemeColors, side: 'left' | 'right' | 'full') => (
		<span className={`dg-swatch-half dg-swatch-${side}`} style={{ background: c.background }}>
			<span className="dg-swatch-card" style={{ background: c.surface, borderColor: c.border }}>
				<span className="dg-swatch-line" style={{ background: c.text, width: '70%' }} />
				<span className="dg-swatch-line" style={{ background: c.muted, width: '45%' }} />
				<span className="dg-swatch-pill" style={{ background: c.primary }} />
			</span>
		</span>
	)
	return (
		<button type="button" role="radio" aria-checked={selected} aria-label={label} className={`dg-swatch ${selected ? 'dg-selected' : ''}`} onClick={onPick}>
			<span className="dg-swatch-preview">{split ? <>{half(colors, 'left')}{half(split, 'right')}</> : half(colors, 'full')}</span>
			<span className="dg-swatch-label">{label}</span>
		</button>
	)
}

/** The preferences: the language (pills), the regional format and the theme (previews), as Ilusor shows them */
export const PreferencesPage: React.FC = () => {
	const { t, locale, setLocale, theme, setTheme, culture, setCulture } = usePrefs()
	const light = THEMES.find(x => x.id === 'light')!.colors
	const dark = THEMES.find(x => x.id === 'dark')!.colors
	return (
		<div className="dg-pane">
			<h2>{t.preferences}</h2>
			<section className="dg-card">
				<div className="dg-pick-row">
					<span className="dg-row-label">{t.language}</span>
					<span className="dg-pills" role="radiogroup" aria-label={t.language}>
						{LOCALES.map(l => (
							<button key={l.code} type="button" role="radio" aria-checked={locale === l.code} lang={l.code}
								className={`dg-pill ${locale === l.code ? 'dg-selected' : ''}`} onClick={() => setLocale(l.code)}>{l.name}</button>
						))}
					</span>
				</div>
				<div className="dg-pick-row">
					<span className="dg-row-label">{t.culture}</span>
					<span className="dg-culture">
						<select aria-label={t.culture} value={culture} onChange={e => setCulture(e.target.value)}>
							{[...new Set([...CULTURES, culture])].map(c => <option key={c} value={c}>{cultureName(c, locale)}</option>)}
						</select>
						<span className="dg-muted">{t.cultureNote}</span>
						<code className="dg-culture-preview">{culturePreview(culture)}</code>
					</span>
				</div>
				<div className="dg-theme-block">
					<span className="dg-row-label">{t.theme}</span>
					<span className="dg-theme-grid" role="radiogroup" aria-label={t.theme}>
						<ThemeSwatch label={t.themeSystem} selected={theme === 'system'} colors={light} split={dark} onPick={() => setTheme('system')} />
						{THEMES.map(x => (
							<ThemeSwatch key={x.id} label={x.id === 'light' ? t.themeLight : x.id === 'dark' ? t.themeDark : x.name} selected={theme === x.id} colors={x.colors} onPick={() => setTheme(x.id)} />
						))}
					</span>
				</div>
			</section>
		</div>
	)
}

/** What the credential of a connection may do: each permission of the gateway with what it allows */
export const PermissionsOf: React.FC<{ who: Who }> = ({ who }) => {
	const { locale } = usePrefs()
	const p = permissionTextsOf(locale)
	const granted = new Set(who.permissions)
	const others = who.permissions.filter(x => !DATA_PERMISSIONS.includes(x) && !ADMIN_PERMISSIONS.includes(x))
	const group = (title: string, names: string[]) => (
		<section className="dg-card">
			<h3>{title} <span className="dg-muted">{names.filter(n => granted.has(n)).length} / {names.length}</span></h3>
			<ul className="dg-permissions">
				{names.map(name => (
					<li key={name} className={granted.has(name) ? 'dg-granted' : 'dg-denied'}>
						<span className="dg-permission-mark" aria-hidden="true">{granted.has(name) ? <Check size={16} /> : <Minus size={16} />}</span>
						<span className="dg-permission-text">
							<code>{name}</code> <span className="dg-muted">{granted.has(name) ? p.granted : p.notGranted}</span>
							<span className="dg-permission-description">{p[name] ?? ''}</span>
						</span>
					</li>
				))}
			</ul>
		</section>
	)
	return (
		<>
			{group(p.data, DATA_PERMISSIONS)}
			{group(p.admin, ADMIN_PERMISSIONS)}
			{others.length > 0 && group(p.other, others)}
		</>
	)
}

/**
 * A connection to a data-gateway: where it is, how it authenticates, who that credential is and what it may do (its
 * roles). The IDE puts its form above (children); the gateway's UI shows its current connection.
 */
export const ConnectionPage: React.FC<{ name: string, url: string, credential: Credential, who?: Who, current?: boolean, children?: React.ReactNode, tools?: React.ReactNode, sessions?: React.ReactNode }> = ({ name, url, credential, who, current, children, tools, sessions }) => {
	const { t } = usePrefs()
	// its sections in tabs: the connection (its form and who it is), its tools, its roles, its sessions
	const sections = [
		{ key: 'connection', label: t.connection, show: true },
		{ key: 'tools', label: t.tools, show: !!tools },
		{ key: 'roles', label: t.roles, show: !!who },
		{ key: 'sessions', label: t.sessions, show: !!sessions }
	].filter(s => s.show)
	const [section, setSection] = useState('connection')
	const active = sections.some(s => s.key === section) ? section : 'connection'
	return (
		<div className="dg-pane">
			<h2>{t.connection}: {name}{current && <span className="dg-badge">{t.current}</span>}</h2>
			{sections.length > 1 && (
				<div className="dg-sections" role="tablist" aria-label={`${t.connection}: ${name}`}>
					{sections.map(s => (
						<button key={s.key} type="button" role="tab" aria-selected={s.key === active} className={s.key === active ? 'dg-section-active' : ''} onClick={() => setSection(s.key)}>{s.label}</button>
					))}
				</div>
			)}
			{active === 'connection' && (
				<>
					{children}
					<section className="dg-card dg-account-card">
						<span className="dg-avatar" aria-hidden="true">{(who?.name ?? name).slice(0, 1).toUpperCase()}</span>
						<span>
							<strong className="dg-account-title">{who?.name ?? t.notConnected}</strong>
							<span className="dg-muted"><code>{url}</code></span>
							<span className="dg-muted">{t.accountAuthentication}: {authenticationOf(credential, t)}</span>
						</span>
					</section>
				</>
			)}
			{active === 'tools' && tools}
			{active === 'roles' && who && <PermissionsOf who={who} />}
			{active === 'sessions' && sessions}
		</div>
	)
}

/** What a connection opens in tabs (with its credential): its REST API, its WebSocket, its MCP */
export const ConnectionTools: React.FC<{ available: { swagger: boolean, webSocket: boolean, mcp: boolean }, onOpen: (tool: 'swagger' | 'websocket' | 'mcp') => void }> = ({ available, onOpen }) => {
	const { t } = usePrefs()
	const tool = (key: 'swagger' | 'websocket' | 'mcp', label: string, on: boolean) => (
		<button type="button" disabled={!on} title={on ? label : `${label}: ${t.notExposed}`} onClick={() => onOpen(key)}>{label}</button>
	)
	return (
		<section className="dg-card">
			<h3>{t.tools}</h3>
			<span className="dg-form-actions">
				{tool('swagger', t.openSwagger, available.swagger)}
				{tool('websocket', t.openWebSocket, available.webSocket)}
				{tool('mcp', t.openMcp, available.mcp)}
			</span>
		</section>
	)
}

/** A menu of the header (an icon, maybe a name, its items) */
export const HeaderMenu: React.FC<{ label: string, icon: React.ReactNode, name?: string, title?: string, items: { label: string, icon: React.ReactNode, onClick: () => void }[] }> = ({ label, icon, name, title, items }) => {
	const [open, setOpen] = useState(false)
	const box = React.useRef<HTMLSpanElement>(null)
	useEffect(() => {
		if (!open) return
		const outside = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
		const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
		document.addEventListener('mousedown', outside)
		document.addEventListener('keydown', escape)
		return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
	}, [open])
	return (
		<span className="dg-account" ref={box}>
			<button className="dg-account-button" aria-label={label} title={title ?? label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
				{icon}
				{name && <span className="dg-account-name">{name}</span>}
			</button>
			{open && (
				<span className="dg-menu" role="menu">
					{items.map(item => <button key={item.label} role="menuitem" onClick={() => { setOpen(false); item.onClick() }}>{item.icon} {item.label}</button>)}
				</span>
			)}
		</span>
	)
}

export const Header: React.FC<{ brand: string, version?: string, children?: React.ReactNode, menu: React.ReactNode }> = ({ brand, version, children, menu }) => (
	<header className="dg-header">
		<a className="dg-brand" href="#/">{brand}</a>
		{version && <span className="dg-version">{version}</span>}
		<span className="dg-spacer" />
		{children}
		{menu}
	</header>
)

/** what a browser says of a module of the page that is not there any more */
const STALE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|older than the gateway/i

/**
 * The frame of both apps: the preferences (language, theme, culture) given to what is inside, the theme on the page, and
 * the notice that the page is older than what serves it (reload).
 */
export const AppShell: React.FC<{ children: (dark: boolean) => React.ReactNode }> = ({ children }) => {
	const [locale, setLocaleState] = useState<Locale>(firstLocale)
	const [theme, setThemeState] = useState<Theme>(firstTheme)
	const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
	const resolved = themeOf(theme, systemDark)
	const [culture, setCultureState] = useState<string>(firstCulture)
	const prefs = useMemo<Prefs>(() => ({
		t: textsOf(locale),
		locale,
		setLocale: (l: Locale) => { setLocaleState(l); store('locale', l) },
		theme,
		setTheme: (t: Theme) => { setThemeState(t); store('theme', t) },
		culture,
		setCulture: (c: string) => { setCultureState(c); store('culture', c) }
	}), [locale, theme, culture])

	useEffect(() => { document.documentElement.lang = locale }, [locale])
	useEffect(() => {
		const query = window.matchMedia?.('(prefers-color-scheme: dark)')
		if (!query) return
		const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
		query.addEventListener('change', onChange)
		return () => query.removeEventListener('change', onChange)
	}, [])
	// updated while this page was open: its old assets (a diagram's ELK, an editor's worker) are gone
	const [stale, setStale] = useState(false)
	useEffect(() => {
		const onPreload = (e: Event) => { e.preventDefault(); setStale(true) }
		const onRejection = (e: PromiseRejectionEvent) => { if (STALE.test(String(e.reason?.message ?? e.reason))) setStale(true) }
		window.addEventListener('vite:preloadError', onPreload)
		window.addEventListener('unhandledrejection', onRejection)
		return () => { window.removeEventListener('vite:preloadError', onPreload); window.removeEventListener('unhandledrejection', onRejection) }
	}, [])
	return (
		<PrefsContext.Provider value={prefs}>
			<div className={`dg-app ${resolved.dark ? 'dark' : ''}`} data-theme={resolved.id} style={themeVariables(resolved) as React.CSSProperties}>
				{stale && (
					<div className="dg-stale" role="alert">
						<span>{prefs.t.updated}</span>
						<button className="dg-primary" onClick={() => window.location.reload()}>{prefs.t.reload}</button>
					</div>
				)}
				{children(resolved.dark)}
			</div>
		</PrefsContext.Provider>
	)
}

/** How a credential authenticates: its kind, its header or user, and its secret (shown on demand) */
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
