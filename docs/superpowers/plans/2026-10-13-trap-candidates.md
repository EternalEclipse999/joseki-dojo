# Trap Candidates and the One-Command GPU Run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run traps:gpu` checks the trap base with KataGo, completes the trap candidates (good answers, natural losing moves from the human net at several ranks), writes both files and commits them, so the owner runs one command on a GPU machine and pushes.

**Architecture:** The loss measurement of `traps/check.ts` moves into `traps/measure.ts` (no behaviour change). `traps/complete.ts` completes candidates with it; `traps/tree.ts` adds accepted traps to the base tree and removes them from the candidates tree. `scripts/traps/gpu-steps.ts` holds the testable command logic (options, git checks, commit, the run); `scripts/traps/gpu.ts` wires KataGo and calls it.

**Tech Stack:** TypeScript, Node 24, Vitest, KataGo analysis engine (stubbed in tests), git CLI via `execFileSync`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-13-trap-candidates-design.md`; traps spec: `docs/superpowers/specs/2026-10-12-traps-mode-design.md` (3.3 ids, 4.2 check).
- Command defaults: `--visits 8000`, `--good-max 1`, `--caught-gap 2`, `--ranks 20k,15k,10k,5k,3k,1k`, `--natural 0.1`.
- Human policy query: `maxVisits: 1`, `includePolicy: true`, `overrideSettings: { humanSLProfile: 'rank_<rank>' }`.
- A tenuki is one natural "move": the summed human policy of every legal point outside the top-right 11×11 zone plus pass (values below 0 mark illegal points and are skipped).
- Candidates without good answers try KataGo's first 3 zone moves; those losing at most `--good-max` are good.
- A caught answer loses at least `--caught-gap` more than the best good answer; thresholds compare unrounded losses, nodes store losses rounded to 0.1.
- Rejection reasons (exact): `not a corner sequence`, `illegal position`, `illegal answer <gtp>`, `no legal zone move for the answer`, `the engine returned no zone move`, `no good answer within <good-max>`, `best good answer loses <x> > <good-max>`, `no natural losing move`, or the rejected query's `error: …` text.
- The commit holds only `packages/server/bases/traps.jdb` and `scripts/traps/candidates.jdb`, authored as the author of the last commit; subject `feat(traps): verify the base and complete the candidates with KataGo`; no commit when they did not change.
- `traps:check` behaviour and its tests stay unchanged. No mention of the joseki dictionary anywhere.
- Command output is English (like `traps:check`); comments and identifiers English.

---

### Task 1: Measurement module, candidate completion and tree updates

**Files:**
- Create: `packages/server/src/traps/measure.ts`
- Modify: `packages/server/src/traps/check.ts` (use `measure.ts`; behaviour unchanged)
- Create: `packages/server/src/traps/complete.ts`, `packages/server/src/traps/complete.test.ts`
- Create: `packages/server/src/traps/tree.ts`, `packages/server/src/traps/tree.test.ts`

**Interfaces:**
- Produces: `completeCandidates(base: JdbBase, engine: AnalysisEngine, opts: CompleteOptions, log: (line: string) => void): Promise<CompleteResult>`; `CompleteOptions = CheckOptions & { ranks: string[]; natural: number }`; `CompletedTrap { id: string; path: CanonicalMove[]; answers: CompletedAnswer[] }`; `CompletedAnswer { move: CanonicalMove; category: 'good' | 'caught'; loss: number; ranks: string[] }`; `CompleteResult { accepted: CompletedTrap[]; rejected: { id: string; path: CanonicalMove[]; reason: string }[] }`; `addTraps(tree: JdbTree, traps: readonly CompletedTrap[]): JdbTree`; `removeTraps(tree: JdbTree, ids: ReadonlySet<string>): JdbTree`.

- [ ] **Step 1: Create `packages/server/src/traps/measure.ts`**

```ts
import { colorSign, gtpToVertex, inZone, Position, vertexToGtp, zoneVertices, type Color, type Move, type MoveVertex, type Vertex } from '@joseki-dojo/shared'
import { EngineError, type AnalysisEngine } from '../engine/engine'
import type { AnalysisResponse, KataGoQueryBody } from '../engine/katago-types'
import { baseQuery } from '../engine/query'
import type { CanonicalMove } from '../jdb'

/** A trap or candidate that cannot be judged because KataGo rejected a query (as opposed to an engine that is gone). */
export class DataError extends Error {}

export type Ask = (query: KataGoQueryBody) => Promise<AnalysisResponse>

/** Runs queries: a query KataGo rejects is a DataError, a failed engine is retried once, then its error goes up. */
export function makeAsk(engine: AnalysisEngine): Ask {
  return async (query) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await engine.analyze(query)
      } catch (err) {
        if (!(err instanceof EngineError)) throw err
        if (err.code === 'query_error') throw new DataError(`error: ${err.message}`)
        // A hung query is rejected and the engine restarts: transient, so one more try.
        if (err.code !== 'engine_failed' || attempt >= 1) throw err
      }
    }
  }
}

export const round1 = (x: number): number => Math.round(x * 10) / 10

const vertexOf = (m: CanonicalMove): MoveVertex => (m === 'tenuki' ? 'pass' : m)

/** Moves of a canonical path, Black first; a tenuki is a real pass. */
export function movesOf(path: readonly CanonicalMove[]): Move[] {
  return path.map((m, i) => ({ color: (i % 2 === 0 ? 'B' : 'W') as Color, vertex: vertexOf(m) }))
}

/** The position before an answer: its moves, the side that answers and that side's legal points of the corner zone. */
export interface AnswerSpot {
  moves: Move[]
  position: Position
  answerer: Color
  zone: Vertex[]
}

/** The spot after `path`; null when the path is not a legal sequence of moves. */
export function answerSpot(path: readonly CanonicalMove[]): AnswerSpot | null {
  const moves = movesOf(path)
  const answerer: Color = path.length % 2 === 0 ? 'B' : 'W'
  try {
    const position = Position.fromMoves(moves)
    return { moves, position, answerer, zone: zoneVertices('TR').filter((v) => position.isLegal(answerer, v)) }
  } catch {
    return null
  }
}

