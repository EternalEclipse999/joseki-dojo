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
