import { indexToVertex, inZone, PASS_INDEX, vertexToGtp, vertexToIndex } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'
import { sameMove, trapId, zoneIndex, type CanonicalMove, type JdbBase } from '../jdb'
import { weakAnswersText, type CheckOptions, type WeakAnswer } from './check'
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
  /** Good answers from the file that the accepted candidates lost: KataGo does not confirm them. */
  weakAnswers: WeakAnswer[]
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
 * A good answer, from the file or from KataGo, loses at most goodMax; the file's weaker ones are dropped and reported.
 * A candidate is accepted when it has a good answer and a caught answer. A query KataGo rejects
 * leaves the candidate as it was; an engine failure that survives one retry rejects the whole run.
 */
export async function completeCandidates(base: JdbBase, engine: AnalysisEngine, opts: CompleteOptions, log: (line: string) => void): Promise<CompleteResult> {
  const ask = makeAsk(engine)

  async function complete(node: number, path: CanonicalMove[]): Promise<{ trap: CompletedTrap; weak: WeakAnswer[] } | string> {
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
    const measured = tried.map((move, i) => ({ move, loss: triedLosses[i] }))
    // The thresholds compare the unrounded losses; the answers keep the rounded ones.
    const good = measured.filter((g) => g.loss <= opts.goodMax)
    if (good.length === 0) {
      return fromFile.length > 0 ? `best good answer loses ${round1(Math.min(...triedLosses))} > ${opts.goodMax}` : `no good answer within ${opts.goodMax}`
    }
    const id = trapId(path)
    const weak = fromFile.length > 0 ? measured.filter((g) => g.loss > opts.goodMax).map((g): WeakAnswer => ({ id, move: g.move, loss: round1(g.loss) })) : []
    const minGood = Math.min(...good.map((g) => g.loss))

    // A dropped good answer is tried again as a natural move: people who play it are caught.
    const tries = (await naturalMoves(ask, spot, opts)).filter((n) => !good.some((g) => sameMove(g.move, n.move)))
    for (const a of fileAnswers) {
      if (a.category === 'caught' && !tries.some((t) => sameMove(t.move, a.move)) && !good.some((g) => sameMove(g.move, a.move))) tries.push({ move: a.move, ranks: [] })
    }
    const caughtLosses = await Promise.all(tries.map((t) => lossOf(t.move)))
    const caught = tries.map((t, i) => ({ ...t, loss: caughtLosses[i] })).filter((c) => c.loss - minGood >= opts.caughtGap)
    if (caught.length === 0) return 'no natural losing move'
    const answers = [
      ...good.map((g): CompletedAnswer => ({ move: g.move, category: 'good', loss: round1(g.loss), ranks: [] })),
      ...caught.map((c): CompletedAnswer => ({ move: c.move, category: 'caught', loss: round1(c.loss), ranks: c.ranks })),
    ]
    return { trap: { id, path, answers }, weak }
  }

  const accepted: CompletedTrap[] = []
  const rejected: CompleteResult['rejected'] = []
  const weakAnswers: WeakAnswer[] = []
  const nodes = base.nodesOf('trap')
  for (const [k, node] of nodes.entries()) {
    const path = base.path(node)
    const id = trapId(path)
    let outcome: { trap: CompletedTrap; weak: WeakAnswer[] } | string
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
      accepted.push(outcome.trap)
      weakAnswers.push(...outcome.weak)
      log(`[${k + 1}/${nodes.length}] ${id}: accepted${outcome.weak.length > 0 ? `, good answers dropped: ${weakAnswersText(outcome.weak)}` : ''}`)
    }
  }
  return { accepted, rejected, weakAnswers }
}
