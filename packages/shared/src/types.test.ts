import { describe, expect, it } from 'vitest'
import { BOT_RANKS, humanProfile, isBotRank, isPlayerLevel, otherColor, PLAYER_LEVELS } from './types'

describe('types helpers', () => {
  it('lists the player levels: the bot ranks, then pro', () => {
    expect(PLAYER_LEVELS).toHaveLength(30)
    expect([PLAYER_LEVELS[0], PLAYER_LEVELS[28], PLAYER_LEVELS[29]]).toEqual(['20k', '9d', 'pro'])
    expect([isPlayerLevel('pro'), isPlayerLevel('7k'), isPlayerLevel('10p')]).toEqual([true, true, false])
    expect([humanProfile('7k'), humanProfile('pro')]).toEqual(['rank_7k', 'proyear_2023'])
  })

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
