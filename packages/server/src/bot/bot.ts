import type { Color, Corner, Move, MoveVertex, Position } from '@joseki-dojo/shared'
import { EngineError, type AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'
import { chooseBotMove } from './choose'
import type { Rng } from './rng'

export interface BotRequest {
  /** Every move so far, including the session's initial moves. */
  moves: readonly Move[]
  position: Position
  color: Color
  corner: Corner
  josekiStarted: boolean
  rank: string
  temperature: number
}

export interface MoveChooser {
  chooseMove(req: BotRequest): Promise<MoveVertex>
}

export class HumanBot implements MoveChooser {
  constructor(private readonly engine: AnalysisEngine, private readonly rng: Rng = Math.random) {}

  async chooseMove(req: BotRequest): Promise<MoveVertex> {
    const r = await this.engine.analyze({
      ...baseQuery(req.moves),
      maxVisits: 1,
      includePolicy: true,
      priority: 10,
      overrideSettings: { humanSLProfile: `rank_${req.rank}` },
    })
    if (!r.humanPolicy) throw new EngineError('KataGo не вернул humanPolicy: human-сеть не загружена', 'query_error')
    const choice = chooseBotMove(
      {
        humanPolicy: r.humanPolicy,
        position: req.position,
        color: req.color,
        corner: req.corner,
        josekiStarted: req.josekiStarted,
        temperature: req.temperature,
      },
      this.rng,
    )
    return choice.kind === 'pass' ? 'pass' : choice.vertex
  }
}
