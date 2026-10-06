// Bundles the Electron main process (with the whole server) and the preload script into dist/. Run from packages/desktop.
import { build } from 'esbuild'

// A warning is a bundling problem that would only show up at run time in the installed app: fail the build on it.
const common = { bundle: true, platform: 'node', target: 'node24', format: 'cjs', logLevel: 'warning', logLimit: 0 } // Electron 44 runs Node 24

const results = []
results.push(await build({
  ...common,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  // Provided at run time: Electron itself, the native SQLite addon and the updater (shipped as dependencies);
  // bufferutil and utf-8-validate are optional speed-ups of `ws` that are not installed.
  external: ['electron', 'electron-updater', 'better-sqlite3', 'bufferutil', 'utf-8-validate'],
}))

// A sandboxed preload may only require('electron'): everything else is bundled in.
results.push(await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', external: ['electron'] }))

const warnings = results.flatMap((r) => r.warnings)
if (warnings.length > 0) {
  console.error(`esbuild reported ${warnings.length} warning(s); failing the build`)
  process.exit(1)
}
