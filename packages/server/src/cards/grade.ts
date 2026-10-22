import type { Category, Rating, RepetitionInfo, ReviewData } from '@joseki-dojo/shared'
import type { Thresholds } from '../config'
import { categorize } from '../review/compute'

export interface AutoRating {
  rating: Rating
  worst: RepetitionInfo['worst']
}

/**
 * Spec (progress part 2) 5: what a position review's rating at any level needs — the loss of every in-zone move of the
 * user, and every in-zone bot move the user answered, mistake or not, with its loss and the loss of the reply.
 */
export interface PositionRaw {
  moves: { loss: number }[]
  opponent: { loss: number; replyLoss: number }[]
}

type Worst = NonNullable<RepetitionInfo['worst']>

const RANK: Record<Category | 'unpunished', number> = { exact: 0, inaccuracy: 1, mistake: 2, unpunished: 2, blunder: 3 }

/** Spec (repetition) 4.4: the worst candidate that is not exact (the higher category, then the larger loss) and its rating. */
function rateWorst(candidates: Worst[]): AutoRating {
  const worst = candidates
    .filter((c) => c.category !== 'exact')
    .reduce<RepetitionInfo['worst']>((w, c) => (!w || RANK[c.category] > RANK[w.category] || (RANK[c.category] === RANK[w.category] && c.loss > w.loss) ? c : w), null)
  return { rating: !worst ? 'good' : worst.category === 'inaccuracy' ? 'hard' : 'again', worst }
}

const userMoves = (review: ReviewData) => review.moveReviews.filter((m) => m.actor === 'user' && review.moves[m.turn]?.inZone)

/**
 * Spec (repetition) 4.4: the worst category of the user's in-zone moves after the start, an unpunished bot mistake
 * (the bot's mistaken move in the zone) counting as a mistake: exact → good, inaccuracy → hard, mistake / blunder /
 * unpunished → again. Null without in-zone user moves.
 */
export function positionRating(review: ReviewData): AutoRating | null {
  const user = userMoves(review)
  if (user.length === 0) return null
  return rateWorst([
    ...user.map((m) => ({ category: m.category as Category | 'unpunished', loss: m.loss })),
    ...review.punishments.filter((p) => !p.punished && review.moves[p.turn]?.inZone).map((p) => ({ category: 'unpunished' as const, loss: p.userLoss })),
  ])
}

/** Spec (progress part 2) 5: the raw losses behind positionRating, for a rating at another level; null without in-zone user moves. */
export function positionRaw(review: ReviewData): PositionRaw | null {
  const user = userMoves(review)
  if (user.length === 0) return null
  const opponent: PositionRaw['opponent'] = []
  review.moveReviews.forEach((m, t) => {
    const reply = review.moveReviews[t + 1]
    // The bot's moves the user answered, as findPunishments takes them, in the zone, as positionRating counts them.
    if (m.actor === 'bot' && review.moves[t]?.inZone && reply?.color === review.settings.userColor) opponent.push({ loss: m.loss, replyLoss: reply.loss })
  })
  return { moves: user.map((m) => ({ loss: m.loss })), opponent }
}

/** Spec (progress part 2) 5: positionRating at `th` from the raw losses; a bot mistake answered by a reply losing at least `punished` is unpunished. */
export function ratePosition(raw: PositionRaw, th: Thresholds): AutoRating {
  return rateWorst([
    ...raw.moves.map((m) => ({ category: categorize(m.loss, th) as Category | 'unpunished', loss: m.loss })),
    ...raw.opponent.filter((o) => o.loss >= th.mistake && o.replyLoss >= th.punished).map((o) => ({ category: 'unpunished' as const, loss: o.replyLoss })),
  ])
}
