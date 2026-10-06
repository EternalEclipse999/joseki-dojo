// The re-pick e2e server (port 5182): KataGo is installed (placeholder files; the fake KataGo answers) by an
// installer from an OLDER katago.lock.json, so the engine-update bar shows; downloads come from a local fixture.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startServer } from '../packages/server/src/start'
import { createInstallFixture, fakeBuildCommand } from '../packages/server/test/install-fixture'

const root = resolve('e2e/.repick')
rmSync(root, { recursive: true, force: true })
mkdirSync(join(root, 'old'), { recursive: true })

const old = (name: string): string => {
  const file = join(root, 'old', name)
  writeFileSync(file, 'placeholder')
  return file
}
writeFileSync(
  join(root, 'config.json'),
  JSON.stringify({
    setup: { kind: 'cpu', lockId: '1.17.0/aaaaaaaaaaaa/bbbbbbbbbbbb' },
    katago: { path: old('katago.exe'), analysisConfig: old('analysis.cfg'), mainModel: old('main.bin.gz'), humanModel: old('human.bin.gz') },
  }),
)

const fixture = await createInstallFixture()
const server = await startServer({
  configFile: join(root, 'config.json'),
  dataDir: join(root, 'data'),
  enginesDir: join(root, 'engines'),
  lockFile: resolve('katago.lock.json'),
  webDist: resolve('packages/web/dist'),
  port: 5182,
  lock: fixture.lock,
  commandFor: fakeBuildCommand(),
})
console.log(`Re-pick e2e server: ${server.url}`)
