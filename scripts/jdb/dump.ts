import { readFileSync, writeFileSync } from 'node:fs'
import { decodeJdb, dumpSgf, dumpText } from '../../packages/server/src/jdb'

const USAGE = 'Usage: npm run jdb:dump -- <file.jdb> [--sgf <out.sgf>]'

function main(): void {
  const args = process.argv.slice(2)
  const sgfAt = args.indexOf('--sgf')
  let sgfOut: string | null = null
  if (sgfAt !== -1) {
    sgfOut = args[sgfAt + 1] ?? null
    if (!sgfOut) throw new Error(USAGE)
    args.splice(sgfAt, 2)
  }
  if (args.length !== 1) throw new Error(USAGE)
  const base = decodeJdb(readFileSync(args[0]))
  if (sgfOut) {
    writeFileSync(sgfOut, dumpSgf(base))
    console.log(`Wrote ${sgfOut} (${base.size} nodes)`)
  } else console.log(dumpText(base))
}

try {
  main()
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
