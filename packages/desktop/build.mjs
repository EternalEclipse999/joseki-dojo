// Bundles the Electron main process (with the whole server) into dist/. Run from packages/desktop.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24', // Electron 44 runs Node 24
  format: 'cjs',
  logLevel: 'warning',
  // Provided at run time: Electron itself, the native SQLite addon and the updater (shipped as dependencies);
  // bufferutil and utf-8-validate are optional speed-ups of `ws` that are not installed.
  external: ['electron', 'electron-updater', 'better-sqlite3', 'bufferutil', 'utf-8-validate'],
})
