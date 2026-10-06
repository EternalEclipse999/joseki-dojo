// `npm start` / `npm run dev`: everything lives in the repository (config.local.json, data/, engines/).
// JOSEKI_CONFIG points at another config file (the e2e test uses e2e/config.e2e.json).
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './start'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const server = await startServer({
  configFile: process.env.JOSEKI_CONFIG ? resolve(process.env.JOSEKI_CONFIG) : join(repoRoot, 'config.local.json'),
  enginesDir: join(repoRoot, 'engines'),
  lockFile: join(repoRoot, 'katago.lock.json'),
  webDist: join(repoRoot, 'packages', 'web', 'dist'),
})
console.log(`Joseki Dojo: ${server.url}`)

const shutdown = async (): Promise<void> => {
  await server.close()
  process.exit(0)
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
