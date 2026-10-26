import { translator } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { colorLabel, dayStart, formatCount, formatPercent, formatPercentPair, formatPoints, formatWhen, levelLabel, moveLabel, pointsText, rankLabel } from './format'

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

  it('writes a share as a whole percent in the reader’s language', () => {
    expect([0, 0.424, 0.425, 1].map((n) => formatPercent(n, 'ru').replace(/\s/g, ' '))).toEqual(['0 %', '42 %', '43 %', '100 %'])
    expect(formatPercent(0.07, 'en')).toBe('7%')
    expect(formatPercent(0.5, 'ja')).toBe('50%')
  })

  it('writes a pair of percents whole, or with one decimal when they are equal whole', () => {
    const pair = (before: number, after: number, lang: 'ru' | 'en' = 'ru'): string[] => formatPercentPair(before, after, lang).map((s) => s.replace(/\s/g, ' '))
    expect(pair(0.34, 0.36)).toEqual(['34 %', '36 %'])
    expect(pair(0.341, 0.344)).toEqual(['34,1 %', '34,4 %'])
    expect(pair(0.3412, 0.3414)).toEqual(['34,1 %', '34,1 %'])
    expect(pair(0.341, 0.344, 'en')).toEqual(['34.1%', '34.4%'])
    expect(pair(0.36, 0.34, 'en')).toEqual(['36%', '34%'])
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
    expect([levelLabel('pro', t), levelLabel('3d', t)]).toEqual(['профи', '3 дан'])
    expect([colorLabel('B', t), colorLabel('W', translator('en'))]).toEqual(['Чёрные', 'White'])
  })

  it('tells when a card is due: now, minutes and hours within a day, then repetition days on the 04:00 boundary', () => {
    // Local times: the repetition day starts at 04:00 local time.
    const at = (day: number, hour: number, minute = 0): Date => new Date(2026, 9, day, hour, minute)
    const when = (now: Date, due: Date, lang: 'ru' | 'en' = 'ru'): string => formatWhen(due.toISOString(), now, lang, translator(lang))
    expect(when(at(15, 12), at(15, 11, 59))).toBe(t('repetition.now'))
    expect(when(at(15, 12), at(15, 12, 10))).toBe('через 10 минут')
    expect(when(at(15, 20), at(16, 10))).toBe('через 14 часов')
    expect(when(at(15, 20), at(16, 21))).toBe('завтра')
    expect(when(at(15, 20), at(17, 7))).toBe('послезавтра')
    expect(when(at(15, 20), at(17, 7), 'en')).toBe('in 2 days')
    expect(when(at(15, 12), at(18, 12), 'en')).toBe('in 3 days')
    // 02:00 still belongs to the day before: a card due at 05:00 the next day is two repetition days away.
    expect(when(at(16, 2), at(17, 5))).toBe('послезавтра')
    // Over 23½ hours but within the same repetition day: still in hours, never «сегодня».
    expect(when(at(15, 4), at(16, 3, 40))).toBe('через 24 часа')
  })

  it('a repetition day starts at 04:00 local time', () => {
    expect(dayStart(new Date(2026, 9, 15, 12))).toEqual(new Date(2026, 9, 15, 4))
    expect(dayStart(new Date(2026, 9, 16, 3, 59))).toEqual(new Date(2026, 9, 15, 4))
    expect(dayStart(new Date(2026, 9, 16, 4))).toEqual(new Date(2026, 9, 16, 4))
  })
})
