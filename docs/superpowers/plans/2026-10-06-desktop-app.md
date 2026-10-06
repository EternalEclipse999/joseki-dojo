# Joseki Dojo Desktop App and One-Click Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player who has never seen a terminal installs Joseki Dojo with a Windows installer (or a Linux AppImage), installs KataGo with one button inside the app, and later updates both the app and KataGo with one button each.

**Architecture:** The server gets an explicit-paths entry point `startServer(options)`; `npm start` becomes a thin wrapper around it, and a new Electron package (`packages/desktop`) calls it in-process with the Electron profile folders and port 0, then shows `http://127.0.0.1:<port>` in a window. The KataGo download/verify/benchmark code moves from `scripts/setup` into `packages/server/src/install/`, where an `InstallerService` behind `GET/POST /api/install` drives a new install screen. electron-builder packages the esbuild bundle as an NSIS installer and an AppImage; electron-updater reads published GitHub Releases and talks to the page through a preload bridge (`window.dojoDesktop`). GitHub Actions test every PR and build draft releases from `v*` tags.

**Tech Stack:** Node ≥ 22.12 (CI: 24), TypeScript 7, Vitest 5, Fastify 5, better-sqlite3 13, Preact 10, Vite 8, Playwright, Electron 44.5.1, electron-builder 26.15, electron-updater 6.8, esbuild 0.28, extract-zip 2, fflate 0.8 (tests only), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-06-desktop-app-design.md` (Russian; approved).

## Global Constraints

- Node.js `>=22.12` locally (the repo's `engines`); CI uses Node 24. All packages are ESM (`"type": "module"`) except the desktop build outputs, which are CommonJS bundles (`.cjs`). Relative TypeScript imports have no file extension; TypeScript `strict`.
- User-facing text is Russian. Code, identifiers, comments, commit messages, PR description and `README.md` are English (spec 8).
- The server listens on `127.0.0.1` only. `npm start` keeps port `5179` from the config; the desktop app passes port `0` (a free port).
- Electron is pinned to the exact version **`44.5.1`** (electron-builder refuses a range: `Electron version "^44.5.1" is a range, not a fixed version`). It embeds Node **24.21.0**, N-API 10, so esbuild targets `node24`.
- electron-builder `^26.15.3`, electron-updater `^6.8.9`, esbuild `^0.28.2` (already used by Vite and tsx), fflate `^0.8.3` (MIT, no dependencies; creates zip archives in tests only).
- better-sqlite3 13 ships N-API prebuilds for every platform inside the npm package and has no install script: Electron loads them unchanged. electron-builder therefore runs with `npmRebuild: false`, and it unpacks the `.node` files from `app.asar` by itself. No `@electron/rebuild`, and `npm test` keeps working after `npm run dist`.
- Electron 44 downloads its binary lazily (there is no postinstall): `npm ci` stays light in CI; the first `npm run desktop` prints `Downloading Electron binary...`.
- electron-builder 26 detects the npm workspace root and collects the hoisted production dependencies of `packages/desktop` correctly (only `better-sqlite3`, `electron-updater` and their dependencies end up in `app.asar`), so no staging folder is needed. The server and shared packages are bundled by esbuild and are dev dependencies of the desktop package.
- The first `npm version` rewrites the root `package.json` in npm's own multi-line format: expected, harmless.
- Code that ends up in the desktop bundle must not use `import.meta` (the bundle is CommonJS): the lock file path is always passed in, and SQL migrations live in code. Only `packages/server/src/main.ts`, `scripts/` and tests may use `import.meta.url`.
- Desktop data (spec 4.2) lives in Electron's `userData` folder (`%APPDATA%\Joseki Dojo`, `~/.config/Joseki Dojo`): `config.json`; `data/` (SQLite, `katago-logs/`, `joseki-dojo.log`); `engines/` (`downloads/`, `katago-<version>-<id>/`, `models/`, `analysis-cpu.cfg`, `analysis-gpu.cfg`). `npm start` / `npm run dev` keep everything in the repository as before.
- The per-user NSIS install folder is named after the packaged `name`, so `extraMetadata.name` is `Joseki Dojo` → `%LOCALAPPDATA%\Programs\Joseki Dojo`. `appId` is `io.github.eternaleclipse999.josekidojo`; never change it after the first release (Windows uses it to find the installed app).
- One app instance at a time; a second launch focuses the open window.
- No code signing: the installer is unsigned (`Get-AuthenticodeSignature` → `NotSigned`), so first-time SmartScreen warnings are expected (README explains them).
- Releases are created as **drafts**; only the owner publishes them, and electron-updater sees only published releases. The app version is the root `package.json` `version`; electron-builder takes it via `extraMetadata.version`.
- Never commit KataGo binaries, networks, `config.local.json`, `data/`, `engines/`, `packages/desktop/release/`, `e2e/.install/`.
- **Commits — one per milestone, not per task** (see `CLAUDE.md`): M1 after Task 3, M2 after Task 5, M3 after Task 7, M4 after Task 8, M5 after Task 10. Every other task ends by staging its files. Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (the second `-m` in the commit commands).
- **One pull request** for the whole plan, opened in Task 10 after the user confirms. All work happens on branch `feat/desktop-app` (already checked out, the spec is committed); `main` is protected by the ruleset "Protect main" (PR only, no bypass); never push to `main`; the user merges.
- Make edits in large complete blocks (whole files or whole sections) rather than many small edits.
- Run commands from the repository root `D:\private\joseki-dojo` in Git Bash. For throwaway folders use short paths under `$TEMP` (very long paths break node on Windows).

## Decisions taken where the spec is silent or ambiguous

1. **Install failure (spec 5.3 "KataGo не запустился даже на CPU").** The installation fails only when neither the CPU nor the OpenCL build starts; a machine whose CPU build fails but whose GPU build works is installed on the GPU.
2. **Benchmarks during an engine update** do not stop the running KataGo: the update is started from a non-game screen, where that KataGo is idle.
3. **Analysis configs.** The installer writes `engines/analysis-cpu.cfg` and `engines/analysis-gpu.cfg` (thread counts per build) and points the config at the chosen one. `npm run setup` keeps writing `engines/analysis.cfg` and records only `setup.kind` (a manual setup: no `setup.lockId`, so no engine-update bar).
4. **Bars.** The app-update bar (spec 6) is always at the top; the engine-update bar (spec 5.1) is hidden during a game, on the settings screen and while the install screen is open.
5. **Preload and IPC arrive with the updater (M4).** In M3 the window has no preload: `window.dojoDesktop` is absent, exactly as in a browser.
6. **Updater errors.** "No published versions on GitHub" (before the first release is published) counts as "no update", not as an error. A failed background check does not hide a version already on offer. If `quitAndInstall` did not start the installer, the app relaunches itself after 15 s instead of staying open with its server stopped.
7. **Release flow with a protected `main`** (spec 7): `npm version patch` and `git push --follow-tags` run on a release branch; the tag builds the draft; the branch is merged through a PR with a merge commit; then the owner publishes the draft.
8. **SQL migrations move into `packages/server/src/store/migrations.ts`** (same SQL, same `schema_migrations` names), so the bundle needs no files beside it.
9. **No app icon** (the spec names none): electron-builder uses Electron's default icon; adding `packages/desktop/build/icon.png` later needs no other change.

## File Structure

```
package.json                          + packages/desktop workspace; scripts desktop / dist / release; fflate; − extract-zip
.gitignore                            + e2e/.install/, release/
playwright.config.ts                  second web server (5181) for the install e2e
.github/workflows/ci.yml              PRs to main: unit tests, typecheck, e2e (ubuntu)
.github/workflows/release.yml         tag v*: tests → draft release → Windows + Linux builds uploaded to the draft
README.md                             English, player first (spec 8)
scripts/setup/setup.ts                reuses packages/server/src/install/*
scripts/setup/{download,calibrate,katago-config}(.test).ts   → moved to packages/server/src/install/
packages/shared/src/install.ts        InstallStep, InstallFile, InstallStatus
packages/shared/src/desktop.ts        AppUpdateState, DojoDesktopApi
packages/server/package.json          + extract-zip dependency; exports "." → src/start.ts
packages/server/migrations/           → removed (SQL moved into src/store/migrations.ts)
packages/server/src/
  start.ts                            startServer(options) → RunningServer
  main.ts                             CLI wrapper (npm start / npm run dev / JOSEKI_CONFIG)
  app.ts                              ServiceOptions; createServices(config, engine, options); /api/install wired
  config.ts                           SetupInfo; AppConfig.setup
  engine/lock.ts                      loadLock(file) with a required path; lockId(lock)
  settings/service.ts                 switchTo(katago, analysis, setup?) shared by apply() and the installer
  store/migrations.ts, store/db.ts    migrations in code
  api/install-routes.ts               GET/POST /api/install
  install/download.ts                 download (progress, replaceMismatched), extractBuild, findKatagoBinary, sha256File
  install/calibrate.ts                visitsForBudget, measureVisitsPerSecond
  install/katago-config.ts            analysisConfigText, searchThreadsFor
  install/installer.ts                InstallerService, engineUpdateAvailable
packages/server/test/
  helpers.ts                          + REPO_LOCK, serviceOptions
  install-fixture.ts                  local HTTP server with fake KataGo archives/networks; fakeBuildCommand
packages/web/src/
  api.ts                              + fetchInstall, startInstall
  install-format.ts                   step texts, file progress text
  update-banner.ts                    app-update bar texts
  desktop-env.d.ts                    window.dojoDesktop typing
  components/AppUpdateBanner.tsx      app-update bar (desktop only)
  screens/InstallScreen.tsx           «Нужно скачать движок KataGo» / «Обновление KataGo»
  App.tsx, styles.css                 install screen routing, engine-update bar, styles
packages/desktop/
  package.json                        @joseki-dojo/desktop (productName "Joseki Dojo")
  build.mjs                           esbuild: dist/main.cjs (+ dist/preload.cjs in M4)
  electron-builder.config.cjs         NSIS per-user, AppImage, extraResources, GitHub publish (draft)
  src/main.ts                         single instance, startServer, window, quit, log file, smoke report, updater
  src/channels.ts, src/preload.ts     window.dojoDesktop bridge (M4)
  src/update-controller.ts            update bar state machine (M4)
e2e/
  install-server.ts                   install e2e server: empty profile, fixture downloads, fake KataGo
  install.spec.ts, app-update.spec.ts
```

---

## Milestone M1 — server ready for packaging, built-in KataGo installer

### Task 1: Move the KataGo download, verification and benchmark code into the server

**Files:**
- Move: `scripts/setup/{download,download.test,calibrate,calibrate.test,katago-config,katago-config.test}.ts` → `packages/server/src/install/`
- Modify: `package.json`, `packages/server/package.json`, `package-lock.json`
- Rewrite: `packages/server/src/install/download.ts`, `packages/server/src/install/download.test.ts`, `scripts/setup/setup.ts`
- Modify (imports only): `packages/server/src/install/calibrate.ts`, `packages/server/src/install/calibrate.test.ts`, `packages/server/src/install/katago-config.ts`

**Interfaces:**
- Consumes: `KataGoEngine`, `AnalysisEngine` (`packages/server/src/engine/engine.ts`), `baseQuery` (`engine/query.ts`), `LockedBuild` (`engine/lock.ts`).
- Produces (all in `packages/server/src/install/`):
  - `download.ts`: `interface DownloadOptions { log?: (line: string) => void; onProgress?: (received: number, total: number) => void; replaceMismatched?: boolean; stallTimeoutMs?: number }`; `download(url: string, dest: string, sha256: string, options?: DownloadOptions): Promise<void>`; `extractBuild(zipFile: string, dir: string): Promise<string>` (returns the executable path); `findKatagoBinary(dir: string): string | null`; `sha256File(file: string): Promise<string>`.
  - `calibrate.ts`: `visitsForBudget(visitsPerSecond: number, seconds = 2): { reviewVisits: number; endVisits: number }`; `measureVisitsPerSecond(engine: AnalysisEngine, visits = 800): Promise<number>` (unchanged).
  - `katago-config.ts`: `ANALYSIS_THREADS`, `analysisConfigText(o: AnalysisCfgOptions): string`, `searchThreadsFor(kind: 'cpu' | 'gpu', logicalCores: number): number` (unchanged except the header comment).

- [ ] **Step 1: Confirm the branch**

Run: `git status --short --branch`
Expected: `## feat/desktop-app` and nothing else.

- [ ] **Step 2: Dependencies — extract-zip becomes a server dependency, fflate is added for test archives**

`package.json`:
```json
{
  "name": "joseki-dojo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "workspaces": ["packages/shared", "packages/server", "packages/web"],
  "engines": { "node": ">=22.12" },
  "scripts": {
    "setup": "tsx scripts/setup/setup.ts",
    "dev": "concurrently -k -n server,web -c blue,green \"npm run dev -w @joseki-dojo/server\" \"npm run dev -w @joseki-dojo/web\"",
    "build": "npm run build -w @joseki-dojo/web",
    "start": "npm run build && npm run start -w @joseki-dojo/server",
    "test": "vitest run",
    "test:katago": "vitest run -c vitest.katago.config.ts",
    "typecheck": "tsc -p tsconfig.json",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "@types/node": "^24.0.0",
    "concurrently": "^10.0.5",
    "fflate": "^0.8.3",
    "tsx": "^4.23.15",
    "typescript": "^7.0.2",
    "vitest": "^5.0.3"
  }
}
```

`packages/server/package.json`:
```json
{
  "name": "@joseki-dojo/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "tsx watch src/main.ts", "start": "tsx src/main.ts" },
  "dependencies": {
    "@fastify/static": "^10.1.5",
    "@fastify/websocket": "^11.3.3",
    "@joseki-dojo/shared": "*",
    "better-sqlite3": "^13.0.3",
    "extract-zip": "^2.0.1",
    "fastify": "^5.12.5"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^9.6.0",
    "@types/ws": "^8.18.2",
    "ws": "^8.22.0"
  }
}
```

Run: `npm install && npm ls fflate extract-zip`
Expected: install finishes without errors; the tree shows `fflate@0.8.3` under the root and `extract-zip@2.0.1` under `@joseki-dojo/server`.

- [ ] **Step 3: Move the modules (history follows the files)**

```bash
mkdir -p packages/server/src/install
for f in download download.test calibrate calibrate.test katago-config katago-config.test; do
  git mv scripts/setup/$f.ts packages/server/src/install/$f.ts
done
```

- [ ] **Step 4: Write the failing download tests**

`packages/server/src/install/download.test.ts` (replaces the moved file; options are now an object, new tests cover progress, `replaceMismatched` and `extractBuild`):
```ts
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { download, extractBuild, findKatagoBinary, sha256File } from './download'

const temp = (): string => mkdtempSync(join(tmpdir(), 'joseki-setup-'))
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const closers: (() => Promise<void>)[] = []
const EXE = process.platform === 'win32' ? 'katago.exe' : 'katago'

async function serve(body: Buffer): Promise<string> {
  const server = createServer((_req, res) => {
    res.setHeader('content-length', body.length)
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/file.bin`
}

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

describe('download', () => {
  const body = Buffer.from('katago network bytes')

  it('downloads a file, reports progress and verifies its checksum', async () => {
    const dest = join(temp(), 'net.bin.gz')
    const progress: [number, number][] = []
    await download(await serve(body), dest, sha(body), { onProgress: (received, total) => progress.push([received, total]) })
    expect(readFileSync(dest)).toEqual(body)
    expect(await sha256File(dest)).toBe(sha(body))
    expect(progress[0]).toEqual([0, body.length])
    expect(progress.at(-1)).toEqual([body.length, body.length])
  })

  it('rejects a wrong checksum and leaves nothing behind', async () => {
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(await serve(body), dest, sha(Buffer.from('other')))).rejects.toThrow(/SHA-256/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('re-checks an existing file instead of downloading it', async () => {
    const dest = join(temp(), 'net.bin.gz')
    writeFileSync(dest, body)
    const logs: string[] = []
    const progress: [number, number][] = []
    await download('https://invalid.example/never-fetched', dest, sha(body), {
      log: (l) => logs.push(l),
      onProgress: (received, total) => progress.push([received, total]),
    })
    expect(logs).toEqual(['Уже скачано и проверено: net.bin.gz'])
    expect(progress).toEqual([[body.length, body.length]])
  })

  it('refuses an existing file with a different checksum', async () => {
    const dest = join(temp(), 'net.bin.gz')
    writeFileSync(dest, 'tampered')
    await expect(download('https://invalid.example/never-fetched', dest, sha(body))).rejects.toThrow(/katago\.lock\.json/)
  })

  it('downloads again over a mismatched file when asked to', async () => {
    const dest = join(temp(), 'net.bin.gz')
    writeFileSync(dest, 'tampered')
    await download(await serve(body), dest, sha(body), { replaceMismatched: true })
    expect(readFileSync(dest)).toEqual(body)
  })
})

describe('download failures', () => {
  const body = Buffer.from('katago network bytes')

  async function serveRaw(handler: Parameters<typeof createServer>[1]): Promise<string> {
    const server = createServer(handler)
    server.on('connection', (s) => s.on('error', () => undefined))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    closers.push(() => {
      server.closeAllConnections()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    })
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/file.bin`
  }

  it('removes the partial file when the connection dies mid-body', async () => {
    const url = await serveRaw((_req, res) => {
      res.writeHead(200, { 'content-length': 1000 })
      res.write(body)
      setTimeout(() => res.destroy(), 50)
    })
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(url, dest, sha(body))).rejects.toThrow()
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('names the URL when the connection is refused', async () => {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    const url = `http://127.0.0.1:${port}/file.bin`
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(url, dest, sha(body))).rejects.toThrow(url)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('aborts a stalled download and leaves no partial file', async () => {
    const url = await serveRaw((_req, res) => {
      res.writeHead(200, { 'content-length': 1000 })
      res.write(body)
    })
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(url, dest, sha(body), { stallTimeoutMs: 300 })).rejects.toThrow(/завис/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('aborts when headers never arrive', async () => {
    const url = await serveRaw(() => undefined)
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(url, dest, sha(body), { stallTimeoutMs: 300 })).rejects.toThrow(/завис/)
  })

  it('accepts an upper-case checksum', async () => {
    const dest = join(temp(), 'net.bin.gz')
    await download(await serve(body), dest, sha(body).toUpperCase())
    expect(existsSync(dest)).toBe(true)
  })
})

describe('findKatagoBinary', () => {
  it('finds the executable in nested folders', () => {
    const dir = temp()
    const nested = join(dir, 'katago-v1.18.1', 'bin')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, EXE), '')
    expect(findKatagoBinary(dir)).toBe(join(nested, EXE))
    expect(findKatagoBinary(temp())).toBeNull()
  })
})

describe('extractBuild', () => {
  const archive = (files: Record<string, string>): string => {
    const zip = join(temp(), 'build.zip')
    const entries = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))
    writeFileSync(zip, zipSync({ 'katago-v1.18.1': entries }))
    return zip
  }

  it('unpacks the archive and returns the executable', async () => {
    const dir = join(temp(), 'katago-1.18.1-eigenavx2')
    const bin = await extractBuild(archive({ [EXE]: 'fake', 'README.txt': 'r' }), dir)
    expect(bin).toBe(join(dir, 'katago-v1.18.1', EXE))
    expect(readFileSync(bin, 'utf8')).toBe('fake')
    expect(existsSync(`${dir}.part`)).toBe(false)
  })

  it('keeps a folder that already has the executable', async () => {
    const zip = archive({ [EXE]: 'fake' })
    const dir = join(temp(), 'katago')
    const bin = await extractBuild(zip, dir)
    rmSync(zip)
    expect(await extractBuild(zip, dir)).toBe(bin)
  })

  it('rejects an archive without KataGo and leaves nothing behind', async () => {
    const dir = join(temp(), 'katago')
    await expect(extractBuild(archive({ 'README.txt': 'r' }), dir)).rejects.toThrow(/нет исполняемого файла KataGo/)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(`${dir}.part`)).toBe(false)
  })
})
```

- [ ] **Step 5: Run the tests to see them fail**

Run: `npx vitest run packages/server/src/install/download.test.ts`
Expected: FAIL, 8 tests — `TypeError: log is not a function` (the old `download` takes a positional `log` callback), `extractBuild is not a function`, and the mismatched-file test still gets the old refusal (`… Удалите его и запустите setup снова.`).

- [ ] **Step 6: Implement the download module and fix the moved imports**

`packages/server/src/install/download.ts`:
```ts
import { createHash } from 'node:crypto'
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import extractZip from 'extract-zip'

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(
    createReadStream(file),
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        hash.update(chunk)
        done()
      },
    }),
  )
  return hash.digest('hex')
}

export interface DownloadOptions {
  /** Progress lines for a terminal (`npm run setup`); silent by default. */
  log?: (line: string) => void
  /** Bytes received so far and the expected total (0 while the server has not said). */
  onProgress?: (received: number, total: number) => void
  /** Delete an existing file whose checksum differs and download it again; by default such a file is refused. */
  replaceMismatched?: boolean
  /** Abort when no bytes arrive for this long (not a total timeout: big files on slow links are fine). */
  stallTimeoutMs?: number
}

/**
 * Downloads `url` to `dest` and accepts it only if its SHA-256 matches; an existing file is re-checked instead.
 * Any failure removes the partial file.
 */
