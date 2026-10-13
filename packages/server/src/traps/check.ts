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

  /** The nodes that still lead to a trap, each checked in turn. */
  async function walkAll(nodes: JdbNode[], path: CanonicalMove[]): Promise<JdbNode[]> {
    const out: JdbNode[] = []
    for (const c of nodes) {
      const r = await walk(c, path)
      if (r) out.push(r)
    }
    return out
  }

  /**
   * The answers of a trap with `mark` applied; traps nested below an answer are checked on their own.
   * An answer that is itself a trap is judged as a trap too (it keeps its mark, the outer trap's loss, and stays a trap candidate).
   */
  async function walkAnswers(trap: JdbNode, path: CanonicalMove[], mark: (a: JdbNode) => JdbNode): Promise<JdbNode[]> {
    const out: JdbNode[] = []
    for (const a of trap.children) {
      if (a.category === 'trap') {
        const r = await walk({ ...mark(a), category: 'trap' }, path)
        if (r) out.push(r)
      } else {
        out.push({ ...mark(a), children: await walkAll(a.children, [...path, a.move]) })
      }
    }
    return out
  }

  async function walk(node: JdbNode, parent: CanonicalMove[]): Promise<JdbNode | null> {
    const path = [...parent, node.move]
    if (node.category !== 'trap') {
      const children = await walkAll(node.children, path)
      return children.length > 0 ? { ...node, children } : null
    }
    const id = trapId(path)
    let verdict: Verdict | null = null
    let failure = ''
    try {
      verdict = await judge(node, path)
    } catch (err) {
      if (!(err instanceof DataError)) throw err
      failure = err.message
    }
    done++
    if (verdict?.kind === 'kept') {
      kept++
      log(`[${done}/${total}] ${id}: kept`)
      const losses = verdict.losses
      return { ...node, children: await walkAnswers(node, path, (a) => ({ ...a, loss: round1(losses.get(a)!) })) }
    }
    if (verdict?.kind === 'dropped') {
      dropped.push({ id, reason: verdict.reason })
      log(`[${done}/${total}] ${id}: dropped, ${verdict.reason}`)
      // The node stops being a trap, but traps nested below its answers stay: keep the way to them, without the answer marks.
      const answers = (await walkAnswers(node, path, (a) => ({ ...a, category: 'none', loss: null }))).filter((a) => a.children.length > 0)
      return answers.length > 0 ? { ...node, category: 'none', loss: null, children: answers } : null
    }
    failed.push({ id, reason: failure })
    log(`[${done}/${total}] ${id}: left as it was, ${failure}`)
    return { ...node, children: await walkAnswers(node, path, (a) => a) }
  }

  const source = base.toTree()
  const roots = await walkAll(source.roots, [])
  return { tree: { kind: source.kind, verified: failed.length === 0, roots }, kept, dropped, failed }
}
