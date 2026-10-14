import { translator } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { colorLabel, formatCount, formatPoints, moveLabel, pointsText, rankLabel } from './format'

const t = translator('ru')

describe('format', () => {
  it('formats points with one decimal in the reader’s language', () => {
    expect(formatPoints(7.5, 'ru')).toBe('7,5')
    expect(formatPoints(2, 'ru')).toBe('2,0')
    expect(formatPoints(0.04, 'ru')).toBe('0,0')
    expect(formatPoints(-0.01, 'ru')).toBe('0,0')
    expect([formatPoints(5.06, 'ru'), formatPoints(5.06, 'en'), formatPoints(-0.04, 'ru')]).toEqual(['5,1', '5.1', '0,0'])
    expect(formatPoints(-1.25, 'en')).toBe('-1.3')
  })

  it('writes points with their unit; a number with a decimal takes the fraction form', () => {
    expect([0, 1, 3.4, 5].map((n) => pointsText(n, t, 'ru'))).toEqual(['0,0 очка', '1,0 очка', '3,4 очка', '5,0 очка'])
    expect(pointsText(1, translator('en'), 'en')).toBe('1.0 points')
    expect(pointsText(5.1, translator('ja'), 'ja')).toBe('5.1目')
  })

  it('groups the thousands of a visit count', () => {
    expect(formatCount(25, 'ru')).toBe('25')
    expect(formatCount(1200, 'ru').replace(/\s/g, ' ')).toBe('1 200')
    expect(formatCount(1199.6, 'en')).toBe('1,200')
  })

  it('labels moves, ranks and colours', () => {
    expect(moveLabel([15, 3], t)).toBe('Q16')
    expect(moveLabel('pass', t)).toBe('пас')
    expect(moveLabel('pass', translator('ja'))).toBe('パス')
    expect(rankLabel('7k', t)).toBe('7 кю')
    expect(rankLabel('1d', t)).toBe('1 дан')
    expect(['7k', '1d', '3d'].map((r) => rankLabel(r, translator('ja')))).toEqual(['7級', '初段', '3段'])
    expect(['7k', '1d'].map((r) => rankLabel(r, translator('en')))).toEqual(['7 kyu', '1 dan'])
    expect([colorLabel('B', t), colorLabel('W', translator('en'))]).toEqual(['Чёрные', 'White'])
  })
})
