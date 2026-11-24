import React, { useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronDown, Info, RefreshCw, Settings } from 'lucide-react'
import { OUT, usePrefs, wikiUrl } from './shared'

/** The name of the app */
export const APP_NAME = 'λORM Data Gateway'
const REPOSITORY = 'https://github.com/lambda-orm/data-gateway'
const RELEASES = 'https://api.github.com/repos/lambda-orm/data-gateway/releases?per_page=30'
const IMAGE = 'flaviorita/data-gateway-ide'

/** What the desktop app gives the page (preload.cjs): its proxy, its version, its platform and its check of updates */
interface Desktop { version?: string, platform?: string, checkForUpdates?: () => Promise<void> }
const desktop = (): Desktop | undefined => (window as { ideDesktop?: Desktop }).ideDesktop

const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? `{${k}}`)

/** 1.10.0 > 1.9.2; a prerelease (1.1.0-rc.1) is older than its release (as the desktop app compares them) */
export const newer = (a: string, b: string): boolean => {
	const parse = (v: string) => { const [main, pre] = v.replace(/^v/, '').split('-'); return { parts: main.split('.').map(Number), pre } }
	const x = parse(a)
	const y = parse(b)
	for (let i = 0; i < 3; i++) if ((x.parts[i] ?? 0) !== (y.parts[i] ?? 0)) return (x.parts[i] ?? 0) > (y.parts[i] ?? 0)
	if (x.pre && !y.pre) return false
	if (!x.pre && y.pre) return true
	return (x.pre ?? '') > (y.pre ?? '')
}

/** The latest release of the IDE (its tags are ide-v<version>), from the API of GitHub */
const latestRelease = async (): Promise<{ version: string, url: string } | undefined> => {
	const response = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } })
	if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
	const releases = await response.json() as { tag_name?: string, html_url: string, draft?: boolean, prerelease?: boolean }[]
	const release = releases.find(r => !r.draft && !r.prerelease && typeof r.tag_name === 'string' && r.tag_name.startsWith('ide-v'))
	return release ? { version: release.tag_name!.slice('ide-v'.length), url: release.html_url } : undefined
}

/**
 * The menu of the app, by the connections: λORM, with its preferences, the wiki, the update to the latest version (the
 * desktop app by itself; the web one, its image) and about.
 */
export const AppMenu: React.FC<{ onPreferences: () => void }> = ({ onPreferences }) => {
	const { t, locale } = usePrefs()
	const [open, setOpen] = useState(false)
	const [dialog, setDialog] = useState<'update' | 'about'>()
	const box = useRef<HTMLSpanElement>(null)
	useEffect(() => {
		if (!open) return
		const outside = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
		const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
		document.addEventListener('mousedown', outside)
		document.addEventListener('keydown', escape)
		return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
	}, [open])
	const update = () => {
		const app = desktop()
		// the desktop app checks as its Help menu does: it downloads by itself (Windows, AppImage) or tells where
		if (app?.checkForUpdates) app.checkForUpdates().catch(() => undefined)
		else setDialog('update')
	}
	const items: { label: string, icon: React.ReactNode, onClick: () => void }[] = [
		{ label: t.preferences, icon: <Settings size={16} aria-hidden="true" />, onClick: onPreferences },
		{ label: t.wiki, icon: <BookOpen size={16} aria-hidden="true" />, onClick: () => window.open(wikiUrl(locale), '_blank', 'noopener,noreferrer') },
		{ label: t.update, icon: <RefreshCw size={16} aria-hidden="true" />, onClick: update },
		{ label: t.about, icon: <Info size={16} aria-hidden="true" />, onClick: () => setDialog('about') }
	]
	return (
		<span className="dg-account dg-app-menu" ref={box}>
			<button type="button" className="dg-app-menu-button" aria-label={APP_NAME} title={APP_NAME} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span className="dg-app-mark">λORM</span>
				<ChevronDown size={14} aria-hidden="true" />
			</button>
			{open && (
				<span className="dg-menu dg-menu-left" role="menu">
					{items.map(item => <button key={item.label} role="menuitem" onClick={() => { setOpen(false); item.onClick() }}>{item.icon} {item.label}</button>)}
				</span>
			)}
			{dialog === 'update' && <UpdateDialog onClose={() => setDialog(undefined)} />}
			{dialog === 'about' && <AboutDialog onClose={() => setDialog(undefined)} />}
		</span>
	)
}

const Dialog: React.FC<{ title: string, onClose: () => void, children: React.ReactNode }> = ({ title, onClose, children }) => {
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
				<div className="dg-dialog-actions dg-form-actions">
					<button type="button" onClick={onClose} autoFocus>{t.close}</button>
				</div>
			</div>
		</div>
	)
}

/** The web IDE: the latest version and how to take it (its image); it can't update itself */
const UpdateDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
	const { t, locale } = usePrefs()
	const [state, setState] = useState<{ latest?: { version: string, url: string }, error?: string, done: boolean }>({ done: false })
	useEffect(() => {
		let alive = true
		latestRelease().then(latest => { if (alive) setState({ latest, done: true }) }, e => { if (alive) setState({ error: e?.message ?? String(e), done: true }) })
		return () => { alive = false }
	}, [])
	const current = __APP_VERSION__
	const downloads = `${wikiUrl(locale)}Download/`
	return (
		<Dialog title={`${t.update} · ${APP_NAME}`} onClose={onClose}>
			{!state.done && <p className="dg-muted">{t.checkingUpdates}</p>}
			{state.error && <p className="dg-error" role="alert">{fill(t.updateFailed, { error: state.error })}</p>}
			{state.done && !state.error && (!state.latest || !newer(state.latest.version, current)) && <p role="status">{fill(t.upToDate, { version: current })}</p>}
			{state.latest && newer(state.latest.version, current) && (
				<>
					<p role="status"><strong>{fill(t.updateAvailable, { version: state.latest.version, current })}</strong></p>
					<p className="dg-muted">{t.updateHowWeb}</p>
					<pre className="dg-code">{`docker pull ${IMAGE}:${state.latest.version}`}</pre>
					<p><a href={state.latest.url} {...OUT}>{t.releaseNotes}</a> · <a href={downloads} {...OUT}>{t.downloads}</a></p>
				</>
			)}
		</Dialog>
	)
}

/** All about the app: its name, version, how it runs, what it is built with, its license and its source */
const AboutDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
	const { t, locale } = usePrefs()
	const app = desktop()
	const rows: [string, React.ReactNode][] = [
		[t.aboutVersion, __APP_VERSION__],
		[t.aboutVariant, app ? fill(t.aboutDesktop, { platform: app.platform ?? '' }) : t.aboutWeb],
		[t.aboutLibrary, `@lambdaorm/ui ${__UI_VERSION__}`],
		[t.aboutLicense, 'MIT'],
		[t.aboutSource, <a key="source" href={REPOSITORY} {...OUT}>github.com/lambda-orm/data-gateway</a>],
		[t.wiki, <a key="wiki" href={wikiUrl(locale)} {...OUT}>lambda-orm.github.io/wiki</a>]
	]
	return (
		<Dialog title={`${t.about} · ${APP_NAME}`} onClose={onClose}>
			<p className="dg-about-name"><span className="dg-app-mark">λORM</span> Data Gateway</p>
			<p className="dg-muted">{t.aboutDescription}</p>
			<dl className="dg-about">
				{rows.map(([term, value]) => <React.Fragment key={term}><dt>{term}</dt><dd>{value}</dd></React.Fragment>)}
			</dl>
		</Dialog>
	)
}
