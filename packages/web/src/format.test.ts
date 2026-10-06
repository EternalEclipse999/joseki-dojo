import { describe, expect, it } from 'vitest'
import { formatPoints, moveLabel, plural, rankLabel } from './format'

describe('format', () => {
  it('formats points with a decimal comma', () => {
    expect(formatPoints(7.5)).toBe('7,5')
    expect(formatPoints(2)).toBe('2,0')
    expect(formatPoints(0.04)).toBe('0,0')
    expect(formatPoints(-0.01)).toBe('0,0')
  })

  it('picks Russian plural forms', () => {
    expect(plural(1, 'раз', 'раза', 'раз')).toBe('раз')
    expect(plural(3, 'раз', 'раза', 'раз')).toBe('раза')
    expect(plural(5, 'раз', 'раза', 'раз')).toBe('раз')
    expect(plural(11, 'раз', 'раза', 'раз')).toBe('раз')
    expect(plural(22, 'раз', 'раза', 'раз')).toBe('раза')
  })

  it('labels moves and ranks', () => {
    expect(moveLabel([15, 3])).toBe('Q16')
    expect(moveLabel('pass')).toBe('пас')
    expect(rankLabel('7k')).toBe('7 кю')
    expect(rankLabel('1d')).toBe('1 дан')
  })
})
