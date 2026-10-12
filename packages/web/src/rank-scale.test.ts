import { describe, expect, it } from 'vitest'
import { BOT_RANKS } from '@joseki-dojo/shared'
import { RANK_MARKS, rankAt, rankIndex } from './rank-scale'

describe('rank scale', () => {
  it('maps ranks to slider positions and back', () => {
    expect(rankIndex('20k')).toBe(0)
    expect(rankAt(rankIndex('7k'))).toBe('7k')
    expect(rankAt(BOT_RANKS.length - 1)).toBe('9d')
  })

  it('clamps and rounds positions, and treats an unknown rank as the weakest', () => {
    expect(rankAt(-3)).toBe('20k')
    expect(rankAt(99)).toBe('9d')
    expect(rankAt(12.6)).toBe(rankAt(13))
    expect(rankIndex('nope')).toBe(0)
  })

  it('places the marks at their share of the track', () => {
    expect(RANK_MARKS.map((m) => m.rank)).toEqual(['20k', '1d', '9d'])
    expect(RANK_MARKS[0].at).toBe(0)
    expect(RANK_MARKS[1].at).toBeCloseTo(20 / 28)
    expect(RANK_MARKS[2].at).toBe(1)
  })
})
