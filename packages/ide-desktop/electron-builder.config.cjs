// electron-builder for the desktop IDE (docs/DATA_GATEWAY_IDE_DESKTOP_PLAN.md §4): the version is the IDE's, the app
// (packages/ide/dist) and its proxy (packages/ide/server/server.mjs) go as resources, the artifacts have fixed names
// (the IDE page of the wiki classifies them by name), and the releases are those of this repository (ide-v<version>).
const ide = require('../ide/package.json')

module.exports = {
	appId: 'io.github.lambda-orm.data-gateway-ide',
	productName: 'Data Gateway IDE',
	artifactName: 'data-gateway-ide-${version}-${os}-${arch}.${ext}',
	extraMetadata: { version: ide.version },
	directories: { output: 'release', buildResources: 'build' },
	files: ['src/**/*', 'package.json'],
	extraResources: [
		{ from: '../ide/dist', to: 'ide' },
		{ from: '../ide/server/server.mjs', to: 'server/server.mjs' }
	],
	linux: {
		target: ['AppImage', 'deb'],
		category: 'Development',
		executableName: 'data-gateway-ide',
		maintainer: 'lambda-orm (https://github.com/lambda-orm/data-gateway)',
		synopsis: 'The IDE of the λORM Data Gateway'
	},
	win: { target: ['nsis'] },
	nsis: { oneClick: true, perMachine: false },
	mac: { target: ['dmg', 'zip'], category: 'public.app-category.developer-tools' },
	// the updater reads latest*.yml of the latest release of this repository (always the IDE's: §4.5)
	publish: { provider: 'github', owner: 'lambda-orm', repo: 'data-gateway', releaseType: 'release' }
}
