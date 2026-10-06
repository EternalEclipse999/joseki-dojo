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
  let app: FastifyInstance | undefined
  try {
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
      if (closing === null) log(h.state === 'ready' ? 'KataGo готов' : `KataGo не готов: ${h.reason}`)
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
