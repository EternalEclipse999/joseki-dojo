import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../../packages/server/src/config'
import { engineCommand } from '../../packages/server/src/engine/command'
import { KataGoEngine } from '../../packages/server/src/engine/engine'
import { decodeJdb, encodeJdb } from '../../packages/server/src/jdb'
import { checkTraps } from '../../packages/server/src/traps/check'

const root = fileURLToPath(new URL('../../', import.meta.url))
const DEFAULTS = { visits: 1600, 'good-max': 1, 'caught-gap': 2 }
const log = (line: string): void => console.log(line)

function numberOption(args: string[], name: keyof typeof DEFAULTS): number {
  const at = args.indexOf(`--${name}`)
  if (at === -1) return DEFAULTS[name]
  const value = Number(args[at + 1])
  if (args[at + 1] === undefined || !(value >= 0)) throw new Error(`--${name} needs a non-negative number`)
  return value
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const opts = { visits: numberOption(args, 'visits'), goodMax: numberOption(args, 'good-max'), caughtGap: numberOption(args, 'caught-gap') }
  const file = join(root, 'packages', 'server', 'bases', 'traps.jdb')
  const base = decodeJdb(readFileSync(file))
  if (base.kind !== 'traps') throw new Error(`${file} is not a traps base`)
  const config = loadConfig(join(root, 'config.local.json'))
  log(`Checking ${base.nodesOf('trap').length} traps with ${opts.visits} visits (good-max ${opts.goodMax}, caught-gap ${opts.caughtGap})`)
  const engine = new KataGoEngine(engineCommand(config), (line) => log(`  [katago] ${line}`))
  engine.start()
  try {
    const result = await checkTraps(base, engine, opts, log)
    writeFileSync(file, encodeJdb(result.tree))
    log(`\nKept ${result.kept}, dropped ${result.dropped.length}. The base is marked as verified and written to ${file}`)
    for (const d of result.dropped) log(`  dropped ${d.id}: ${d.reason}`)
  } finally {
    await engine.stop()
  }
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
