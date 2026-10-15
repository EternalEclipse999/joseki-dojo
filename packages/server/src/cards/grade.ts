import type { Category, Rating, RepetitionInfo, ReviewData } from '@joseki-dojo/shared'

export interface AutoRating {
  rating: Rating
  worst: RepetitionInfo['worst']
}

const RANK: Record<Category | 'unpunished', number> = { exact: 0, inaccuracy: 1, mistake: 2, unpunished: 2, blunder: 3 }

/**
 * Spec (repetition) 4.4: the worst category of the user's in-zone moves after the start, an unpunished bot mistake
 * (the bot's mistaken move in the zone) counting as a mistake: exact → good, inaccuracy → hard, mistake / blunder /
 * unpunished → again. Null without in-zone user moves.
 */
export function positionRating(review: ReviewData): AutoRating | null {
  const user = review.moveReviews.filter((m) => m.actor === 'user' && review.moves[m.turn]?.inZone)
  if (user.length === 0) return null
  const candidates: NonNullable<RepetitionInfo['worst']>[] = [
    ...user.map((m) => ({ category: m.category as Category | 'unpunished', loss: m.loss })),
    ...review.punishments.filter((p) => !p.punished && review.moves[p.turn]?.inZone).map((p) => ({ category: 'unpunished' as const, loss: p.userLoss })),
  ].filter((c) => c.category !== 'exact')
  const worst = candidates.reduce<RepetitionInfo['worst']>(
    (w, c) => (!w || RANK[c.category] > RANK[w.category] || (RANK[c.category] === RANK[w.category] && c.loss > w.loss) ? c : w),
    null,
  )
  const rating: Rating = !worst ? 'good' : worst.category === 'inaccuracy' ? 'hard' : 'again'
  return { rating, worst }
}