/** Black-view lead -> the answerer's view. */
const answererView = (lead: number, spot: AnswerSpot): number => colorSign(spot.answerer) * lead

/** KataGo's best zone moves for the answerer, in its order, with the first one's lead (answerer view); null when it returns none. */
export async function zoneBest(ask: Ask, spot: AnswerSpot, visits: number): Promise<{ lead: number; moves: Vertex[] } | null> {
  const r = await ask({
    ...baseQuery(spot.moves),
    maxVisits: visits,
    allowMoves: [{ player: spot.answerer, moves: spot.zone.map(vertexToGtp), untilDepth: 1 }],
  })
  const infos = [...r.moveInfos].sort((a, b) => a.order - b.order)
  if (infos.length === 0) return null
  const moves = infos.map((m) => gtpToVertex(m.move)).filter((m): m is Vertex => m !== 'pass')
  return { lead: answererView(infos[0].scoreLead, spot), moves }
}

/** The lead (answerer view) after `answer`; a tenuki is the best move outside the zone, not a pass. */
export async function leadAfter(ask: Ask, spot: AnswerSpot, answer: CanonicalMove, visits: number): Promise<number> {
  if (answer !== 'tenuki') {
    const after = await ask({ ...baseQuery([...spot.moves, { color: spot.answerer, vertex: answer }]), maxVisits: visits })
    return answererView(after.rootInfo.scoreLead, spot)
  }
  const outside = spot.position.emptyVertices().filter((v) => !inZone('TR', v) && spot.position.isLegal(spot.answerer, v))
  if (outside.length === 0) {
    const after = await ask({ ...baseQuery([...spot.moves, { color: spot.answerer, vertex: 'pass' }]), maxVisits: visits })
    return answererView(after.rootInfo.scoreLead, spot)
  }
  const r = await ask({
    ...baseQuery(spot.moves),
    maxVisits: visits,
    allowMoves: [{ player: spot.answerer, moves: outside.map(vertexToGtp), untilDepth: 1 }],
  })
  const top = [...r.moveInfos].sort((a, b) => a.order - b.order)[0]
  if (!top) throw new DataError('error: the engine returned no move outside the zone')
  return answererView(top.scoreLead, spot)
}
```

- [ ] **Step 2: Rewrite the top of `packages/server/src/traps/check.ts` to use `measure.ts`**

Replace everything from the first line down to (and including) the end of `async function judge(...)` with the block below. `walkAll`, `walkAnswers`, `walk` and the final lines of `checkTraps` stay exactly as they are.

```ts
import { vertexToGtp } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../engine/engine'
import { trapId, type CanonicalMove, type JdbBase, type JdbNode, type JdbTree } from '../jdb'
import { answerSpot, DataError, leadAfter, makeAsk, round1, zoneBest } from './measure'

export interface CheckOptions {
  /** Visits per query. */
  visits: number
  /** A trap is kept when its best good answer loses at most this many points. */
  goodMax: number
  /** ... and its best caught answer loses at least this many points more than its best good answer. */
  caughtGap: number
}

export interface CheckResult {
  tree: JdbTree
  kept: number
  dropped: { id: string; reason: string }[]
  /** Traps that could not be checked because KataGo rejected a query; they stay as they were. */
  failed: { id: string; reason: string }[]
}

type Verdict = { kind: 'kept'; losses: Map<JdbNode, number> } | { kind: 'dropped'; reason: string }

/**
 * Spec 4.2: verifies every trap of a traps base with the engine, writes the answer losses, drops the traps
 * that fail the thresholds (and the branches left without traps) and marks the base as verified.
 * Illegal data (a path or an answer that is not a legal move) is a permanent fact: the trap, or the answer, is dropped.
 * A query KataGo rejects leaves the trap unchanged and the base not marked as verified.
 * An engine failure that survives one retry rejects the whole run.
 */
