import { ApiError } from './api'

/**
 * Spec (progress part 2) 3.4: the server records a training's cards (the start card, the graph cards) when its review is
 * ready, and leaving the training does not stop that. A training left while its review was still being prepared waits
 * here until the review is ready, so that the header's count, the tree's marks and the progress are read again then.
 */

/** How often the start screen asks whether a left training's review is ready (the socket stops hearing of it once another training starts). */
export const LEFT_REVIEW_POLL_MS = 5000

/** How long after leaving a training its review is waited for: one not ready by then (its analysis failed) is no longer asked for. */
export const LEFT_REVIEW_WAIT_MS = 10 * 60_000

/** A training left before its review was ready, and when it was left (ms since the epoch). */
export interface LeftTraining {
  id: string
  leftAt: number
}

/**
 * The trainings waiting for their review after the screen goes, at `now`, from `pending` — the finished training shown
 * without its review, or null — to session `shown` (null: none): `pending` joins them when it is no longer the one shown.
 * The same list when nothing changes.
 */
export function afterLeaving(waiting: readonly LeftTraining[], pending: string | null, shown: string | null, now: number): readonly LeftTraining[] {
  return pending === null || pending === shown || waiting.some((w) => w.id === pending) ? waiting : [...waiting, { id: pending, leftAt: now }]
}

/** The trainings still waiting once those of `ids` are dropped; the same list when none of them was waiting. */
export function without(waiting: readonly LeftTraining[], ids: readonly string[]): readonly LeftTraining[] {
  return waiting.some((w) => ids.includes(w.id)) ? waiting.filter((w) => !ids.includes(w.id)) : waiting
}

/** What asking for a left training's review told: it is ready, not yet (or the request failed: asked again), or the session is gone. */
export type LeftAnswer = 'ready' | 'waiting' | 'gone'

/** The answer of a review request (fetchReview: null while not ready; a 404 for a session that no longer exists). */
export const leftAnswer = (review: Promise<unknown>): Promise<LeftAnswer> =>
  review.then(
    (r) => (r === null ? 'waiting' : 'ready'),
    (e: unknown) => (e instanceof ApiError && e.text.params?.status === '404' ? 'gone' : 'waiting'),
  )

/**
 * After a poll at `now` (`answers` in the order of `waiting`): the trainings no longer asked for — the ready ones, the
 * gone ones and those still not ready LEFT_REVIEW_WAIT_MS after they were left — and whether a review became ready (the
 * counts, the marks and the progress are read again then).
 */
export function afterPoll(waiting: readonly LeftTraining[], answers: readonly LeftAnswer[], now: number): { drop: string[]; ready: boolean } {
  const drop = waiting.filter((w, i) => answers[i] !== 'waiting' || now - w.leftAt >= LEFT_REVIEW_WAIT_MS).map((w) => w.id)
  return { drop, ready: answers.includes('ready') }
}
