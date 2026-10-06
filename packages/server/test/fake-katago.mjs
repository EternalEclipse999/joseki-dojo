// Stand-in for `katago analysis` used by tests and e2e. Reads JSON queries from stdin and answers
// deterministically: the best move is the first free point of D4, Q4, D16, Q16 (or the first
// allowed move), every score is 0, and the human policy is uniform over free points.
// Switches (environment variables):
//   FAKE_KATAGO_CRASH_ONCE_FILE=<path>  exit on the first analysis query if <path> is missing (creates it)
//   FAKE_KATAGO_ALWAYS_CRASH=1          exit on every analysis query
//   FAKE_KATAGO_NO_HUMAN=1              omit humanPolicy (as if -human-model were missing)
//   FAKE_KATAGO_HANG=1                  never answer analysis queries (query_version is still answered)
//   FAKE_KATAGO_SILENT=1                never answer anything
//   FAKE_KATAGO_DELAY_MS=<n>            answer analysis queries one at a time (a queue), each <n> ms after the previous
//                                       answer was written; query_version stays immediate
//   FAKE_KATAGO_VERSION=<v>             version reported by query_version (default 1.18.1)
import { existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const LETTERS = 'ABCDEFGHJKLMNOPQRST'
const BEST_MOVE_PREFERENCE = ['D4', 'Q4', 'D16', 'Q16']

const toIndex = (gtp) => (19 - Number(gtp.slice(1))) * 19 + LETTERS.indexOf(gtp[0].toUpperCase())

function answer(query) {
  if (query.action === 'query_version') {
    return { id: query.id, action: 'query_version', version: process.env.FAKE_KATAGO_VERSION ?? '1.18.1', git_hash: 'fake' }
  }
  if (query.rules === 'invalid') return { id: query.id, error: 'Could not parse rules', field: 'rules' }
  const moves = query.moves ?? []
  const taken = new Set(moves.filter(([, v]) => v.toLowerCase() !== 'pass').map(([, v]) => toIndex(v)))
  const last = moves[moves.length - 1]
  const toMove = last ? (last[0] === 'B' ? 'W' : 'B') : 'B'
  const allowed = (query.allowMoves ?? []).find((a) => a.player === toMove)
  const options = (allowed ? allowed.moves : BEST_MOVE_PREFERENCE).filter((m) => !taken.has(toIndex(m)))
  const best = options[0] ?? 'pass'
  const visits = query.maxVisits ?? 1
  const res = {
    id: query.id,
    isDuringSearch: false,
    turnNumber: moves.length,
    rootInfo: { currentPlayer: toMove, scoreLead: 0, winrate: 0.5, visits },
    moveInfos: [{ move: best, order: 0, visits, scoreLead: 0, winrate: 0.5, pv: [best] }],
  }
  if (query.includeOwnership) res.ownership = new Array(361).fill(0)
  if (query.includePolicy) {
    const free = 361 - taken.size
    const policy = Array.from({ length: 362 }, (_, i) => (i === 361 ? 0 : taken.has(i) ? -1 : 1 / free))
    res.policy = policy
    if (query.overrideSettings?.humanSLProfile && !process.env.FAKE_KATAGO_NO_HUMAN) res.humanPolicy = [...policy]
  }
  return res
}

let chain = Promise.resolve()
function enqueue(fn, delay) {
  chain = chain.then(() => new Promise((r) => setTimeout(r, delay))).then(fn)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  const query = JSON.parse(line)
  if (process.env.FAKE_KATAGO_SILENT) return
  const isAnalysis = query.action === undefined
  if (isAnalysis && process.env.FAKE_KATAGO_HANG) return
  if (isAnalysis && process.env.FAKE_KATAGO_ALWAYS_CRASH) process.exit(3)
  const marker = process.env.FAKE_KATAGO_CRASH_ONCE_FILE
  if (isAnalysis && marker && !existsSync(marker)) {
    writeFileSync(marker, 'crashed')
    process.exit(3)
  }
  const reply = () => process.stdout.write(`${JSON.stringify(answer(query))}\n`)
  const delay = Number(process.env.FAKE_KATAGO_DELAY_MS ?? 0)
  if (isAnalysis && delay > 0) enqueue(reply, delay)
  else reply()
})