export async function checkTraps(base: JdbBase, engine: AnalysisEngine, opts: CheckOptions, log: (line: string) => void): Promise<CheckResult> {
  const dropped: { id: string; reason: string }[] = []
  const failed: { id: string; reason: string }[] = []
  let kept = 0
  const total = base.nodesOf('trap').length
  let done = 0
  const ask = makeAsk(engine)

  async function judge(trap: JdbNode, path: CanonicalMove[]): Promise<Verdict> {
    const spot = answerSpot(path)
    if (!spot) return { kind: 'dropped', reason: 'illegal position' }
    for (const a of trap.children) {
      if (a.move !== 'tenuki' && !spot.position.isLegal(spot.answerer, a.move)) return { kind: 'dropped', reason: `illegal answer ${vertexToGtp(a.move)}` }
    }
    if (spot.zone.length === 0) return { kind: 'dropped', reason: 'no legal zone move for the answer' }
    const best = await zoneBest(ask, spot, opts.visits)
    if (!best) return { kind: 'dropped', reason: 'the engine returned no zone move' }
    const leads = await Promise.all(trap.children.map((a) => leadAfter(ask, spot, a.move, opts.visits)))
    const losses = new Map<JdbNode, number>()
    trap.children.forEach((answer, i) => losses.set(answer, Math.max(0, best.lead - leads[i])))
    const lossesOf = (cat: JdbNode['category']): number[] => trap.children.filter((a) => a.category === cat).map((a) => losses.get(a)!)
    const good = lossesOf('good')
    const caught = lossesOf('caught')
    if (good.length === 0) return { kind: 'dropped', reason: 'no good answer' }
    if (caught.length === 0) return { kind: 'dropped', reason: 'no caught answer' }
    // The thresholds compare the unrounded losses; the nodes keep the rounded ones.
    const minGood = Math.min(...good)
    if (minGood > opts.goodMax) return { kind: 'dropped', reason: `best good answer loses ${round1(minGood)} > ${opts.goodMax}` }
    const gap = Math.min(...caught) - minGood
    if (gap < opts.caughtGap) return { kind: 'dropped', reason: `caught answers are not bad enough: gap ${round1(gap)} < ${opts.caughtGap}` }
    return { kind: 'kept', losses }
  }
```

- [ ] **Step 3: Run the check tests — they must pass unchanged**

Run: `npx vitest run packages/server/src/traps/check.test.ts`
Expected: all tests PASS (no test file is edited).

- [ ] **Step 4: Write `packages/server/src/traps/complete.test.ts`**

```ts
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
```

- [ ] **Step 5: Run it to see it fail**

Run: `npx vitest run packages/server/src/traps/complete.test.ts`
Expected: FAIL — `Cannot find module './complete'` (or equivalent).

- [ ] **Step 6: Create `packages/server/src/traps/complete.ts`**

```ts
import { indexToVertex, inZone, PASS_INDEX, vertexToGtp, vertexToIndex } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'
import { sameMove, trapId, zoneIndex, type CanonicalMove, type JdbBase } from '../jdb'
import type { CheckOptions } from './check'
import { answerSpot, DataError, leadAfter, makeAsk, round1, zoneBest, type Ask, type AnswerSpot } from './measure'

export interface CompleteOptions extends CheckOptions {
  /** Human SL ranks to look for natural moves at, e.g. '20k' or '1k'. */
  ranks: string[]
  /** A move is natural for a rank when that rank's human policy gives it at least this share. */
  natural: number
}

export interface CompletedAnswer {
  move: CanonicalMove
  category: 'good' | 'caught'
  /** Rounded to 0.1. */
  loss: number
  /** The ranks where the move is natural; empty for a good answer and for a caught answer from the file. */
  ranks: string[]
}

export interface CompletedTrap {
  id: string
  path: CanonicalMove[]
  answers: CompletedAnswer[]
}

export interface CompleteResult {
  accepted: CompletedTrap[]
  rejected: { id: string; path: CanonicalMove[]; reason: string }[]
}

/** Up to this many of KataGo's best zone moves are tried as good answers for a candidate that has none. */
const GOOD_TRIES = 3

/** The answerer's natural moves over all ranks, with the ranks that play each; a tenuki sums everything outside the zone and pass. */
async function naturalMoves(ask: Ask, spot: AnswerSpot, opts: CompleteOptions): Promise<{ move: CanonicalMove; ranks: string[] }[]> {
  const policies = await Promise.all(
    opts.ranks.map((rank) =>
      ask({ ...baseQuery(spot.moves), maxVisits: 1, includePolicy: true, overrideSettings: { humanSLProfile: `rank_${rank}` } }),
    ),
  )
  const out: { move: CanonicalMove; ranks: string[] }[] = []
  const add = (move: CanonicalMove, rank: string): void => {
    const known = out.find((n) => sameMove(n.move, move))
    if (known) known.ranks.push(rank)
    else out.push({ move, ranks: [rank] })
  }
  opts.ranks.forEach((rank, k) => {
    const p = policies[k].humanPolicy
    if (!p) throw new DataError('error: KataGo returned no human policy')
    for (const v of spot.zone) if (p[vertexToIndex(v)] >= opts.natural) add(v, rank)
    let outside = 0
    for (let i = 0; i <= PASS_INDEX; i++) {
      if (p[i] > 0 && (i === PASS_INDEX || !inZone('TR', indexToVertex(i)))) outside += p[i]
    }
    if (outside >= opts.natural) add('tenuki', rank)
  })
  return out
}

/**
 * Spec 4: completes the candidates of a candidates base. KataGo supplies good answers to a candidate that has none,
 * the human net at each rank supplies natural moves, and a natural move that loses enough is a caught answer.
 * A candidate is accepted when it has a good answer within goodMax and a caught answer. A query KataGo rejects
 * leaves the candidate as it was; an engine failure that survives one retry rejects the whole run.
 */
export async function completeCandidates(base: JdbBase, engine: AnalysisEngine, opts: CompleteOptions, log: (line: string) => void): Promise<CompleteResult> {
  const ask = makeAsk(engine)

  async function complete(node: number, path: CanonicalMove[]): Promise<CompletedTrap | string> {
    if (path.some((m) => m === 'tenuki' || zoneIndex(m) === null)) return 'not a corner sequence'
    const spot = answerSpot(path)
    if (!spot) return 'illegal position'
    const fileAnswers = base.children(node).map((c) => ({ move: base.move(c), category: base.category(c) }))
    for (const a of fileAnswers) {
      if (a.move !== 'tenuki' && !spot.position.isLegal(spot.answerer, a.move)) return `illegal answer ${vertexToGtp(a.move)}`
    }
    if (spot.zone.length === 0) return 'no legal zone move for the answer'
    const best = await zoneBest(ask, spot, opts.visits)
    if (!best) return 'the engine returned no zone move'
    const lossOf = async (m: CanonicalMove): Promise<number> => Math.max(0, best.lead - (await leadAfter(ask, spot, m, opts.visits)))

    const fromFile = fileAnswers.filter((a) => a.category === 'good').map((a) => a.move)
    const tried = fromFile.length > 0 ? fromFile : best.moves.slice(0, GOOD_TRIES)
    const triedLosses = await Promise.all(tried.map(lossOf))
    let good = tried.map((move, i) => ({ move, loss: triedLosses[i] }))
    // KataGo's own moves are good answers only within the threshold; the file's answers all stay, as in traps:check.
    if (fromFile.length === 0) good = good.filter((g) => g.loss <= opts.goodMax)
    if (good.length === 0) return `no good answer within ${opts.goodMax}`
    // The thresholds compare the unrounded losses; the answers keep the rounded ones.
    const minGood = Math.min(...good.map((g) => g.loss))
    if (minGood > opts.goodMax) return `best good answer loses ${round1(minGood)} > ${opts.goodMax}`

    const tries = (await naturalMoves(ask, spot, opts)).filter((n) => !good.some((g) => sameMove(g.move, n.move)))
    for (const a of fileAnswers) {
      if (a.category === 'caught' && !tries.some((t) => sameMove(t.move, a.move))) tries.push({ move: a.move, ranks: [] })
    }
    const caughtLosses = await Promise.all(tries.map((t) => lossOf(t.move)))
    const caught = tries.map((t, i) => ({ ...t, loss: caughtLosses[i] })).filter((c) => c.loss - minGood >= opts.caughtGap)
    if (caught.length === 0) return 'no natural losing move'
    return {
      id: trapId(path),
      path,
      answers: [
        ...good.map((g): CompletedAnswer => ({ move: g.move, category: 'good', loss: round1(g.loss), ranks: [] })),
        ...caught.map((c): CompletedAnswer => ({ move: c.move, category: 'caught', loss: round1(c.loss), ranks: c.ranks })),
      ],
    }
  }

  const accepted: CompletedTrap[] = []
  const rejected: CompleteResult['rejected'] = []
  const nodes = base.nodesOf('trap')
  for (const [k, node] of nodes.entries()) {
    const path = base.path(node)
    const id = trapId(path)
    let outcome: CompletedTrap | string
    try {
      outcome = await complete(node, path)
    } catch (err) {
      if (!(err instanceof DataError)) throw err
      outcome = err.message
    }
    if (typeof outcome === 'string') {
      rejected.push({ id, path, reason: outcome })
      log(`[${k + 1}/${nodes.length}] ${id}: not accepted, ${outcome}`)
    } else {
      accepted.push(outcome)
      log(`[${k + 1}/${nodes.length}] ${id}: accepted`)
    }
  }
  return { accepted, rejected }
}
```

- [ ] **Step 7: Run the completion tests**

Run: `npx vitest run packages/server/src/traps/complete.test.ts`
Expected: all PASS.

- [ ] **Step 8: Write `packages/server/src/traps/tree.test.ts`**

```ts
import { gtpToVertex, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { decodeJdb, encodeJdb, moveText, trapId, type CanonicalMove, type JdbNode, type JdbTree } from '../jdb'
import { TrapBook } from './book'
import type { CompletedTrap } from './complete'
import { addTraps, removeTraps } from './tree'

const mv = (gtp: string): CanonicalMove => (gtp === 'tenuki' ? 'tenuki' : (gtpToVertex(gtp) as Vertex))
const n = (gtp: string, category: JdbNode['category'], children: JdbNode[] = [], loss: number | null = null): JdbNode => ({ move: mv(gtp), category, loss, children })
const id = (path: string): string => trapId(path.split(' ').map(mv))

/** Q16 O17 O18 is a trap: P17 good (loss 0), N18 caught (loss 4). */
const base = (): JdbTree => ({
  kind: 'traps',
  verified: true,
  roots: [n('Q16', 'none', [n('O17', 'none', [n('O18', 'trap', [n('P17', 'good', [], 0), n('N18', 'caught', [], 4)])])])],
})

function trap(path: string, answers: [string, 'good' | 'caught', number, string[]?][]): CompletedTrap {
  return {
    id: id(path),
    path: path.split(' ').map(mv),
    answers: answers.map(([m, category, loss, ranks]) => ({ move: mv(m), category, loss, ranks: ranks ?? [] })),
  }
}

/** A node of `tree` by its path: category, loss and its children as "move:category:loss". */
function at(tree: JdbTree, path: string): { category: string; loss: number | null; children: string[] } | null {
  const b = decodeJdb(encodeJdb(tree))
  const i = b.find(path.split(' ').map(mv))
  if (i === null) return null
  return { category: b.category(i), loss: b.loss(i), children: b.children(i).map((c) => `${moveText(b.move(c))}:${b.category(c)}:${b.loss(c)}`) }
}

describe('addTraps', () => {
  it('adds a trap on a new path with plain path nodes and leaves the input alone', () => {
    const tree = base()
    const out = addTraps(tree, [trap('Q16 O17 R14 R13', [['Q13', 'good', 0], ['S13', 'caught', 3, ['10k']]])])
    expect(at(out, 'Q16 O17 R14 R13')).toEqual({ category: 'trap', loss: null, children: ['Q13:good:0', 'S13:caught:3'] })
    expect(at(out, 'Q16 O17 R14')?.category).toBe('none')
    expect(tree.roots[0].children[0].children).toHaveLength(1)
    expect(out.verified).toBe(true)
  })

  it('keeps the marks of the nodes on the way', () => {
    const out = addTraps(base(), [trap('Q16 O17 O18 P17 Q18', [['R17', 'good', 0], ['R18', 'caught', 3]])])
    expect(at(out, 'Q16 O17 O18')?.category).toBe('trap')
    expect(at(out, 'Q16 O17 O18 P17')).toMatchObject({ category: 'good', loss: 0 })
    expect(at(out, 'Q16 O17 O18 P17 Q18')).toEqual({ category: 'trap', loss: null, children: ['R17:good:0', 'R18:caught:3'] })
  })

  it('turns an existing answer into the trap and keeps its loss', () => {
    const out = addTraps(base(), [trap('Q16 O17 O18 N18', [['M18', 'good', 0], ['M17', 'caught', 2.5]])])
    expect(at(out, 'Q16 O17 O18 N18')).toEqual({ category: 'trap', loss: 4, children: ['M18:good:0', 'M17:caught:2.5'] })
  })

  it('gives the book a playable trap', () => {
    const out = addTraps(base(), [trap('Q16 O17 R14 R13', [['Q13', 'good', 0], ['S13', 'caught', 3]])])
    const book = TrapBook.fromBase(decodeJdb(encodeJdb(out)))
    expect(book.ids().sort()).toEqual([id('Q16 O17 O18'), id('Q16 O17 R14 R13')].sort())
    expect(book.skipped).toEqual([])
  })
})

describe('removeTraps', () => {
  /** Two candidates under R14; R13's good answer Q13 leads to a nested candidate Q12. */
  const candidates = (): JdbTree => ({
    kind: 'traps',
    verified: false,
    roots: [
      n('Q16', 'none', [
        n('O17', 'none', [
          n('R14', 'none', [
            n('R13', 'trap', [n('Q13', 'good', [n('Q12', 'trap', [n('P12', 'good')])]), n('S13', 'good')]),
            n('R12', 'trap', [n('Q13', 'good')]),
          ]),
        ]),
      ]),
    ],
  })

  it('turns a removed trap and its answers into plain nodes and prunes what leads to no trap', () => {
    const out = removeTraps(candidates(), new Set([id('Q16 O17 R14 R13'), id('Q16 O17 R14 R12')]))
    expect(at(out, 'Q16 O17 R14')?.children).toEqual(['R13:none:null'])
    expect(at(out, 'Q16 O17 R14 R13')).toEqual({ category: 'none', loss: null, children: ['Q13:none:null'] })
    expect(at(out, 'Q16 O17 R14 R13 Q13 Q12')).toEqual({ category: 'trap', loss: null, children: ['P12:good:null'] })
  })

  it('removes the whole tree when no trap is left', () => {
    const out = removeTraps(candidates(), new Set([id('Q16 O17 R14 R13'), id('Q16 O17 R14 R12'), id('Q16 O17 R14 R13 Q13 Q12')]))
    expect(out.roots).toEqual([])
  })

  it('keeps the tree as it is when nothing is removed', () => {
    expect(removeTraps(candidates(), new Set())).toEqual(candidates())
  })
})
```

- [ ] **Step 9: Run it to see it fail**

Run: `npx vitest run packages/server/src/traps/tree.test.ts`
Expected: FAIL — `Cannot find module './tree'`.

- [ ] **Step 10: Create `packages/server/src/traps/tree.ts`**

```ts
import { sameMove, trapId, type CanonicalMove, type JdbNode, type JdbTree } from '../jdb'
import type { CompletedTrap } from './complete'

const copy = (n: JdbNode): JdbNode => ({ ...n, children: n.children.map(copy) })

function childOf(level: JdbNode[], move: CanonicalMove): JdbNode {
  let child = level.find((c) => sameMove(c.move, move))
  if (!child) {
    child = { move, category: 'none', loss: null, children: [] }
    level.push(child)
  }
  return child
}

/**
 * Spec 4.4: a copy of `tree` with the traps added. Missing path nodes come in as plain nodes and the nodes on the way
 * keep their marks. The trap's node becomes a trap (an answer of another trap keeps its loss); its answers get their
 * category and loss unless the node already carries a mark.
 */
export function addTraps(tree: JdbTree, traps: readonly CompletedTrap[]): JdbTree {
  const roots = tree.roots.map(copy)
  for (const t of traps) {
    let level = roots
    let node: JdbNode | null = null
    for (const m of t.path) {
      node = childOf(level, m)
      level = node.children
    }
    if (!node) continue
    node.category = 'trap'
    for (const a of t.answers) {
      const child = childOf(node.children, a.move)
      if (child.category === 'none') {
        child.category = a.category
        child.loss = a.loss
      }
    }
  }
  return { ...tree, roots }
}

/** A copy of `tree` without the traps whose ids are given: each becomes a plain node with plain answers, and branches left without a mark go. */
export function removeTraps(tree: JdbTree, ids: ReadonlySet<string>): JdbTree {
  const walk = (n: JdbNode, parent: CanonicalMove[], underRemoved: boolean): JdbNode | null => {
    const path = [...parent, n.move]
    const removed = n.category === 'trap' && ids.has(trapId(path))
    const plain = removed || (underRemoved && (n.category === 'good' || n.category === 'caught'))
    const children = n.children.map((c) => walk(c, path, removed)).filter((c): c is JdbNode => c !== null)
    const out: JdbNode = plain ? { ...n, category: 'none', loss: null, children } : { ...n, children }
    return out.category !== 'none' || children.length > 0 ? out : null
  }
  return { ...tree, roots: tree.roots.map((r) => walk(r, [], false)).filter((r): r is JdbNode => r !== null) }
}
```

- [ ] **Step 11: Run the trap tests and the type check**

Run: `npx vitest run packages/server/src/traps && npm run typecheck`
Expected: all PASS; typecheck prints no errors.

- [ ] **Step 12: Commit**

```bash
git add packages/server/src/traps/measure.ts packages/server/src/traps/check.ts packages/server/src/traps/complete.ts packages/server/src/traps/complete.test.ts packages/server/src/traps/tree.ts packages/server/src/traps/tree.test.ts
git commit -m "feat(traps): complete the trap candidates with KataGo and the human net" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `traps:gpu` command

**Files:**
- Create: `scripts/traps/gpu-steps.ts`, `scripts/traps/gpu-steps.test.ts`, `scripts/traps/gpu.ts`
- Modify: `package.json` (script `traps:gpu`), `README.md` (a paragraph after the `traps:check` paragraph)

**Interfaces:**
- Consumes (Task 1): `completeCandidates`, `CompleteOptions`, `CompleteResult`, `CompletedTrap` from `packages/server/src/traps/complete`; `addTraps`, `removeTraps` from `packages/server/src/traps/tree`; `checkTraps`, `CheckResult` from `packages/server/src/traps/check`.
- Produces: `TRAPS_FILE`, `CANDIDATES_FILE`, `parseGpuOptions(args: string[]): CompleteOptions`, `gitProblem(root: string): string | null`, `commitBases(root: string, subject: string, body: string): boolean`, `runGpu(run: GpuRun): Promise<{ committed: boolean }>`.

- [ ] **Step 1: Write `scripts/traps/gpu-steps.test.ts`**

```ts
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gtpToVertex, vertexToIndex, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { EngineError } from '../../packages/server/src/engine/engine'
import { decodeJdb, encodeJdb, type CanonicalMove, type JdbNode, type JdbTree } from '../../packages/server/src/jdb'
import { testTrapsTree } from '../../packages/server/src/traps/fixture'
import { StubEngine } from '../../packages/server/test/helpers'
import { CANDIDATES_FILE, commitBases, gitProblem, parseGpuOptions, runGpu, TRAPS_FILE } from './gpu-steps'

const AUTHOR = { name: 'Base Author', email: '1+author@users.noreply.github.com' }
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const mv = (gtp: string): CanonicalMove => gtpToVertex(gtp) as Vertex
const n = (gtp: string, category: JdbNode['category'], children: JdbNode[] = []): JdbNode => ({ move: mv(gtp), category, loss: null, children })
/** One candidate: Q16 O17 R14 R13 (Black answers) with the good answer Q13. */
const CANDIDATES: JdbTree = {
  kind: 'traps',
  verified: false,
  roots: [n('Q16', 'none', [n('O17', 'none', [n('R14', 'none', [n('R13', 'trap', [n('Q13', 'good')])])])])],
}

/** A repository on branch feat/x with both base files and other.txt committed by AUTHOR. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'joseki-gpu-'))
  git(root, 'init', '-q')
  git(root, 'checkout', '-q', '-b', 'feat/x')
  const write = (file: string, tree: JdbTree): void => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), encodeJdb(tree))
  }
  write(TRAPS_FILE, { ...testTrapsTree(), verified: false })
  write(CANDIDATES_FILE, CANDIDATES)
  writeFileSync(join(root, 'other.txt'), 'x')
  git(root, 'add', '-A')
  git(root, '-c', `user.name=${AUTHOR.name}`, '-c', `user.email=${AUTHOR.email}`, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init')
  return root
}

describe('parseGpuOptions', () => {
  it('has the spec defaults', () => {
    expect(parseGpuOptions([])).toEqual({ visits: 8000, goodMax: 1, caughtGap: 2, ranks: ['20k', '15k', '10k', '5k', '3k', '1k'], natural: 0.1 })
  })

  it('reads every option', () => {
    const args = ['--visits', '5000', '--good-max', '0.5', '--caught-gap', '3', '--ranks', '15k, 5k,1d', '--natural', '0.2']
    expect(parseGpuOptions(args)).toEqual({ visits: 5000, goodMax: 0.5, caughtGap: 3, ranks: ['15k', '5k', '1d'], natural: 0.2 })
  })

  it.each([
    [['--visits', '0'], /--visits needs an integer of at least 1/],
    [['--visits', '1.5'], /--visits needs an integer of at least 1/],
    [['--good-max', '-1'], /--good-max needs a non-negative number/],
    [['--caught-gap', 'x'], /--caught-gap needs a number/],
    [['--natural', '0'], /--natural needs a number above 0 and at most 1/],
    [['--natural', '1.5'], /--natural needs a number above 0 and at most 1/],
    [['--ranks', '25k'], /unknown rank "25k"/],
    [['--ranks', ''], /--ranks needs a value/],
    [['--visits'], /--visits needs a value/],
    [['--fast', '1'], /Unknown option --fast/],
  ])('rejects %j', (args, error) => {
    expect(() => parseGpuOptions(args)).toThrow(error)
  })
})

describe('gitProblem', () => {
  it('accepts a clean pull request branch, even with other changes in the tree', () => {
    const root = repo()
    writeFileSync(join(root, 'other.txt'), 'changed')
    expect(gitProblem(root)).toBeNull()
  })

  it('refuses main', () => {
    const root = repo()
    git(root, 'checkout', '-q', '-b', 'main')
    expect(gitProblem(root)).toMatch(/on main/)
  })

  it('refuses a detached HEAD and a folder outside git', () => {
    const root = repo()
    git(root, 'checkout', '-q', '--detach')
    expect(gitProblem(root)).toMatch(/Not on a branch/)
    expect(gitProblem(mkdtempSync(join(tmpdir(), 'joseki-nogit-')))).toMatch(/Not on a branch/)
  })

  it('refuses uncommitted changes in a base file', () => {
    const root = repo()
    writeFileSync(join(root, CANDIDATES_FILE), 'x')
    expect(gitProblem(root)).toMatch(/Uncommitted changes in the base files/)
  })
})

describe('commitBases', () => {
  it('commits only the two base files, as the author of the last commit', () => {
    const root = repo()
    writeFileSync(join(root, TRAPS_FILE), encodeJdb({ kind: 'traps', verified: true, roots: [] }))
    writeFileSync(join(root, 'other.txt'), 'changed')
    git(root, 'add', 'other.txt')
    expect(commitBases(root, 'subject', 'body line')).toBe(true)
    expect(git(root, 'log', '-1', '--format=%an <%ae>|%s|%b')).toBe(`${AUTHOR.name} <${AUTHOR.email}>|subject|body line`)
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe(TRAPS_FILE)
    expect(git(root, 'status', '--porcelain')).toBe('M  other.txt')
  })

  it('does not commit when the base files did not change', () => {
    const root = repo()
    const head = git(root, 'rev-parse', 'HEAD')
    expect(commitBases(root, 'subject', 'body')).toBe(false)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })
})

describe('runGpu', () => {
  const opts = parseGpuOptions(['--visits', '10'])
  const ENGINE_INFO = 'KataGo 1.18.1; networks: main.bin.gz, human.bin.gz'

  it('moves an accepted candidate into the base and commits both files', async () => {
    const root = repo()
    const engine = new StubEngine()
    const s13 = vertexToIndex(mv('S13') as Vertex)
    engine.human = () => Array.from({ length: 362 }, (_, i) => (i === s13 ? 0.5 : 0))
    const after: Record<string, number> = { Q13: 5, S13: 2 }
    engine.lead = (q) => (q.allowMoves ? 5 : (after[q.moves.at(-1)?.[1] ?? ''] ?? 0))
    const lines: string[] = []
    const out = await runGpu({ root, engine, opts, engineInfo: ENGINE_INFO, log: (l) => lines.push(l) })
    expect(out.committed).toBe(true)
    const traps = decodeJdb(readFileSync(join(root, TRAPS_FILE)))
    const node = traps.find(['Q16', 'O17', 'R14', 'R13'].map(mv))
    expect(node === null ? null : traps.category(node)).toBe('trap')
    expect(decodeJdb(readFileSync(join(root, CANDIDATES_FILE))).size).toBe(0)
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([CANDIDATES_FILE, TRAPS_FILE].sort())
    const message = git(root, 'log', '-1', '--format=%B')
    expect(message).toMatch(/^feat\(traps\): verify the base and complete the candidates with KataGo/)
    expect(message).toContain('Candidates: accepted 1, not accepted 0')
    expect(message).toContain(ENGINE_INFO)
    expect(message).toContain('Options: visits 10, good-max 1, caught-gap 2, ranks 20k,15k,10k,5k,3k,1k, natural 0.1')
    expect(lines.at(-1)).toBe('Committed. Next: git push')
  })

  it('writes and commits nothing when the engine fails', async () => {
    const root = repo()
    const head = git(root, 'rev-parse', 'HEAD')
    const before = readFileSync(join(root, TRAPS_FILE))
    const engine = {
      analyze: async (): Promise<never> => {
        throw new EngineError('gone', 'engine_failed')
      },
    }
    await expect(runGpu({ root, engine, opts, engineInfo: ENGINE_INFO, log: () => {} })).rejects.toThrow('gone')
    expect(readFileSync(join(root, TRAPS_FILE))).toEqual(before)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run scripts/traps/gpu-steps.test.ts`
Expected: FAIL — `Cannot find module './gpu-steps'`.

- [ ] **Step 3: Create `scripts/traps/gpu-steps.ts`**

```ts
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AnalysisEngine } from '../../packages/server/src/engine/engine'
import { renameRetrying } from '../../packages/server/src/install/download'
import { decodeJdb, encodeJdb, moveText } from '../../packages/server/src/jdb'
import { checkTraps, type CheckResult } from '../../packages/server/src/traps/check'
import { completeCandidates, type CompletedTrap, type CompleteOptions, type CompleteResult } from '../../packages/server/src/traps/complete'
import { addTraps, removeTraps } from '../../packages/server/src/traps/tree'

export const TRAPS_FILE = 'packages/server/bases/traps.jdb'
export const CANDIDATES_FILE = 'scripts/traps/candidates.jdb'
const SUBJECT = 'feat(traps): verify the base and complete the candidates with KataGo'
const USAGE = 'Usage: npm run traps:gpu -- [--visits N] [--good-max X] [--caught-gap X] [--ranks 20k,15k,10k,5k,3k,1k] [--natural X]'
const DEFAULTS: CompleteOptions = { visits: 8000, goodMax: 1, caughtGap: 2, ranks: ['20k', '15k', '10k', '5k', '3k', '1k'], natural: 0.1 }
const FLAGS = new Set(['--visits', '--good-max', '--caught-gap', '--ranks', '--natural'])
/** Human SL profiles: rank_20k … rank_1k, rank_1d … rank_9d. */
const RANK = /^(?:[1-9]|1\d|20)k$|^[1-9]d$/

function numberOf(flag: string, value: string): number {
  const x = Number(value)
  if (!Number.isFinite(x)) throw new Error(`${flag} needs a number`)
  return x
}

/** Spec 3: reads `--name value` pairs over the defaults; an unknown flag, a missing value or a bad value is an error. */
export function parseGpuOptions(args: string[]): CompleteOptions {
  const opts: CompleteOptions = { ...DEFAULTS, ranks: [...DEFAULTS.ranks] }
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    if (!FLAGS.has(flag)) throw new Error(`Unknown option ${flag}. ${USAGE}`)
    const value = args[i + 1]
    if (value === undefined || value.trim() === '') throw new Error(`${flag} needs a value. ${USAGE}`)
    if (flag === '--ranks') {
      const ranks = value.split(',').map((r) => r.trim())
      const bad = ranks.find((r) => !RANK.test(r))
      if (bad !== undefined) throw new Error(`--ranks: unknown rank "${bad}" (use 20k … 1k or 1d … 9d)`)
      opts.ranks = ranks
      continue
    }
    const x = numberOf(flag, value)
    if (flag === '--visits') {
      if (!Number.isInteger(x) || x < 1) throw new Error('--visits needs an integer of at least 1')
      opts.visits = x
    } else if (flag === '--natural') {
      if (x <= 0 || x > 1) throw new Error('--natural needs a number above 0 and at most 1')
      opts.natural = x
    } else {
      if (x < 0) throw new Error(`${flag} needs a non-negative number`)
      if (flag === '--good-max') opts.goodMax = x
      else opts.caughtGap = x
    }
  }
  return opts
}

const git = (root: string, args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const baseChanges = (root: string): string => git(root, ['status', '--porcelain', '--', TRAPS_FILE, CANDIDATES_FILE])

/** Spec 3, step 1: why the run could not commit its result here, or null. */
export function gitProblem(root: string): string | null {
  let branch: string
  try {
    branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])
  } catch {
    return 'Not on a branch (a detached HEAD or not a git repository): check out the pull request branch first'
  }
  if (branch === 'main') return 'You are on main: check out the pull request branch first'
  const changed = baseChanges(root)
  if (changed !== '') return `Uncommitted changes in the base files:\n${changed}\nCommit or restore them first`
  return null
}

/** Spec 3, step 5: commits only the two base files, as the author of the last commit; false when they did not change. */
export function commitBases(root: string, subject: string, body: string): boolean {
  if (baseChanges(root) === '') return false
  const [name, email] = git(root, ['log', '-1', '--format=%an%n%ae']).split('\n')
  git(root, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', subject, '-m', body, '--', TRAPS_FILE, CANDIDATES_FILE])
  return true
}

async function writeAtomically(file: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, bytes)
  await renameRetrying(tmp, file)
}

function answersOf(t: CompletedTrap, category: 'good' | 'caught'): string {
  return t.answers
    .filter((a) => a.category === category)
    .map((a) => `${moveText(a.move)} ${a.loss}${a.ranks.length > 0 ? ` (${a.ranks.join(' ')})` : ''}`)
    .join(', ')
}

/** Spec 5: the report, also the body of the commit. */
function summaryLines(checked: CheckResult, completed: CompleteResult): string[] {
  return [
    `Base: kept ${checked.kept}, dropped ${checked.dropped.length}, left unchecked ${checked.failed.length}; verified: ${checked.tree.verified ? 'yes' : 'no'}`,
    ...checked.dropped.map((d) => `  dropped ${d.id}: ${d.reason}`),
    ...checked.failed.map((f) => `  unchecked ${f.id}: ${f.reason}`),
    `Candidates: accepted ${completed.accepted.length}, not accepted ${completed.rejected.length}`,
    ...completed.accepted.map((t) => `  accepted ${t.id} ${t.path.map(moveText).join(' ')} | good: ${answersOf(t, 'good')} | caught: ${answersOf(t, 'caught')}`),
    ...completed.rejected.map((r) => `  not accepted ${r.id}: ${r.reason}`),
  ]
}

export interface GpuRun {
  root: string
  engine: AnalysisEngine
  opts: CompleteOptions
  /** KataGo version and network names, for the log and the commit. */
  engineInfo: string
  log: (line: string) => void
}

/** Spec 3, steps 2–6: checks the base, completes the candidates, writes both files and commits them. An engine failure writes nothing. */
export async function runGpu({ root, engine, opts, engineInfo, log }: GpuRun): Promise<{ committed: boolean }> {
  const trapsFile = join(root, TRAPS_FILE)
  const candidatesFile = join(root, CANDIDATES_FILE)
  const traps = decodeJdb(readFileSync(trapsFile))
  const candidates = decodeJdb(readFileSync(candidatesFile))
  if (traps.kind !== 'traps' || candidates.kind !== 'traps') throw new Error(`${TRAPS_FILE} and ${CANDIDATES_FILE} must both be traps bases`)

  log(`Checking ${traps.nodesOf('trap').length} traps of the base with ${opts.visits} visits (good-max ${opts.goodMax}, caught-gap ${opts.caughtGap})`)
  const checked = await checkTraps(traps, engine, opts, log)
  log(`Completing ${candidates.nodesOf('trap').length} candidates (ranks ${opts.ranks.join(' ')}, natural ${opts.natural})`)
  const completed = await completeCandidates(candidates, engine, opts, log)

  await writeAtomically(trapsFile, encodeJdb(addTraps(checked.tree, completed.accepted)))
  await writeAtomically(candidatesFile, encodeJdb(removeTraps(candidates.toTree(), new Set(completed.accepted.map((t) => t.id)))))

  const summary = summaryLines(checked, completed)
  log('')
  for (const line of summary) log(line)
  const options = `Options: visits ${opts.visits}, good-max ${opts.goodMax}, caught-gap ${opts.caughtGap}, ranks ${opts.ranks.join(',')}, natural ${opts.natural}`
  const committed = commitBases(root, SUBJECT, [...summary, '', engineInfo, options].join('\n'))
  log('')
  log(committed ? 'Committed. Next: git push' : 'The base files did not change: nothing to commit.')
  return { committed }
}
```

- [ ] **Step 4: Run the command tests**

Run: `npx vitest run scripts/traps/gpu-steps.test.ts`
Expected: all PASS.

- [ ] **Step 5: Create `scripts/traps/gpu.ts`**

```ts
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../../packages/server/src/config'
import { engineCommand } from '../../packages/server/src/engine/command'
import { KataGoEngine } from '../../packages/server/src/engine/engine'
import { checkEngine } from '../../packages/server/src/engine/health'
import { gitProblem, parseGpuOptions, runGpu } from './gpu-steps'

const root = fileURLToPath(new URL('../../', import.meta.url))
const log = (line: string): void => console.log(line)

/** Spec 3: `npm run traps:gpu` — the checks first, then the run with the owner's KataGo. */
async function main(): Promise<void> {
  const opts = parseGpuOptions(process.argv.slice(2))
  const problem = gitProblem(root)
  if (problem) throw new Error(problem)
  const configFile = join(root, 'config.local.json')
  if (!existsSync(configFile)) throw new Error(`No ${configFile}: run npm run setup first`)
  const config = loadConfig(configFile)
  const engine = new KataGoEngine(engineCommand(config), (line) => log(`  [katago] ${line}`))
  try {
    const health = await checkEngine(config, engine)
    if (health.state !== 'ready') throw new Error(`KataGo is not ready: ${health.reason}`)
    const engineInfo = `KataGo ${await engine.version()}; networks: ${basename(config.katago.mainModel)}, ${basename(config.katago.humanModel)}`
    log(engineInfo)
    await runGpu({ root, engine, opts, engineInfo, log })
  } finally {
    await engine.stop()
  }
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
```

- [ ] **Step 6: Add the npm script**

In the root `package.json` `scripts`, right after `"traps:check": "tsx scripts/traps/check.ts",` add:

```json
    "traps:gpu": "tsx scripts/traps/gpu.ts",
```

- [ ] **Step 7: Document the command in `README.md`**

Insert this paragraph right after the paragraph that starts with `For each trap the tool searches the position before the answer` (the `traps:check` description):

````markdown
The trap candidates (`scripts/traps/candidates.jdb`) are tricks whose answers are incomplete. One command on a machine with a strong GPU checks the base, completes the candidates and commits both files:

```
npm run traps:gpu -- --visits 8000
```

It refuses to start on `main`, on a detached HEAD or with uncommitted changes in the two base files, and checks that KataGo answers with the human net before any work. A candidate without good answers tries KataGo's three best zone moves. The human net then names the natural moves at each rank of `--ranks` (default `20k,15k,10k,5k,3k,1k`; a move is natural from `--natural 0.1` of the policy, a tenuki sums everything outside the zone), and a natural move that loses at least `--caught-gap` more than the best good answer becomes a caught answer. Accepted candidates move into `traps.jdb`; the rest stay in the candidates file. The commit holds only the two files, is authored as the last commit of the branch, and carries the report; push it afterwards.
````

- [ ] **Step 8: Run all tests and the type check**

Run: `npm test && npm run typecheck`
Expected: all tests PASS; typecheck prints no errors.

- [ ] **Step 9: Commit**

```bash
git add scripts/traps/gpu-steps.ts scripts/traps/gpu-steps.test.ts scripts/traps/gpu.ts package.json README.md
git commit -m "feat(traps): one command for the GPU run: check, complete the candidates, commit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
