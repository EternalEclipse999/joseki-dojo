import { describe, expect, it } from 'vitest'
import { BOT_RANKS, isBotRank, otherColor } from './types'

describe('types helpers', () => {
  it('lists ranks from 20k to 9d', () => {
    expect(BOT_RANKS).toHaveLength(29)
    expect(BOT_RANKS[0]).toBe('20k')
    expect(BOT_RANKS[19]).toBe('1k')
    expect(BOT_RANKS[20]).toBe('1d')
    expect(BOT_RANKS[28]).toBe('9d')
  })

  it('validates ranks', () => {
    expect(isBotRank('7k')).toBe(true)
    expect(isBotRank('0k')).toBe(false)
    expect(isBotRank('10d')).toBe(false)
  })

  it('flips colors', () => {
    expect(otherColor('B')).toBe('W')
    expect(otherColor('W')).toBe('B')
  })
})
