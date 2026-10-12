import { gtpToVertex, vertexToGtp, zoneVertices, type MoveVertex } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'
import type { BotRequest } from './bot'

export type StrongRequest = BotRequest & { visits: number }

export interface StrongChooser {
  chooseMove(req: StrongRequest): Promise<MoveVertex>
}

/** The strong replies of the traps mode: KataGo's best move among the legal points of the corner zone. */
export class StrongBot implements StrongChooser {
  constructor(private readonly engine: AnalysisEngine) {}

  async chooseMove(req: StrongRequest): Promise<MoveVertex> {
    const legal = zoneVertices(req.corner).filter((v) => req.position.colorAt(v) === null && req.position.isLegal(req.color, v))
    if (legal.length === 0) return 'pass'
    const r = await this.engine.analyze({
      ...baseQuery(req.moves),
      maxVisits: req.visits,
      priority: 10,
      allowMoves: [{ player: req.color, moves: legal.map(vertexToGtp), untilDepth: 1 }],
    })
    const best = [...r.moveInfos].sort((a, b) => a.order - b.order)[0]
    return best ? gtpToVertex(best.move) : 'pass'
  }
}
