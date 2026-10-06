// electron-builder configuration (spec 4.3). Run from packages/desktop after `node build.mjs` and the web build.
// The app version is the root package.json version (spec 7), so `npm version` is the only place to change it.
const { version } = require('../../package.json')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.github.eternaleclipse999.josekidojo',
  productName: 'Joseki Dojo',
  copyright: 'Copyright © 2026 Oleg Kushmantsev',
  // `name` names the per-user install folder: %LOCALAPPDATA%\Programs\Joseki Dojo (spec 4.2).
  extraMetadata: { name: 'Joseki Dojo', version },
  directories: { output: 'release' },
  files: ['dist/**', 'package.json', '!**/node_modules/better-sqlite3/{src,deps}/**'],
  extraResources: [
    { from: '../../katago.lock.json', to: 'katago.lock.json' },
    { from: '../web/dist', to: 'web' },
  ],
  // better-sqlite3 13 ships N-API prebuilds that Electron loads as they are: nothing to rebuild.
  npmRebuild: false,
  publish: [{ provider: 'github', owner: 'EternalEclipse999', repo: 'joseki-dojo', releaseType: 'draft' }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: {
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Joseki Dojo',
    runAfterFinish: true,
    artifactName: 'Joseki-Dojo-Setup-${version}.${ext}',
  },
  linux: { target: [{ target: 'AppImage', arch: ['x64'] }], category: 'Game', executableName: 'joseki-dojo' },
  appImage: { artifactName: 'Joseki-Dojo-${version}.${ext}' },
}
