import { gtpToVertex, vertexToGtp, vertexToIndex, zoneVertices, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { EngineError, type AnalysisEngine } from '../engine/engine'
import type { AnalysisResponse, KataGoQueryBody } from '../engine/katago-types'
import { decodeJdb, encodeJdb, trapId, type CanonicalMove, type JdbBase, type JdbNode } from '../jdb'
import { completeCandidates, type CompleteOptions } from './complete'

const v = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex
const mv = (gtp: string): CanonicalMove => (gtp === 'tenuki' ? 'tenuki' : v(gtp))
const OPTS: CompleteOptions = { visits: 100, goodMax: 1, caughtGap: 2, ranks: ['20k', '10k', '1k'], natural: 0.1 }
const ZONE = new Set(zoneVertices('TR').map(vertexToGtp))

/** Black answers after these four moves, so Black-view leads are the answerer's. */
const PATH = ['Q16', 'O17', 'R14', 'R13']
const ID = trapId(PATH.map(mv))

/** `moves` as a chain of plain nodes whose last node has category `last` and the given children. */
function chain(moves: string[], last: JdbNode['category'], children: JdbNode[]): JdbNode {
  const [first, ...rest] = moves
  if (rest.length === 0) return { move: mv(first), category: last, loss: null, children }
  return { move: mv(first), category: 'none', loss: null, children: [chain(rest, last, children)] }
}
const answer = (gtp: string, category: JdbNode['category']): JdbNode => ({ move: mv(gtp), category, loss: null, children: [] })
const candidates = (...roots: JdbNode[]): JdbBase => decodeJdb(encodeJdb({ kind: 'traps', verified: false, roots }))
/** One candidate: PATH with these answers. */
const one = (...answers: JdbNode[]): JdbBase => candidates(chain(PATH, 'trap', answers))

function policy(shares: Record<string, number>): number[] {
  const p = new Array<number>(362).fill(0)
  for (const [m, s] of Object.entries(shares)) p[m === 'pass' ? 361 : vertexToIndex(v(m))] = s
  return p
}

interface Fake {
  /** KataGo's best zone moves in its order, with their leads (Black view). Default: Q13 at 5. */
  top?: [string, number][]
  /** The lead after an answer, by the answer's GTP; 0 when missing. */
  after?: Record<string, number>
  /** The best lead outside the zone (a tenuki answer). */
  outside?: number
  /** Human policy shares by rank. */
  human?: Record<string, Record<string, number>>
  /** An error for the queries it matches, every time. */
  fail?: (q: KataGoQueryBody) => Error | null
}

function fakeEngine(f: Fake): AnalysisEngine & { queries: KataGoQueryBody[] } {
  const queries: KataGoQueryBody[] = []
  const response = (q: KataGoQueryBody, lead: number, infos: [string, number][] = []): AnalysisResponse => ({
    id: 'fake',
    turnNumber: q.moves.length,
    isDuringSearch: false,
    rootInfo: { currentPlayer: 'B', scoreLead: lead, winrate: 0.5, visits: 1 },
    moveInfos: infos.map(([move, scoreLead], order) => ({ move, order, visits: 1, scoreLead, winrate: 0.5, pv: [move] })),
  })
  return {
    queries,
    async analyze(q) {
      queries.push(q)
      const error = f.fail?.(q)
      if (error) throw error
      const rank = q.overrideSettings?.humanSLProfile
      if (typeof rank === 'string') return { ...response(q, 0), humanPolicy: policy(f.human?.[rank.replace('rank_', '')] ?? {}) }
      if (q.allowMoves) return ZONE.has(q.allowMoves[0].moves[0]) ? response(q, 0, f.top ?? [['Q13', 5]]) : response(q, 0, [['D4', f.outside ?? 0]])
      return response(q, f.after?.[q.moves.at(-1)![1]] ?? 0)
    },
  }
}

const run = (base: JdbBase, f: Fake, opts: Partial<CompleteOptions> = {}) => completeCandidates(base, fakeEngine(f), { ...OPTS, ...opts }, () => {})

describe('completeCandidates', () => {
  it('accepts a candidate whose natural move loses enough and lists the ranks that play it', async () => {
    const out = await run(one(answer('Q13', 'good')), {
      after: { Q13: 5, S13: 2 },
      human: { '20k': { S13: 0.3, Q13: 0.4 }, '10k': { S13: 0.2 }, '1k': { Q13: 0.9 } },
    })
    expect(out.rejected).toEqual([])
    expect(out.accepted).toEqual([
      {
        id: ID,
        path: PATH.map(mv),
        answers: [
          { move: v('Q13'), category: 'good', loss: 0, ranks: [] },
          { move: v('S13'), category: 'caught', loss: 3, ranks: ['20k', '10k'] },
        ],
      },
    ])
  })

  it('asks the human policy once per rank, with one visit, before the answer', async () => {
    const engine = fakeEngine({ after: { Q13: 5 } })
    await completeCandidates(one(answer('Q13', 'good')), engine, OPTS, () => {})
    const human = engine.queries.filter((q) => q.overrideSettings?.humanSLProfile !== undefined)
    expect(human.map((q) => q.overrideSettings?.humanSLProfile)).toEqual(['rank_20k', 'rank_10k', 'rank_1k'])
    expect(human.every((q) => q.maxVisits === 1 && q.includePolicy === true && q.moves.length === 4)).toBe(true)
  })

  it('ignores moves below the natural share', async () => {
    const out = await run(one(answer('Q13', 'good')), { after: { Q13: 5, S13: 2 }, human: { '20k': { S13: 0.09 } } })
    expect(out.accepted).toEqual([])
    expect(out.rejected).toEqual([{ id: ID, path: PATH.map(mv), reason: 'no natural losing move' }])
  })

  it('takes a natural move as caught only when it loses caughtGap more than the best good answer', async () => {
    // Best 5; Q13 loses 0.5, so S13 must lose at least 2.5.
    const at = (s13: number) => run(one(answer('Q13', 'good')), { after: { Q13: 4.5, S13: s13 }, human: { '10k': { S13: 0.5 } } })
    expect((await at(2.5)).accepted).toHaveLength(1)
    expect((await at(2.6)).accepted).toHaveLength(0)
  })

  it('never takes a good answer as caught', async () => {
    const out = await run(one(answer('Q13', 'good')), { after: { Q13: 5 }, human: { '10k': { Q13: 0.8 } } })
    expect(out.rejected[0]?.reason).toBe('no natural losing move')
  })

  it('treats a tenuki as one natural move summed over the points outside the zone and pass', async () => {
    const out = await run(one(answer('Q13', 'good')), { after: { Q13: 5 }, outside: 1, human: { '20k': { D4: 0.04, C16: 0.04, pass: 0.03 } } })
    expect(out.accepted[0]?.answers.find((a) => a.category === 'caught')).toEqual({ move: 'tenuki', category: 'caught', loss: 4, ranks: ['20k'] })
  })

  it('finds good answers among the first three zone moves for a candidate without answers', async () => {
    const engine = fakeEngine({
      top: [['Q13', 5], ['S13', 4.6], ['R12', 3], ['Q12', 4.9]],
      after: { Q13: 5, S13: 4.6, R12: 3, Q12: 4.9, S12: 1 },
      human: { '10k': { S12: 0.5 } },
    })
    const out = await completeCandidates(one(), engine, OPTS, () => {})
    expect(out.accepted[0]?.answers).toEqual([
      { move: v('Q13'), category: 'good', loss: 0, ranks: [] },
      { move: v('S13'), category: 'good', loss: 0.4, ranks: [] },
      { move: v('S12'), category: 'caught', loss: 4, ranks: ['10k'] },
    ])
    expect(engine.queries.some((q) => !q.allowMoves && q.moves.at(-1)?.[1] === 'Q12')).toBe(false)
  })

  it('keeps every good answer from the file but needs the best within goodMax', async () => {
    const ok = await run(one(answer('Q13', 'good'), answer('Q12', 'good')), { after: { Q13: 5, Q12: 3, S13: 0 }, human: { '10k': { S13: 0.5 } } })
    expect(ok.accepted[0]?.answers.filter((a) => a.category === 'good').map((a) => a.loss)).toEqual([0, 2])
    const bad = await run(one(answer('Q13', 'good')), { after: { Q13: 3 }, human: { '10k': { S13: 0.5 } } })
    expect(bad.rejected[0]?.reason).toBe('best good answer loses 2 > 1')
  })

  it('rejects a candidate without answers when no KataGo move is within goodMax', async () => {
    const out = await run(one(), { top: [['Q13', 5]], after: { Q13: 3 } })
    expect(out.rejected[0]?.reason).toBe('no good answer within 1')
  })

  it('skips a sequence that leaves the corner without asking KataGo', async () => {
    const engine = fakeEngine({})
    const path = ['K10', 'C16', 'K16']
    const out = await completeCandidates(candidates(chain(path, 'trap', [])), engine, OPTS, () => {})
    expect(out.rejected).toEqual([{ id: trapId(path.map(mv)), path: path.map(mv), reason: 'not a corner sequence' }])
    expect(engine.queries).toEqual([])
  })

  it('rejects an illegal path and an illegal answer', async () => {
    expect((await run(candidates(chain(['Q16', 'Q16'], 'trap', [])), {})).rejected[0]?.reason).toBe('illegal position')
    expect((await run(one(answer('R14', 'good')), {})).rejected[0]?.reason).toBe('illegal answer R14')
  })

  it('leaves a candidate whose query KataGo rejects and goes on to the next one', async () => {
    const base = candidates(chain(['Q16', 'O17', 'R14'], 'none', [chain(['R13'], 'trap', [answer('Q13', 'good')]), chain(['R12'], 'trap', [answer('Q13', 'good')])]))
    const engine = fakeEngine({
      after: { Q13: 5, S13: 2 },
      human: { '10k': { S13: 0.5 } },
      fail: (q) => (q.allowMoves && q.moves.at(-1)?.[1] === 'R13' ? new EngineError('bad query', 'query_error') : null),
    })
    const out = await completeCandidates(base, engine, OPTS, () => {})
    expect(out.rejected).toEqual([{ id: ID, path: PATH.map(mv), reason: 'error: bad query' }])
    expect(out.accepted.map((t) => t.id)).toEqual([trapId(['Q16', 'O17', 'R14', 'R12'].map(mv))])
  })

  it('retries a failed engine once, then gives up on the whole run', async () => {
    let failures = 0
    const flaky = fakeEngine({
      after: { Q13: 5, S13: 2 },
      human: { '10k': { S13: 0.5 } },
      fail: () => (failures++ === 0 ? new EngineError('restarting', 'engine_failed') : null),
    })
    expect((await completeCandidates(one(answer('Q13', 'good')), flaky, OPTS, () => {})).accepted).toHaveLength(1)
    const dead = fakeEngine({ fail: () => new EngineError('gone', 'engine_failed') })
    await expect(completeCandidates(one(answer('Q13', 'good')), dead, OPTS, () => {})).rejects.toThrow('gone')
  })

  it('logs progress', async () => {
    const lines: string[] = []
    await completeCandidates(one(answer('Q13', 'good')), fakeEngine({ after: { Q13: 5, S13: 2 }, human: { '10k': { S13: 0.5 } } }), OPTS, (l) => lines.push(l))
    expect(lines).toEqual([`[1/1] ${ID}: accepted`])
  })
})
