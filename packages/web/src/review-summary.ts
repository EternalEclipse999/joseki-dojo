import type { ReviewSummary } from '@joseki-dojo/shared'
import { formatPoints } from './format'

export interface SummaryTile {
  /** Label above the number. */
  k: string
  /** The number. */
  v: string
  /** Line under the number. */
  s: string
}

/** Spec 7: the three summary tiles of the review. */
export function summaryTiles(s: ReviewSummary): SummaryTile[] {
  const mistakes = s.botMistakes > 0
  return [
    { k: 'Вы потеряли', v: formatPoints(s.userLoss), s: 'очка' },
    { k: 'Ошибки бота', v: String(s.botMistakes), s: mistakes ? `на ${formatPoints(s.botMistakeLoss)} очка` : 'бот не ошибся' },
    { k: 'Наказано', v: mistakes ? `${s.punished} из ${s.botMistakes}` : '—', s: mistakes ? `удержано ${formatPoints(s.keptPoints)}` : 'нечего наказывать' },
  ]
}
