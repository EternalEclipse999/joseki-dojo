// The news e2e server (port 5185): its database already holds a training, so its first start counts as an update
// and the novelties show. Its own gitignored profile and data folder, so that nothing tracked changes.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openDb } from '../packages/server/src/store/db'
import { startServer } from '../packages/server/src/start'
import { FAKE_KATAGO } from '../packages/server/test/helpers'

const root = resolve('e2e/.news')
rmSync(root, { recursive: true, force: true })
mkdirSync(root, { recursive: true })
writeFileSync(
  join(root, 'config.json'),
  JSON.stringify({
    katago: { commandOverride: ['node', FAKE_KATAGO] },
    analysis: { reviewVisits: 10, endVisits: 5 },
    ui: { language: 'ru' },
  }),
)

// An install from before the novelties: its database already holds a finished training, so the first start is an update.
const db = openDb(join(root, 'data', 'joseki-dojo.sqlite'))
db.prepare("INSERT INTO sessions (id, created_at, mode, environment, user_color, bot_rank, corner, status) VALUES ('seed', '2026-10-01T00:00:00.000Z', 'free', 'empty', 'B', '7k', 'TR', 'finished')").run()
db.close()

const server = await startServer({
  configFile: join(root, 'config.json'),
  dataDir: join(root, 'data'),
  enginesDir: join(root, 'engines'),
  lockFile: resolve('katago.lock.json'),
  trapsFile: resolve('e2e/traps.test.jdb'),
  startsFile: resolve('e2e/starts.test.jdb'),
  startsListFile: resolve('e2e/starts-list.test.json'),
  startsNamesFile: resolve('e2e/starts-i18n.test.json'),
  thresholdsFile: null,
  graphFile: null,
  graphWeightsFile: null,
  webDist: resolve('packages/web/dist'),
  port: 5185,
})
console.log(`News e2e server: ${server.url}`)
