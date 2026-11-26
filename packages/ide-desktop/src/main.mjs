// The desktop IDE (docs/DATA_GATEWAY_IDE_DESKTOP_PLAN.md §3): the app of packages/ide in a window, served at app://ide/
// (a fixed origin: its connections in localStorage stay between runs and versions), and its proxy to the gateways on
// 127.0.0.1 with a token of this run (server.mjs in its desktop mode). The same code as the web image.
import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setupUpdates } from './updates.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const APP_ORIGIN = 'app://ide'
const smokeTest = process.argv.includes('--smoke-test')

/** Where the app and its proxy are: next to the executable (packaged) or in packages/ide (development) */
const resources = app.isPackaged
	? { dist: path.join(process.resourcesPath, 'ide'), server: path.join(process.resourcesPath, 'server', 'server.mjs') }
	: { dist: path.resolve(here, '../../ide/dist'), server: path.resolve(here, '../../ide/server/server.mjs') }
/** The version is the IDE's (packaged: electron-builder puts it; development: packages/ide/package.json) */
const version = app.isPackaged ? app.getVersion() : JSON.parse(fs.readFileSync(path.resolve(here, '../../ide/package.json'), 'utf8')).version

// app:// is a standard, secure origin: fetch, CORS and storage as https
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

if (!smokeTest && !app.requestSingleInstanceLock()) app.quit()

const TYPES = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8'
}

/** The page of the app: nothing from elsewhere; it talks to its own proxy only (and ws to it) */
const securityHeaders = (proxyOrigin) => ({
	'Content-Security-Policy': `default-src 'self'; connect-src 'self' ${proxyOrigin} ${proxyOrigin.replace('http:', 'ws:')} data: blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'none'`,
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer'
})

/** app://ide/… → a file of the app; any other path, its page (it has its own routes) */
const serveApp = (proxyOrigin) => async (request) => {
	const url = new URL(request.url)
	if (url.host !== 'ide') return new Response('not found', { status: 404 })
	let file = path.join(resources.dist, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''))
	if (!file.startsWith(resources.dist)) return new Response('not found', { status: 404 })
	if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
		if (url.pathname.startsWith('/assets/')) return new Response('not found', { status: 404 })
		file = path.join(resources.dist, 'index.html')
	}
	const response = await net.fetch(pathToFileURL(file).toString())
	return new Response(response.body, { status: 200, headers: { ...securityHeaders(proxyOrigin), 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' } })
}

/** The proxy of this run: on 127.0.0.1, a random port, a random token; only for the page of the app */
const startProxy = async () => {
	const { createServer } = await import(pathToFileURL(resources.server).toString())
	const token = crypto.randomBytes(32).toString('base64url')
	const server = createServer({ targets: '*', desktop: { token, appOrigin: APP_ORIGIN } })
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
	const origin = `http://127.0.0.1:${server.address().port}`
	return { server, origin, base: `${origin}/t/${token}/` }
}

/** Size and place of the window, kept between runs */
const windowFile = () => path.join(app.getPath('userData'), 'window.json')
const readWindow = () => { try { return JSON.parse(fs.readFileSync(windowFile(), 'utf8')) } catch { return { width: 1400, height: 900 } } }
const keepWindow = (win) => {
	const save = () => { if (!win.isDestroyed() && !win.isMinimized()) fs.writeFileSync(windowFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })) }
	win.on('close', save)
}

const createWindow = (proxy) => {
	const kept = readWindow()
	const win = new BrowserWindow({
		x: kept.x, y: kept.y, width: kept.width ?? 1400, height: kept.height ?? 900, minWidth: 800, minHeight: 500,
		title: 'λORM Data Gateway',
		// in development its icon; packaged, the one electron-builder gives the app
		icon: fs.existsSync(path.join(here, '..', 'build', 'icon.png')) ? path.join(here, '..', 'build', 'icon.png') : undefined,
		show: false,
		// no bar of a menu on Windows and Linux (applicationMenu)
		autoHideMenuBar: true,
		webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
	})
	if (kept.maximized) win.maximize()
	keepWindow(win)
	// it never navigates away from the app; links (the wiki) open in the browser of the system, only https
	win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault() })
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('https://')) shell.openExternal(url)
		return { action: 'deny' }
	})
	win.once('ready-to-show', () => { if (!smokeTest) win.show() })
	win.loadURL(`${APP_ORIGIN}/`)
	return win
}

