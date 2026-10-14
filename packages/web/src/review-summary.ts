import type { Language, ReviewSummary, Translate } from '@joseki-dojo/shared'
import { formatPoints, pointsText } from './format'

export interface SummaryTile {
  /** Label above the number. */
  k: string
  /** The number. */
  v: string
  /** Line under the number. */
  s: string
}

/** Spec 7: the three summary tiles of the review. */
export function summaryTiles(s: ReviewSummary, t: Translate, lang: Language): SummaryTile[] {
  const mistakes = s.botMistakes > 0
  return [
    { k: t('review.summary.userLoss'), v: formatPoints(s.userLoss, lang), s: t('review.summary.pointsUnit') },
    {
      k: t('review.summary.botMistakes'),
      v: String(s.botMistakes),
      s: mistakes ? t('review.summary.botLoss', { points: pointsText(s.botMistakeLoss, t, lang) }) : t('review.summary.noBotMistakes'),
    },
    {
      k: t('review.summary.punished'),
      v: mistakes ? t('review.summary.punishedOf', { punished: s.punished, total: s.botMistakes }) : '—',
      s: mistakes ? t('review.summary.kept', { value: formatPoints(s.keptPoints, lang) }) : t('review.summary.nothingToPunish'),
    },
  ]
}
