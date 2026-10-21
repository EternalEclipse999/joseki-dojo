import { existsSync } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import type { ServerMessage } from '@joseki-dojo/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { AnalysisScheduler } from './analysis/scheduler'
import { CardRepo } from './cards/repo'
import { CardService } from './cards/service'
import { registerHttp } from './api/http'
import { Hub } from './api/hub'
import { registerInstallRoutes } from './api/install-routes'
import { registerSettingsRoutes } from './api/settings-routes'
import { registerAboutRoutes } from './api/about-routes'
import { registerCardsRoutes } from './api/cards-routes'
import { registerStartsRoutes } from './api/starts-routes'
import { registerTrapsRoutes } from './api/traps-routes'
import { registerNewsRoutes } from './api/news-routes'
import { registerPlayerRoutes } from './api/player-routes'
import { registerUiRoutes } from './api/ui-routes'
import { handleSocket } from './api/ws'
import { HumanBot } from './bot/bot'
import { StrongBot } from './bot/strong'
import type { AppConfig } from './config'
import type { EngineCommand, KataGoEngine } from './engine/engine'
import { HealthMonitor } from './engine/health'
import type { KataGoLock } from './engine/lock'
import { toErrorMessage } from './errors'
import { GraphBook } from './graph/book'
import { InstallerService } from './install/installer'
import { NewsService } from './news/service'
import { ReviewService } from './review/service'
import { thresholdsFor, type ThresholdTable } from './review/thresholds'
import { VariationService } from './review/variation'
import { SessionService } from './session/service'
import { SettingsService } from './settings/service'
import { openDb, type Db } from './store/db'
import { SessionRepo } from './store/repo'
import { PlayerService } from './settings/player'
import { UiService } from './settings/ui'
import { StartBook } from './starts/book'
import { TrapBook } from './traps/book'

export interface AppServices {
  config: AppConfig
  db: Db
  engine: KataGoEngine
  health: HealthMonitor
  sessions: SessionService
  reviews: ReviewService
  variations: VariationService
  settings: SettingsService
  installer: InstallerService
  /** The loaded traps base; empty when there is none. */
  traps: TrapBook
  /** The loaded start positions; empty when there is none. */
  starts: StartBook
  /** Spec (progress) 3.4: the joseki graph with its weights; empty when there is none. */
  graph: GraphBook
  cards: CardService
  ui: UiService
  player: PlayerService
  /** Spec (whats-new) 3.2: which novelties are new for this player. */
  news: NewsService
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
  /** The HTTP client for KataGo downloads; default: the global `fetch`. */
  fetch?: typeof fetch
  /** The traps base; default: an empty book. */
  traps?: TrapBook
  /** The start positions; default: an empty book. */
  starts?: StartBook
  /** Spec (repetition) 3.2: the calibrated thresholds table; default: none (the config thresholds). */
  thresholds?: ThresholdTable | null
  /** Spec (progress) 3.4: the joseki graph; default: an empty book. */
  graph?: GraphBook
}

// The server only talks to the local browser. Checking Host defeats DNS rebinding, checking Origin stops other
// sites from opening the WebSocket (browsers do not apply the same-origin policy to it). Any port is allowed:
// the Vite dev server proxies from its own port.
const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/i
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i

export function createServices(config: AppConfig, engine: KataGoEngine, options: ServiceOptions): AppServices {
  const db = openDb(join(config.dataDir, 'joseki-dojo.sqlite'))
  const news = new NewsService(db)
  const repo = new SessionRepo(db)
  const hub = new Hub()
  const publish = (sessionId: string, msg: ServerMessage): void => hub.publish(sessionId, msg)
  const analysis = new AnalysisScheduler(engine, repo, config.analysis)
  const traps = options.traps ?? TrapBook.empty()
  const starts = options.starts ?? StartBook.empty()
  const graph = options.graph ?? GraphBook.empty()
  const health = new HealthMonitor(config, engine)
  const cards = new CardService({
    repo: new CardRepo(db),
    starts,
    judge: {
      analyze: (q) => engine.analyze(q),
      ready: () => health.get().state === 'ready',
      thresholds: () => thresholdsFor(config.player.level, options.thresholds ?? null, config.thresholds),
      visits: () => config.analysis.reviewVisits,
    },
  })
  const reviews = new ReviewService({ repo, analysis, config, publish, traps, thresholds: options.thresholds ?? null, cards, log: options.log })
  const variations = new VariationService({ repo, engine, config, problems: (id) => cards.problemBase(id) })
  const sessions = new SessionService({
    repo,
    analysis,
    engine,
    config,
    publish,
    bot: new HumanBot(engine),
    strong: new StrongBot(engine),
    traps,
    starts,
    log: options.log,
    onFinished: (id) => {
      reviews.prepare(id).catch((err: unknown) => publish(id, toErrorMessage(err)))
    },
  })
  const { configFile, enginesDir, lock, commandFor, log, fetch } = options
  const settings = new SettingsService({ config, engine, health, lock, configFile, modelsDir: join(enginesDir, 'models'), commandFor, onSwitched: () => variations.clear() })
  const installer = new InstallerService({ config, lock, enginesDir, settings, commandFor, log, engine, health, fetch })
  const ui = new UiService(config, configFile)
  const player = new PlayerService(config, configFile)
  return { config, db, engine, health, sessions, reviews, variations, settings, installer, hub, traps, starts, graph, cards, ui, player, news }
}

export async function buildApp(services: AppServices, webDist: string | null = null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    // Another site's page can POST to 127.0.0.1 (CORS does not stop "simple" requests): refuse any changing request
    // that names a foreign Origin. Requests without Origin (curl, the desktop window's own fetch) pass.
    const foreignOrigin = origin !== undefined && !LOCAL_ORIGIN.test(origin) && (req.url.startsWith('/ws') || (req.method !== 'GET' && req.method !== 'HEAD'))
    if (!LOCAL_HOST.test(req.headers.host ?? '') || foreignOrigin) {
      // A rejected WebSocket upgrade has no keep-alive owner: close its socket once the 403 is written.
      if (req.headers.upgrade) reply.raw.once('finish', () => req.raw.socket.end())
      return reply.code(403).header('connection', 'close').send({ error: 'forbidden' })
    }
  })
  await app.register(websocket)
  app.get('/ws', { websocket: true }, (socket) => handleSocket(socket, services))
  registerHttp(app, services)
  registerSettingsRoutes(app, services.settings)
  registerAboutRoutes(app, services.settings)
  registerInstallRoutes(app, services.installer)
  registerTrapsRoutes(app, services.traps)
  registerStartsRoutes(app, services.starts)
  registerCardsRoutes(app, services.cards)
  registerUiRoutes(app, services.ui)
  registerPlayerRoutes(app, services.player)
  registerNewsRoutes(app, services.news)
  if (webDist && existsSync(webDist)) await app.register(fastifyStatic, { root: webDist })
  return app
}