export async function download(url: string, dest: string, sha256: string, options: DownloadOptions = {}): Promise<void> {
  const { log = () => undefined, onProgress = () => undefined, replaceMismatched = false, stallTimeoutMs = 60_000 } = options
  const name = basename(dest)
  const expected = sha256.toLowerCase()
  if (existsSync(dest)) {
    if ((await sha256File(dest)) === expected) {
      log(`Уже скачано и проверено: ${name}`)
      const size = statSync(dest).size
      onProgress(size, size)
      return
    }
    if (!replaceMismatched) {
      throw new Error(`${name}: контрольная сумма не совпадает с katago.lock.json (файл повреждён или другой версии). Удалите его и запустите setup снова.`)
    }
    log(`Файл повреждён или другой версии, скачиваю заново: ${name}`)
    rmSync(dest, { force: true })
  }
  mkdirSync(dirname(dest), { recursive: true })
  log(`Скачиваю ${url}`)
  const partial = `${dest}.part`
  const controller = new AbortController()
  let stalled = false
  let timer: NodeJS.Timeout | undefined
  const arm = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      stalled = true
      controller.abort()
    }, stallTimeoutMs)
  }
  const fail = (cause: unknown): Error => {
    if (stalled) return new Error(`Не удалось скачать ${url}: загрузка зависла, нет данных ${Math.round(stallTimeoutMs / 1000)} с`)
    if (cause instanceof Error && cause.message.startsWith('Не удалось скачать')) return cause
    const detail = cause instanceof Error ? ((cause.cause as Error | undefined)?.message ?? cause.message) : String(cause)
    return new Error(`Не удалось скачать ${url}: ${detail}`)
  }
  try {
    arm()
    let res: Response
    try {
      res = await fetch(url, { signal: controller.signal })
    } catch (err) {
      throw fail(err)
    }
    if (!res.ok || !res.body) throw new Error(`Не удалось скачать ${url}: HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length') ?? 0)
    const hash = createHash('sha256')
    let received = 0
    let shown = -1
    onProgress(0, total)
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        arm()
        hash.update(chunk)
        received += chunk.length
        onProgress(received, total)
        const pct = total > 0 ? Math.floor((received / total) * 100) : -1
        if (pct >= 0 && pct % 10 === 0 && pct !== shown) {
          shown = pct
          log(`  ${name}: ${pct}%`)
        }
        done(null, chunk)
      },
    })
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), meter, createWriteStream(partial), { signal: controller.signal })
    } catch (err) {
      throw fail(err)
    }
    const actual = hash.digest('hex')
    if (actual !== expected) throw new Error(`${name}: SHA-256 ${actual} не совпадает с katago.lock.json (${expected})`)
    renameSync(partial, dest)
  } catch (err) {
    rmSync(partial, { force: true })
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Finds the KataGo executable anywhere under `dir`. */
export function findKatagoBinary(dir: string): string | null {
  const name = process.platform === 'win32' ? 'katago.exe' : 'katago'
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const found = findKatagoBinary(full)
      if (found) return found
    }
  }
  return null
}

/**
 * Unpacks a KataGo archive into `dir` and returns the executable. A `dir` that already holds the executable is kept
 * as is (that KataGo may be running). The archive is unpacked into `<dir>.part` first and renamed when complete, so
 * an interrupted extraction never leaves a half-filled `dir`.
 */
export async function extractBuild(zipFile: string, dir: string): Promise<string> {
  const existing = existsSync(dir) ? findKatagoBinary(dir) : null
  if (existing) return existing
  const partial = `${dir}.part`
  rmSync(partial, { recursive: true, force: true })
  try {
    await extractZip(zipFile, { dir: resolve(partial) })
    const found = findKatagoBinary(partial)
    if (!found) throw new Error(`В архиве нет исполняемого файла KataGo: ${basename(zipFile)}`)
    rmSync(dir, { recursive: true, force: true })
    renameSync(partial, dir)
    const bin = join(dir, relative(partial, found))
    if (process.platform !== 'win32') chmodSync(bin, 0o755)
    return bin
  } catch (err) {
    rmSync(partial, { recursive: true, force: true })
    throw err
  }
}
```

`packages/server/src/install/calibrate.ts`:
```ts
import type { Move } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'

/** Spec 6.4: about `seconds` per reviewed position; the end check uses half of that. */
export function visitsForBudget(visitsPerSecond: number, seconds = 2): { reviewVisits: number; endVisits: number } {
  const to50 = (n: number): number => Math.round(n / 50) * 50
  const reviewVisits = Math.min(5000, Math.max(100, to50(visitsPerSecond * seconds)))
  const endVisits = Math.min(2500, Math.max(50, to50(reviewVisits / 2)))
  return { reviewVisits, endVisits }
}

const SAMPLE: Move[] = [
  { color: 'B', vertex: [15, 3] },
  { color: 'W', vertex: [3, 15] },
  { color: 'B', vertex: [2, 3] },
  { color: 'W', vertex: [16, 5] },
]

export async function measureVisitsPerSecond(engine: AnalysisEngine, visits = 800): Promise<number> {
  // Warm up on a different position so the timed search does not hit the NN cache (and OpenCL is tuned).
  await engine.analyze({ ...baseQuery([]), maxVisits: 100 })
  const started = performance.now()
  const r = await engine.analyze({ ...baseQuery(SAMPLE), maxVisits: visits })
  const seconds = (performance.now() - started) / 1000
  return r.rootInfo.visits / Math.max(seconds, 0.001)
}
```

`packages/server/src/install/calibrate.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { StubEngine } from '../../test/helpers'
import { measureVisitsPerSecond, visitsForBudget } from './calibrate'

describe('visitsForBudget', () => {
  it('targets two seconds per position, rounded to 50, within limits', () => {
    expect(visitsForBudget(250)).toEqual({ reviewVisits: 500, endVisits: 250 })
    expect(visitsForBudget(400)).toEqual({ reviewVisits: 800, endVisits: 400 })
    expect(visitsForBudget(10)).toEqual({ reviewVisits: 100, endVisits: 50 })
    expect(visitsForBudget(100_000)).toEqual({ reviewVisits: 5000, endVisits: 2500 })
  })
})

describe('measureVisitsPerSecond', () => {
  it('warms up on another position, then times a fixed search', async () => {
    const engine = new StubEngine()
    const vps = await measureVisitsPerSecond(engine, 800)
    expect(vps).toBeGreaterThan(0)
    expect(engine.queries.map((q) => [q.moves.length, q.maxVisits])).toEqual([
      [0, 100],
      [4, 800],
    ])
  })
})
```

`packages/server/src/install/katago-config.ts`:
```ts
import type { LockedBuild } from '../engine/lock'

export const ANALYSIS_THREADS = 2

export interface AnalysisCfgOptions {
  logDir: string
  searchThreadsPerAnalysisThread: number
}

export function analysisConfigText(o: AnalysisCfgOptions): string {
  return [
    '# Generated by Joseki Dojo. Search limits are set per query.',
    `logDir = ${o.logDir.replaceAll('\\', '/')}`,
    'reportAnalysisWinratesAs = BLACK',
    `numAnalysisThreads = ${ANALYSIS_THREADS}`,
    `numSearchThreadsPerAnalysisThread = ${o.searchThreadsPerAnalysisThread}`,
    'nnCacheSizePowerOfTwo = 21',
    'nnMutexPoolSizePowerOfTwo = 17',
    'nnRandomize = true',
    '',
  ].join('\n')
}

/** CPU: split the logical cores between the analysis threads; GPU: 8 search threads per analysis thread. */
export function searchThreadsFor(kind: LockedBuild['kind'], logicalCores: number): number {
  return kind === 'cpu' ? Math.max(1, Math.floor(logicalCores / ANALYSIS_THREADS)) : 8
}
```

`packages/server/src/install/katago-config.test.ts` is unchanged (it imports `./katago-config`).

- [ ] **Step 7: Run the moved tests**

Run: `npx vitest run packages/server/src/install scripts`
Expected: `Test Files  4 passed (4)`, `Tests  28 passed (28)`.

- [ ] **Step 8: Make `npm run setup` use the moved code**

`scripts/setup/setup.ts` (same dialogue as before; downloads and extraction go through `download(..., { log })` and `extractBuild`, and the lock path is passed explicitly):
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { KataGoEngine } from '../../packages/server/src/engine/engine'
import { compareVersions, MIN_KATAGO_VERSION } from '../../packages/server/src/engine/health'
import { buildsFor, loadLock, versionWarning, type LockedBuild } from '../../packages/server/src/engine/lock'
import { measureVisitsPerSecond, visitsForBudget } from '../../packages/server/src/install/calibrate'
import { download, extractBuild } from '../../packages/server/src/install/download'
import { analysisConfigText, searchThreadsFor } from '../../packages/server/src/install/katago-config'
import { defaultKind, parseCpuAnswer, parseSourceAnswer } from './build-kind'

type Json = Record<string, unknown>

const root = fileURLToPath(new URL('../../', import.meta.url))
const configFile = join(root, 'config.local.json')
const enginesDir = join(root, 'engines')
const log = (line: string): void => console.log(line)

/**
 * Line-queue prompter. Unlike readline's question(), it keeps lines that arrive before the question
 * is asked, so piped answers (`printf '\n1\n\n' | npm run setup`) work. After EOF every answer is ''.
 */
function prompter(): { ask: (question: string) => Promise<string>; close: () => void } {
  const rl = createInterface({ input: process.stdin })
  const lines: string[] = []
  const waiting: ((line: string) => void)[] = []
  let closed = false
  rl.on('line', (line) => {
    const waiter = waiting.shift()
    if (waiter) waiter(line)
    else lines.push(line)
  })
  rl.on('close', () => {
    closed = true
    for (const waiter of waiting.splice(0)) waiter('')
  })
  return {
    ask(question: string): Promise<string> {
      process.stdout.write(question)
      const line = lines.shift()
      if (line !== undefined) return Promise.resolve(line.trim())
      if (closed) return Promise.resolve('')
      return new Promise((done) => waiting.push((l) => done(l.trim())))
    },
    close: () => rl.close(),
  }
}

async function main(): Promise<void> {
  const lock = loadLock(join(root, 'katago.lock.json'))
  const rl = prompter()
  let existing: Json = {}
  if (existsSync(configFile)) {
    try {
      existing = JSON.parse(readFileSync(configFile, 'utf8')) as Json
    } catch {
      throw new Error(`Файл ${configFile} содержит некорректный JSON. Исправьте или удалите его и запустите setup снова.`)
    }
  }
  const existingKatago = (existing.katago ?? {}) as Json
  const knownPath = typeof existingKatago.path === 'string' && existsSync(existingKatago.path) ? existingKatago.path : null

  console.log(`Настройка KataGo ${lock.katago.version} для Joseki Dojo (версии из katago.lock.json)\n`)
  const prompt = knownPath
    ? `Путь к установленной KataGo (Enter — ${knownPath}, «скачать» — скачать заново): `
    : 'Путь к установленной KataGo (Enter — скачать проверенную версию): '
  const source = parseSourceAnswer(await rl.ask(prompt), knownPath)
  let katagoPath: string
  let kind: LockedBuild['kind']
  if (source.action !== 'download') {
    katagoPath = resolve(source.path)
    if (!existsSync(katagoPath)) throw new Error(`Файл не найден: ${katagoPath}`)
    const storedKind = source.action === 'typed' ? undefined : ((existing.setup ?? {}) as Json).kind
    const fallback = defaultKind(storedKind, katagoPath)
    kind = parseCpuAnswer(await rl.ask(`Это CPU-сборка (eigen)? ${fallback === 'cpu' ? '[Y/n]' : '[y/N]'}: `), fallback)
  } else {
    const options = buildsFor(lock, process.platform)
    if (options.length === 0) throw new Error(`Для ${process.platform} нет готовых сборок KataGo: установите её сами и укажите путь.`)
    options.forEach((b, i) => console.log(`  ${i + 1}) ${b.label}`))
    const build = options[Number(await rl.ask(`Бэкенд [1-${options.length}]: `)) - 1]
    if (!build) throw new Error('Нет такого варианта')
    const zip = join(enginesDir, 'downloads', basename(new URL(build.url).pathname))
    await download(build.url, zip, build.sha256, { log })
    katagoPath = await extractBuild(zip, join(enginesDir, `katago-${lock.katago.version}-${build.id}`))
    kind = build.kind
  }
  const customModel = await rl.ask(`Путь к своей основной сети (Enter — ${lock.models.main.file}): `)
  rl.close()

  const mainModel = customModel ? resolve(customModel) : join(enginesDir, 'models', lock.models.main.file)
  if (customModel && !existsSync(mainModel)) throw new Error(`Файл основной сети не найден: ${mainModel}`)
  if (!customModel) await download(lock.models.main.url, mainModel, lock.models.main.sha256, { log })
  const humanModel = join(enginesDir, 'models', lock.models.human.file)
  await download(lock.models.human.url, humanModel, lock.models.human.sha256, { log })

  const logDir = join(root, 'data', 'katago-logs')
  mkdirSync(logDir, { recursive: true })
  const analysisConfig = join(enginesDir, 'analysis.cfg')
  writeFileSync(analysisConfig, analysisConfigText({ logDir, searchThreadsPerAnalysisThread: searchThreadsFor(kind, availableParallelism()) }))

  console.log('\nЗапускаю KataGo и замеряю скорость. Первый запуск OpenCL может настраиваться несколько минут…')
  const engine = new KataGoEngine(
    { command: katagoPath, args: ['analysis', '-config', analysisConfig, '-model', mainModel, '-human-model', humanModel] },
    (line) => console.log(`  [katago] ${line}`),
  )
  engine.start()
  try {
    const version = await engine.version()
    if (compareVersions(version, MIN_KATAGO_VERSION) < 0) throw new Error(`Нужна KataGo ${MIN_KATAGO_VERSION} или новее, установлена ${version}`)
    const warning = versionWarning(lock, version)
    if (warning) console.log(`\nВнимание: ${warning}`)
    const vps = await measureVisitsPerSecond(engine)
    const visits = visitsForBudget(vps)
    console.log(`Скорость ≈ ${Math.round(vps)} визитов/с → разбор: ${visits.reviewVisits}, проверка конца: ${visits.endVisits} визитов`)
    const { commandOverride: _ignored, ...katagoRest } = existingKatago
    const config = {
      ...existing,
      setup: { ...((existing.setup ?? {}) as Json), kind },
      katago: { ...katagoRest, path: katagoPath, analysisConfig, mainModel, humanModel },
      analysis: { ...((existing.analysis ?? {}) as Json), ...visits },
    }
    writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`)
    console.log(`\nГотово: ${configFile}\nЗапуск: npm start`)
  } finally {
    await engine.stop()
  }
}

main().catch((err: unknown) => {
  console.error(`\nОшибка: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
```

- [ ] **Step 9: Verify**

Run: `npm test && npm run typecheck`
Expected: `Test Files  31 passed (31)`, `Tests  185 passed (185)`; `tsc` prints nothing.

Run: `printf 'C:/nope/katago.exe\n' | npx tsx scripts/setup/setup.ts; echo "exit=$?"`
Expected (the script loads the moved modules and stops at the missing file):
```
Настройка KataGo 1.18.1 для Joseki Dojo (версии из katago.lock.json)

Путь к установленной KataGo (Enter — скачать проверенную версию): 
Ошибка: Файл не найден: C:\nope\katago.exe
exit=1
```
(If `config.local.json` already names a KataGo, the prompt mentions it; the error line is the same.)

- [ ] **Step 10: Stage the changes**

```bash
git add package.json package-lock.json packages/server/package.json packages/server/src/install scripts/setup
```

---

### Task 2: KataGo installer service

**Files:**
- Create: `packages/shared/src/install.ts`, `packages/server/src/install/installer.ts`, `packages/server/src/install/installer.test.ts`, `packages/server/test/install-fixture.ts`
- Modify: `packages/shared/src/index.ts`, `packages/server/src/config.ts`, `packages/server/src/config.test.ts`, `packages/server/src/engine/lock.ts`, `packages/server/src/engine/lock.test.ts`, `packages/server/src/settings/service.ts`, `packages/server/src/settings/service.test.ts`, `packages/server/test/helpers.ts`

**Interfaces:**
- Consumes: Task 1 (`download`, `extractBuild`, `measureVisitsPerSecond`, `visitsForBudget`, `analysisConfigText`, `searchThreadsFor`); `KataGoEngine(cmd, log, { maxRestarts })`; `HealthMonitor`; `missingFiles`, `compareVersions`, `MIN_KATAGO_VERSION` (`engine/health.ts`); `buildsFor`, `KataGoLock`, `LockedBuild`, `LockedFile` (`engine/lock.ts`).
- Produces:
  - `@joseki-dojo/shared`: `type InstallStep = 'idle' | 'downloading' | 'extracting' | 'benchmarking-cpu' | 'benchmarking-gpu' | 'finishing' | 'done' | 'failed'`; `interface InstallFile { name: string; label: string; received: number; total: number; done: boolean }`; `interface InstallStatus { step: InstallStep; files: InstallFile[]; error: string | null; installed: boolean; updateAvailable: boolean; kind: 'cpu' | 'gpu' | null }`.
  - `config.ts`: `interface SetupInfo { kind?: 'cpu' | 'gpu'; lockId?: string }`; `AppConfig.setup?: SetupInfo`.
  - `engine/lock.ts`: `lockId(lock: KataGoLock): string` → `"<version>/<main sha256 first 12>/<human sha256 first 12>"`.
  - `SettingsService.switchTo(katago: KataGoSettings, analysis: AnalysisSettings, setup?: SetupInfo): Promise<SettingsResponse>` — the rollback logic formerly inside `apply`, now also saving `setup`; `apply()` validates and delegates to it.
  - `install/installer.ts`: `interface InstallerDeps { config: AppConfig; lock: KataGoLock; enginesDir: string; settings: SettingsService; commandFor: (config: AppConfig) => EngineCommand; log?: (line: string) => void; platform?: NodeJS.Platform; cores?: number; benchmarkVisits?: number; stallTimeoutMs?: number }`; `class InstallerService { constructor(d: InstallerDeps); status(): InstallStatus; start(): InstallStatus; settled(): Promise<InstallStatus>; close(): Promise<void> }`; `engineUpdateAvailable(config: AppConfig, lock: KataGoLock): boolean`.
  - Tests: `REPO_LOCK` (`test/helpers.ts`); `createInstallFixture(): Promise<InstallFixture>` with `InstallFixture { lock: KataGoLock; requests: string[]; failing: Set<string>; close(): Promise<void> }`; `fakeBuildCommand(env?: { cpu?: Record<string, string>; gpu?: Record<string, string> }): (config: AppConfig) => EngineCommand` (`test/install-fixture.ts`).

- [ ] **Step 1: Test helpers — the repository lock and the install fixture**

In `packages/server/test/helpers.ts`, add after the `FAKE_KATAGO` line:
```ts

/** The repository's katago.lock.json (product code always receives the lock path explicitly). */
export const REPO_LOCK = fileURLToPath(new URL('../../../katago.lock.json', import.meta.url))
```

`packages/server/test/install-fixture.ts` (a local download server: zipped fake "builds" with a fake executable for the current OS and two tiny "networks"; the lock points at them with real checksums; the fake KataGo is chosen per build by folder name):
```ts
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { strToU8, zipSync } from 'fflate'
import type { AppConfig } from '../src/config'
import type { EngineCommand } from '../src/engine/engine'
import type { KataGoLock, LockedBuild, LockedFile } from '../src/engine/lock'
import { FAKE_KATAGO } from './helpers'

export interface InstallFixture {
  /** A lock whose builds and networks are served by this fixture over plain HTTP. */
  lock: KataGoLock
  /** Request paths in arrival order, e.g. `/human.bin.gz`. */
  requests: string[]
  /** Paths answered with HTTP 500 while listed here. */
  failing: Set<string>
  close(): Promise<void>
}

const VERSION = '1.18.1'
const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

/**
 * Spec 9: a local download server for installer tests and the install e2e. It serves tiny KataGo "archives" (a zip
 * with a fake executable) for the current OS and two small "networks"; the lock points at them with real checksums.
 */
export async function createInstallFixture(): Promise<InstallFixture> {
  const platform: LockedBuild['platform'] = process.platform === 'win32' ? 'win32' : 'linux'
  const os = platform === 'win32' ? 'windows' : 'linux'
  const exe = platform === 'win32' ? 'katago.exe' : 'katago'
  const archive = (id: string): Uint8Array =>
    zipSync({ [`katago-v${VERSION}-${id}`]: { [exe]: strToU8(`fake katago ${id}`), 'README.txt': strToU8('test build') } })
  const buildPath = (id: string): string => `/katago-v${VERSION}-${id}-${os}-x64.zip`
  const files = new Map<string, Uint8Array>([
    [buildPath('eigenavx2'), archive('eigenavx2')],
    [buildPath('opencl'), archive('opencl')],
    [buildPath('cuda'), archive('cuda')],
    ['/main.bin.gz', strToU8('fake main network')],
    ['/human.bin.gz', strToU8('fake human network')],
  ])
  const requests: string[] = []
  const failing = new Set<string>()
  const server = createServer((req, res) => {
    const path = req.url ?? '/'
    requests.push(path)
    const body = files.get(path)
    if (!body || failing.has(path)) {
      res.statusCode = body ? 500 : 404
      res.end()
      return
    }
    res.setHeader('content-length', body.length)
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const build = (id: string, kind: LockedBuild['kind'], label: string): LockedBuild => {
    const path = buildPath(id)
    return { id, platform, kind, label, url: base + path, sha256: sha256(files.get(path)!) }
  }
  const model = (path: string): LockedFile => {
    const body = files.get(path)!
    return { file: path.slice(1), url: base + path, sha256: sha256(body), size: body.length }
  }
  return {
    lock: {
      katago: { version: VERSION, builds: [build('eigenavx2', 'cpu', 'CPU'), build('opencl', 'gpu', 'OpenCL'), build('cuda', 'gpu', 'CUDA')] },
      models: { main: model('/main.bin.gz'), human: model('/human.bin.gz') },
    },
    requests,
    failing,
    close: () => {
      server.closeAllConnections()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/**
 * The fake KataGo for an installed fixture build: the OpenCL build is recognised by its folder name, and `env`
 * sets each build's behaviour (e.g. `{ gpu: { FAKE_KATAGO_ALWAYS_CRASH: '1' } }`).
 */
export function fakeBuildCommand(env: { cpu?: Record<string, string>; gpu?: Record<string, string> } = {}): (config: AppConfig) => EngineCommand {
  return (config) => ({
    command: process.execPath,
    args: [FAKE_KATAGO],
    env: /opencl/.test(config.katago.path) ? (env.gpu ?? {}) : (env.cpu ?? {}),
  })
}
```

- [ ] **Step 2: Write the failing tests**

`packages/server/src/install/installer.test.ts`:
```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createInstallFixture, fakeBuildCommand, type InstallFixture } from '../../test/install-fixture'
import { tempDir } from '../../test/helpers'
import { loadConfig } from '../config'
import { KataGoEngine } from '../engine/engine'
import { HealthMonitor } from '../engine/health'
import { lockId } from '../engine/lock'
import { SettingsService } from '../settings/service'
import { engineUpdateAvailable, InstallerService } from './installer'

const EXE = process.platform === 'win32' ? 'katago.exe' : 'katago'
const SLOW = { FAKE_KATAGO_DELAY_MS: '300' }
const CRASH = { FAKE_KATAGO_ALWAYS_CRASH: '1' }

const fixtures: InstallFixture[] = []
const engines: KataGoEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.stop()))
  await Promise.all(fixtures.splice(0).map((f) => f.close()))
})

/** A fresh profile without KataGo: the config file does not exist yet, so every path is a missing default. */
async function setup(env: Parameters<typeof fakeBuildCommand>[0] = {}, fixture?: InstallFixture) {
  const fx = fixture ?? (await createInstallFixture())
  if (!fixture) fixtures.push(fx)
  const root = tempDir()
  const configFile = join(root, 'config.json')
  const config = loadConfig(configFile)
  const commandFor = fakeBuildCommand(env)
  const engine = new KataGoEngine(commandFor(config))
  engines.push(engine)
  const health = new HealthMonitor(config, engine)
  await health.check()
  const enginesDir = join(root, 'engines')
  const settings = new SettingsService({ config, configFile, modelsDir: join(enginesDir, 'models'), engine, health, lock: fx.lock, commandFor })
  const deps = { config, lock: fx.lock, enginesDir, settings, commandFor, cores: 4, benchmarkVisits: 100 }
  return { fixture: fx, root, configFile, enginesDir, config, health, deps, installer: new InstallerService(deps) }
}

describe('InstallerService', () => {
  it('downloads, checks, benchmarks, keeps the faster build and starts KataGo', async () => {
    const { installer, fixture, configFile, enginesDir, config, health } = await setup({ cpu: SLOW })
    expect(health.get().state).toBe('failed')
    expect(installer.status()).toMatchObject({ step: 'idle', installed: false, updateAvailable: false })

    expect(installer.start().step).toBe('downloading')
    const s = await installer.settled()

    expect(s.error).toBeNull()
    expect(s).toMatchObject({ step: 'done', kind: 'gpu', installed: true, updateAvailable: false })
    expect(s.files.map((f) => f.label)).toEqual(['KataGo для процессора', 'KataGo для видеокарты (OpenCL)', 'Основная сеть', 'Human-сеть'])
    for (const f of s.files) expect(f.done && f.total > 0 && f.received === f.total).toBe(true)
    expect(fixture.requests.some((p) => p.includes('cuda'))).toBe(false)

    const gpuBinary = join(enginesDir, 'katago-1.18.1-opencl', 'katago-v1.18.1-opencl', EXE)
    const saved = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(saved.setup).toEqual({ kind: 'gpu', lockId: lockId(fixture.lock) })
    expect(saved.katago).toEqual({
      path: gpuBinary,
      analysisConfig: join(enginesDir, 'analysis-gpu.cfg'),
      mainModel: join(enginesDir, 'models', 'main.bin.gz'),
      humanModel: join(enginesDir, 'models', 'human.bin.gz'),
    })
    expect(saved.analysis.reviewVisits).toBeGreaterThanOrEqual(100)
    expect(config.katago.path).toBe(gpuBinary)
    expect(config.analysis).toEqual(saved.analysis)
    expect(readFileSync(join(enginesDir, 'analysis-gpu.cfg'), 'utf8')).toContain('numSearchThreadsPerAnalysisThread = 8')
    expect(readFileSync(join(enginesDir, 'analysis-cpu.cfg'), 'utf8')).toContain('numSearchThreadsPerAnalysisThread = 2')
    expect(health.get().state).toBe('ready')
  })

  it('keeps the CPU build when it is faster', async () => {
    const { installer } = await setup({ gpu: SLOW })
    installer.start()
    expect(await installer.settled()).toMatchObject({ step: 'done', kind: 'cpu' })
  })

  it('falls back to the CPU when the OpenCL build crashes', async () => {
    const { installer, configFile } = await setup({ gpu: CRASH })
    installer.start()
    expect(await installer.settled()).toMatchObject({ step: 'done', kind: 'cpu', error: null })
    expect(JSON.parse(readFileSync(configFile, 'utf8')).setup.kind).toBe('cpu')
  })

  it('fails when no build starts and leaves the settings alone', async () => {
    const { installer, configFile, health } = await setup({ cpu: CRASH, gpu: CRASH })
    installer.start()
    const s = await installer.settled()
    expect(s.step).toBe('failed')
    expect(s.error).toMatch(/^KataGo не запустился: KataGo аварийно завершился/)
    expect(s.installed).toBe(false)
    expect(existsSync(configFile)).toBe(false)
    expect(health.get().state).toBe('failed')
  })

  it('reports a failed download, keeps the verified files and fetches only what is missing on retry', async () => {
    const { installer, fixture, enginesDir, configFile } = await setup()
    fixture.failing.add('/human.bin.gz')
    installer.start()
    const failed = await installer.settled()
    expect(failed.step).toBe('failed')
    expect(failed.error).toBe(`Не удалось скачать ${fixture.lock.models.human.url}: HTTP 500`)
    expect(failed.files.map((f) => f.done)).toEqual([true, true, true, false])
    expect(existsSync(join(enginesDir, 'models', 'main.bin.gz'))).toBe(true)
    expect(existsSync(join(enginesDir, 'models', 'human.bin.gz.part'))).toBe(false)
    expect(existsSync(configFile)).toBe(false)

    fixture.failing.clear()
    fixture.requests.length = 0
    installer.start()
    expect(await installer.settled()).toMatchObject({ step: 'done', error: null })
    expect(fixture.requests).toEqual(['/human.bin.gz'])
  })

  it('rejects a file whose checksum does not match the lock', async () => {
    const fixture = await createInstallFixture()
    fixtures.push(fixture)
    fixture.lock.models.main.sha256 = '0'.repeat(64)
    const { installer } = await setup({}, fixture)
    installer.start()
    const s = await installer.settled()
    expect(s.step).toBe('failed')
    expect(s.error).toMatch(/^main\.bin\.gz: SHA-256 [0-9a-f]{64} не совпадает с katago\.lock\.json/)
  })

  it('ignores a second start while installing', async () => {
    const { installer, fixture } = await setup()
    installer.start()
    expect(installer.start().step).not.toBe('idle')
    await installer.settled()
    expect(fixture.requests.filter((p) => p === '/main.bin.gz')).toHaveLength(1)
  })

  it('fails at once on a system without KataGo builds', async () => {
    const { deps } = await setup()
    const mac = new InstallerService({ ...deps, platform: 'darwin' })
    expect(mac.start()).toMatchObject({ step: 'failed', error: 'Для этой системы (darwin) нет готовых сборок KataGo' })
  })
})

describe('engineUpdateAvailable', () => {
  it('compares the installer record with the current lock and ignores a manual setup', async () => {
    const fixture = await createInstallFixture()
    fixtures.push(fixture)
    const file = join(tempDir(), 'config.json')
    const withSetup = (setup: object) => {
      writeFileSync(file, JSON.stringify({ setup }))
      return loadConfig(file)
    }
    expect(engineUpdateAvailable(withSetup({ kind: 'cpu', lockId: '1.17.0/aaaaaaaaaaaa/bbbbbbbbbbbb' }), fixture.lock)).toBe(true)
    expect(engineUpdateAvailable(withSetup({ kind: 'cpu', lockId: lockId(fixture.lock) }), fixture.lock)).toBe(false)
    expect(engineUpdateAvailable(withSetup({ kind: 'cpu' }), fixture.lock)).toBe(false)
  })
})
```

In `packages/server/src/config.test.ts`, add inside `describe('loadConfig', …)` after the last test:
```ts

  it('keeps the installer record', () => {
    const setup = { kind: 'gpu', lockId: '1.18.1/9d7a6afed8ff/637746e44f0e' }
    expect(loadConfig(configFile({ setup })).setup).toEqual(setup)
    expect(loadConfig(configFile()).setup).toBeUndefined()
  })
```

In `packages/server/src/engine/lock.test.ts`, change the imports to
```ts
import { REPO_LOCK, tempDir } from '../../test/helpers'
import { HUMAN_MODEL_FILE, MAIN_MODEL_FILE } from '../config'
import { buildsFor, loadLock, lockId, versionWarning } from './lock'
```
and append:
```ts

describe('lockId', () => {
  it('names the KataGo version and both networks by their checksums', () => {
    expect(lockId(loadLock(REPO_LOCK))).toBe('1.18.1/9d7a6afed8ff/637746e44f0e')
  })
})
```

In `packages/server/src/settings/service.test.ts`, change the helpers import to
```ts
import { FAKE_KATAGO, fakeEngine, REPO_LOCK, tempDir, testConfig } from '../../test/helpers'
```
and append:
```ts

describe('SettingsService.switchTo', () => {
  it('switches to an installed engine and records who set it up, keeping other config fields', async () => {
    const { settings, inst, config, configFile } = await setup()
    writeFileSync(configFile, JSON.stringify({ bot: { defaultRank: '5k' }, setup: { kind: 'cpu' } }))
    const katago = { path: inst.katago, analysisConfig: inst.cfg, mainModel: inst.main, humanModel: inst.human }
    const r = await settings.switchTo(katago, { reviewVisits: 300, endVisits: 150 }, { kind: 'gpu', lockId: '1.18.1/aaaaaaaaaaaa/bbbbbbbbbbbb' })
    expect(r.ok).toBe(true)
    expect(config.setup).toEqual({ kind: 'gpu', lockId: '1.18.1/aaaaaaaaaaaa/bbbbbbbbbbbb' })
    expect(config.analysis).toEqual({ reviewVisits: 300, endVisits: 150 })
    const saved = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(saved).toEqual({
      bot: { defaultRank: '5k' },
      setup: { kind: 'gpu', lockId: '1.18.1/aaaaaaaaaaaa/bbbbbbbbbbbb' },
      katago,
      analysis: { reviewVisits: 300, endVisits: 150 },
    })
  })

  it('creates the folder of a config file that does not exist yet', async () => {
    const { inst, config, engine, health } = await setup()
    const configFile = join(inst.dir, 'profile', 'config.json')
    const settings = new SettingsService({ config, configFile, modelsDir: inst.models, engine, health, lock: loadLock(REPO_LOCK), commandFor })
    const katago = { path: inst.katago, analysisConfig: inst.cfg, mainModel: inst.main, humanModel: inst.human }
    expect((await settings.switchTo(katago, { reviewVisits: 300, endVisits: 150 })).ok).toBe(true)
    expect(JSON.parse(readFileSync(configFile, 'utf8')).katago).toEqual(katago)
  })
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run packages/server`
Expected: FAIL — `Error: Cannot find module './installer'`, `lockId is not a function`, `settings.switchTo is not a function`. (The new config test already passes at run time because `loadConfig` copies unknown fields through `...raw`; the `setup` type is added in Step 4 and checked by `tsc` in Step 6.)

- [ ] **Step 4: Shared types, config field and lock fingerprint**

`packages/shared/src/install.ts`:
```ts
/** Spec 5.3: the built-in KataGo installer's steps; `failed` keeps the reason in `InstallStatus.error`. */
export type InstallStep =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'benchmarking-cpu'
  | 'benchmarking-gpu'
  | 'finishing'
  | 'done'
  | 'failed'

export interface InstallFile {
  /** File name on disk, e.g. `b18c384nbt-humanv0.bin.gz`. */
  name: string
  /** What the file is, for the install screen. */
  label: string
  received: number
  /** Expected size in bytes; 0 while unknown. */
  total: number
  /** Downloaded (or found on disk) and its SHA-256 checked. */
  done: boolean
}

export interface InstallStatus {
  step: InstallStep
  files: InstallFile[]
  error: string | null
  /** The KataGo files named in the settings exist. */
  installed: boolean
  /** Spec 5.1: the installer set KataGo up from a different katago.lock.json. */
  updateAvailable: boolean
  /** The build chosen by the last successful installation. */
  kind: 'cpu' | 'gpu' | null
}
```

`packages/shared/src/index.ts`:
```ts
export * from './types'
export * from './protocol'
export * from './coords'
export * from './zone'
export * from './rules'
export * from './settings'
export * from './install'
```

In `packages/server/src/config.ts`, replace the `AppConfig` interface with:
```ts
/** Who set KataGo up: the installer writes both fields, `npm run setup` only `kind`. */
export interface SetupInfo {
  kind?: 'cpu' | 'gpu'
  /** Spec 5.1: fingerprint of the katago.lock.json the installer used (see `lockId`); absent for a manual setup. */
  lockId?: string
}

export interface AppConfig {
  port: number
  dataDir: string
  katago: KataGoSettings
  analysis: { reviewVisits: number; endVisits: number }
  thresholds: Thresholds
  bot: { defaultRank: string; temperature: number }
  maxSessionMoves: number
  setup?: SetupInfo
}
```
(`loadConfig` already copies `setup` from the file through `...raw`.)

Append to `packages/server/src/engine/lock.ts`:
```ts

/** Spec 5.1: names the pinned KataGo version and networks: `<version>/<main sha256, 12>/<human sha256, 12>`. */
export const lockId = (lock: KataGoLock): string =>
  `${lock.katago.version}/${lock.models.main.sha256.slice(0, 12)}/${lock.models.human.sha256.slice(0, 12)}`
```

- [ ] **Step 5: `switchTo` in the settings service and the installer**

`packages/server/src/settings/service.ts`:
```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { AnalysisSettings, SettingsResponse, SettingsUpdate, SettingsView } from '@joseki-dojo/shared'
import type { AppConfig, KataGoSettings, SetupInfo } from '../config'
import { engineCommand } from '../engine/command'
import type { EngineCommand, KataGoEngine } from '../engine/engine'
import { checkEngine, missingFiles, type HealthMonitor } from '../engine/health'
import { versionWarning, type KataGoLock } from '../engine/lock'

export interface SettingsServiceDeps {
  config: AppConfig
  configFile: string
  modelsDir: string
  engine: KataGoEngine
  health: HealthMonitor
  lock: KataGoLock
  /** Tests substitute the fake KataGo; production builds the real command line. */
  commandFor?: (config: AppConfig) => EngineCommand
}

const MODEL_FILE = /\.(bin|txt)\.gz$|\.bin$/
const BUSY = 'Настройки уже применяются'

function validateUpdate(u: SettingsUpdate): string | null {
  const paths = u?.katago ? [u.katago.path, u.katago.analysisConfig, u.katago.mainModel, u.katago.humanModel] : []
  if (paths.length !== 4 || paths.some((p) => typeof p !== 'string' || p.trim() === '')) return 'Укажите все пути'
  const visits = [u.analysis?.reviewVisits, u.analysis?.endVisits]
  if (visits.some((v) => !Number.isInteger(v) || (v as number) < 1 || (v as number) > 100_000)) {
    return 'Число визитов должно быть целым от 1 до 100000'
  }
  return null
}

/** Spec 7a: shows and changes the engine paths; a change is kept only if the restarted KataGo passes its checks. */
export class SettingsService {
  private applying = false
  private readonly commandFor: (config: AppConfig) => EngineCommand

  constructor(private readonly d: SettingsServiceDeps) {
    this.commandFor = d.commandFor ?? engineCommand
  }

  async view(): Promise<SettingsView> {
    const running = this.d.health.get().state === 'ready' ? await this.d.engine.version().catch(() => null) : null
    const { path, analysisConfig, mainModel, humanModel } = this.d.config.katago
    return {
      katago: { path, analysisConfig, mainModel, humanModel },
      analysis: { ...this.d.config.analysis },
      models: this.listModels(),
      lockedVersion: this.d.lock.katago.version,
      runningVersion: running,
      versionWarning: versionWarning(this.d.lock, running),
      defaultBotRank: this.d.config.bot.defaultRank,
    }
  }

  async apply(update: SettingsUpdate): Promise<SettingsResponse> {
    if (this.applying) return { ok: false, reason: BUSY }
    const invalid = validateUpdate(update)
    if (invalid) return { ok: false, reason: invalid }
    // Relative paths mean "relative to the config file", like in loadConfig, not to the process's working directory.
    const base = dirname(resolve(this.d.configFile))
    const katago: KataGoSettings = {
      path: resolve(base, update.katago.path),
      analysisConfig: resolve(base, update.katago.analysisConfig),
      mainModel: resolve(base, update.katago.mainModel),
      humanModel: resolve(base, update.katago.humanModel),
    }
    return this.switchTo(katago, { reviewVisits: update.analysis.reviewVisits, endVisits: update.analysis.endVisits })
  }

  /**
   * Restarts KataGo with `katago` and keeps the change only if it passes the startup checks; then updates the live
   * config and saves it, with `setup` when given (the installer's record). On any failure the previous engine stays.
   */
  async switchTo(katago: KataGoSettings, analysis: AnalysisSettings, setup?: SetupInfo): Promise<SettingsResponse> {
    if (this.applying) return { ok: false, reason: BUSY }
    this.applying = true
    try {
      const candidate: AppConfig = { ...this.d.config, katago, analysis }
      const missing = missingFiles(candidate)
      if (missing) return { ok: false, reason: missing }

      const previous = this.commandFor(this.d.config)
      let failure: string | null = null
      try {
        await this.d.engine.restartWith(this.commandFor(candidate))
        const health = await checkEngine(candidate, this.d.engine)
        if (health.state !== 'ready') failure = health.reason ?? 'KataGo не запустился'
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e)
      }
      if (failure !== null) {
        await this.d.engine.restartWith(previous).catch(() => undefined)
        await this.d.health.check().catch(() => undefined)
        return { ok: false, reason: failure }
      }

      const prevKatago = this.d.config.katago
      const prevAnalysis: AnalysisSettings = { ...this.d.config.analysis }
      const prevSetup = this.d.config.setup
      try {
        this.d.config.katago = katago // a test-only commandOverride is dropped here on purpose
        Object.assign(this.d.config.analysis, analysis) // the scheduler holds this same object
        if (setup) this.d.config.setup = { ...prevSetup, ...setup }
        this.persist(katago, analysis, setup)
        await this.d.health.check()
        return { ok: true, settings: await this.view() }
      } catch (e) {
        // A change is kept only if everything succeeds: put the previous engine and config back.
        this.d.config.katago = prevKatago
        Object.assign(this.d.config.analysis, prevAnalysis)
        this.d.config.setup = prevSetup
        await this.d.engine.restartWith(previous).catch(() => undefined)
        await this.d.health.check().catch(() => undefined)
        return { ok: false, reason: `Не удалось сохранить настройки: ${e instanceof Error ? e.message : String(e)}` }
      }
    } finally {
      this.applying = false
    }
  }

  private listModels(): string[] {
    if (!existsSync(this.d.modelsDir)) return []
    return readdirSync(this.d.modelsDir)
      .filter((f) => MODEL_FILE.test(f))
      .map((f) => join(this.d.modelsDir, f))
      .sort()
  }

  private persist(katago: KataGoSettings, analysis: AnalysisSettings, setup?: SetupInfo): void {
    const raw = (existsSync(this.d.configFile) ? JSON.parse(readFileSync(this.d.configFile, 'utf8')) : {}) as Record<string, unknown>
    const { commandOverride: _dropped, ...oldKatago } = (raw.katago ?? {}) as Record<string, unknown>
    raw.katago = { ...oldKatago, ...katago }
    raw.analysis = { ...((raw.analysis ?? {}) as Record<string, unknown>), ...analysis }
    if (setup) raw.setup = { ...((raw.setup ?? {}) as Record<string, unknown>), ...setup }
    mkdirSync(dirname(this.d.configFile), { recursive: true })
    writeFileSync(this.d.configFile, `${JSON.stringify(raw, null, 2)}\n`)
  }
}
```

`packages/server/src/install/installer.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { basename, join } from 'node:path'
import type { InstallFile, InstallStatus, InstallStep } from '@joseki-dojo/shared'
import type { AppConfig } from '../config'
import { KataGoEngine, type EngineCommand } from '../engine/engine'
import { compareVersions, missingFiles, MIN_KATAGO_VERSION } from '../engine/health'
import { buildsFor, lockId, type KataGoLock, type LockedBuild } from '../engine/lock'
import type { SettingsService } from '../settings/service'
import { measureVisitsPerSecond, visitsForBudget } from './calibrate'
import { download, extractBuild } from './download'
import { analysisConfigText, searchThreadsFor } from './katago-config'

type BuildKind = LockedBuild['kind']

export interface InstallerDeps {
  /** The live config: the installer reads the current paths and, through `settings`, replaces them. */
  config: AppConfig
  lock: KataGoLock
  /** Builds, networks and analysis configs go here (`downloads/`, `katago-<version>-<id>/`, `models/`). */
  enginesDir: string
  /** Switches KataGo to the installed build and saves the config (with the same rollback as the settings screen). */
  settings: SettingsService
  /** Builds the KataGo command line; tests substitute the fake KataGo. */
  commandFor: (config: AppConfig) => EngineCommand
  log?: (line: string) => void
  /** Defaults: the current OS, its logical cores, an 800-visit timed search, 60 s without download progress. */
  platform?: NodeJS.Platform
  cores?: number
  benchmarkVisits?: number
  stallTimeoutMs?: number
}

interface PlannedDownload {
  url: string
  sha256: string
  dest: string
  label: string
  size: number
}

interface Plan {
  downloads: PlannedDownload[]
  builds: { kind: BuildKind; zip: string; dir: string }[]
  mainModel: string
  humanModel: string
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Spec 5.1: the installer set KataGo up from another katago.lock.json; a manual setup (no lockId) is never offered one. */
export function engineUpdateAvailable(config: AppConfig, lock: KataGoLock): boolean {
  const id = config.setup?.lockId
  return typeof id === 'string' && id !== lockId(lock)
}

/**
 * Spec 5: downloads the CPU and OpenCL builds and both networks from katago.lock.json, checks every SHA-256,
 * benchmarks each build, keeps the faster one and switches KataGo to it. One installation runs at a time.
 */
export class InstallerService {
  private step: InstallStep = 'idle'
  private files: InstallFile[] = []
  private error: string | null = null
  private kind: BuildKind | null = null
  private running: Promise<void> | null = null
  private bench: KataGoEngine | null = null
  private closed = false
  private readonly log: (line: string) => void

  constructor(private readonly d: InstallerDeps) {
    this.log = d.log ?? (() => undefined)
  }

  status(): InstallStatus {
    return {
      step: this.step,
      files: this.files.map((f) => ({ ...f })),
      error: this.error,
      installed: missingFiles(this.d.config) === null,
      updateAvailable: engineUpdateAvailable(this.d.config, this.d.lock),
      kind: this.kind,
    }
  }

  /** Starts an installation; while one runs, only returns its state (spec 5.3). */
  start(): InstallStatus {
    if (this.running || this.closed) return this.status()
    this.error = null
    this.kind = null
    let plan: Plan
    try {
      plan = this.plan()
    } catch (err) {
      this.fail(err)
      return this.status()
    }
    this.files = plan.downloads.map((d) => ({ name: basename(d.dest), label: d.label, received: 0, total: d.size, done: false }))
    this.step = 'downloading'
    this.running = this.run(plan).finally(() => {
      this.running = null
    })
    return this.status()
  }

  /** Resolves when no installation is running. */
  async settled(): Promise<InstallStatus> {
    await this.running
    return this.status()
  }

  /** Server shutdown: stops a benchmark KataGo so that no process outlives the app. */
  async close(): Promise<void> {
    this.closed = true
    await this.bench?.stop()
  }

  private plan(): Plan {
    const platform = this.d.platform ?? process.platform
    const builds = buildsFor(this.d.lock, platform)
    const cpu = builds.find((b) => b.kind === 'cpu')
    const gpu = builds.find((b) => b.id === 'opencl')
    if (!cpu) throw new Error(`Для этой системы (${platform}) нет готовых сборок KataGo`)
    const { version } = this.d.lock.katago
    const dir = this.d.enginesDir
    const chosen: [LockedBuild, string][] = [[cpu, 'KataGo для процессора']]
    if (gpu) chosen.push([gpu, 'KataGo для видеокарты (OpenCL)'])
    const plan: Plan = {
      downloads: [],
      builds: [],
      mainModel: join(dir, 'models', this.d.lock.models.main.file),
      humanModel: join(dir, 'models', this.d.lock.models.human.file),
    }
    for (const [b, label] of chosen) {
      const zip = join(dir, 'downloads', basename(new URL(b.url).pathname))
      plan.downloads.push({ url: b.url, sha256: b.sha256, dest: zip, label, size: 0 })
      plan.builds.push({ kind: b.kind, zip, dir: join(dir, `katago-${version}-${b.id}`) })
    }
    const { main, human } = this.d.lock.models
    plan.downloads.push({ url: main.url, sha256: main.sha256, dest: plan.mainModel, label: 'Основная сеть', size: main.size })
    plan.downloads.push({ url: human.url, sha256: human.sha256, dest: plan.humanModel, label: 'Human-сеть', size: human.size })
    return plan
  }

  private async run(plan: Plan): Promise<void> {
    try {
      for (const [i, d] of plan.downloads.entries()) {
        const file = this.files[i]
        await download(d.url, d.dest, d.sha256, {
          replaceMismatched: true,
          stallTimeoutMs: this.d.stallTimeoutMs,
          onProgress: (received, total) => {
            file.received = received
            if (total > 0) file.total = total
          },
        })
        file.done = true
        if (file.total === 0) file.total = file.received
        this.alive()
      }

      this.step = 'extracting'
      const binaries = new Map<BuildKind, string>()
      for (const b of plan.builds) binaries.set(b.kind, await extractBuild(b.zip, b.dir))

      const speeds = new Map<BuildKind, number>()
      const errors: string[] = []
      for (const kind of ['cpu', 'gpu'] as const) {
        const bin = binaries.get(kind)
        if (!bin) continue
        this.alive()
        this.step = kind === 'cpu' ? 'benchmarking-cpu' : 'benchmarking-gpu'
        try {
          const vps = await this.benchmark(kind, bin, plan)
          speeds.set(kind, vps)
          this.log(`[install] ${kind}: ${Math.round(vps)} визитов/с`)
        } catch (err) {
          // Spec 5.2: a GPU that does not start (no card, no driver) only means the CPU build is used.
          errors.push(message(err))
          this.log(`[install] ${kind}: ${message(err)}`)
        }
      }
      const ranked = [...speeds].sort((a, b) => b[1] - a[1])
      if (ranked.length === 0) throw new Error(`KataGo не запустился: ${errors[0] ?? 'нет подходящей сборки'}`)
      const [kind, vps] = ranked[0]

      this.alive()
      this.step = 'finishing'
      const katago = { path: binaries.get(kind)!, analysisConfig: this.analysisConfig(kind), mainModel: plan.mainModel, humanModel: plan.humanModel }
      const r = await this.d.settings.switchTo(katago, visitsForBudget(vps), { kind, lockId: lockId(this.d.lock) })
      if (!r.ok) throw new Error(r.reason)
      this.kind = kind
      this.step = 'done'
    } catch (err) {
      this.fail(err)
    }
  }

  /** Runs `bin` alone and measures its visits per second (the startup timeout allows for OpenCL tuning). */
  private async benchmark(kind: BuildKind, bin: string, plan: Plan): Promise<number> {
    const logDir = join(this.d.config.dataDir, 'katago-logs')
    mkdirSync(logDir, { recursive: true })
    const cores = this.d.cores ?? availableParallelism()
    writeFileSync(this.analysisConfig(kind), analysisConfigText({ logDir, searchThreadsPerAnalysisThread: searchThreadsFor(kind, cores) }))
    const candidate: AppConfig = {
      ...this.d.config,
      katago: { path: bin, analysisConfig: this.analysisConfig(kind), mainModel: plan.mainModel, humanModel: plan.humanModel },
    }
    const engine = new KataGoEngine(this.d.commandFor(candidate), (line) => this.log(`[katago ${kind}] ${line}`), { maxRestarts: 0 })
    this.bench = engine
    try {
      engine.start()
      const version = await engine.version()
      if (compareVersions(version, MIN_KATAGO_VERSION) < 0) throw new Error(`нужна KataGo ${MIN_KATAGO_VERSION} или новее, а запущена ${version}`)
      return await measureVisitsPerSecond(engine, this.d.benchmarkVisits)
    } finally {
      this.bench = null
      await engine.stop()
    }
  }

  private analysisConfig(kind: BuildKind): string {
    return join(this.d.enginesDir, `analysis-${kind}.cfg`)
  }

  private alive(): void {
    if (this.closed) throw new Error('Сервер остановлен')
  }

  private fail(err: unknown): void {
    this.error = message(err)
    this.step = 'failed'
    this.log(`[install] ${this.error}`)
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run packages/server/src/install/installer.test.ts --reporter=verbose`
Expected: 9 tests pass, among them `downloads, checks, benchmarks, keeps the faster build and starts KataGo`, `falls back to the CPU when the OpenCL build crashes`, `reports a failed download, keeps the verified files and fetches only what is missing on retry`.

Run: `npm test && npm run typecheck`
Expected: `Test Files  32 passed (32)`, `Tests  198 passed (198)`; `tsc` prints nothing.

- [ ] **Step 7: Stage the changes**

```bash
git add packages/shared/src packages/server/src packages/server/test
```

---

### Task 3: `startServer` with explicit paths, `/api/install`, CLI wrapper

**Files:**
- Create: `packages/server/src/start.ts`, `packages/server/src/start.test.ts`, `packages/server/src/api/install-routes.ts`, `packages/server/src/store/migrations.ts`
- Delete: `packages/server/migrations/001_init.sql` (the SQL moves into `migrations.ts` unchanged)
- Rewrite: `packages/server/src/main.ts`, `packages/server/src/app.ts`, `packages/server/src/store/db.ts`, `packages/server/src/engine/lock.ts`, `packages/server/test/helpers.ts`
- Modify: `packages/server/src/store/repo.test.ts`, `packages/server/src/api/api.test.ts`, `packages/server/src/engine/lock.test.ts`, `packages/server/src/settings/service.test.ts`, `packages/server/test/katago.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 (`InstallerService`, `SettingsService.switchTo`, `createInstallFixture`, `fakeBuildCommand`, `REPO_LOCK`); `loadConfig`, `engineCommand`, `KataGoEngine`, `HealthMonitor`.
- Produces:
  - `engine/lock.ts`: `loadLock(file: string): KataGoLock` — the path is required (no `import.meta.url` default).
  - `store/migrations.ts`: `interface Migration { version: number; name: string; sql: string }`, `MIGRATIONS: readonly Migration[]`; `store/db.ts`: `migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number[]`.
  - `app.ts`: `interface ServiceOptions { configFile: string; enginesDir: string; lock: KataGoLock; commandFor: (config: AppConfig) => EngineCommand; log?: (line: string) => void }`; `createServices(config: AppConfig, engine: KataGoEngine, options: ServiceOptions): AppServices` (now required); `AppServices.installer: InstallerService`.
  - `api/install-routes.ts`: `registerInstallRoutes(app: FastifyInstance, installer: InstallerService): void` — `GET /api/install` → `InstallStatus`; `POST /api/install` → starts (or, while running, only returns) the state.
  - `start.ts`: `interface ServerOptions { configFile: string; dataDir?: string; enginesDir: string; lockFile: string; webDist: string | null; port?: number; log?: (line: string) => void; lock?: KataGoLock; commandFor?: (config: AppConfig) => EngineCommand }`; `interface RunningServer { url: string; port: number; services: AppServices; close(): Promise<void> }`; `startServer(options: ServerOptions): Promise<RunningServer>`.
  - Tests: `serviceOptions(config: AppConfig, overrides?: Partial<ServiceOptions>): ServiceOptions` (`test/helpers.ts`).

- [ ] **Step 1: Write the failing tests**

`packages/server/src/start.test.ts`:
```ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HealthResponse, InstallStatus } from '@joseki-dojo/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAKE_KATAGO, REPO_LOCK, tempDir } from '../test/helpers'
import { createInstallFixture, fakeBuildCommand, type InstallFixture } from '../test/install-fixture'
import { startServer, type RunningServer } from './start'

const servers: RunningServer[] = []
const fixtures: InstallFixture[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
  await Promise.all(fixtures.splice(0).map((f) => f.close()))
})

const getJson = async <T>(url: string): Promise<T> => (await fetch(url)).json() as Promise<T>

async function health(server: RunningServer, state: HealthResponse['state']): Promise<HealthResponse> {
  return vi.waitFor(
    async () => {
      const h = await getJson<HealthResponse>(`${server.url}/api/health`)
      if (h.state !== state) throw new Error(`health is ${h.state}`)
      return h
    },
    { timeout: 10_000, interval: 50 },
  )
}

describe('startServer', () => {
  it('runs with explicit paths on a free port and serves the web UI', async () => {
    const root = tempDir()
    const configFile = join(root, 'profile', 'config.json')
    mkdirSync(join(root, 'profile'))
    writeFileSync(configFile, JSON.stringify({ katago: { commandOverride: [process.execPath, FAKE_KATAGO] } }))
    const webDist = join(root, 'web')
    mkdirSync(webDist)
    writeFileSync(join(webDist, 'index.html'), '<div id="app"></div>')

    const server = await startServer({ configFile, dataDir: join(root, 'data'), enginesDir: join(root, 'engines'), lockFile: REPO_LOCK, webDist, port: 0, log: () => undefined })
    servers.push(server)

    expect(server.port).toBeGreaterThan(0)
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`)
    expect(await (await fetch(server.url)).text()).toContain('<div id="app"></div>')
    await health(server, 'ready')
    expect(existsSync(join(root, 'data', 'joseki-dojo.sqlite'))).toBe(true)
    expect(await getJson<InstallStatus>(`${server.url}/api/install`)).toEqual({
      step: 'idle',
      files: [],
      error: null,
      installed: true,
      updateAvailable: false,
      kind: null,
    })

    await server.close()
    await server.close() // a second close is harmless
    expect(server.services.engine.pendingCount).toBe(0)
  })

  it('installs KataGo through /api/install when it is missing', async () => {
    const fixture = await createInstallFixture()
    fixtures.push(fixture)
    const root = tempDir()
    const server = await startServer({
      configFile: join(root, 'config.json'),
      dataDir: join(root, 'data'),
      enginesDir: join(root, 'engines'),
      lockFile: REPO_LOCK,
      webDist: null,
      port: 0,
      log: () => undefined,
      lock: fixture.lock,
      commandFor: fakeBuildCommand(),
    })
    servers.push(server)

    expect((await health(server, 'failed')).reason).toMatch(/^KataGo не найден/)
    expect(await getJson<InstallStatus>(`${server.url}/api/install`)).toMatchObject({ step: 'idle', installed: false })

    const started = (await (await fetch(`${server.url}/api/install`, { method: 'POST' })).json()) as InstallStatus
    expect(started.step).toBe('downloading')
    expect(started.files).toHaveLength(4)

    await vi.waitFor(
      async () => {
        const s = await getJson<InstallStatus>(`${server.url}/api/install`)
        if (s.step !== 'done') throw new Error(`install is ${s.step}: ${s.error}`)
      },
      { timeout: 10_000, interval: 50 },
    )
    await health(server, 'ready')
    expect(existsSync(join(root, 'config.json'))).toBe(true)
  })
})
```

In `packages/server/src/store/repo.test.ts`, add the import `import { MIGRATIONS } from './migrations'` after `import { migrate, openDb } from './db'`, and add this test inside `describe('migrations', …)` after `applies once`:
```ts

  it('applies only the migrations not recorded yet', () => {
    const db = openDb(':memory:')
    const next = { version: 2, name: '002_extra.sql', sql: 'CREATE TABLE extra (id INTEGER PRIMARY KEY)' }
    expect(migrate(db, [...MIGRATIONS, next])).toEqual([2])
    expect(migrate(db, [...MIGRATIONS, next])).toEqual([])
    expect(db.prepare('SELECT name FROM schema_migrations ORDER BY version').all()).toEqual([{ name: '001_init.sql' }, { name: '002_extra.sql' }])
  })
```

`packages/server/test/helpers.ts` (adds `serviceOptions`; `REPO_LOCK` is from Task 2):
```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gtpToVertex, vertexToIndex } from '@joseki-dojo/shared'
import type { ServiceOptions } from '../src/app'
import { DEFAULT_CONFIG, type AppConfig } from '../src/config'
import { engineCommand } from '../src/engine/command'
import { KataGoEngine, type AnalysisEngine, type EngineOptions } from '../src/engine/engine'
import { loadLock } from '../src/engine/lock'
import type { AnalysisResponse, KataGoQueryBody } from '../src/engine/katago-types'

export const FAKE_KATAGO = fileURLToPath(new URL('./fake-katago.mjs', import.meta.url))

/** The repository's katago.lock.json (product code always receives the lock path explicitly). */
export const REPO_LOCK = fileURLToPath(new URL('../../../katago.lock.json', import.meta.url))

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'joseki-dojo-'))

