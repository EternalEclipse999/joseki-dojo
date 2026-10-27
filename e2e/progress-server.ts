// The progress e2e server (port 5186): a small joseki graph with weights for two levels (e2e/make-graph.ts) over the e2e
// start list, with the fake KataGo that makes every move exact but one: a stone on B19 costs its colour 3 points
// (FAKE_KATAGO_PENALTY). In the top-right corner B19 is where the user's tenuki goes after the bot's first one (A19), so
// a tenuki of the user's is a mistake there — a graph card rated «Снова», due in a minute — and, being outside the
// corner, makes no problem card. Its own gitignored profile and data folder.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startServer } from '../packages/server/src/start'
import { FAKE_KATAGO } from '../packages/server/test/helpers'
import { writeProgressGraph } from './make-graph'

// The KataGo process inherits the environment of the server.
process.env.FAKE_KATAGO_PENALTY = 'B19:3'

const root = resolve('e2e/.progress')
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
const graphFile = join(root, 'graph.bin')
const graphWeightsFile = join(root, 'weights.bin')
writeProgressGraph(graphFile, graphWeightsFile)

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
  graphFile,
  graphWeightsFile,
  webDist: resolve('packages/web/dist'),
  port: 5186,
})
console.log(`Progress e2e server: ${server.url}`)
