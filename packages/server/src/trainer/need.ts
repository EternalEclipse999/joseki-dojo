import { recall } from '../cards/schedule'
import type { NodeCards } from '../progress/compute'

/**
 * Part 3 spec 2: how much there is to learn at each node's move card at `now`, by node — 1 without a card (or for a new
 * one), else 1 − the FSRS probability of recalling it. Spec 5.2 draws «Случайно»'s target by it.
 */
export function moveNeeds(cards: NodeCards, now: Date): Float64Array {
  return Float64Array.from(cards.move, (s) => (s ? 1 - recall(s, now) : 1))
}
