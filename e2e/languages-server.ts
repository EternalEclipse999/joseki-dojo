// The languages e2e server (port 5183): its own profile, so that the saved language the language spec switches never
// lives in the tracked e2e/config.e2e.json (an aborted run cannot leave it in another language). The profile starts in
// Russian like the 5180 server and has the same fake KataGo and start positions (with their translations).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startServer } from '../packages/server/src/start'
import { FAKE_KATAGO } from '../packages/server/test/helpers'

const root = resolve('e2e/.languages')
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
  webDist: resolve('packages/web/dist'),
  port: 5183,
  startsFile: resolve('e2e/starts.test.jdb'),
  startsListFile: resolve('e2e/starts-list.test.json'),
  startsNamesFile: resolve('e2e/starts-i18n.test.json'),
})
console.log(`Languages e2e server: ${server.url}`)
