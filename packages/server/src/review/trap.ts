import type { PlayedMove, ResolvedSettings, ReviewTrap } from '@joseki-dojo/shared'
import type { TrapBook } from '../traps/book'

/** The trap block of the review; null outside the traps mode. Turns are relative to the session's moves. */
export function trapReview(
  settings: ResolvedSettings,
  initialMoveCount: number,
  moves: readonly PlayedMove[],
  book: TrapBook,
): ReviewTrap | null {
  const trap = settings.trap
  if (!trap) return null
  const rel = (abs: number): number | null => (abs >= initialMoveCount && abs - initialMoveCount < moves.length ? abs - initialMoveCount : null)
  const trickTurn = rel(trap.index)
  const answerTurn = rel(trap.index + 1)
  // A base replaced since the session was played may no longer know the trap.
  if (!book.ids().includes(trap.id)) return { trickTurn, answerTurn, verdict: null, good: [] }
  const placement = { corner: settings.corner, mirror: trap.mirror, swapColors: trap.swapColors }
  return {
    trickTurn,
    answerTurn,
    verdict: answerTurn === null ? null : book.verdict(trap.id, placement, moves[answerTurn].vertex),
    good: book.answers(trap.id, placement).good,
  }
}