/**
 * The menu of the app: none on Windows and Linux once packaged (the page has its own menu: the documentation, the
 * updates, the version); on macOS only the menu of the app and Edit (the bar is the system's, and without Edit its
 * shortcuts, copy and paste, don't work); in development (npm start) the whole one, with the DevTools.
 */
const applicationMenu = () => {
	if (!app.isPackaged) return menu()
	if (process.platform === 'darwin') return Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
	return null
}

const menu = () => Menu.buildFromTemplate([
	...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
	{ role: 'fileMenu' },
	{ role: 'editMenu' },
	{
		label: 'View',
		submenu: [
			{ role: 'reload' }, { role: 'forceReload' },
			...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
			{ type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }
		]
	},
	{ role: 'windowMenu' },
	{
		role: 'help',
		submenu: [
			{ label: 'Documentation', click: () => shell.openExternal('https://lambda-orm.github.io/wiki/ide/') },
			{ label: 'Check for updates', id: 'check-updates', click: () => updates?.check(true) },
			{ label: 'Check automatically', id: 'auto-updates', type: 'checkbox', checked: updates?.automatic ?? true, click: item => updates?.setAutomatic(item.checked) },
			{ type: 'separator' },
			{ label: `λORM Data Gateway ${version}`, enabled: false }
		]
	}
])

let updates

app.whenReady().then(async () => {
	const proxy = await startProxy()
	// what the page needs of the app: the base of its proxy, its version, the platform (nothing else is exposed)
	ipcMain.on('ide:config', event => { event.returnValue = { proxyBase: proxy.base, version, platform: process.platform } })
	// the menu of the page asks for the check of updates (its native dialogs answer)
	ipcMain.handle('ide:check-updates', () => updates?.check(true))
	protocol.handle('app', serveApp(proxy.origin))
	Menu.setApplicationMenu(applicationMenu())
	const win = createWindow(proxy)
	app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus() })
	app.on('before-quit', () => proxy.server.close())
	if (smokeTest) return runSmokeTest(win, proxy)
	updates = setupUpdates({ version, window: win })
	Menu.setApplicationMenu(applicationMenu())
})

app.on('window-all-closed', () => app.quit())

/**
 * --smoke-test (CI, docs/DATA_GATEWAY_IDE_DESKTOP_PLAN.md §4.2): the page loads from app://ide with its desktop config,
 * and the proxy answers with the token of this run and refuses without it; exit 0, else 1.
 */
const runSmokeTest = async (win, proxy) => {
	const fail = (why) => { console.error(`[smoke-test] ${why}`); app.exit(1) }
	setTimeout(() => fail('timed out'), 60000).unref()
	try {
		await new Promise(resolve => win.webContents.once('did-finish-load', resolve))
		await new Promise(resolve => setTimeout(resolve, 1500))
		const page = await win.webContents.executeJavaScript(`({ root: document.getElementById('root')?.children.length ?? 0, desktop: !!window.ideDesktop, base: window.ideDesktop?.proxyBase })`)
		if (!page.root) return fail('the page of the app did not render')
		if (!page.desktop || page.base !== proxy.base) return fail('the page has no desktop config')
		// a gateway that doesn't listen: with the token, the proxy says it can't reach it (502); without it, 403
		const target = `gw/${Buffer.from('http://127.0.0.1:1').toString('base64url')}/schemas`
		const withToken = await fetch(`${proxy.base}${target}`, { headers: { Origin: APP_ORIGIN } })
		const without = await fetch(`${proxy.origin}/${target}`, { headers: { Origin: APP_ORIGIN } })
		if (withToken.status !== 502 || without.status !== 403) return fail(`the proxy answered ${withToken.status} / ${without.status}`)
		console.log(`[smoke-test] ok: λORM Data Gateway ${version} on ${process.platform} ${process.arch}`)
		app.exit(0)
	} catch (error) {
		fail(error?.stack ?? String(error))
	}
}