export function fakeEngine(env: Record<string, string> = {}, logs: string[] = [], options: EngineOptions = {}): KataGoEngine {
  return new KataGoEngine({ command: process.execPath, args: [FAKE_KATAGO], env }, (line) => logs.push(line), options)
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    dataDir: tempDir(),
    katago: { ...DEFAULT_CONFIG.katago, commandOverride: [process.execPath, FAKE_KATAGO] },
    analysis: { reviewVisits: 10, endVisits: 5 },
    ...overrides,
  }
}

/** createServices options for a test config: files under its data folder, the repository lock, the real command line. */
export function serviceOptions(config: AppConfig, overrides: Partial<ServiceOptions> = {}): ServiceOptions {
  return {
    configFile: join(config.dataDir, 'config.local.json'),
    enginesDir: join(config.dataDir, 'engines'),
    lock: loadLock(REPO_LOCK),
    commandFor: engineCommand,
    ...overrides,
  }
}

export const isHumanQuery = (q: KataGoQueryBody): boolean => q.overrideSettings?.humanSLProfile !== undefined
export const isTenukiQuery = (q: KataGoQueryBody): boolean => q.allowMoves !== undefined
export const isPassProbe = (q: KataGoQueryBody): boolean => !isHumanQuery(q) && q.moves.at(-1)?.[1] === 'pass'

