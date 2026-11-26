// The bridge of the page (sandboxed, CommonJS): only data, never ipcRenderer itself. viaProxy (packages/ide/src/proxy.ts)
// reads window.ideDesktop.proxyBase: the local proxy of this run, with its token.
const { contextBridge, ipcRenderer } = require('electron')

const config = ipcRenderer.sendSync('ide:config')
// checkForUpdates: as Help → Check for updates (the menu λORM → Update of the page)
contextBridge.exposeInMainWorld('ideDesktop', Object.freeze({
	proxyBase: config.proxyBase,
	version: config.version,
	platform: config.platform,
	checkForUpdates: () => ipcRenderer.invoke('ide:check-updates'),
	// the login of a connection with its identity provider (docs/OIDC_LOGIN.md §2): the loopback of this run, the browser
	// of the system, and the answer
	oidcStart: () => ipcRenderer.invoke('ide:oidc-start'),
	oidcOpen: (url) => ipcRenderer.invoke('ide:oidc-open', String(url)),
	oidcWait: () => ipcRenderer.invoke('ide:oidc-wait')
}))
