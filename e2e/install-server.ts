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
