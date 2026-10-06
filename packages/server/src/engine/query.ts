import { BOARD_SIZE, moveToGtp, type Move } from '@joseki-dojo/shared'
import type { KataGoQueryBody } from './katago-types'

export const RULES = 'chinese'
export const KOMI = 7.5

export function baseQuery(moves: readonly Move[]): KataGoQueryBody {
  return {
    moves: moves.map((m): [string, string] => [m.color, moveToGtp(m.vertex)]),
    rules: RULES,
    komi: KOMI,
    boardXSize: BOARD_SIZE,
    boardYSize: BOARD_SIZE,
  }
}
