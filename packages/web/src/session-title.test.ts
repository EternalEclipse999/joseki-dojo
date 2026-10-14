import type { ResolvedSettings, StartRef } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { reviewLabels, reviewTitle, sessionTitle } from './session-title'

const settings = (start?: StartRef, mode: ResolvedSettings['mode'] = start ? 'list' : 'free'): ResolvedSettings => ({
  mode,
  environment: 'empty',
  userColor: 'B',
  botRank: '7k',
  corner: 'TR',
  ...(start ? { start } : {}),
})
const listed: StartRef = { id: 'a', name: 'Малое приближение — ответ кэймой', group: '3-4', mirror: false }

describe('session titles', () => {
  it('names a listed start with its group in the game and in the review', () => {
    expect(sessionTitle(settings(listed))).toBe('3-4 · Малое приближение — ответ кэймой')
    expect(reviewTitle(settings(listed))).toBe('Разбор: 3-4 · Малое приближение — ответ кэймой')
  })

  it('keeps the bare name of a start saved without its group', () => {
    const { group: _old, ...saved } = listed
    expect(sessionTitle(settings(saved))).toBe('Малое приближение — ответ кэймой')
  })

  it('marks a dubious random start only in the review', () => {
    const dubious: StartRef = { id: 'b', name: null, mirror: true, dubious: true, swapColors: false }
    expect(sessionTitle(settings(dubious, 'random'))).toBe('Случайная позиция')
    expect(reviewTitle(settings(dubious, 'random'))).toBe('Разбор: случайная позиция (ход соперника похуже)')
    expect(reviewTitle(settings({ id: 'c', name: null, mirror: false }, 'random'))).toBe('Разбор: случайная позиция')
  })

  it('plays a listed node again and goes back to the tree; the other modes go on to a new game', () => {
    expect(reviewLabels('list')).toEqual({ next: 'Играть позицию заново', back: 'К выбору позиции' })
    for (const mode of ['free', 'traps', 'random'] as const) expect(reviewLabels(mode)).toEqual({ next: 'Следующая позиция', back: 'К выбору тренировки' })
  })

  it('keeps the names of the other modes', () => {
    expect(sessionTitle(settings())).toBe('Свободная тренировка')
    expect(sessionTitle(settings(undefined, 'traps'))).toBe('Ловушка')
    expect(reviewTitle(settings())).toBe('Разбор тренировки')
  })
})
