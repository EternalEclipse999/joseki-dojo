import { colorSign, inZone, Position, vertexToGtp, zoneVertices, type Color, type Move, type MoveVertex, type Vertex } from '@joseki-dojo/shared'
import { EngineError, type AnalysisEngine } from '../engine/engine'
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
  /** Traps that could not be checked because of bad data (an illegal position or a rejected query); they stay as they were. */
  failed: { id: string; reason: string }[]
}

const vertexOf = (m: CanonicalMove): MoveVertex => (m === 'tenuki' ? 'pass' : m)
const round1 = (x: number): number => Math.round(x * 10) / 10
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Moves of a canonical path, Black first; a tenuki is a real pass. */
function movesOf(path: readonly CanonicalMove[]): Move[] {
  return path.map((m, i) => ({ color: (i % 2 === 0 ? 'B' : 'W') as Color, vertex: vertexOf(m) }))
}

/** A trap that cannot be judged because its data is bad (as opposed to an engine that is gone). */
class DataError extends Error {}

type Verdict = { kind: 'kept'; losses: Map<JdbNode, number> } | { kind: 'dropped'; reason: string }

/**
 * Spec 4.2: verifies every trap of a traps base with the engine, writes the answer losses, drops the traps
 * that fail the thresholds (and the branches left without traps) and marks the base as verified.
 * An engine failure rejects the whole run; a trap with bad data stays unchanged and the base is not marked as verified.
 */
export async function checkTraps(base: JdbBase, engine: AnalysisEngine, opts: CheckOptions, log: (line: string) => void): Promise<CheckResult> {
  const dropped: { id: string; reason: string }[] = []
  const failed: { id: string; reason: string }[] = []
  let kept = 0
  const total = base.nodesOf('trap').length
  let done = 0

  /** Black-view lead -> the view of `color`. */
  const view = (lead: number, color: Color): number => colorSign(color) * lead

  /** Runs a query; a query the engine rejects is bad data, any other failure aborts the run. */
  async function ask(query: Parameters<AnalysisEngine['analyze']>[0]): ReturnType<AnalysisEngine['analyze']> {
    try {
      return await engine.analyze(query)
    } catch (err) {
      if (err instanceof EngineError && err.code === 'query_error') throw new DataError(`error: ${err.message}`)
      throw err
    }
  }

  async function judge(trap: JdbNode, path: CanonicalMove[]): Promise<Verdict> {
    const moves = movesOf(path)
    const answerer: Color = path.length % 2 === 0 ? 'B' : 'W'
    let position: Position
    let legal: Vertex[]
    try {
      position = Position.fromMoves(moves)
      legal = zoneVertices('TR').filter((v) => position.isLegal(answerer, v))
    } catch (err) {
      throw new DataError(`illegal path: ${message(err)}`)
    }
    if (legal.length === 0) return { kind: 'dropped', reason: 'no legal zone move for the answer' }
    const before = await ask({
      ...baseQuery(moves),
      maxVisits: opts.visits,
      allowMoves: [{ player: answerer, moves: legal.map(vertexToGtp), untilDepth: 1 }],
    })
    const best = [...before.moveInfos].sort((a, b) => a.order - b.order)[0]
    if (!best) return { kind: 'dropped', reason: 'the engine returned no zone move' }
    const bestLead = view(best.scoreLead, answerer)

    /** The lead (answerer view) after the answer; a tenuki is the best move outside the zone, not a pass. */
    async function leadAfter(answer: JdbNode): Promise<number> {
      if (answer.move !== 'tenuki') {
        if (!position.isLegal(answerer, answer.move)) throw new DataError(`illegal answer ${vertexToGtp(answer.move)}`)
        const after = await ask({ ...baseQuery([...moves, { color: answerer, vertex: answer.move }]), maxVisits: opts.visits })
        return view(after.rootInfo.scoreLead, answerer)
      }
      const outside = position.emptyVertices().filter((v) => !inZone('TR', v) && position.isLegal(answerer, v))
      if (outside.length === 0) {
        const after = await ask({ ...baseQuery([...moves, { color: answerer, vertex: 'pass' }]), maxVisits: opts.visits })
        return view(after.rootInfo.scoreLead, answerer)
      }
      const r = await ask({
        ...baseQuery(moves),
        maxVisits: opts.visits,
        allowMoves: [{ player: answerer, moves: outside.map(vertexToGtp), untilDepth: 1 }],
      })
      const top = [...r.moveInfos].sort((a, b) => a.order - b.order)[0]
      if (!top) throw new DataError('error: the engine returned no move outside the zone')
      return view(top.scoreLead, answerer)
    }

    const leads = await Promise.all(trap.children.map(leadAfter))
    const losses = new Map<JdbNode, number>()
    trap.children.forEach((answer, i) => losses.set(answer, Math.max(0, bestLead - leads[i])))
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

  /** The answers of a trap with `mark` applied; traps nested below an answer are checked on their own. */
  async function walkAnswers(trap: JdbNode, path: CanonicalMove[], mark: (a: JdbNode) => JdbNode): Promise<JdbNode[]> {
    const out: JdbNode[] = []
    for (const a of trap.children) out.push({ ...mark(a), children: await walkAll(a.children, [...path, a.move]) })
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
