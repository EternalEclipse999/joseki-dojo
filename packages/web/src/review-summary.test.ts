import { translator } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { summaryTiles } from './review-summary'

const t = translator('ru')

describe('summaryTiles', () => {
  it('shows the losses and the punished bot mistakes', () => {
    expect(summaryTiles({ userLoss: 3.4, botMistakes: 2, botMistakeLoss: 5.1, punished: 1, keptPoints: 2.9 }, t, 'ru')).toEqual([
      { k: 'Вы потеряли', v: '3,4', s: 'очка' },
      { k: 'Ошибки бота', v: '2', s: 'на 5,1 очка' },
      { k: 'Наказано', v: '1 из 2', s: 'удержано 2,9' },
    ])
  })

  it('has nothing to punish when the bot made no mistake', () => {
    const [lost, mistakes, punished] = summaryTiles({ userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 }, t, 'ru')
    expect(lost).toEqual({ k: 'Вы потеряли', v: '0,0', s: 'очка' })
    expect(mistakes).toEqual({ k: 'Ошибки бота', v: '0', s: 'бот не ошибся' })
    expect(punished).toEqual({ k: 'Наказано', v: '—', s: 'нечего наказывать' })
  })

  it('speaks the reader’s language and writes numbers its way', () => {
    expect(summaryTiles({ userLoss: 1, botMistakes: 1, botMistakeLoss: 1, punished: 1, keptPoints: 0.5 }, translator('en'), 'en')).toEqual([
      { k: 'You lost', v: '1.0', s: 'points' },
      { k: 'Bot mistakes', v: '1', s: 'worth 1.0 points' },
      { k: 'Punished', v: '1 of 1', s: 'kept 0.5' },
    ])
  })
})
