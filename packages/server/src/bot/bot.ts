import type { Color, Corner, Move, MoveVertex, Position } from '@joseki-dojo/shared'
import { EngineError, type AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'
import { chooseBotMove, naturalMoves, type BotChoiceInput, type NaturalMove } from './choose'
import type { Rng } from './rng'

/**
 * Part 3 spec 5.4: the bot's move from its natural distribution (naturalMoves), drawn with the bot's `rng`; null: the bot
 * plays as without a guide. A guide decides on null before it draws from `rng`, so a null leaves the generator untouched
 * and the bot's own move is drawn as without a guide.
 */
export type BotGuide = (natural: readonly NaturalMove[], rng: Rng) => MoveVertex | null

export interface BotRequest {
  /** Every move so far, including the session's initial moves. */
  moves: readonly Move[]
  position: Position
  color: Color
  corner: Corner
  josekiStarted: boolean
  rank: string
  temperature: number
  /** Part 3 spec 5.4: guides the move on a deep start's path; HumanBot plays its move when it gives a legal one. */
  guide?: BotGuide
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
    if (!r.humanPolicy) throw new EngineError({ key: 'error.engine.noHumanPolicy' }, 'query_error')
    const input: BotChoiceInput = {
      humanPolicy: r.humanPolicy,
      position: req.position,
      color: req.color,
      corner: req.corner,
      josekiStarted: req.josekiStarted,
      temperature: req.temperature,
    }
    const guided = req.guide?.(naturalMoves(input), this.rng) ?? null
    // A guided move that is not legal here is ignored: the bot plays as without a guide.
    if (guided !== null && (guided === 'pass' || req.position.isLegal(req.color, guided))) return guided
    const choice = chooseBotMove(input, this.rng)
    return choice.kind === 'pass' ? 'pass' : choice.vertex
  }
}
