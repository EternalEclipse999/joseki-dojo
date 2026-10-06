import { existsSync } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import type { ServerMessage } from '@joseki-dojo/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { AnalysisScheduler } from './analysis/scheduler'
import { registerHttp } from './api/http'
import { Hub } from './api/hub'
import { registerSettingsRoutes } from './api/settings-routes'
import { handleSocket } from './api/ws'
import { HumanBot } from './bot/bot'
import type { AppConfig } from './config'
import type { KataGoEngine } from './engine/engine'
import { HealthMonitor } from './engine/health'
import { loadLock } from './engine/lock'
import { toErrorMessage } from './errors'
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
  hub: Hub
}

export interface ServicePaths {
  /** Where the settings screen saves changes (config.local.json in production). */
  configFile: string
  /** Folder listed as "available networks" on the settings screen. */
  modelsDir: string
}

export function createServices(
  config: AppConfig,
  engine: KataGoEngine,
  paths: ServicePaths = { configFile: join(config.dataDir, 'config.local.json'), modelsDir: join(config.dataDir, 'models') },
): AppServices {
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
  const settings = new SettingsService({ config, engine, health, lock: loadLock(), ...paths })
  return { config, db, engine, health, sessions, reviews, settings, hub }
}

export async function buildApp(services: AppServices, webDist: string | null = null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(websocket)
  app.get('/ws', { websocket: true }, (socket) => handleSocket(socket, services))
  registerHttp(app, services)
  registerSettingsRoutes(app, services.settings)
  if (webDist && existsSync(webDist)) await app.register(fastifyStatic, { root: webDist })
  return app
}