/** In-process engine with programmable answers (captures are not simulated). */
export class StubEngine implements AnalysisEngine {
  readonly queries: KataGoQueryBody[] = []
  best: (q: KataGoQueryBody) => string = (q) => q.allowMoves?.[0]?.moves[0] ?? 'D4'
  lead: (q: KataGoQueryBody) => number = () => 0
  fail: { when: (q: KataGoQueryBody) => boolean; error: Error } | null = null
  hold = false
  private readonly held: (() => void)[] = []

  async analyze(q: KataGoQueryBody): Promise<AnalysisResponse> {
    this.queries.push(q)
    if (this.hold) await new Promise<void>((resolve) => this.held.push(resolve))
    if (this.fail?.when(q)) {
      const { error } = this.fail
      this.fail = null
      throw error
    }
    return stubResponse(q, this.best(q), this.lead(q))
  }

  release(): void {
    this.hold = false
    for (const resolve of this.held.splice(0)) resolve()
  }
}

export function stubResponse(q: KataGoQueryBody, best: string, lead: number): AnalysisResponse {
  const taken = new Set<number>()
  for (const [, v] of q.moves) {
    const vertex = gtpToVertex(v)
    if (vertex !== 'pass') taken.add(vertexToIndex(vertex))
  }
  const last = q.moves.at(-1)
  const toMove = last ? (last[0] === 'B' ? 'W' : 'B') : 'B'
  const visits = q.maxVisits ?? 1
  const res: AnalysisResponse = {
    id: 'stub',
    turnNumber: q.moves.length,
    isDuringSearch: false,
    rootInfo: { currentPlayer: toMove, scoreLead: lead, winrate: 0.5, visits },
    moveInfos: [{ move: best, order: 0, visits, scoreLead: lead, winrate: 0.5, pv: [best] }],
  }
  if (q.includeOwnership) res.ownership = new Array<number>(361).fill(0)
  if (q.includePolicy) {
    const free = 361 - taken.size
    const policy = Array.from({ length: 362 }, (_, i) => (i === 361 ? 0 : taken.has(i) ? -1 : 1 / free))
    res.policy = policy
    if (isHumanQuery(q)) res.humanPolicy = [...policy]
  }
  return res
}
```

In `packages/server/src/api/api.test.ts`, import `serviceOptions` (`import { fakeEngine, serviceOptions, testConfig } from '../../test/helpers'`) and replace the first line of `beforeEach`
```ts
  services = createServices(testConfig(), fakeEngine())
```
with
```ts
  const config = testConfig()
  services = createServices(config, fakeEngine(), serviceOptions(config))
```

Every remaining `loadLock()` in tests gets the explicit path:
```bash
sed -i 's/loadLock()/loadLock(REPO_LOCK)/g' packages/server/src/engine/lock.test.ts packages/server/src/settings/service.test.ts packages/server/test/katago.integration.test.ts
```
and `packages/server/test/katago.integration.test.ts` gets `import { REPO_LOCK } from './helpers'` after `import { baseQuery } from '../src/engine/query'`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run packages/server`
Expected: FAIL — `Error: Cannot find module './start'` and `Error: Cannot find module './migrations'`.

- [ ] **Step 3: Migrations in code**

```bash
git rm -q packages/server/migrations/001_init.sql
```

`packages/server/src/store/migrations.ts` (the SQL of `001_init.sql`, byte for byte):
```ts
/**
 * Schema migrations in order, applied by `migrate`. They live in code rather than in .sql files so that the bundled
 * desktop app needs no files next to its JavaScript. Never edit a shipped migration: add the next one.
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: '001_init.sql',
    sql: `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  mode TEXT NOT NULL,
  environment TEXT NOT NULL,
  user_color TEXT NOT NULL CHECK (user_color IN ('B', 'W')),
  bot_rank TEXT NOT NULL,
  corner TEXT NOT NULL CHECK (corner IN ('TL', 'TR', 'BL', 'BR')),
  status TEXT NOT NULL CHECK (status IN ('playing', 'finished', 'abandoned')),
  parent_session_id TEXT REFERENCES sessions (id),
  initial_moves_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT
);

CREATE TABLE moves (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  color TEXT NOT NULL CHECK (color IN ('B', 'W')),
  move TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'bot', 'auto-tenuki')),
  in_zone INTEGER NOT NULL,
  PRIMARY KEY (session_id, turn)
);

CREATE TABLE analyses (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('position', 'pass_probe')),
  visits INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (session_id, turn, kind)
);

CREATE TABLE missed_punishments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  bot_move TEXT NOT NULL,
  bot_loss REAL NOT NULL,
  user_move TEXT NOT NULL,
  user_loss REAL NOT NULL,
  best_move TEXT NOT NULL,
  best_pv_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX missed_punishments_session ON missed_punishments (session_id);
`,
  },
]
```

