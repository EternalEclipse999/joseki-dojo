import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { localize, type Language } from '@joseki-dojo/shared'
import { buildApp, createServices, type AppServices } from './app'
import { loadConfig, type AppConfig } from './config'
import { engineCommand } from './engine/command'
import { KataGoEngine, type EngineCommand } from './engine/engine'
import { loadLock, type KataGoLock } from './engine/lock'
import { StartBook } from './starts/book'
import { loadNames, type StartNames } from './starts/names'
import { TrapBook } from './traps/book'

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
  /** The HTTP client for KataGo downloads: the desktop app passes Electron's `net.fetch` (proxy, antivirus certificates). Default: the global `fetch`. */
  fetch?: typeof fetch
  /** The traps base (packages/server/bases/traps.jdb); missing, null or unreadable leaves the traps mode empty. */
  trapsFile?: string | null
  /** The start positions base (packages/server/bases/starts.jdb); missing, null or unreadable turns the start modes off. */
  startsFile?: string | null
  /** The named start list (packages/server/bases/starts-list.json); missing or unreadable turns «Из списка» off. */
  startsListFile?: string | null
  /**
   * Spec (languages) 7: the names of the list in the other languages (packages/server/bases/starts-i18n.json); by default
   * starts-i18n.json next to the list. Missing, null or broken leaves the names Russian.
   */
  startsNamesFile?: string | null
  /** Spec (languages) 8.1: the language chosen in the Windows installer; saved only into a config without one. */
  initialLanguage?: Language
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
  const traps = loadTraps(options.trapsFile, log)
  const starts = loadStarts(options.startsFile, options.startsListFile, log, options.startsNamesFile)
  const services = createServices(config, engine, { configFile: options.configFile, enginesDir: options.enginesDir, lock, commandFor, log, fetch: options.fetch, traps, starts })
  let app: FastifyInstance | undefined
  try {
    if (options.initialLanguage) await services.ui.applyInitialLanguage(options.initialLanguage)
    app = await buildApp(services, options.webDist)
    await app.listen({ port: options.port ?? config.port, host: '127.0.0.1' })
  } catch (err) {
    await app?.close().catch(() => undefined)
    await services.installer.close().catch(() => undefined)
    await engine.stop().catch(() => undefined)
    services.db.close()
    throw err
  }
  const port = (app.server.address() as AddressInfo).port
  let closing: Promise<void> | null = null
  void services.health
    .check()
    .then((h) => {
      if (closing === null) log(h.state === 'ready' ? 'KataGo готов' : `KataGo не готов: ${h.reason ? localize('en', h.reason) : h.state}`)
    })
    .catch((err) => log(`Проверка KataGo не удалась: ${err instanceof Error ? err.message : String(err)}`))

  const close = (): Promise<void> =>
    (closing ??= (async () => {
      await app.close()
      await services.installer.close()
      await engine.stop()
      services.db.close()
    })())
  return { url: `http://127.0.0.1:${port}`, port, services, close }
}

export function loadTraps(file: string | null | undefined, log: (line: string) => void): TrapBook {
  if (!file) return TrapBook.empty()
  try {
    const book = TrapBook.load(file)
    if (book.skipped.length > 0) log(`Пропущено ловушек: ${book.skipped.length} (недопустимые позиции)`)
    return book
  } catch (err) {
    log(`База ловушек недоступна: ${err instanceof Error ? err.message : String(err)}`)
    return TrapBook.empty()
  }
}

/**
 * Spec (starts) 4.3: the starts base and its list; a missing or broken base turns both start modes off, a broken list only
 * «Из списка». The names file (languages spec 7) defaults to starts-i18n.json next to the list.
 */
export function loadStarts(baseFile: string | null | undefined, listFile: string | null | undefined, log: (line: string) => void, namesFile?: string | null): StartBook {
  if (!baseFile) return StartBook.empty()
  let book: StartBook
  try {
    book = StartBook.loadBase(baseFile)
  } catch (err) {
    log(`База стартовых позиций недоступна: ${err instanceof Error ? err.message : String(err)}`)
    return StartBook.empty()
  }
  if (book.skipped.length > 0) log(`Пропущено стартовых позиций: ${book.skipped.length} (недопустимые позиции)`)
  if (!listFile) return book
  let json: string
  try {
    json = readFileSync(listFile, 'utf8')
  } catch (err) {
    log(`Список стартовых позиций недоступен: ${err instanceof Error ? err.message : String(err)}`)
    return book
  }
  const names = loadStartNames(namesFile === undefined ? join(dirname(listFile), 'starts-i18n.json') : namesFile, log)
  try {
    return book.withList(json, log, names)
  } catch (err) {
    log(`Список стартовых позиций недоступен: ${err instanceof Error ? err.message : String(err)}`)
    return book
  }
}

/** Spec (languages) 7: the translations of the list names; a missing or broken file leaves them Russian, with one log line. */
function loadStartNames(file: string | null, log: (line: string) => void): StartNames {
  if (!file) return {}
  try {
    return loadNames(readFileSync(file, 'utf8'), log)
  } catch (err) {
    log(`Переводы названий стартовых позиций недоступны: ${err instanceof Error ? err.message : String(err)}`)
    return {}
  }
}
