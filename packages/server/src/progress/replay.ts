import type { Rating } from '@joseki-dojo/shared'
import { newState, schedule, type FsrsState } from '../cards/schedule'

/** A review as the replay sees it: when it was made, and the player's own rating, if any. */
export interface ReplayedReview {
  reviewedAt: string
  manual: Rating | null
}

/**
 * Spec (progress part 2) 5: a card's history at another level. `derive` gives each review's auto rating anew, or null for
 * a review that is none at that level (it is skipped, a manual rating with it); FSRS gets the manual rating where there
 * is one. The state is replayed from a new card at `createdAt` through the reviews at their times. Returns the final
 * state, the derived auto ratings and the state before each review. Pure.
 */
export function replayCard<T extends ReplayedReview>(
  reviews: readonly T[],
  derive: (review: T) => Rating | null,
  createdAt: string,
): { state: FsrsState; autos: (Rating | null)[]; before: FsrsState[] } {
  let state = newState(new Date(createdAt))
  const autos: (Rating | null)[] = []
  const before: FsrsState[] = []
  for (const r of reviews) {
    const auto = derive(r)
    autos.push(auto)
    before.push(state)
    if (auto !== null) state = schedule(state, r.manual ?? auto, new Date(r.reviewedAt))
  }
  return { state, autos, before }
}