`packages/server/src/store/db.ts`:
```ts
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MIGRATIONS, type Migration } from './migrations'

export type Db = Database.Database

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

/** Applies the migrations not yet recorded in `schema_migrations`; returns the versions applied. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
  const applied = new Set(rows.map((r) => r.version))
  const ran: number[] = []
  for (const m of migrations) {
    if (applied.has(m.version)) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString())
    })()
    ran.push(m.version)
  }
  return ran
}
```

- [ ] **Step 4: The lock path is always passed in**

`packages/server/src/engine/lock.ts`:
```ts
import { readFileSync } from 'node:fs'

export interface LockedBuild {
  id: string
  platform: 'win32' | 'linux'
  kind: 'cpu' | 'gpu'
  label: string
  url: string
  sha256: string
}

export interface LockedFile {
  file: string
  url: string
  sha256: string
  size: number
}

export interface KataGoLock {
  katago: { version: string; builds: LockedBuild[] }
  models: { main: LockedFile; human: LockedFile }
}

const SHA256 = /^[0-9a-f]{64}$/

/** Reads and checks katago.lock.json; the caller says where it is (the repository root, or the desktop app's resources). */
export function loadLock(file: string): KataGoLock {
  const lock = JSON.parse(readFileSync(file, 'utf8')) as KataGoLock
  if (!/^\d+\.\d+\.\d+$/.test(lock.katago?.version ?? '')) throw new Error(`${file}: katago.version must look like 1.18.1`)
  if (!lock.katago.builds?.length) throw new Error(`${file}: no KataGo builds`)
  if (!lock.models?.main || !lock.models?.human) throw new Error(`${file}: models.main and models.human are required`)
  for (const entry of [...lock.katago.builds, lock.models.main, lock.models.human]) {
    if (!entry.url?.startsWith('https://')) throw new Error(`${file}: url must be https: ${entry.url}`)
    if (!SHA256.test(entry.sha256 ?? '')) throw new Error(`${file}: bad sha256 for ${entry.url}`)
  }
  return lock
}

export const buildsFor = (lock: KataGoLock, platform: string): LockedBuild[] =>
  lock.katago.builds.filter((b) => b.platform === platform)

export function versionWarning(lock: KataGoLock, running: string | null): string | null {
  if (!running || running === lock.katago.version) return null
  return `Запущена KataGo ${running}, а проверена ${lock.katago.version}. Работать будет, но эта версия не проверялась.`
}

/** Spec 5.1: names the pinned KataGo version and networks: `<version>/<main sha256, 12>/<human sha256, 12>`. */
export const lockId = (lock: KataGoLock): string =>
  `${lock.katago.version}/${lock.models.main.sha256.slice(0, 12)}/${lock.models.human.sha256.slice(0, 12)}`
```

- [ ] **Step 5: Install routes, services, `startServer` and the CLI wrapper**

`packages/server/src/api/install-routes.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { InstallerService } from '../install/installer'

export function registerInstallRoutes(app: FastifyInstance, installer: InstallerService): void {
  app.get('/api/install', async () => installer.status())

  // Spec 5.3: starts the installer; while it runs, a repeated request only returns the current state.
  app.post('/api/install', async () => installer.start())
}
```

`packages/server/src/app.ts`:
```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import type { ServerMessage } from '@joseki-dojo/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { AnalysisScheduler } from './analysis/scheduler'
import { registerHttp } from './api/http'
import { Hub } from './api/hub'
import { registerInstallRoutes } from './api/install-routes'
import { registerSettingsRoutes } from './api/settings-routes'
import { handleSocket } from './api/ws'
import { HumanBot } from './bot/bot'
import type { AppConfig } from './config'
import type { EngineCommand, KataGoEngine } from './engine/engine'
import { HealthMonitor } from './engine/health'
import type { KataGoLock } from './engine/lock'
import { toErrorMessage } from './errors'
import { InstallerService } from './install/installer'
import { ReviewService } from './review/service'
import { SessionService } from './session/service'
import { SettingsService } from './settings/service'
import { openDb, type Db } from './store/db'
import { SessionRepo } from './store/repo'

export interface AppServices {
  config: AppConfig
  db: Db
  engine: KataGoEngine
  health: HealthMonitor
  sessions: SessionService
  reviews: ReviewService
  settings: SettingsService
  installer: InstallerService
  hub: Hub
}

export interface ServiceOptions {
  /** Where the settings screen and the installer save changes (config.local.json in a checkout). */
  configFile: string
  /** KataGo builds, networks and analysis configs; `<enginesDir>/models` is listed on the settings screen. */
  enginesDir: string
  lock: KataGoLock
  /** Builds the KataGo command line for a config; tests substitute the fake KataGo. */
  commandFor: (config: AppConfig) => EngineCommand
  log?: (line: string) => void
}

// The server only talks to the local browser. Checking Host defeats DNS rebinding, checking Origin stops other
// sites from opening the WebSocket (browsers do not apply the same-origin policy to it). Any port is allowed:
// the Vite dev server proxies from its own port.
const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/i
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i

export function createServices(config: AppConfig, engine: KataGoEngine, options: ServiceOptions): AppServices {
  const db = openDb(join(config.dataDir, 'joseki-dojo.sqlite'))
  const repo = new SessionRepo(db)
  const hub = new Hub()
  const publish = (sessionId: string, msg: ServerMessage): void => hub.publish(sessionId, msg)
  const analysis = new AnalysisScheduler(engine, repo, config.analysis)
  const reviews = new ReviewService({ repo, analysis, config, publish })
  const sessions = new SessionService({
    repo,
    analysis,
    engine,
    config,
    publish,
    bot: new HumanBot(engine),
    onFinished: (id) => {
      reviews.prepare(id).catch((err: unknown) => publish(id, toErrorMessage(err)))
    },
  })
  const health = new HealthMonitor(config, engine)
  const { configFile, enginesDir, lock, commandFor, log } = options
  const settings = new SettingsService({ config, engine, health, lock, configFile, modelsDir: join(enginesDir, 'models'), commandFor })
  const installer = new InstallerService({ config, lock, enginesDir, settings, commandFor, log })
  return { config, db, engine, health, sessions, reviews, settings, installer, hub }
}

export async function buildApp(services: AppServices, webDist: string | null = null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (!LOCAL_HOST.test(req.headers.host ?? '') || (req.url.startsWith('/ws') && origin !== undefined && !LOCAL_ORIGIN.test(origin))) {
      // A rejected WebSocket upgrade has no keep-alive owner: close its socket once the 403 is written.
      if (req.headers.upgrade) reply.raw.once('finish', () => req.raw.socket.end())
      return reply.code(403).header('connection', 'close').send({ error: 'forbidden' })
    }
  })
  await app.register(websocket)
  app.get('/ws', { websocket: true }, (socket) => handleSocket(socket, services))
  registerHttp(app, services)
  registerSettingsRoutes(app, services.settings)
  registerInstallRoutes(app, services.installer)
  if (webDist && existsSync(webDist)) await app.register(fastifyStatic, { root: webDist })
  return app
}
```

`packages/server/src/start.ts`:
```ts
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp, createServices, type AppServices } from './app'
import { loadConfig, type AppConfig } from './config'
import { engineCommand } from './engine/command'
import { KataGoEngine, type EngineCommand } from './engine/engine'
import { loadLock, type KataGoLock } from './engine/lock'

export interface ServerOptions {
  /** Settings file: config.local.json in a checkout, <userData>/config.json in the desktop app. Created on the first save. */
  configFile: string
  /** SQLite database and KataGo logs; replaces `dataDir` from the config file. */
  dataDir?: string
  /** Where the installer puts KataGo builds, networks and analysis configs. */
  enginesDir: string
  /** katago.lock.json with the pinned KataGo builds and networks. */
  lockFile: string
  /** The built web UI (packages/web/dist); null serves the API only. */
  webDist: string | null
  /** Replaces `port` from the config file; 0 picks a free port. */
  port?: number
  /** Server and KataGo log lines; the console by default. */
  log?: (line: string) => void
  /** Tests and e2e only: use this lock instead of reading `lockFile`. */
  lock?: KataGoLock
  /** Tests and e2e only: build the KataGo command line (e.g. the fake KataGo). */
  commandFor?: (config: AppConfig) => EngineCommand
}

export interface RunningServer {
  /** `http://127.0.0.1:<port>` */
  url: string
  port: number
  services: AppServices
  /** Stops the HTTP server, the installer, KataGo and the database; safe to call more than once. */
  close(): Promise<void>
}

/** Spec 4.1: the whole server with explicit paths, used by `npm start` (main.ts) and by the desktop app. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const log = options.log ?? ((line: string) => console.log(line))
  const loaded = loadConfig(options.configFile)
  const config: AppConfig = options.dataDir === undefined ? loaded : { ...loaded, dataDir: resolve(options.dataDir) }
  const lock = options.lock ?? loadLock(options.lockFile)
  const commandFor = options.commandFor ?? engineCommand
  const engine = new KataGoEngine(commandFor(config), (line) => log(`[katago] ${line}`))
  const services = createServices(config, engine, { configFile: options.configFile, enginesDir: options.enginesDir, lock, commandFor, log })
  let app: FastifyInstance
  try {
    app = await buildApp(services, options.webDist)
    await app.listen({ port: options.port ?? config.port, host: '127.0.0.1' })
  } catch (err) {
    services.db.close()
    throw err
  }
  const port = (app.server.address() as AddressInfo).port
  void services.health.check().then((h) => log(h.state === 'ready' ? 'KataGo готов' : `KataGo не готов: ${h.reason}`))

  let closing: Promise<void> | null = null
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      await app.close()
      await services.installer.close()
      await engine.stop()
      services.db.close()
    })())
  return { url: `http://127.0.0.1:${port}`, port, services, close }
}
```

`packages/server/src/main.ts`:
```ts
// `npm start` / `npm run dev`: everything lives in the repository (config.local.json, data/, engines/).
// JOSEKI_CONFIG points at another config file (the e2e test uses e2e/config.e2e.json).
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './start'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const server = await startServer({
  configFile: process.env.JOSEKI_CONFIG ? resolve(process.env.JOSEKI_CONFIG) : join(repoRoot, 'config.local.json'),
  enginesDir: join(repoRoot, 'engines'),
  lockFile: join(repoRoot, 'katago.lock.json'),
  webDist: join(repoRoot, 'packages', 'web', 'dist'),
})
console.log(`Joseki Dojo: ${server.url}`)

const shutdown = async (): Promise<void> => {
  await server.close()
  process.exit(0)
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
```

- [ ] **Step 6: Run everything**

Run: `npm test && npm run typecheck`
Expected: `Test Files  33 passed (33)`, `Tests  201 passed (201)`; `tsc` prints nothing.

Run: `grep -rn "import.meta" packages/server/src --include=*.ts | grep -v "\.test\.ts"`
Expected: only `packages/server/src/main.ts` (the CLI wrapper, which is not bundled).

Run: `npm run e2e`
Expected: `5 passed` — the e2e server starts through `main.ts` → `startServer` with `JOSEKI_CONFIG=e2e/config.e2e.json`.

Run: `npx vitest run -c vitest.katago.config.ts` (this machine has a real KataGo in `config.local.json`)
Expected: all real-KataGo tests pass (they now read the lock through `REPO_LOCK`).

- [ ] **Step 7: Commit milestone M1**

```bash
git add packages/server scripts
git commit -m "feat(server): startServer with explicit paths and a built-in KataGo installer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Milestone M2 — install screen, engine and app update bars

### Task 4: Install screen and update bars in the web UI

**Files:**
- Create: `packages/shared/src/desktop.ts`, `packages/web/src/install-format.ts`, `packages/web/src/install-format.test.ts`, `packages/web/src/update-banner.ts`, `packages/web/src/update-banner.test.ts`, `packages/web/src/desktop-env.d.ts`, `packages/web/src/components/AppUpdateBanner.tsx`, `packages/web/src/screens/InstallScreen.tsx`
- Modify: `packages/shared/src/index.ts`, `packages/web/src/api.ts`, `packages/web/src/styles.css`
- Rewrite: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `InstallStatus`, `InstallStep`, `InstallFile` (Task 2); `GET/POST /api/install` (Task 3).
- Produces:
  - `@joseki-dojo/shared`: `type AppUpdateState = { status: 'idle' } | { status: 'available'; version: string } | { status: 'downloading'; version: string; percent: number } | { status: 'installing'; version: string } | { status: 'error'; message: string }`; `interface DojoDesktopApi { getUpdateState(): Promise<AppUpdateState>; onUpdateState(listener: (state: AppUpdateState) => void): () => void; downloadUpdate(): Promise<void>; retryUpdate(): Promise<void> }`.
  - web: `fetchInstall(): Promise<InstallStatus>`, `startInstall(): Promise<InstallStatus>` (`api.ts`); `INSTALL_STEP_TEXT: Record<InstallStep, string>`, `isInstalling(step): boolean`, `fileProgressText(f: InstallFile): string` (`install-format.ts`); `updateBannerView(state: AppUpdateState): UpdateBannerView | null` (`update-banner.ts`); `InstallScreen({ update, onDone, onClose? })`; `AppUpdateBanner()`; `window.dojoDesktop?: DojoDesktopApi`.
  - UI texts (Russian): «Нужно скачать движок KataGo», «Установить», «Обновление KataGo», «Скачиваю файлы…», «Распаковываю KataGo…», «Проверяю скорость на процессоре…», «Настраиваю видеокарту — это может занять несколько минут», «Запускаю KataGo…», «Не получилось установить KataGo», «Попробовать снова», «Назад», «Доступна новая проверенная версия KataGo», «Обновить движок», «Доступна версия X.Y.Z», «Обновить», «Скачиваю версию X.Y.Z: N%», «Устанавливаю версию X.Y.Z, приложение перезапустится…», «Повторить».

- [ ] **Step 1: Write the failing tests**

`packages/web/src/install-format.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { InstallFile } from '@joseki-dojo/shared'
import { fileProgressText, INSTALL_STEP_TEXT, isInstalling } from './install-format'

const file = (over: Partial<InstallFile>): InstallFile => ({ name: 'net.bin.gz', label: 'Основная сеть', received: 0, total: 0, done: false, ...over })

describe('install screen texts', () => {
  it('warns that the GPU step is slow', () => {
    expect(INSTALL_STEP_TEXT['benchmarking-gpu']).toBe('Настраиваю видеокарту — это может занять несколько минут')
  })

  it('tells running steps from finished ones', () => {
    expect(isInstalling('downloading')).toBe(true)
    expect(isInstalling('benchmarking-gpu')).toBe(true)
    expect(isInstalling('idle')).toBe(false)
    expect(isInstalling('done')).toBe(false)
    expect(isInstalling('failed')).toBe(false)
  })

  it('shows file progress in megabytes', () => {
    expect(fileProgressText(file({}))).toBe('ожидает')
    expect(fileProgressText(file({ received: 12_897_485, total: 97_898_094 }))).toBe('12,3 из 93,4 МБ')
    expect(fileProgressText(file({ received: 3_145_728 }))).toBe('3,0 МБ')
    expect(fileProgressText(file({ received: 10, total: 10, done: true }))).toBe('готово')
  })
})
```

`packages/web/src/update-banner.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { updateBannerView } from './update-banner'

describe('updateBannerView', () => {
  it('is hidden while there is nothing to say', () => {
    expect(updateBannerView({ status: 'idle' })).toBeNull()
  })

  it('offers the new version with one button', () => {
    expect(updateBannerView({ status: 'available', version: '0.2.0' })).toEqual({
      text: 'Доступна версия 0.2.0',
      button: { label: 'Обновить', action: 'download' },
      error: false,
    })
  })

  it('shows the download percentage and then the restart', () => {
    expect(updateBannerView({ status: 'downloading', version: '0.2.0', percent: 42 })).toMatchObject({ text: 'Скачиваю версию 0.2.0: 42%', button: null })
    expect(updateBannerView({ status: 'installing', version: '0.2.0' })).toMatchObject({
      text: 'Устанавливаю версию 0.2.0, приложение перезапустится…',
      button: null,
    })
  })

  it('shows an error with a retry button', () => {
    expect(updateBannerView({ status: 'error', message: 'Не удалось скачать обновление: offline' })).toEqual({
      text: 'Не удалось скачать обновление: offline',
      button: { label: 'Повторить', action: 'retry' },
      error: true,
    })
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run packages/web`
Expected: FAIL — `Error: Cannot find module './install-format'` and `Error: Cannot find module './update-banner'`.

- [ ] **Step 3: Shared desktop types**

`packages/shared/src/desktop.ts`:
```ts
/** Spec 6: what the desktop app's updater is doing, as shown in the update bar. */
export type AppUpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'installing'; version: string }
  | { status: 'error'; message: string }

/** Exposed by the desktop app's preload script as `window.dojoDesktop`; absent in a browser. */
export interface DojoDesktopApi {
  getUpdateState(): Promise<AppUpdateState>
  /** Calls `listener` on every change; returns the unsubscribe function. */
  onUpdateState(listener: (state: AppUpdateState) => void): () => void
  /** «Обновить»: downloads the available version, then the app restarts into it. */
  downloadUpdate(): Promise<void>
  /** «Повторить» after an error: downloads again when a version is known, otherwise checks again. */
  retryUpdate(): Promise<void>
}
```

`packages/shared/src/index.ts`:
```ts
export * from './types'
export * from './protocol'
export * from './coords'
export * from './zone'
export * from './rules'
export * from './settings'
export * from './install'
export * from './desktop'
```

- [ ] **Step 4: Texts, API calls and the desktop typing**

`packages/web/src/install-format.ts`:
```ts
import type { InstallFile, InstallStep } from '@joseki-dojo/shared'

/** Spec 5.2: what the install screen says during each step. */
export const INSTALL_STEP_TEXT: Record<InstallStep, string> = {
  idle: '',
  downloading: 'Скачиваю файлы…',
  extracting: 'Распаковываю KataGo…',
  'benchmarking-cpu': 'Проверяю скорость на процессоре…',
  'benchmarking-gpu': 'Настраиваю видеокарту — это может занять несколько минут',
  finishing: 'Запускаю KataGo…',
  done: 'Готово',
  failed: 'Не получилось установить KataGo',
}

export const isInstalling = (step: InstallStep): boolean => step !== 'idle' && step !== 'done' && step !== 'failed'

const megabytes = (bytes: number): string =>
  (bytes / 1_048_576).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** "12,3 из 93,4 МБ" while downloading, "готово" once checked. */
export function fileProgressText(f: InstallFile): string {
  if (f.done) return 'готово'
  if (f.received === 0) return 'ожидает'
  return f.total > 0 ? `${megabytes(f.received)} из ${megabytes(f.total)} МБ` : `${megabytes(f.received)} МБ`
}
```

`packages/web/src/update-banner.ts`:
```ts
import type { AppUpdateState } from '@joseki-dojo/shared'

export interface UpdateBannerView {
  text: string
  button: { label: string; action: 'download' | 'retry' } | null
  error: boolean
}

/** Spec 6: the app update bar for each updater state; null hides it. */
export function updateBannerView(state: AppUpdateState): UpdateBannerView | null {
  switch (state.status) {
    case 'idle':
      return null
    case 'available':
      return { text: `Доступна версия ${state.version}`, button: { label: 'Обновить', action: 'download' }, error: false }
    case 'downloading':
      return { text: `Скачиваю версию ${state.version}: ${state.percent}%`, button: null, error: false }
    case 'installing':
      return { text: `Устанавливаю версию ${state.version}, приложение перезапустится…`, button: null, error: false }
    case 'error':
      return { text: state.message, button: { label: 'Повторить', action: 'retry' }, error: true }
  }
}
```

`packages/web/src/desktop-env.d.ts`:
```ts
import type { DojoDesktopApi } from '@joseki-dojo/shared'

declare global {
  interface Window {
    /** Set by the desktop app's preload script; absent in a browser. */
    dojoDesktop?: DojoDesktopApi
  }
}

export {}
```

`packages/web/src/api.ts` (adds `InstallStatus` to the shared import and two functions at the end):
```ts
import type {
  ClientMessage,
  HealthResponse,
  InstallStatus,
  ReviewData,
  ServerMessage,
  SettingsResponse,
  SettingsUpdate,
  SettingsView,
} from '@joseki-dojo/shared'

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as HealthResponse
}

/** Restarts a failed engine and runs the startup checks again; resolves when they are done. */
export async function recheckHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health/recheck', { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as HealthResponse
}

/** Null while the review is still being prepared (HTTP 409). */
export async function fetchReview(sessionId: string): Promise<ReviewData | null> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/review`)
  if (res.status === 409) return null
  if (!res.ok) throw new Error(`Не удалось загрузить разбор: HTTP ${res.status}`)
  return (await res.json()) as ReviewData
}

/** WebSocket that reconnects with backoff and re-subscribes to `sessionId` after reconnecting. */
export class DojoSocket {
  sessionId: string | null = null
  private ws: WebSocket | null = null
  private retries = 0
  private readonly queue: string[] = []

  constructor(
    private readonly onMessage: (msg: ServerMessage) => void,
    private readonly onStatus: (connected: boolean) => void,
  ) {
    this.connect()
  }

  send(msg: ClientMessage): void {
    const data = JSON.stringify(msg)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data)
    else this.queue.push(data)
  }

  private connect(): void {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.retries = 0
      this.onStatus(true)
      if (this.sessionId) ws.send(JSON.stringify({ type: 'resync', sessionId: this.sessionId }))
      for (const data of this.queue.splice(0)) ws.send(data)
    }
    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMessage)
    ws.onclose = () => {
      this.onStatus(false)
      const delay = Math.min(5000, 250 * 2 ** this.retries++)
      setTimeout(() => this.connect(), delay)
    }
  }
}

export async function fetchSettings(): Promise<SettingsView> {
  const res = await fetch('/api/settings')
  if (!res.ok) throw new Error(`Не удалось загрузить настройки: HTTP ${res.status}`)
  return (await res.json()) as SettingsView
}

/** 200 and 400 both carry a SettingsResponse; anything else is a transport error. */
export async function saveSettings(update: SettingsUpdate): Promise<SettingsResponse> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
  })
  if (res.status !== 200 && res.status !== 400) throw new Error(`Не удалось сохранить настройки: HTTP ${res.status}`)
  return (await res.json()) as SettingsResponse
}

/** Spec 5.3: the KataGo installer's state, also telling whether KataGo is installed at all. */
export async function fetchInstall(): Promise<InstallStatus> {
  const res = await fetch('/api/install')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as InstallStatus
}

/** Starts the KataGo installer (a running installation is left alone) and returns its state. */
export async function startInstall(): Promise<InstallStatus> {
  const res = await fetch('/api/install', { method: 'POST' })
  if (!res.ok) throw new Error(`Не удалось запустить установку: HTTP ${res.status}`)
  return (await res.json()) as InstallStatus
}
```

