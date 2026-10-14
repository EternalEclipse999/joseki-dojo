import { translator, type ResolvedSettings, type StartRef } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { reviewLabels, reviewTitle, sessionTitle } from './session-title'

const t = translator('ru')
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
    expect(sessionTitle(settings(listed), t)).toBe('3-4 · Малое приближение — ответ кэймой')
    expect(reviewTitle(settings(listed), t)).toBe('Разбор: 3-4 · Малое приближение — ответ кэймой')
  })

  it('keeps the bare name of a start saved without its group', () => {
    const { group: _old, ...saved } = listed
    expect(sessionTitle(settings(saved), t)).toBe('Малое приближение — ответ кэймой')
  })

  it('shows the name it is given in place of the saved one, still with the group', () => {
    expect(sessionTitle(settings(listed), t, 'Small approach — knight answer')).toBe('3-4 · Small approach — knight answer')
    expect(reviewTitle(settings(listed), t, 'Small approach — knight answer')).toBe('Разбор: 3-4 · Small approach — knight answer')
  })

  it('marks a dubious random start only in the review', () => {
    const dubious: StartRef = { id: 'b', name: null, mirror: true, dubious: true, swapColors: false }
    expect(sessionTitle(settings(dubious, 'random'), t)).toBe('Случайная позиция')
    expect(reviewTitle(settings(dubious, 'random'), t)).toBe('Разбор: случайная позиция (ход соперника похуже)')
    expect(reviewTitle(settings({ id: 'c', name: null, mirror: false }, 'random'), t)).toBe('Разбор: случайная позиция')
  })

  it('plays a listed node again and goes back to the tree; the other modes go on to a new game', () => {
    expect(reviewLabels('list', t)).toEqual({ next: 'Играть позицию заново', back: 'К выбору позиции' })
    for (const mode of ['free', 'traps', 'random'] as const) expect(reviewLabels(mode, t)).toEqual({ next: 'Следующая позиция', back: 'К выбору тренировки' })
  })

  it('keeps the names of the other modes', () => {
    expect(sessionTitle(settings(), t)).toBe('Свободная тренировка')
    expect(sessionTitle(settings(undefined, 'traps'), t)).toBe('Ловушка')
    expect(reviewTitle(settings(), t)).toBe('Разбор тренировки')
  })

  it('speaks the language of the translator it is given', () => {
    const en = translator('en')
    expect(sessionTitle(settings(), en)).toBe('Free training')
    expect(reviewTitle(settings(listed), en)).toBe('Review: 3-4 · Малое приближение — ответ кэймой')
    expect(reviewLabels('list', en)).toEqual({ next: 'Play the position again', back: 'Choose a position' })
  })
})
