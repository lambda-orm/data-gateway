// Updates of the desktop IDE (docs/DATA_GATEWAY_IDE_DESKTOP_PLAN.md §4.4, D4): Windows (the installer) and the AppImage
// update themselves with electron-updater (download in the background, offer to restart); macOS (until signed) and the
// .deb only tell that a new version is out, with a link to the page of the IDE. On start and every 6 hours, unless
// turned off (Help → Check automatically); an error never bothers: it goes to the log.
import { app, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// the page of the downloads of the IDE, where the macOS and .deb builds take a new version from
const PAGE = 'https://lambda-orm.github.io/wiki/ide/Download/'
const RELEASES = 'https://api.github.com/repos/lambda-orm/data-gateway/releases?per_page=30'
const EVERY_MS = 6 * 3600000

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } catch { return {} } }
const writeSettings = (settings) => { try { fs.writeFileSync(settingsFile(), JSON.stringify(settings)) } catch { /* read only */ } }

/** 1.10.0 > 1.9.2; a prerelease (1.1.0-rc.1) is older than its release */
export const newer = (a, b) => {
	const parse = v => { const [main, pre] = v.replace(/^v/, '').split('-'); return { parts: main.split('.').map(Number), pre } }
	const x = parse(a)
	const y = parse(b)
	for (let i = 0; i < 3; i++) if ((x.parts[i] ?? 0) !== (y.parts[i] ?? 0)) return (x.parts[i] ?? 0) > (y.parts[i] ?? 0)
	if (x.pre && !y.pre) return false
	if (!x.pre && y.pre) return true
	return (x.pre ?? '') > (y.pre ?? '')
}

/** The latest release of the IDE in this repository (its tags are ide-v<version>), from the API of GitHub */
export const latestIdeRelease = async (fetcher = fetch) => {
	const response = await fetcher(RELEASES, { headers: { Accept: 'application/vnd.github+json' } })
	if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
	const releases = await response.json()
	const release = releases.find(r => !r.draft && !r.prerelease && typeof r.tag_name === 'string' && r.tag_name.startsWith('ide-v'))
	return release ? { version: release.tag_name.slice('ide-v'.length), url: release.html_url } : undefined
}

export const setupUpdates = ({ version, window }) => {
	const settings = readSettings()
	let automatic = settings.autoUpdates !== false
	// it updates itself when it was installed in a way that can: the Windows installer, or an AppImage
	const selfUpdating = app.isPackaged && (process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE))
	let updater
	const log = (message) => console.log(`[updates] ${message}`)

	const notice = async (manual) => {
		const latest = await latestIdeRelease()
		if (latest && newer(latest.version, version)) {
			const { response } = await dialog.showMessageBox(window, {
				type: 'info', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1,
				message: `Data Gateway IDE ${latest.version} is available`,
				detail: `You have ${version}. Download the new version from the page of the IDE.`
			})
			if (response === 0) shell.openExternal(PAGE)
		} else if (manual) {
			dialog.showMessageBox(window, { type: 'info', message: 'Data Gateway IDE is up to date', detail: `You have ${version}, the latest.` })
		}
	}

	const selfUpdate = async (manual) => {
		if (!updater) {
			const { autoUpdater } = (await import('electron-updater')).default
			updater = autoUpdater
			updater.autoDownload = true
			updater.autoInstallOnAppQuit = true
			updater.logger = { info: log, warn: log, error: log, debug: () => undefined }
			updater.on('update-downloaded', async (info) => {
				const { response } = await dialog.showMessageBox(window, {
					type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
					message: `Data Gateway IDE ${info.version} is ready`,
					detail: 'Restart to use it, or it is installed when the IDE closes.'
				})
				if (response === 0) updater.quitAndInstall()
			})
		}
		const result = await updater.checkForUpdates()
		if (manual && (!result?.updateInfo || !newer(result.updateInfo.version, version))) {
			dialog.showMessageBox(window, { type: 'info', message: 'Data Gateway IDE is up to date', detail: `You have ${version}, the latest.` })
		}
	}

	const check = async (manual = false) => {
		try {
			if (selfUpdating) await selfUpdate(manual)
			else await notice(manual)
		} catch (error) {
			log(`the check failed: ${error?.message ?? error}`)
			if (manual) dialog.showMessageBox(window, { type: 'warning', message: 'The updates could not be checked', detail: String(error?.message ?? error) })
		}
	}

	// in development, only when asked
	if (app.isPackaged) {
		setTimeout(() => { if (automatic) check() }, 10000).unref()
		setInterval(() => { if (automatic) check() }, EVERY_MS).unref()
	}

	return {
		check,
		get automatic () { return automatic },
		setAutomatic (value) {
			automatic = value
			writeSettings({ ...readSettings(), autoUpdates: value })
		}
	}
}
