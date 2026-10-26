import { describe, expect, it } from 'vitest'
import { inZone, Position } from '@joseki-dojo/shared'
import { StubEngine, stubResponse } from '../../test/helpers'
import type { AnalysisEngine } from '../engine/engine'
import { HumanBot, type BotGuide, type BotRequest } from './bot'
import { chooseBotMove, naturalMoves, type BotChoiceInput, type NaturalMove } from './choose'
import { mulberry32, type Rng } from './rng'

const request: BotRequest = {
  moves: [],
  position: Position.empty(),
  color: 'B',
  corner: 'TR',
  josekiStarted: false,
  rank: '5k',
  temperature: 1,
}

describe('HumanBot', () => {
  it('queries the human policy of the configured rank and plays in the zone', async () => {
    const engine = new StubEngine()
    const vertex = await new HumanBot(engine, mulberry32(3)).chooseMove(request)
    expect(engine.queries[0]).toMatchObject({ maxVisits: 1, includePolicy: true, overrideSettings: { humanSLProfile: 'rank_5k' } })
    expect(vertex).not.toBe('pass')
    expect(inZone('TR', vertex)).toBe(true)
  })

  it("plays its guide's move, and as without one when the guide gives none", async () => {
    const engine = new StubEngine()
    const humanPolicy = Array.from({ length: 362 }, (_, i) => (i === 361 ? 0 : (i % 7) / 1000))
    engine.human = () => humanPolicy
    const input: BotChoiceInput = { humanPolicy, position: request.position, color: request.color, corner: request.corner, josekiStarted: request.josekiStarted, temperature: request.temperature }
    const choice = chooseBotMove(input, mulberry32(3))
    const unguided = choice.kind === 'pass' ? 'pass' : choice.vertex
    expect(await new HumanBot(engine, mulberry32(3)).chooseMove(request)).toEqual(unguided)
    expect(await new HumanBot(engine, mulberry32(3)).chooseMove({ ...request, guide: () => null })).toEqual(unguided)

    const rng = mulberry32(3)
    let seen: { natural: readonly NaturalMove[]; rng: Rng } | null = null
    const guide: BotGuide = (natural, r) => {
      seen = { natural, rng: r }
      return [3, 15]
    }
    expect(await new HumanBot(engine, rng).chooseMove({ ...request, guide })).toEqual([3, 15])
    // The guide gets the natural distribution and the bot's own generator.
    expect(seen).toEqual({ natural: naturalMoves(input), rng })
    expect(await new HumanBot(engine, mulberry32(3)).chooseMove({ ...request, guide: () => 'pass' })).toBe('pass')
  })

  it('ignores a guided move that is not legal and plays as without a guide', async () => {
    const engine = new StubEngine()
    const humanPolicy = Array.from({ length: 362 }, (_, i) => (i === 361 ? 0 : (i % 7) / 1000))
    engine.human = () => humanPolicy
    const position = Position.fromMoves([{ color: 'W', vertex: [15, 3] }])
    const input: BotChoiceInput = { humanPolicy, position, color: request.color, corner: request.corner, josekiStarted: request.josekiStarted, temperature: request.temperature }
    const choice = chooseBotMove(input, mulberry32(3))
    const unguided = choice.kind === 'pass' ? 'pass' : choice.vertex
    // The guide points at White's stone.
    expect(await new HumanBot(engine, mulberry32(3)).chooseMove({ ...request, position, guide: () => [15, 3] })).toEqual(unguided)
    expect(unguided).not.toEqual([15, 3])
  })

  it('fails clearly when KataGo returns no human policy', async () => {
    const engine: AnalysisEngine = {
      analyze: async (q) => {
        const r = stubResponse(q, 'D4', 0)
        delete r.humanPolicy
        return r
      },
    }
    await expect(new HumanBot(engine).chooseMove(request)).rejects.toThrow(/humanPolicy/)
  })
})
