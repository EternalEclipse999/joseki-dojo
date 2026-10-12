import { describe, expect, it } from 'vitest'
import { summaryTiles } from './review-summary'

describe('summaryTiles', () => {
  it('shows the losses and the punished bot mistakes', () => {
    expect(summaryTiles({ userLoss: 3.4, botMistakes: 2, botMistakeLoss: 5.1, punished: 1, keptPoints: 2.9 })).toEqual([
      { k: 'Вы потеряли', v: '3,4', s: 'очка' },
      { k: 'Ошибки бота', v: '2', s: 'на 5,1 очка' },
      { k: 'Наказано', v: '1 из 2', s: 'удержано 2,9' },
    ])
  })

  it('has nothing to punish when the bot made no mistake', () => {
    const [, mistakes, punished] = summaryTiles({ userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 })
    expect(mistakes).toEqual({ k: 'Ошибки бота', v: '0', s: 'бот не ошибся' })
    expect(punished).toEqual({ k: 'Наказано', v: '—', s: 'нечего наказывать' })
  })
})
