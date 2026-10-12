import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../../packages/server/src/config'
import { engineCommand } from '../../packages/server/src/engine/command'
import { KataGoEngine } from '../../packages/server/src/engine/engine'
import { renameRetrying } from '../../packages/server/src/install/download'
import { decodeJdb, encodeJdb } from '../../packages/server/src/jdb'
import { checkTraps } from '../../packages/server/src/traps/check'

const root = fileURLToPath(new URL('../../', import.meta.url))
const DEFAULTS = { visits: 1600, 'good-max': 1, 'caught-gap': 2 }
const log = (line: string): void => console.log(line)

type OptionName = keyof typeof DEFAULTS

/** Reads `--name value` pairs; an unknown flag, a missing value or a bad number is an error. */
function parseOptions(args: string[]): Record<OptionName, number> {
  const values = { ...DEFAULTS }
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const name = flag.replace(/^--/, '') as OptionName
    if (!flag.startsWith('--') || !(name in DEFAULTS)) throw new Error(`Unknown option ${flag}. Usage: npm run traps:check -- [--visits N] [--good-max X] [--caught-gap X]`)
    const value = Number(args[i + 1])
    if (args[i + 1] === undefined || args[i + 1].trim() === '' || !Number.isFinite(value)) throw new Error(`${flag} needs a number`)
    if (name === 'visits' ? !Number.isInteger(value) || value < 1 : value < 0) {
      throw new Error(name === 'visits' ? '--visits needs an integer of at least 1' : `${flag} needs a non-negative number`)
    }
    values[name] = value
  }
  return values
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const opts = { visits: options.visits, goodMax: options['good-max'], caughtGap: options['caught-gap'] }
  const file = join(root, 'packages', 'server', 'bases', 'traps.jdb')
  const base = decodeJdb(readFileSync(file))
  if (base.kind !== 'traps') throw new Error(`${file} is not a traps base`)
  const config = loadConfig(join(root, 'config.local.json'))
  log(`Checking ${base.nodesOf('trap').length} traps with ${opts.visits} visits (good-max ${opts.goodMax}, caught-gap ${opts.caughtGap})`)
  const engine = new KataGoEngine(engineCommand(config), (line) => log(`  [katago] ${line}`))
  engine.start()
  try {
    log(`KataGo ${await engine.version().catch(() => 'unknown version')}; networks: ${basename(config.katago.mainModel)}, ${basename(config.katago.humanModel)}`)
    const result = await checkTraps(base, engine, opts, log)
    // Written next to the base and renamed over it, so a failed run never leaves a half-written base.
    const tmp = `${file}.tmp`
    writeFileSync(tmp, encodeJdb(result.tree))
    await renameRetrying(tmp, file)
    log(`\nKept ${result.kept}, dropped ${result.dropped.length}, left unchecked ${result.failed.length}. Written to ${file}`)
    for (const d of result.dropped) log(`  dropped ${d.id}: ${d.reason}`)
    for (const f of result.failed) log(`  unchecked ${f.id}: ${f.reason}`)
    log(result.tree.verified ? 'The base is marked as verified.' : 'The base is NOT marked as verified: fix the unchecked traps and run again.')
  } finally {
    await engine.stop()
  }
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
