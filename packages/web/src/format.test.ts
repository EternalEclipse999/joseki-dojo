import { describe, expect, it } from 'vitest'
import { formatCount, formatPoints, moveLabel, rankLabel } from './format'

describe('format', () => {
  it('formats points with a decimal comma', () => {
    expect(formatPoints(7.5)).toBe('7,5')
    expect(formatPoints(2)).toBe('2,0')
    expect(formatPoints(0.04)).toBe('0,0')
    expect(formatPoints(-0.01)).toBe('0,0')
  })

  it('groups the thousands of a visit count', () => {
    expect(formatCount(25)).toBe('25')
    expect(formatCount(1200).replace(/\s/g, ' ')).toBe('1 200')
  })

  it('labels moves and ranks', () => {
    expect(moveLabel([15, 3])).toBe('Q16')
    expect(moveLabel('pass')).toBe('пас')
    expect(rankLabel('7k')).toBe('7 кю')
    expect(rankLabel('1d')).toBe('1 дан')
  })
})
