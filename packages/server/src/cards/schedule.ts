import { createEmptyCard, fsrs, generatorParameters, Rating as FsrsRating, State, type Card, type Grade } from 'ts-fsrs'
import type { CardStage, Rating } from '@joseki-dojo/shared'

/** Spec (repetition) 4.3: a ts-fsrs card with its dates as ISO strings (stored as JSON). */
export type FsrsState = Omit<Card, 'due' | 'last_review'> & { due: string; last_review: string | null }

const scheduler = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false, enable_short_term: true, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] }))

const GRADES: Record<Rating, Grade> = { again: FsrsRating.Again, hard: FsrsRating.Hard, good: FsrsRating.Good, easy: FsrsRating.Easy }

const toState = (c: Card): FsrsState => ({ ...c, due: c.due.toISOString(), last_review: c.last_review ? c.last_review.toISOString() : null })
const toCard = (s: FsrsState): Card => ({ ...s, due: new Date(s.due), last_review: s.last_review ? new Date(s.last_review) : undefined }) as Card

/** A card that has never been reviewed: due now. */
export const newState = (now: Date): FsrsState => toState(createEmptyCard(now))

/** Spec (repetition) 4.3: the state after answering `rating` at `now`. */
export const schedule = (state: FsrsState, rating: Rating, now: Date): FsrsState => toState(scheduler.next(toCard(state), now, GRADES[rating]).card)

/** «изучена» only on the review stage; new, learning and relearning cards are «изучается». */
export const stageOf = (state: FsrsState): CardStage => (state.state === State.Review ? 'learned' : 'learning')

/** Spec (repetition) 5.2: the card is in its short learning or relearning steps (minutes apart). */
export const inLearningSteps = (state: FsrsState): boolean => state.state === State.Learning || state.state === State.Relearning

/** Spec (repetition) 4.3: the start of the day containing `now` — 04:00 local time. */
export function dayStart(now: Date): Date {
  const d = new Date(now)
  d.setHours(4, 0, 0, 0)
  if (now < d) d.setDate(d.getDate() - 1)
  return d
}
