import { describe, expect, it } from 'vitest'
import { StubEngine } from '../../test/helpers'
import { measureVisitsPerSecond, visitsForBudget } from './calibrate'

describe('visitsForBudget', () => {
  it('targets two seconds per position, rounded to 50, within limits', () => {
    expect(visitsForBudget(250)).toEqual({ reviewVisits: 500, endVisits: 250 })
    expect(visitsForBudget(400)).toEqual({ reviewVisits: 800, endVisits: 400 })
    expect(visitsForBudget(10)).toEqual({ reviewVisits: 100, endVisits: 50 })
    expect(visitsForBudget(100_000)).toEqual({ reviewVisits: 5000, endVisits: 2500 })
  })
})

describe('measureVisitsPerSecond', () => {
  it('warms up on another position, then times a fixed search', async () => {
    const engine = new StubEngine()
    const vps = await measureVisitsPerSecond(engine, 800)
    expect(vps).toBeGreaterThan(0)
    expect(engine.queries.map((q) => [q.moves.length, q.maxVisits])).toEqual([
      [0, 100],
      [4, 800],
    ])
  })
})
