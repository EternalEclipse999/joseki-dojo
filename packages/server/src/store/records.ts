import type { Color, Move, MoveVertex, PlayedMove, ResolvedSettings, ReviewSummary, SessionStatus } from '@joseki-dojo/shared'

export interface SessionRecord {
  id: string
  createdAt: string
  finishedAt: string | null
  settings: ResolvedSettings
  status: SessionStatus
  parentSessionId: string | null
  initialMoves: Move[]
  moves: PlayedMove[]
  summary: ReviewSummary | null
}

export type AnalysisKind = 'position' | 'pass_probe'

export interface StoredMoveInfo {
  move: string
  order: number
  visits: number
  scoreLead: number
  winrate: number
  pv: string[]
}

/** Compact KataGo answer kept in the database. Scores and ownership are from Black's view. */
export interface StoredAnalysis {
  rootInfo: { currentPlayer: Color; scoreLead: number; winrate: number; visits: number }
  moveInfos: StoredMoveInfo[]
  ownership: number[] | null
}

export interface MissedPunishmentRow {
  /** Turn of the bot mistake. */
  turn: number
  botMove: MoveVertex
  botLoss: number
  userMove: MoveVertex
  userLoss: number
  bestMove: MoveVertex
  bestPv: MoveVertex[]
}

/** Moves leading to position `t`: the initial moves plus the first `t` session moves. */
export function movesBefore(rec: Pick<SessionRecord, 'initialMoves' | 'moves'>, t: number): Move[] {
  return [...rec.initialMoves, ...rec.moves.slice(0, t).map(({ color, vertex }) => ({ color, vertex }))]
}