- [ ] **Step 5: Components and screen**

`packages/web/src/components/AppUpdateBanner.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks'
import type { AppUpdateState } from '@joseki-dojo/shared'
import { updateBannerView } from '../update-banner'

/** Spec 6: the desktop app's update bar. A browser has no `window.dojoDesktop`, so nothing is shown there. */
export function AppUpdateBanner() {
  const desktop = window.dojoDesktop
  const [state, setState] = useState<AppUpdateState>({ status: 'idle' })

  useEffect(() => {
    if (!desktop) return
    let live = true
    let changed = false
    const off = desktop.onUpdateState((s) => {
      changed = true
      setState(s)
    })
    desktop
      .getUpdateState()
      .then((s) => {
        if (live && !changed) setState(s)
      })
      .catch(() => undefined)
    return () => {
      live = false
      off()
    }
  }, [desktop])

  const view = desktop ? updateBannerView(state) : null
  if (!desktop || !view) return null
  const act = (): void => {
    void (view.button?.action === 'retry' ? desktop.retryUpdate() : desktop.downloadUpdate())
  }
  return (
    <div class={view.error ? 'bar error' : 'bar'} role="status">
      <span>{view.text}</span>
      {view.button && (
        <button class="primary" onClick={act}>
          {view.button.label}
        </button>
      )}
    </div>
  )
}
```

`packages/web/src/screens/InstallScreen.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks'
import type { InstallStatus } from '@joseki-dojo/shared'
import { fetchInstall, startInstall } from '../api'
import { fileProgressText, INSTALL_STEP_TEXT, isInstalling } from '../install-format'

export interface InstallScreenProps {
  /** An engine update from the banner: it starts at once and can be left after a failure. */
  update: boolean
  /** The installation finished and KataGo runs. */
  onDone: () => void
  /** Leaves a failed engine update (the previous KataGo keeps working). */
  onClose?: () => void
}

/** Spec 5: downloads and sets up KataGo with one button, polling the server once a second. */
export function InstallScreen({ update, onDone, onClose }: InstallScreenProps) {
  const [status, setStatus] = useState<InstallStatus | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  // A first install watches from the start (an installation may already run). An update watches only after its
  // own start request, so a 'done' left over from an earlier installation is not taken for this one.
  const [watching, setWatching] = useState(!update)

  const start = async (): Promise<void> => {
    setRequestError(null)
    try {
      setStatus(await startInstall())
      setWatching(true)
    } catch (e) {
      setRequestError((e as Error).message)
    }
  }

  useEffect(() => {
    if (update) void start()
  }, [])

  useEffect(() => {
    if (!watching) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const s = await fetchInstall()
        if (cancelled) return
        setStatus(s)
        if (s.step === 'done') {
          onDone()
          return
        }
      } catch {
        // transient failure: try again on the next tick
      }
      if (!cancelled) timer = setTimeout(() => void tick(), 1000)
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [watching])

  const step = status?.step ?? 'idle'
  const running = isInstalling(step)
  const failed = step === 'failed' || requestError !== null
  const canStart = !running && step !== 'done' && (!update || failed)

  return (
    <main class="install">
      <h1>{update ? 'Обновление KataGo' : 'Нужно скачать движок KataGo'}</h1>
      {!update && !running && step !== 'done' && (
        <p>
          Joseki Dojo играет и считает с помощью KataGo — сильной программы для игры в го. Её нужно один раз скачать (около
          200 МБ). Дальше всё произойдёт само: программа проверит файлы и выберет, что на этом компьютере работает быстрее —
          процессор или видеокарта.
        </p>
      )}
      {(running || step === 'done') && <p class="status">{INSTALL_STEP_TEXT[step]}</p>}
      {status && status.files.length > 0 && (
        <ul class="files">
          {status.files.map((f) => (
            <li key={f.name}>
              <div class="row">
                <span>{f.label}</span>
                <span class="meta">{fileProgressText(f)}</span>
              </div>
              <progress max={f.total || 1} value={f.done ? f.total || 1 : f.received} />
            </li>
          ))}
        </ul>
      )}
      {step === 'failed' && (
        <>
          <p class="status error">{INSTALL_STEP_TEXT.failed}</p>
          <p class="hint error">{status?.error}</p>
        </>
      )}
      {requestError && <p class="hint error">{requestError}</p>}
      <div class="row">
        {canStart && (
          <button class="primary" onClick={() => void start()}>
            {failed ? 'Попробовать снова' : 'Установить'}
          </button>
        )}
        {update && failed && onClose && <button onClick={onClose}>Назад</button>}
      </div>
    </main>
  )
}
```

`packages/web/src/App.tsx` (new: install status fetched with the health; the install screen replaces «KataGo не настроен» when KataGo is not installed; the engine-update bar; the app-update bar at the very top):
```tsx
import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { ClientMessage, HealthResponse, InstallStatus, ReviewData, SessionView } from '@joseki-dojo/shared'
import { DojoSocket, fetchHealth, fetchInstall, fetchReview, fetchSettings, recheckHealth } from './api'
import { AppUpdateBanner } from './components/AppUpdateBanner'
import { ErrorBanner } from './components/ErrorBanner'
import { EngineScreen } from './screens/EngineScreen'
import { GameScreen } from './screens/GameScreen'
import { InstallScreen } from './screens/InstallScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StartScreen } from './screens/StartScreen'

interface Progress {
  done: number
  total: number
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthTick, setHealthTick] = useState(0)
  const [session, setSession] = useState<SessionView | null>(null)
  const [review, setReview] = useState<ReviewData | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorSeq, setErrorSeq] = useState(0)
  const [connected, setConnected] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [versionWarning, setVersionWarning] = useState<string | null>(null)
  const [defaultRank, setDefaultRank] = useState<string | undefined>(undefined)
  // True from sending startSession/replayFrom until the server answers (sessionState/error) or the link drops.
  const [starting, setStarting] = useState(false)
  const [install, setInstall] = useState<InstallStatus | null>(null)
  const [installChecked, setInstallChecked] = useState(false)
  // An engine update started from the banner is on screen.
  const [engineUpdate, setEngineUpdate] = useState(false)

  const socket = useMemo(
    () =>
      new DojoSocket((msg) => {
        switch (msg.type) {
          case 'sessionState':
            setSession(msg.session)
            setStarting(false)
            setError(null)
            if (msg.session.status === 'playing') {
              setReview(null)
              setProgress(null)
            }
            break
          case 'analysisProgress':
            setProgress({ done: msg.done, total: msg.total })
            break
          case 'reviewReady':
            fetchReview(msg.sessionId)
              .then((r) => r && setReview(r))
              .catch((e: Error) => {
                setError(e.message)
                setErrorSeq((n) => n + 1)
              })
            break
          case 'error':
            setError(msg.message)
            setStarting(false)
            setErrorSeq((n) => n + 1)
            break
        }
      }, (isConnected) => {
        setConnected(isConnected)
        if (!isConnected) setStarting(false)
      }),
    [],
  )

  useEffect(() => {
    socket.sessionId = session?.id ?? null
  }, [socket, session?.id])

  useEffect(() => {
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const h = await fetchHealth()
        if (cancelled) return
        setHealth(h)
        if (h.state === 'starting') setTimeout(poll, 2000)
      } catch {
        if (!cancelled) setTimeout(poll, 2000)
      }
    }
    void poll()
    return () => {
      cancelled = true
    }
  }, [healthTick])

  // Spec 5.1: is KataGo installed at all, and is the installer's KataGo older than katago.lock.json?
  useEffect(() => {
    let cancelled = false
    fetchInstall()
      .then((s) => {
        if (!cancelled) setInstall(s)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setInstallChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [healthTick])

  // Spec 6.6: warn when the running KataGo is not the version pinned in katago.lock.json.
  const ready = health?.state === 'ready'
  useEffect(() => {
    if (!ready) return
    fetchSettings()
      .then((s) => {
        setVersionWarning(s.versionWarning)
        setDefaultRank(s.defaultBotRank)
      })
      .catch(() => undefined)
  }, [ready, healthTick])

  // While a finished session has no review yet, poll for it: reviewReady may have been missed
  // (socket drop) and the server does not re-send it on resync.
  const finishedId = session?.status === 'finished' ? session.id : null
  const hasReview = review !== null
  useEffect(() => {
    if (!finishedId || hasReview) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const r = await fetchReview(finishedId)
        if (cancelled) return
        if (r) {
          setReview(r)
          return
        }
      } catch {
        // transient failure: try again on the next tick
      }
      if (!cancelled) timer = setTimeout(() => void tick(), 2000)
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [finishedId, hasReview])

  const send = (msg: ClientMessage): void => socket.send(msg)
  const sendStarting = (msg: ClientMessage): void => {
    setStarting(true)
    send(msg)
  }
  const resetToStart = (): void => {
    setSession(null)
    setReview(null)
    setProgress(null)
    setError(null)
  }

  const retryHealth = async (): Promise<void> => {
    await recheckHealth().catch(() => undefined) // a failed request is shown by the re-poll below
    setHealthTick((n) => n + 1)
  }

  const afterInstall = (): void => {
    setEngineUpdate(false)
    setHealthTick((n) => n + 1)
  }

  let screen: JSX.Element
  if (showSettings) screen = <SettingsScreen onClose={() => setShowSettings(false)} onSaved={() => setHealthTick((n) => n + 1)} />
  else if (engineUpdate) screen = <InstallScreen update onDone={afterInstall} onClose={() => setEngineUpdate(false)} />
  else if (!health || (health.state !== 'ready' && !installChecked)) screen = <main><p class="status">Загрузка…</p></main>
  else if (health.state !== 'ready' && install && !install.installed) screen = <InstallScreen update={false} onDone={afterInstall} />
  else if (health.state !== 'ready')
    screen = <EngineScreen health={health} onRetry={retryHealth} onSettings={() => setShowSettings(true)} />
  else if (!session) screen = (
      <StartScreen
        key={defaultRank}
        defaultRank={defaultRank}
        busy={starting || !connected}
        onStart={(settings) => sendStarting({ type: 'startSession', settings })} />
    )
  else if (session.status === 'playing') screen = <GameScreen session={session} errorSeq={errorSeq} send={send} />
  else
    screen = (
      <ReviewScreen
        review={review}
        progress={progress}
        busy={starting}
        onReplay={(turn) => sendStarting({ type: 'replayFrom', sessionId: session.id, turn })}
        onNew={resetToStart}
      />
    )

  const inGame = session?.status === 'playing'
  const bannerText = connected ? error : 'Нет связи с сервером, переподключаюсь…'
  const retry =
    connected && session
      ? () => {
          setError(null)
          send({ type: 'resync', sessionId: session.id })
        }
      : undefined
  // Spec 5.1: offered outside a game, when the installer's KataGo is not the one pinned in katago.lock.json.
  const offerEngineUpdate = ready && install?.updateAvailable === true && !engineUpdate && !inGame && !showSettings

  return (
    <>
      <AppUpdateBanner />
      {bannerText && <ErrorBanner message={bannerText} onRetry={retry} />}
      {!inGame && !showSettings && !engineUpdate && (
        <header class="topbar">
          <button onClick={() => setShowSettings(true)}>Настройки</button>
        </header>
      )}
      {offerEngineUpdate && (
        <div class="bar">
          <span>Доступна новая проверенная версия KataGo</span>
          <button class="primary" onClick={() => setEngineUpdate(true)}>
            Обновить движок
          </button>
        </div>
      )}
      {versionWarning && !showSettings && <p class="notice">{versionWarning}</p>}
      {screen}
    </>
  )
}
```

Append to `packages/web/src/styles.css`:
```css
.bar { display: flex; gap: 12px; align-items: center; justify-content: space-between; max-width: 1168px; margin: 8px auto 0; padding: 8px 12px; border-left: 4px solid var(--accent); background: var(--surface-2); }
.bar.error { border-left-color: var(--critical); }
.install { display: grid; gap: 12px; max-width: 640px; }
.install .files { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.install .files li { display: grid; gap: 4px; }
.install .files .row { justify-content: space-between; }
.install progress { width: 100%; height: 8px; accent-color: var(--accent); }
```

- [ ] **Step 6: Verify**

Run: `npx vitest run packages/web`
Expected: `Test Files  4 passed (4)`, `Tests  14 passed (14)`.

Run: `npm test && npm run typecheck && npm run build`
Expected: `Test Files  35 passed (35)`, `Tests  208 passed (208)`; `tsc` prints nothing; Vite prints `✓ built in …`.

- [ ] **Step 7: Stage the changes**

```bash
git add packages/shared/src packages/web/src
```

---

### Task 5: End-to-end tests for the installer and the update bar

**Files:**
- Create: `e2e/install-server.ts`, `e2e/install.spec.ts`, `e2e/app-update.spec.ts`
- Rewrite: `playwright.config.ts`, `.gitignore`

**Interfaces:**
- Consumes: `startServer` with `lock` and `commandFor` (Task 3); `createInstallFixture`, `fakeBuildCommand` (Task 2); the screens of Task 4.
- Produces: a second e2e server on `http://127.0.0.1:5181` (no KataGo installed, fake downloads, fake KataGo; its files in `e2e/.install/`); spec 9's e2e checks.

- [ ] **Step 1: Write the tests and the install server**

`e2e/install.spec.ts`:
```ts
import { expect, test } from '@playwright/test'

// e2e/install-server.ts: KataGo is not installed; downloads and KataGo are fakes.
test.use({ baseURL: 'http://127.0.0.1:5181' })

test('installs KataGo with one button and opens the start screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Нужно скачать движок KataGo' })).toBeVisible()
  await page.getByRole('button', { name: 'Установить' }).click()
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Доступна новая проверенная версия KataGo')).toHaveCount(0)
})
```

`e2e/app-update.spec.ts`:
```ts
import { expect, test } from '@playwright/test'

test('a browser has no desktop updater and shows no update bar', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible()
  await expect(page.getByText(/Доступна версия/)).toHaveCount(0)
})

test('the update bar follows the desktop updater', async ({ page }) => {
  // Stands in for the desktop preload (window.dojoDesktop): an update is available; downloading reports 42 %.
  await page.addInitScript(() => {
    type State = { status: string; version?: string; percent?: number }
    let listener: ((s: State) => void) | null = null
    const w = window as unknown as { dojoDesktop: unknown; updateCalls: string[] }
    w.updateCalls = []
    w.dojoDesktop = {
      getUpdateState: async (): Promise<State> => ({ status: 'available', version: '0.2.0' }),
      onUpdateState: (l: (s: State) => void) => {
        listener = l
        return () => {
          listener = null
        }
      },
      downloadUpdate: async () => {
        w.updateCalls.push('download')
        listener?.({ status: 'downloading', version: '0.2.0', percent: 42 })
      },
      retryUpdate: async () => {
        w.updateCalls.push('retry')
      },
    }
  })
  await page.goto('/')
  await expect(page.getByText('Доступна версия 0.2.0')).toBeVisible()
  await page.getByRole('button', { name: 'Обновить', exact: true }).click()
  await expect(page.getByText('Скачиваю версию 0.2.0: 42%')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { updateCalls: string[] }).updateCalls)).toEqual(['download'])
})
```

`e2e/install-server.ts`:
```ts
// The install e2e server (port 5181): an empty profile without KataGo, a local download server with fake KataGo
// archives and networks, and the fake KataGo in place of the real one.
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startServer } from '../packages/server/src/start'
import { createInstallFixture, fakeBuildCommand } from '../packages/server/test/install-fixture'

const root = resolve('e2e/.install')
rmSync(root, { recursive: true, force: true })
mkdirSync(root, { recursive: true })

const fixture = await createInstallFixture()
const server = await startServer({
  configFile: join(root, 'config.json'),
  dataDir: join(root, 'data'),
  enginesDir: join(root, 'engines'),
  lockFile: resolve('katago.lock.json'),
  webDist: resolve('packages/web/dist'),
  port: 5181,
  lock: fixture.lock,
  commandFor: fakeBuildCommand(),
})
console.log(`Install e2e server: ${server.url}`)
```

