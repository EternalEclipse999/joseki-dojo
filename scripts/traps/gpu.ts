import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localize } from '@joseki-dojo/shared'
import { loadConfig } from '../../packages/server/src/config'
import { engineCommand } from '../../packages/server/src/engine/command'
import { EngineError, KataGoEngine } from '../../packages/server/src/engine/engine'
import { checkEngine } from '../../packages/server/src/engine/health'
import { gitProblem, parseGpuOptions, runGpu } from './gpu-steps'

const root = fileURLToPath(new URL('../../', import.meta.url))
let visits: number | undefined
const log = (line: string): void => console.log(line)

/** Spec 3: `npm run traps:gpu` — the checks first, then the run with the owner's KataGo. */
async function main(): Promise<void> {
  const opts = parseGpuOptions(process.argv.slice(2))
  visits = opts.visits
  const problem = gitProblem(root)
  if (problem) throw new Error(problem)
  const configFile = join(root, 'config.local.json')
  if (!existsSync(configFile)) throw new Error(`No ${configFile}: run npm run setup first`)
  const config = loadConfig(configFile)
  const engine = new KataGoEngine(engineCommand(config), (line) => log(`  [katago] ${line}`))
  try {
    const health = await checkEngine(config, engine)
    if (health.state !== 'ready') throw new Error(`KataGo is not ready: ${health.reason ? localize('en', health.reason) : health.state}`)
    const engineInfo = `KataGo ${await engine.version()}; networks: ${basename(config.katago.mainModel)}, ${basename(config.katago.humanModel)}`
    log(engineInfo)
    await runGpu({ root, engine, opts, engineInfo, log })
  } finally {
    await engine.stop()
  }
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  if (err instanceof EngineError && err.code === 'engine_failed') {
    console.error(`If KataGo runs on the CPU or is too slow for --visits ${visits}, lower --visits or run npm run setup again and pick a GPU build.`)
  }
  process.exit(1)
})
