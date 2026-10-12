import { colorSign, Position, vertexToGtp, zoneVertices, type Color, type Move, type MoveVertex } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'
import { trapId, type CanonicalMove, type JdbBase, type JdbNode, type JdbTree } from '../jdb'

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
}

const vertexOf = (m: CanonicalMove): MoveVertex => (m === 'tenuki' ? 'pass' : m)
const round1 = (x: number): number => Math.round(x * 10) / 10

/** Moves of a canonical path, Black first; a tenuki is a real pass. */
function movesOf(path: readonly CanonicalMove[]): Move[] {
  return path.map((m, i) => ({ color: (i % 2 === 0 ? 'B' : 'W') as Color, vertex: vertexOf(m) }))
}

/**
 * Spec 4.2: verifies every trap of a traps base with the engine, writes the answer losses, drops the traps
 * that fail the thresholds (and the branches left without traps) and marks the base as verified.
 */
export async function checkTraps(base: JdbBase, engine: AnalysisEngine, opts: CheckOptions, log: (line: string) => void): Promise<CheckResult> {
  const dropped: { id: string; reason: string }[] = []
  let kept = 0
  const total = base.nodesOf('trap').length
  let done = 0

  /** Black-view lead -> the view of `color`. */
  const view = (lead: number, color: Color): number => colorSign(color) * lead

  async function judge(trap: JdbNode, path: CanonicalMove[]): Promise<JdbNode | string> {
    const moves = movesOf(path)
    const answerer: Color = path.length % 2 === 0 ? 'B' : 'W'
    let legal
    try {
      const position = Position.fromMoves(moves)
      legal = zoneVertices('TR').filter((v) => position.isLegal(answerer, v))
    } catch (err) {
      return `illegal path: ${err instanceof Error ? err.message : String(err)}`
    }
    if (legal.length === 0) return 'no legal zone move for the answer'
    const before = await engine.analyze({
      ...baseQuery(moves),
      maxVisits: opts.visits,
      allowMoves: [{ player: answerer, moves: legal.map(vertexToGtp), untilDepth: 1 }],
    })
    const best = [...before.moveInfos].sort((a, b) => a.order - b.order)[0]
    if (!best) return 'the engine returned no zone move'
    const bestLead = view(best.scoreLead, answerer)

    const answers: JdbNode[] = []
    const raws: number[] = []
    for (const answer of trap.children) {
      const after = await engine.analyze({ ...baseQuery([...moves, { color: answerer, vertex: vertexOf(answer.move) }]), maxVisits: opts.visits })
      const raw = Math.max(0, bestLead - view(after.rootInfo.scoreLead, answerer))
      raws.push(raw)
      // The node keeps the rounded loss; the thresholds below compare the unrounded ones.
      answers.push({ ...answer, loss: round1(raw) })
    }
    const lossesOf = (cat: JdbNode['category']): number[] => raws.filter((_, i) => answers[i].category === cat)
    const good = lossesOf('good')
    const caught = lossesOf('caught')
    if (good.length === 0) return 'no good answer'
    if (caught.length === 0) return 'no caught answer'
    const minGood = Math.min(...good)
    if (minGood > opts.goodMax) return `best good answer loses ${round1(minGood)} > ${opts.goodMax}`
    const gap = Math.min(...caught) - minGood
    if (gap < opts.caughtGap) return `caught answers are not bad enough: gap ${round1(gap)} < ${opts.caughtGap}`
    return { ...trap, children: answers }
  }

  async function walk(node: JdbNode, parent: CanonicalMove[]): Promise<JdbNode | null> {
    const path = [...parent, node.move]
    if (node.category === 'trap') {
      const id = trapId(path)
      // Traps nested under an answer are not checked separately: the base format does not produce them.
      let verdict: JdbNode | string
      try {
        verdict = await judge(node, path)
      } catch (err) {
        verdict = `error: ${err instanceof Error ? err.message : String(err)}`
      }
      done++
      if (typeof verdict === 'string') {
        dropped.push({ id, reason: verdict })
        log(`[${done}/${total}] ${id}: dropped, ${verdict}`)
        return null
      }
      kept++
      log(`[${done}/${total}] ${id}: kept`)
      return verdict
    }
    const children: JdbNode[] = []
    for (const c of node.children) {
      const r = await walk(c, path)
      if (r) children.push(r)
    }
    return children.length > 0 ? { ...node, children } : null
  }

  const source = base.toTree()
  const roots: JdbNode[] = []
  for (const r of source.roots) {
    const kept = await walk(r, [])
    if (kept) roots.push(kept)
  }
  return { tree: { kind: source.kind, verified: true, roots }, kept, dropped }
}