`playwright.config.ts` (Playwright starts web servers one after another, so the first one's `npm run build` is done before the second serves `packages/web/dist`):
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5180' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  // Playwright starts these one after another: the first builds the web UI that the second serves too.
  webServer: [
    {
      command: `node -e "require('fs').rmSync('e2e/.data',{recursive:true,force:true})" && npm run build && npx tsx packages/server/src/main.ts`,
      url: 'http://127.0.0.1:5180/api/health',
      env: { JOSEKI_CONFIG: 'e2e/config.e2e.json' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Spec 9: KataGo is missing; the installer downloads from a local fixture server and runs the fake KataGo.
      command: 'npx tsx e2e/install-server.ts',
      url: 'http://127.0.0.1:5181/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
```

`.gitignore`:
```
node_modules/
dist/
data/
engines/
config.local.json
e2e/.data/
e2e/.install/
test-results/
playwright-report/
*.log
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run e2e`
Expected: `8 passed` — the five existing tests plus `installs KataGo with one button and opens the start screen`, `a browser has no desktop updater and shows no update bar`, `the update bar follows the desktop updater`.

- [ ] **Step 3: Commit milestone M2**

```bash
git add packages/shared/src packages/web/src e2e playwright.config.ts .gitignore
git commit -m "feat(web): KataGo install screen, engine and app update bars" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Milestone M3 — desktop app

### Task 6: Electron shell that runs the server in-process

**Files:**
- Create: `packages/desktop/package.json`, `packages/desktop/build.mjs`, `packages/desktop/src/main.ts`
- Modify: `package.json` (workspace + scripts), `packages/server/package.json` (`exports`), `package-lock.json`

**Interfaces:**
- Consumes: `startServer(options): Promise<RunningServer>` (Task 3), imported as `@joseki-dojo/server`.
- Produces:
  - Package `@joseki-dojo/desktop` (`productName` "Joseki Dojo", `main` `dist/main.cjs`); scripts `build` (esbuild), `start` (`electron .`), `dist`, `release` (the last two are used from Task 7).
  - Root scripts: `npm run desktop` (web build + Electron from sources), `npm run dist`, `npm run release`.
  - Environment switches of the main process: `JOSEKI_USER_DATA=<dir>` (throwaway profile, own single-instance lock), `JOSEKI_SMOKE_OUT=<file>` (write a JSON report after the window loads, then quit).
  - `packages/server/package.json` `"exports": { ".": "./src/start.ts" }`.

- [ ] **Step 1: Packages**

`package.json`:
```json
{
  "name": "joseki-dojo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "workspaces": ["packages/shared", "packages/server", "packages/web", "packages/desktop"],
  "engines": { "node": ">=22.12" },
  "scripts": {
    "setup": "tsx scripts/setup/setup.ts",
    "dev": "concurrently -k -n server,web -c blue,green \"npm run dev -w @joseki-dojo/server\" \"npm run dev -w @joseki-dojo/web\"",
    "build": "npm run build -w @joseki-dojo/web",
    "start": "npm run build && npm run start -w @joseki-dojo/server",
    "desktop": "npm run build && npm run start -w @joseki-dojo/desktop",
    "dist": "npm run build && npm run dist -w @joseki-dojo/desktop",
    "release": "npm run build && npm run release -w @joseki-dojo/desktop",
    "test": "vitest run",
    "test:katago": "vitest run -c vitest.katago.config.ts",
    "typecheck": "tsc -p tsconfig.json",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "@types/node": "^24.0.0",
    "concurrently": "^10.0.5",
    "fflate": "^0.8.3",
    "tsx": "^4.23.15",
    "typescript": "^7.0.2",
    "vitest": "^5.0.3"
  }
}
```

`packages/server/package.json`:
```json
{
  "name": "@joseki-dojo/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/start.ts" },
  "scripts": { "dev": "tsx watch src/main.ts", "start": "tsx src/main.ts" },
  "dependencies": {
    "@fastify/static": "^10.1.5",
    "@fastify/websocket": "^11.3.3",
    "@joseki-dojo/shared": "*",
    "better-sqlite3": "^13.0.3",
    "extract-zip": "^2.0.1",
    "fastify": "^5.12.5"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^9.6.0",
    "@types/ws": "^8.18.2",
    "ws": "^8.22.0"
  }
}
```

`packages/desktop/package.json` (the server and shared packages are bundled, so they are dev dependencies; only `better-sqlite3` and `electron-updater` — used from Task 8 — ship in the app; Electron is pinned exactly):
```json
{
  "name": "@joseki-dojo/desktop",
  "version": "0.0.0",
  "private": true,
  "productName": "Joseki Dojo",
  "description": "Joseki trainer for Go against a human-like KataGo",
  "author": "Oleg Kushmantsev",
  "license": "MIT",
  "main": "dist/main.cjs",
  "scripts": {
    "build": "node build.mjs",
    "start": "node build.mjs && electron .",
    "dist": "node build.mjs && electron-builder --config electron-builder.config.cjs --publish never",
    "release": "node build.mjs && electron-builder --config electron-builder.config.cjs --publish always"
  },
  "dependencies": {
    "better-sqlite3": "^13.0.3",
    "electron-updater": "^6.8.9"
  },
  "devDependencies": {
    "@joseki-dojo/server": "*",
    "@joseki-dojo/shared": "*",
    "electron": "44.5.1",
    "electron-builder": "^26.15.3",
    "esbuild": "^0.28.2"
  }
}
```

Run: `npm install && npm ls electron electron-builder esbuild`
Expected: installs the Electron toolchain (about 270 packages, no Electron binary yet); the tree shows `electron@44.5.1`, `electron-builder@26.15.3` and `esbuild@0.28.2` under `@joseki-dojo/desktop`.

- [ ] **Step 2: Bundle script and main process**

`packages/desktop/build.mjs`:
```js
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
```

`packages/desktop/src/main.ts`:
```ts
// Electron main process (spec 4.1): runs the Joseki Dojo server in this process on 127.0.0.1 and a free port and
// shows it in a window. Player data lives in Electron's userData folder (spec 4.2).
import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { startServer, type RunningServer } from '@joseki-dojo/server'
import { app, BrowserWindow, dialog, shell } from 'electron'

// Smoke checks run with a throwaway profile (this also gives them their own single-instance lock).
if (process.env.JOSEKI_USER_DATA) app.setPath('userData', process.env.JOSEKI_USER_DATA)

/** Installed app: the files electron-builder put next to app.asar. From sources: the repository root. */
const resourcesDir = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', '..')
const webDist = app.isPackaged ? join(resourcesDir, 'web') : join(resourcesDir, 'packages', 'web', 'dist')

let server: RunningServer | null = null
let mainWindow: BrowserWindow | null = null
let logFile: WriteStream | null = null
/** Set once the server is stopped for quitting, so that before-quit lets the app go. */
let quitting = false

function log(line: string): void {
  logFile?.write(`${new Date().toISOString()} ${line}\n`)
  if (!app.isPackaged) console.log(line)
}

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const isWebLink = (url: string): boolean => /^https?:\/\//.test(url)

async function boot(): Promise<void> {
  const userData = app.getPath('userData')
  const dataDir = join(userData, 'data')
  mkdirSync(dataDir, { recursive: true })
  logFile = createWriteStream(join(dataDir, 'joseki-dojo.log'), { flags: 'w' })
  log(`Joseki Dojo ${app.getVersion()}, data: ${userData}`)
  server = await startServer({
    configFile: join(userData, 'config.json'),
    dataDir,
    enginesDir: join(userData, 'engines'),
    lockFile: join(resourcesDir, 'katago.lock.json'),
    webDist,
    port: 0,
    log,
  })
  const origin = server.url
  log(`Server: ${origin}`)

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    title: 'Joseki Dojo',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  mainWindow = win
  // The window shows only the local server; other links open in the player's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebLink(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => {
    if (event.url.startsWith(origin)) return
    event.preventDefault()
    if (isWebLink(event.url)) void shell.openExternal(event.url)
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    mainWindow = null
  })
  await win.loadURL(origin)

  if (process.env.JOSEKI_SMOKE_OUT) await writeSmokeReport(process.env.JOSEKI_SMOKE_OUT, origin)
}

/** Packaging check: what the window and the server report, written to `file`; then the app quits. */
async function writeSmokeReport(file: string, origin: string): Promise<void> {
  const page = await (await fetch(origin)).text()
  const health: unknown = await (await fetch(`${origin}/api/health`)).json()
  const install = (await (await fetch(`${origin}/api/install`)).json()) as { installed: boolean }
  const report = { title: mainWindow?.getTitle(), page: page.includes('<div id="app">'), health, installed: install.installed }
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  // Spec 4.1: a second launch only brings the open window to the front.
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('window-all-closed', () => app.quit())
  // Spec 4.1: stop the server and KataGo before the process exits.
  app.on('before-quit', (event) => {
    if (quitting || !server) return
    event.preventDefault()
    quitting = true
    void server
      .close()
      .catch((err: unknown) => log(`Server stop failed: ${String(err)}`))
      .finally(() => app.quit())
  })
  app
    .whenReady()
    .then(boot)
    .catch((err: unknown) => {
      log(`Start failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
      dialog.showErrorBox('Joseki Dojo не запустился', err instanceof Error ? err.message : String(err))
      app.exit(1)
    })
}
```

- [ ] **Step 3: Typecheck and bundle**

Run: `npm run typecheck && npm run build -w @joseki-dojo/desktop && ls -la packages/desktop/dist`
Expected: `tsc` and esbuild print no warnings or errors; `packages/desktop/dist/main.cjs` is about 2.1 MB.

- [ ] **Step 4: Run the app from sources with a throwaway profile**

```bash
S="$TEMP/jd-smoke-dev"; rm -rf "$S"
JOSEKI_USER_DATA="$S" JOSEKI_SMOKE_OUT="$S/smoke.json" npm run desktop
cat "$S/smoke.json"; ls "$S/data"
```
Expected: the first run prints `Downloading Electron binary...`; a window opens briefly and the app quits by itself. The console shows
```
Joseki Dojo 0.0.0, data: <S>
Server: http://127.0.0.1:<free port>
KataGo не готов: KataGo не найден: <S>\engines\katago\katago.exe
```
and `smoke.json` is
```json
{
  "title": "Joseki Dojo",
  "page": true,
  "health": {
    "state": "failed",
    "reason": "KataGo не найден: <S>\\engines\\katago\\katago.exe"
  },
  "installed": false
}
```
`data/` holds `joseki-dojo.log` and `joseki-dojo.sqlite` (better-sqlite3's N-API build loaded inside Electron). (`0.0.0` is the desktop package version; packaged builds carry the root version.)

- [ ] **Step 5: Single instance**

```bash
S="$TEMP/jd-single"; rm -rf "$S"
JOSEKI_USER_DATA="$S" npx electron packages/desktop & sleep 8
time (JOSEKI_USER_DATA="$S" npx electron packages/desktop); echo "second exit=$?"
taskkill //IM electron.exe //F > /dev/null
```
Expected: the first window shows «Нужно скачать движок KataGo»; the second launch returns at once (`real` about 1 s) with `second exit=0` and brings the first window to the front. Chromium may print `Unable to move the cache` / `Gpu Cache Creation failed` from the second process: harmless (the first process holds the cache).

- [ ] **Step 6: Stage the changes**

```bash
git add package.json package-lock.json packages/server/package.json packages/desktop
```

---

### Task 7: Windows installer and Linux AppImage with electron-builder

**Files:**
- Create: `packages/desktop/electron-builder.config.cjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `dist/main.cjs` (Task 6), `packages/web/dist` (root `npm run build`), `katago.lock.json`.
- Produces: `npm run dist` → `packages/desktop/release/Joseki-Dojo-Setup-<version>.exe` (+ `.blockmap`, `latest.yml`, `win-unpacked/`) on Windows, `Joseki-Dojo-<version>.AppImage` (+ `latest-linux.yml`) on Linux; `npm run release` = the same with `--publish always` (Task 9's workflow). Packaged resources: `resources/katago.lock.json`, `resources/web/`, `resources/app-update.yml`.

- [ ] **Step 1: Configuration**

`packages/desktop/electron-builder.config.cjs`:
```js
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
```

`.gitignore`:
```
node_modules/
dist/
data/
engines/
config.local.json
e2e/.data/
e2e/.install/
release/
test-results/
playwright-report/
*.log
```

- [ ] **Step 2: Build the Windows installer on this machine**

Run: `npm run dist`
Expected (the first run also downloads Electron, NSIS and 7-Zip; then about 30 s):
```
  • electron-builder  version=26.15.3 os=10.0.19045
  • detected workspace root for project using lock file  pm=npm …
  • skipped dependencies rebuild  reason=npmRebuild is set to false
  • packaging       platform=win32 arch=x64 electron=44.5.1 appOutDir=release\win-unpacked
  • default Electron icon is used  reason=application icon is not set
  • building        target=nsis file=release\Joseki-Dojo-Setup-0.1.0.exe archs=x64 oneClick=true perMachine=false
  • building block map  blockMapFile=release\Joseki-Dojo-Setup-0.1.0.exe.blockmap
```

- [ ] **Step 3: Inspect the result**

Run: `ls packages/desktop/release packages/desktop/release/win-unpacked/resources packages/desktop/release/win-unpacked/resources/app.asar.unpacked/node_modules && cat packages/desktop/release/latest.yml packages/desktop/release/win-unpacked/resources/app-update.yml`
Expected:
- `release/`: `Joseki-Dojo-Setup-0.1.0.exe` (about 119 MB), `Joseki-Dojo-Setup-0.1.0.exe.blockmap`, `builder-debug.yml`, `latest.yml`, `win-unpacked`;
- `resources/`: `app-update.yml`, `app.asar`, `app.asar.unpacked`, `elevate.exe`, `katago.lock.json`, `web`;
- `app.asar.unpacked/node_modules`: `better-sqlite3`;
- `latest.yml` starts with `version: 0.1.0` and names `Joseki-Dojo-Setup-0.1.0.exe`;
- `app-update.yml`: `owner: EternalEclipse999`, `repo: joseki-dojo`, `provider: github`, `releaseType: draft`, `updaterCacheDirName: joseki dojo-updater`.

Run: `node -e "const l=require('@electron/asar').listPackage('packages/desktop/release/win-unpacked/resources/app.asar');console.log([...new Set(l.filter(p=>p.includes('node_modules')).map(p=>p.split(/[\\\\/]/).filter(Boolean)[1]))].join(' '))"`
Expected: `argparse better-sqlite3 builder-util-runtime debug electron-updater fs-extra graceful-fs js-yaml jsonfile lazy-val lodash.escaperegexp lodash.isequal ms node-addon-api sax semver tiny-typed-emitter universalify` — only the two runtime dependencies and theirs; the server's own dependencies are inside `dist/main.cjs`.

- [ ] **Step 4: Run the packaged app with a throwaway profile**

```bash
S="$TEMP/jd-smoke-pkg"; rm -rf "$S"
JOSEKI_USER_DATA="$S" JOSEKI_SMOKE_OUT="$S/smoke.json" "packages/desktop/release/win-unpacked/Joseki Dojo.exe"
cat "$S/smoke.json"; head -2 "$S/data/joseki-dojo.log"
```
Expected: the same report as in Task 6 Step 4 (`"page": true`, health `failed` with `KataGo не найден: …`, `"installed": false`), and the log starts with `… Joseki Dojo 0.1.0, data: <S>`, proving the bundled server, the lock file and the web UI are found in `resources/`.

- [ ] **Step 5: Commit milestone M3**

```bash
git add .gitignore packages/desktop
git commit -m "feat(desktop): Electron app running the server in-process; NSIS and AppImage packaging" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Milestone M4 — one-click app update

### Task 8: electron-updater, preload bridge and the update bar wiring

**Files:**
- Create: `packages/desktop/src/channels.ts`, `packages/desktop/src/update-controller.ts`, `packages/desktop/src/update-controller.test.ts`, `packages/desktop/src/preload.ts`
- Rewrite: `packages/desktop/src/main.ts`, `packages/desktop/build.mjs`

**Interfaces:**
- Consumes: `AppUpdateState`, `DojoDesktopApi` (Task 4); `AppUpdateBanner` in the web UI (Task 4) reads `window.dojoDesktop`; electron-updater `autoUpdater` (`checkForUpdates()`, `downloadUpdate()`, `quitAndInstall(isSilent, isForceRunAfter)`, events `update-available`, `update-not-available`, `download-progress`, `update-downloaded`, `error`).
- Produces:
  - `channels.ts`: `CHANNELS = { state: 'dojo:update-state', get: 'dojo:update-get', download: 'dojo:update-download', retry: 'dojo:update-retry' }`.
  - `update-controller.ts`: `interface UpdateActions { check(): Promise<unknown>; download(): Promise<unknown>; install(): Promise<void> }`; `class UpdateController { constructor(actions: UpdateActions, publish: (state: AppUpdateState) => void); readonly current: AppUpdateState; check(): Promise<void>; download(): Promise<void>; retry(): Promise<void>; onAvailable(version: string): void; onNotAvailable(): void; onProgress(percent: number): void; onDownloaded(version: string): Promise<void>; onError(err: unknown): void }`.
  - `preload.ts` → `dist/preload.cjs`: `window.dojoDesktop: DojoDesktopApi`.

- [ ] **Step 1: Write the failing test**

`packages/desktop/src/update-controller.test.ts`:
```ts
import type { AppUpdateState } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { UpdateController, type UpdateActions } from './update-controller'

function setup(overrides: Partial<UpdateActions> = {}) {
  const calls: string[] = []
  const states: AppUpdateState[] = []
  const actions: UpdateActions = {
    check: async () => {
      calls.push('check')
    },
    download: async () => {
      calls.push('download')
    },
    install: async () => {
      calls.push('install')
    },
    ...overrides,
  }
  const controller = new UpdateController(actions, (s) => states.push(s))
  return { controller, calls, states }
}

describe('UpdateController', () => {
  it('offers a found version, downloads it only on request and installs it when downloaded', async () => {
    const { controller, calls } = setup()
    expect(controller.current).toEqual({ status: 'idle' })
    await controller.check()
    controller.onAvailable('0.2.0')
    expect(controller.current).toEqual({ status: 'available', version: '0.2.0' })
    expect(calls).toEqual(['check'])

    await controller.download()
    expect(controller.current).toEqual({ status: 'downloading', version: '0.2.0', percent: 0 })
    controller.onProgress(42.7)
    expect(controller.current).toEqual({ status: 'downloading', version: '0.2.0', percent: 42 })

    await controller.onDownloaded('0.2.0')
    expect(controller.current).toEqual({ status: 'installing', version: '0.2.0' })
    expect(calls).toEqual(['check', 'download', 'install'])
  })

  it('does nothing on «Обновить» before a version is found', async () => {
    const { controller, calls } = setup()
    await controller.download()
    expect(calls).toEqual([])
    expect(controller.current).toEqual({ status: 'idle' })
  })

  it('shows a failed check with a retry that checks again; a later quiet check hides it', async () => {
    let online = false
    const { controller, calls } = setup({
      check: async () => {
        calls.push('check')
        if (!online) throw new Error('net::ERR_INTERNET_DISCONNECTED\n    at stack')
      },
    })
    await controller.check()
    expect(controller.current).toEqual({ status: 'error', message: 'Не удалось проверить обновления: net::ERR_INTERNET_DISCONNECTED' })
    online = true
    await controller.retry()
    controller.onNotAvailable()
    expect(controller.current).toEqual({ status: 'idle' })
    expect(calls).toEqual(['check', 'check'])
  })

  it('shows a failed download once and downloads again on retry', async () => {
    let fails = true
    const { controller, calls, states } = setup({
      download: async () => {
        calls.push('download')
        if (fails) {
          controller.onError(new Error('socket hang up')) // electron-updater emits the error and rejects
          throw new Error('socket hang up')
        }
      },
    })
    controller.onAvailable('0.2.0')
    await controller.download()
    expect(controller.current).toEqual({ status: 'error', message: 'Не удалось скачать обновление: socket hang up' })
    expect(states.filter((s) => s.status === 'error')).toHaveLength(1)
    fails = false
    await controller.retry()
    expect(controller.current).toEqual({ status: 'downloading', version: '0.2.0', percent: 0 })
    expect(calls).toEqual(['download', 'download'])
  })

  it('skips checks while downloading and keeps offering a version when a later check fails', async () => {
    let online = true
    const { controller, calls } = setup({
      check: async () => {
        calls.push('check')
        if (!online) throw new Error('offline')
      },
    })
    controller.onAvailable('0.2.0')
    online = false
    await controller.check()
    expect(controller.current).toEqual({ status: 'available', version: '0.2.0' })
    await controller.download()
    await controller.check()
    expect(calls).toEqual(['check', 'download'])
  })

  it('reports a failed installation', async () => {
    const { controller } = setup({
      install: async () => {
        throw new Error('installer missing')
      },
    })
    controller.onAvailable('0.2.0')
    await controller.download()
    await controller.onDownloaded('0.2.0')
    expect(controller.current).toEqual({ status: 'error', message: 'Не удалось установить обновление: installer missing' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/desktop`
Expected: FAIL — `Error: Cannot find module './update-controller'`.

- [ ] **Step 3: Controller, channels and preload**

`packages/desktop/src/update-controller.ts`:
```ts
import type { AppUpdateState } from '@joseki-dojo/shared'

/** What the controller asks electron-updater (or a test) to do. */
export interface UpdateActions {
  check(): Promise<unknown>
  download(): Promise<unknown>
  /** Stops the server and KataGo, then quits and runs the downloaded installer. */
  install(): Promise<void>
}

type Phase = 'check' | 'download' | 'install'

const FAILED: Record<Phase, string> = {
  check: 'Не удалось проверить обновления',
  download: 'Не удалось скачать обновление',
  install: 'Не удалось установить обновление',
}

/** First line of an updater error, short enough for the update bar. */
function shortMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  const line = text.split('\n')[0].trim()
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

/**
 * Spec 6: the update bar's state machine. Nothing downloads on its own: a found version waits for «Обновить»,
 * the download reports its percentage, and the downloaded update is installed at once. Errors offer «Повторить».
 * electron-updater events are fed in through the `on…` methods.
 */
export class UpdateController {
  private state: AppUpdateState = { status: 'idle' }
  /** The newest version the updater found. */
  private version: string | null = null
  private phase: Phase = 'check'

  constructor(
    private readonly actions: UpdateActions,
    private readonly publish: (state: AppUpdateState) => void,
  ) {}

  get current(): AppUpdateState {
    return this.state
  }

  /** At start and every 6 hours; skipped while an update is being downloaded or installed. */
  async check(): Promise<void> {
    if (this.busy()) return
    this.phase = 'check'
    try {
      await this.actions.check()
    } catch (err) {
      this.fail(err)
    }
  }

  /** «Обновить». */
  async download(): Promise<void> {
    if (!this.version || this.busy()) return
    this.phase = 'download'
    this.set({ status: 'downloading', version: this.version, percent: 0 })
    try {
      await this.actions.download()
    } catch (err) {
      this.fail(err)
    }
  }

  /** «Повторить»: downloads again when a version is known, otherwise checks again. */
  retry(): Promise<void> {
    return this.version ? this.download() : this.check()
  }

  onAvailable(version: string): void {
    this.version = version
    if (!this.busy()) this.set({ status: 'available', version })
  }

  onNotAvailable(): void {
    if (this.state.status === 'error' && this.phase === 'check') this.set({ status: 'idle' })
  }

  onProgress(percent: number): void {
    if (this.state.status === 'downloading') this.set({ ...this.state, percent: Math.floor(percent) })
  }

  async onDownloaded(version: string): Promise<void> {
    this.phase = 'install'
    this.set({ status: 'installing', version })
    try {
      await this.actions.install()
    } catch (err) {
      this.fail(err)
    }
  }

  /** electron-updater's `error` event (it also rejects the promise of the running action). */
  onError(err: unknown): void {
    this.fail(err)
  }

  private busy(): boolean {
    return this.state.status === 'downloading' || this.state.status === 'installing'
  }

  private fail(err: unknown): void {
    // A failed background check must not hide a version that is already on offer.
    if (this.phase === 'check' && this.version) return
    const message = `${FAILED[this.phase]}: ${shortMessage(err)}`
    if (this.state.status === 'error' && this.state.message === message) return
    this.set({ status: 'error', message })
  }

  private set(state: AppUpdateState): void {
    this.state = state
    this.publish(state)
  }
}
```

`packages/desktop/src/channels.ts`:
```ts
/** IPC channels between the preload script (window.dojoDesktop) and the main process. */
export const CHANNELS = {
  /** main → window: the update state changed. */
  state: 'dojo:update-state',
  /** window → main: the current update state. */
  get: 'dojo:update-get',
  /** window → main: «Обновить». */
  download: 'dojo:update-download',
  /** window → main: «Повторить». */
  retry: 'dojo:update-retry',
} as const
```

`packages/desktop/src/preload.ts`:
```ts
// Preload script (sandboxed): gives the page `window.dojoDesktop` and nothing else (spec 6).
import type { AppUpdateState, DojoDesktopApi } from '@joseki-dojo/shared'
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS } from './channels'

const api: DojoDesktopApi = {
  getUpdateState: () => ipcRenderer.invoke(CHANNELS.get) as Promise<AppUpdateState>,
  onUpdateState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: AppUpdateState): void => listener(state)
    ipcRenderer.on(CHANNELS.state, handler)
    return () => {
      ipcRenderer.removeListener(CHANNELS.state, handler)
    }
  },
  downloadUpdate: () => ipcRenderer.invoke(CHANNELS.download) as Promise<void>,
  retryUpdate: () => ipcRenderer.invoke(CHANNELS.retry) as Promise<void>,
}

contextBridge.exposeInMainWorld('dojoDesktop', api)
```

- [ ] **Step 4: Bundle the preload and wire the updater into the main process**

`packages/desktop/build.mjs`:
```js
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
```

`packages/desktop/src/main.ts`:
```ts
// Electron main process (spec 4.1): runs the Joseki Dojo server in this process on 127.0.0.1 and a free port and
// shows it in a window. Player data lives in Electron's userData folder (spec 4.2). Updates come from GitHub
// Releases through electron-updater (spec 6).
import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { startServer, type RunningServer } from '@joseki-dojo/server'
import type { AppUpdateState } from '@joseki-dojo/shared'
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { autoUpdater } from 'electron-updater'
import { CHANNELS } from './channels'
import { UpdateController } from './update-controller'

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
/** If the installer did not start, quitAndInstall leaves the app running with its server stopped: start afresh. */
const RELAUNCH_IF_STILL_RUNNING_MS = 15_000

// Smoke checks run with a throwaway profile (this also gives them their own single-instance lock).
if (process.env.JOSEKI_USER_DATA) app.setPath('userData', process.env.JOSEKI_USER_DATA)

/** Installed app: the files electron-builder put next to app.asar. From sources: the repository root. */
const resourcesDir = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', '..')
const webDist = app.isPackaged ? join(resourcesDir, 'web') : join(resourcesDir, 'packages', 'web', 'dist')

let server: RunningServer | null = null
let mainWindow: BrowserWindow | null = null
let logFile: WriteStream | null = null
/** Set once the server is stopped for quitting, so that before-quit lets the app go. */
let quitting = false

function log(line: string): void {
  logFile?.write(`${new Date().toISOString()} ${line}\n`)
  if (!app.isPackaged) console.log(line)
}

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const isWebLink = (url: string): boolean => /^https?:\/\//.test(url)

/** Before the first published release GitHub has nothing to offer: that is "no update", not an error. */
const noReleaseYet = (err: unknown): boolean => /No published versions/i.test(String(err))

const updates = new UpdateController(
  {
    check: () =>
      autoUpdater.checkForUpdates().catch((err: unknown) => {
        if (!noReleaseYet(err)) throw err
        return null
      }),
    download: () => autoUpdater.downloadUpdate(),
    install: async () => {
      // Spec 6: the server and KataGo stop before the installer runs.
      quitting = true
      await server?.close()
      autoUpdater.quitAndInstall(true, true)
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, RELAUNCH_IF_STILL_RUNNING_MS)
    },
  },
  (state: AppUpdateState) => mainWindow?.webContents.send(CHANNELS.state, state),
)

function setUpUpdates(): void {
  const fromWindow = (event: IpcMainInvokeEvent): boolean => event.sender === mainWindow?.webContents
  ipcMain.handle(CHANNELS.get, (event) => (fromWindow(event) ? updates.current : { status: 'idle' }))
  ipcMain.handle(CHANNELS.download, async (event) => {
    if (fromWindow(event)) await updates.download()
  })
  ipcMain.handle(CHANNELS.retry, async (event) => {
    if (fromWindow(event)) await updates.retry()
  })

  autoUpdater.autoDownload = false // spec 6: nothing downloads until «Обновить»
  autoUpdater.logger = {
    info: (m?: unknown) => log(`[updater] ${String(m)}`),
    warn: (m?: unknown) => log(`[updater] ${String(m)}`),
    error: (m?: unknown) => log(`[updater] ${String(m)}`),
  }
  autoUpdater.on('update-available', (info) => updates.onAvailable(info.version))
  autoUpdater.on('update-not-available', () => updates.onNotAvailable())
  autoUpdater.on('download-progress', (progress) => updates.onProgress(progress.percent))
  autoUpdater.on('update-downloaded', (info) => void updates.onDownloaded(info.version))
  autoUpdater.on('error', (err) => {
    if (!noReleaseYet(err)) updates.onError(err)
  })

  // electron-updater works only in an installed app (it reads resources/app-update.yml).
  if (!app.isPackaged) return
  void updates.check()
  setInterval(() => void updates.check(), UPDATE_CHECK_INTERVAL_MS)
}

async function boot(): Promise<void> {
  const userData = app.getPath('userData')
  const dataDir = join(userData, 'data')
  mkdirSync(dataDir, { recursive: true })
  logFile = createWriteStream(join(dataDir, 'joseki-dojo.log'), { flags: 'w' })
  log(`Joseki Dojo ${app.getVersion()}, data: ${userData}`)
  server = await startServer({
    configFile: join(userData, 'config.json'),
    dataDir,
    enginesDir: join(userData, 'engines'),
    lockFile: join(resourcesDir, 'katago.lock.json'),
    webDist,
    port: 0,
    log,
  })
  const origin = server.url
  log(`Server: ${origin}`)

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    title: 'Joseki Dojo',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  mainWindow = win
  // The window shows only the local server; other links open in the player's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebLink(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => {
    if (event.url.startsWith(origin)) return
    event.preventDefault()
    if (isWebLink(event.url)) void shell.openExternal(event.url)
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    mainWindow = null
  })
  setUpUpdates()
  await win.loadURL(origin)

  if (process.env.JOSEKI_SMOKE_OUT) await writeSmokeReport(process.env.JOSEKI_SMOKE_OUT, origin)
}

/** Packaging check: what the window and the server report, written to `file`; then the app quits. */
async function writeSmokeReport(file: string, origin: string): Promise<void> {
  const page = await (await fetch(origin)).text()
  const health: unknown = await (await fetch(`${origin}/api/health`)).json()
  const install = (await (await fetch(`${origin}/api/install`)).json()) as { installed: boolean }
  const desktopApi = (await mainWindow?.webContents.executeJavaScript('typeof window.dojoDesktop?.getUpdateState')) as string
  const report = { title: mainWindow?.getTitle(), page: page.includes('<div id="app">'), health, installed: install.installed, desktopApi }
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  // Spec 4.1: a second launch only brings the open window to the front.
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('window-all-closed', () => app.quit())
  // Spec 4.1: stop the server and KataGo before the process exits.
  app.on('before-quit', (event) => {
    if (quitting || !server) return
    event.preventDefault()
    quitting = true
    void server
      .close()
      .catch((err: unknown) => log(`Server stop failed: ${String(err)}`))
      .finally(() => app.quit())
  })
  app
    .whenReady()
    .then(boot)
    .catch((err: unknown) => {
      log(`Start failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
      dialog.showErrorBox('Joseki Dojo не запустился', err instanceof Error ? err.message : String(err))
      app.exit(1)
    })
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run packages/desktop --reporter=verbose`
Expected: 6 tests pass.

Run: `npm test && npm run typecheck`
Expected: `Test Files  36 passed (36)`, `Tests  214 passed (214)`; `tsc` prints nothing.

Run:
```bash
S="$TEMP/jd-smoke-dev2"; rm -rf "$S"
JOSEKI_USER_DATA="$S" JOSEKI_SMOKE_OUT="$S/smoke.json" npm run desktop && cat "$S/smoke.json"
```
Expected: as in Task 6, plus `"desktopApi": "function"` (the preload exposed `window.dojoDesktop`); `packages/desktop/dist/preload.cjs` exists (about 1 KB). From sources the updater does not check (`app.isPackaged` is false), so no bar appears.

Run:
```bash
npm run dist
S="$TEMP/jd-smoke-pkg2"; rm -rf "$S"
JOSEKI_USER_DATA="$S" JOSEKI_SMOKE_OUT="$S/smoke.json" "packages/desktop/release/win-unpacked/Joseki Dojo.exe"
cat "$S/smoke.json"; grep updater "$S/data/joseki-dojo.log" | head -1
```
Expected: the report contains `"desktopApi": "function"`; the log shows `[updater] Checking for update` (the packaged app checks GitHub at start). While the repository has no published release, GitHub answers "No published versions on GitHub"; the app treats it as "no update" and shows no bar.

- [ ] **Step 6: Commit milestone M4**

```bash
git add packages/desktop
git commit -m "feat(desktop): one-click app update through GitHub Releases" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Milestone M5 — CI, release, README

### Task 9: GitHub Actions — CI on pull requests, draft releases from tags

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

**Interfaces:**
- Consumes: root scripts `test`, `typecheck`, `e2e`, `release` (Tasks 1–7).
- Produces: workflow **CI** (job `test`) on every PR to `main`; workflow **Release** on tags `v*`: `test` → `draft` (creates the draft release once, so the two build jobs do not race to create two) → `build` on `windows-latest` and `ubuntu-latest` (electron-builder uploads the installer / AppImage plus `latest.yml` / `latest-linux.yml` into that draft). Uses only `GITHUB_TOKEN` (`permissions: contents: write` on the release workflow). Actions: `actions/checkout@v7`, `actions/setup-node@v7` (current majors; inputs `node-version`, `cache` checked).

- [ ] **Step 1: Write the workflows**

`.github/workflows/ci.yml`:
```yaml
# Spec 7: every pull request to main runs the unit tests, the type check and the e2e test.
name: CI

on:
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run typecheck
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
```

`.github/workflows/release.yml`:
```yaml
# Spec 7: a pushed tag vX.Y.Z tests the code, then builds the Windows installer and the Linux AppImage and uploads
# them, with latest.yml / latest-linux.yml for the updater, to a DRAFT release. Players see nothing until the owner
# presses Publish on that draft.
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - name: The tag matches package.json
        run: test "v$(node -p "require('./package.json').version")" = "$GITHUB_REF_NAME"
      - run: npm ci
      - run: npm test
      - run: npm run typecheck
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e

  # Created once here, so that the two build jobs upload into the same draft instead of racing to create one each.
  draft:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Create the draft release
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
        run: |
          gh release view "$GITHUB_REF_NAME" > /dev/null 2>&1 ||
            gh release create "$GITHUB_REF_NAME" --draft --verify-tag --title "Joseki Dojo $GITHUB_REF_NAME" --generate-notes

  build:
    needs: draft
    strategy:
      matrix:
        os: [windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Build and upload to the draft release
        run: npm run release
        env:
          GH_TOKEN: ${{ github.token }}
```

Notes for the reviewer:
- electron-builder reads `GH_TOKEN`; it finds the draft created by the `draft` job by its tag (`v` + the version from `extraMetadata.version`) and uploads into it (`releaseType: 'draft'` in the config).
- The `test` job fails early when the tag and `package.json` disagree (e.g. a hand-made tag).
- `npm ci` does not download the Electron binary (Electron 44 fetches it lazily); electron-builder downloads its own copy in the build jobs.

- [ ] **Step 2: Validate the YAML**

Run: `node -e "const y=require('js-yaml');for(const f of ['ci','release']){const d=y.load(require('fs').readFileSync('.github/workflows/'+f+'.yml','utf8'));console.log(f, Object.keys(d.jobs).join(','))}"`
Expected:
```
ci test
release test,draft,build
```
(`js-yaml` is installed as a dependency of electron-builder.)

- [ ] **Step 3: Stage the changes**

```bash
git add .github
```

---

### Task 10: README, final verification, manual check, pull request

**Files:**
- Rewrite: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the English README (spec 8); milestone commit M5; the pull request `feat/desktop-app` → `main`.

- [ ] **Step 1: Write the README**

`README.md`:
````markdown
# Joseki Dojo

Joseki Dojo helps you practise joseki (standard corner sequences in Go). You play out a corner against KataGo that plays like a human of the rank you choose, so it makes human mistakes. Afterwards the app shows how many points each move cost, how you should have played, and whether you punished your opponent's mistakes.

**The app is in Russian for now.** Buttons and messages are in Russian; this guide uses the Russian button names, with a translation in brackets.

## Install on Windows

1. Open the [latest release](https://github.com/EternalEclipse999/joseki-dojo/releases/latest) and download `Joseki-Dojo-Setup-X.Y.Z.exe` (X.Y.Z is the version number).
2. Run the downloaded file.
3. Windows may show **"Windows protected your PC"**. This happens because the app is not signed by a paid certificate. Click **More info**, then **Run anyway**. You only see this the first time: updates install themselves later.
4. The app installs for your Windows user only (no administrator password needed), adds shortcuts to the Start menu and the desktop, and opens.
5. On the first start the app says **«Нужно скачать движок KataGo»** (KataGo needs to be downloaded). Click **«Установить»** (Install). The app downloads about 200 MB, checks every file, and finds out whether your processor or your graphics card runs KataGo faster. Setting up a graphics card can take a few minutes. Then the start screen opens and you can play.

## Install on Linux

1. Open the [latest release](https://github.com/EternalEclipse999/joseki-dojo/releases/latest) and download `Joseki-Dojo-X.Y.Z.AppImage`.
2. Allow it to run: right-click the file, choose **Properties → Permissions**, and tick **Allow executing file as program**. Or in a terminal: `chmod +x Joseki-Dojo-*.AppImage`
3. Double-click the file to start the app.
4. On the first start click **«Установить»** (Install), as on Windows (step 5 above).

## Updating

When a new version is out, a bar appears at the top of the window: **«Доступна версия X.Y.Z»** (version X.Y.Z is available). Click **«Обновить»** (Update). The app downloads the update, shows the progress, and restarts in the new version. Your settings, training history and KataGo stay as they were.

Sometimes a new version also brings a newer tested KataGo. Then the bar says **«Доступна новая проверенная версия KataGo»** (a new tested KataGo version is available); click **«Обновить движок»** (Update engine).

## Uninstall

- **Windows:** open **Settings → Apps → Installed apps**, find **Joseki Dojo**, and choose **Uninstall**.
- **Linux:** delete the AppImage file.

Uninstalling keeps your data (KataGo, settings, training history). To remove it as well, delete this folder:

- Windows: `%APPDATA%\Joseki Dojo` (paste this into the File Explorer address bar)
- Linux: `~/.config/Joseki Dojo`

## Troubleshooting

- **The analysis after a game is slow.** KataGo runs on the processor: either it was faster than your graphics card, or the graphics card could not run KataGo (often an old graphics driver without OpenCL). To switch to the graphics card by hand, open **«Настройки»** (Settings) and enter the graphics card build that the installer keeps in the data folder (see [Uninstall](#uninstall)): the KataGo file in `engines/katago-<version>-opencl/` and the analysis config `engines/analysis-gpu.cfg`. The app restarts KataGo and keeps the change only if it works. Owners of NVIDIA cards with CUDA and cuDNN installed can enter a CUDA build of KataGo they downloaded themselves. On the same screen, fewer visits per position make the analysis faster (and less precise).
- **"Install" fails.** The screen says why. Most often it is the internet connection: check it and click **«Попробовать снова»** (Try again). Files that were already downloaded and checked are not downloaded again.
- **The AppImage does not start on Linux.** Some distributions need FUSE 2 for AppImages, e.g. on Ubuntu: `sudo apt install libfuse2t64` (Ubuntu 24.04) or `sudo apt install libfuse2` (22.04).
- **Logs** are in the data folder (see [Uninstall](#uninstall)): `data/joseki-dojo.log` for the app, `data/katago-logs/` for KataGo.

## For developers

### Requirements

- Node.js 22.12 or newer (CI uses Node 24)
- Windows or Linux x64. On macOS the app runs from sources, but you have to install KataGo yourself and enter its paths on the settings screen.

### Run from sources

```bash
npm install
npm start          # builds the web UI and serves it at http://127.0.0.1:5179
```

On the first start the page offers to install KataGo, exactly like the desktop app. Developers can also run `npm run setup` in a terminal: it asks which KataGo build to download (or takes the path of one you have), checks the files and measures the speed. In both cases everything lives in the repository: `config.local.json`, `data/`, `engines/`.

Other settings live in `config.local.json` (defaults: `config.example.json`):

| Field | Meaning |
|---|---|
| `analysis.reviewVisits` / `endVisits` | analysis depth for the review and for the end-of-joseki check |
| `thresholds` | inaccuracy / mistake / blunder limits and the "punished" limit, in points |
| `bot.defaultRank`, `bot.temperature` | the bot's default rank and the spread of its moves |
| `maxSessionMoves` | safety limit: after this many moves the game goes to the review |

### Commands

```bash
npm run dev          # server and Vite with hot reload: http://127.0.0.1:5173
npm test             # unit tests
npm run typecheck
npm run e2e          # browser tests with a fake KataGo (once: npx playwright install chromium)
npm run test:katago  # checks against a real KataGo (needs config.local.json)
npm run desktop      # the desktop app from sources (data in the Electron profile, see Uninstall)
npm run dist         # the installer for this OS in packages/desktop/release/
```

### Project layout

- `packages/shared`: types, coordinates, the corner zone, Go rules
- `packages/server`: Fastify server, KataGo process, bot, review, SQLite, the built-in KataGo installer (`src/install/`); `startServer()` in `src/start.ts` is used by `npm start` and by the desktop app
- `packages/web`: Preact UI
- `packages/desktop`: Electron main process and preload, bundled with esbuild and packaged with electron-builder
- `katago.lock.json`: the tested KataGo version and networks with their SHA-256. Changing them is a separate PR that passes `npm run test:katago`. The installer offers the new KataGo to players once an app update brings a new lock file.

### Releasing

The version is the `version` field of the root `package.json`. `main` is protected, so the version bump goes through a pull request:

```bash
git switch main && git pull
git switch -c release-0.1.1
npm version patch                    # or minor / major: bumps the version, commits "0.1.1" and tags v0.1.1
git push -u origin release-0.1.1 --follow-tags
```

1. The tag starts the **Release** workflow: tests, then the Windows installer and the Linux AppImage are built and uploaded to a **draft** release `v0.1.1`.
2. Open a pull request from `release-0.1.1` and merge it with **Create a merge commit** (so the tagged commit is on `main`).
3. Check the draft on the Releases page and click **Publish release**. Only then do players see the update: the updater ignores drafts.

Every pull request to `main` runs the **CI** workflow (unit tests, type check, e2e).

## License

MIT. KataGo and its networks are not part of this repository: the app downloads them from GitHub and katagotraining.org, and they come with their own licenses.
````

- [ ] **Step 2: Full automated verification**

Run: `npm test && npm run typecheck && npm run e2e && npx vitest run -c vitest.katago.config.ts`
Expected: `Test Files  36 passed (36)`, `Tests  214 passed (214)`; `tsc` prints nothing; `8 passed`; the real-KataGo tests pass.

Run: `npm run dist`
Expected: `packages/desktop/release/Joseki-Dojo-Setup-0.1.0.exe` is rebuilt without errors.

- [ ] **Step 3: Manual check on this machine (spec 9) — ask the user to do it, report the result in the PR**

The steps need a person at the screen and download about 200 MB:
1. Run `packages\desktop\release\Joseki-Dojo-Setup-0.1.0.exe`. Expected: SmartScreen may warn (unsigned); the app installs into `%LOCALAPPDATA%\Programs\Joseki Dojo` without an administrator prompt, creates «Joseki Dojo» shortcuts on the desktop and in the Start menu, and starts.
2. The window shows «Нужно скачать движок KataGo». Click «Установить». Expected: four files with progress (CPU and OpenCL builds, both networks), then «Распаковываю KataGo…», «Проверяю скорость на процессоре…», «Настраиваю видеокарту — это может занять несколько минут», «Запускаю KataGo…», then the start screen.
3. Play one training to the review. Expected: as with `npm start`.
4. Check `%APPDATA%\Joseki Dojo`: `config.json` with `setup.kind` and `setup.lockId` = `1.18.1/9d7a6afed8ff/637746e44f0e`; `data\joseki-dojo.sqlite`, `data\joseki-dojo.log`, `data\katago-logs\`; `engines\`.
5. Start the shortcut again while the app is open: the open window comes to the front.
6. Close the window; Task Manager shows no `katago.exe` left.

The app-update round trip (spec 9: publish v0.1.0, then v0.1.1, update with «Обновить», data kept) can only happen after this PR is merged and two releases are published; it is listed in the PR description as a follow-up for the owner.

- [ ] **Step 4: Commit milestone M5**

```bash
git add README.md .github
git commit -m "docs: English README for players and developers; ci: PR checks and draft releases" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push and open the pull request (confirm with the user first)**

```bash
git push -u origin feat/desktop-app
```
```bash
gh pr create --base main --head feat/desktop-app --title "Desktop app with one-click KataGo install and updates" --body-file -
```
Body: what was built (milestones M1–M5), the probe findings from Global Constraints, the result of Step 3, and the owner's follow-ups:
- after merging: `git switch main && git pull && git tag v0.1.0 && git push origin v0.1.0` (the version is already 0.1.0), wait for the **Release** workflow, check the draft, **Publish release**;
- to test updates (spec 9): install v0.1.0, release v0.1.1 by the README's "Releasing" steps, publish it, start v0.1.0 → «Доступна версия 0.1.1» → «Обновить» → the app restarts as 0.1.1 with data kept;
- optionally add the **CI / test** check as required in the "Protect main" ruleset.

End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge — merging is the user's.

---

## Spec coverage

| Spec section | Tasks |
|---|---|
| 1–2 Goal, scope (Electron for Windows/Linux, built-in installer, app and engine updates, CI, README) | all |
| 3 Player scenario (installer, SmartScreen, per-user install, shortcuts, first start, update bar) | 4, 7, 8, 10 |
| 4.1 Server inside Electron, `startServer(options)`, explicit lock path, single instance, stop on quit | 3, 6, 8 |
| 4.2 File locations (install folder, `userData` with `config.json`, `data/`, `engines/`; dev unchanged) | 3, 6, 7 |
| 4.3 Build (esbuild, `better-sqlite3` external, Vite, NSIS per-user, AppImage, GitHub publish, `packages/desktop`) | 6, 7 |
| 5.1 When the install screen / engine-update bar shows, `setup.lockId` | 2, 4 |
| 5.2 Steps: download + SHA-256 + per-file progress, extract, CPU and OpenCL benchmarks, OpenCL failure → CPU, pick faster, visits, write config, `restartWith` + checks | 1, 2 |
| 5.3 States, `GET/POST /api/install`, polling once a second, errors with «Попробовать снова», partial files removed and verified kept, code moved from `scripts/setup`, `npm run setup` reuses it | 1, 2, 3, 4 |
| 6 App update (electron-updater, drafts invisible, check at start and every 6 h, no auto-download, «Обновить», percent, `quitAndInstall` after stopping server and KataGo, errors with «Повторить», `window.dojoDesktop`, hidden in a browser, AppImage) | 4, 5, 7, 8 |
| 7 Releases (root version, `npm version` + `git push --follow-tags`, tag → tests → Windows/Linux build → draft with `latest*.yml`, owner publishes, PR workflow) | 7, 9, 10 |
| 8 README (player first, developer section, license) | 10 |
| 9 Verification (installer unit tests with local HTTP server and injected fake KataGo, speed choice, OpenCL failure, download errors, install API, `startServer` with explicit paths; e2e install screen and test-mode installation; manual check; update round trip) | 1, 2, 3, 5, 10 |
