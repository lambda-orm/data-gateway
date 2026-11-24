// The bridge of the page (sandboxed, CommonJS): only data, never ipcRenderer itself. viaProxy (packages/ide/src/proxy.ts)
// reads window.ideDesktop.proxyBase: the local proxy of this run, with its token.
const { contextBridge, ipcRenderer } = require('electron')

const config = ipcRenderer.sendSync('ide:config')
// checkForUpdates: as Help → Check for updates (the menu λORM → Update of the page)
contextBridge.exposeInMainWorld('ideDesktop', Object.freeze({
	proxyBase: config.proxyBase,
	version: config.version,
	platform: config.platform,
	checkForUpdates: () => ipcRenderer.invoke('ide:check-updates')
}))
