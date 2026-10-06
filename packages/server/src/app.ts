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
