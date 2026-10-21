// The problems e2e server (port 5184): the fake KataGo punishes N13 by 3 points (FAKE_KATAGO_PENALTY), so that a
// training can hold a real mistake. Its own gitignored profile and data folder, so that nothing tracked changes.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startServer } from '../packages/server/src/start'
import { FAKE_KATAGO } from '../packages/server/test/helpers'

// The KataGo process inherits the environment of the server.
process.env.FAKE_KATAGO_PENALTY = 'N13:3'

const root = resolve('e2e/.problems')
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
  port: 5184,
})
console.log(`Problems e2e server: ${server.url}`)
