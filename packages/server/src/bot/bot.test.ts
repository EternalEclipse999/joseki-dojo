import { describe, expect, it } from 'vitest'
import { inZone, Position } from '@joseki-dojo/shared'
import { StubEngine, stubResponse } from '../../test/helpers'
import type { AnalysisEngine } from '../engine/engine'
import { HumanBot, type BotRequest } from './bot'
import { mulberry32 } from './rng'

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
