// Bundles the Electron main process (with the whole server) and the preload script into dist/. Run from packages/desktop.
import { build } from 'esbuild'

const common = { bundle: true, platform: 'node', target: 'node24', format: 'cjs', logLevel: 'warning' } // Electron 44 runs Node 24

await build({
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  // Provided at run time: Electron itself, the native SQLite addon and the updater (shipped as dependencies);
  // bufferutil and utf-8-validate are optional speed-ups of `ws` that are not installed.
  external: ['electron', 'electron-updater', 'better-sqlite3', 'bufferutil', 'utf-8-validate'],
})

// A sandboxed preload may only require('electron'): everything else is bundled in.
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', external: ['electron'] })
