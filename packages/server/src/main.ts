import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp, createServices } from './app'
import { loadConfig } from './config'
import { engineCommand } from './engine/command'
import { KataGoEngine } from './engine/engine'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const configFile = process.env.JOSEKI_CONFIG ? resolve(process.env.JOSEKI_CONFIG) : join(repoRoot, 'config.local.json')
const config = loadConfig(configFile)
const engine = new KataGoEngine(engineCommand(config), (line) => console.log(`[katago] ${line}`))
const services = createServices(config, engine, { configFile, modelsDir: join(repoRoot, 'engines', 'models') })
const app = await buildApp(services, join(repoRoot, 'packages', 'web', 'dist'))
await app.listen({ port: config.port, host: '127.0.0.1' })
console.log(`Joseki Dojo: http://127.0.0.1:${config.port}`)
void services.health.check().then((h) => {
  console.log(h.state === 'ready' ? 'KataGo готов' : `KataGo не готов: ${h.reason}`)
})

const shutdown = async (): Promise<void> => {
  await app.close()
  await engine.stop()
  services.db.close()
  process.exit(0)
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
