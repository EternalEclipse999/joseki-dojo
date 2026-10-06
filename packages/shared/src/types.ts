export type Color = 'B' | 'W'
/** Sabaki coordinates: x grows to the right, y grows downward, both 0..18. */
export type Vertex = [x: number, y: number]
export type MoveVertex = Vertex | 'pass'
export type Corner = 'TL' | 'TR' | 'BL' | 'BR'
export const CORNERS: readonly Corner[] = ['TL', 'TR', 'BL', 'BR']

export interface Move {
  color: Color
  vertex: MoveVertex
}

export type Actor = 'user' | 'bot' | 'auto-tenuki'

export interface PlayedMove extends Move {
  actor: Actor
  inZone: boolean
}

export type Mode = 'free'
export type Environment = 'empty'

export interface SessionSettings {
  mode: Mode
  environment: Environment
  userColor: Color | 'random'
  botRank: string
  corner: Corner | 'random'
}

export interface ResolvedSettings {
  mode: Mode
  environment: Environment
  userColor: Color
  botRank: string
  corner: Corner
}

export type SessionStatus = 'playing' | 'finished' | 'abandoned'

export interface SessionView {
  id: string
  settings: ResolvedSettings
  /** Moves played before turn 0 (the parent's prefix after «Переиграть с этого хода»). */
  initialMoves: Move[]
  moves: PlayedMove[]
  toMove: Color
  status: SessionStatus
  josekiStarted: boolean
  endProposed: boolean
  botThinking: boolean
  parentSessionId: string | null
}

export type Category = 'exact' | 'inaccuracy' | 'mistake' | 'blunder'

export interface Candidate {
  vertex: MoveVertex
  /** Points the side to move loses by choosing this candidate instead of the engine's first choice. */
  loss: number
  pv: MoveVertex[]
}

/** Analysis of position `turn` (the position before move `turn`). */
export interface PositionReview {
  turn: number
  scoreLeadBlack: number
  candidates: Candidate[]
  /** 361 values, row-major from the top-left, Black's point of view (-1..1). */
  ownership: number[] | null
}

export interface MoveReview {
  turn: number
  color: Color
  actor: Actor
  vertex: MoveVertex
  loss: number
  category: Category
}

export interface PunishmentEvent {
  /** Turn of the bot mistake; the user's reply is `turn + 1`. */
  turn: number
  botLoss: number
  userLoss: number
  punished: boolean
  kept: number
}

export interface ReviewSummary {
  userLoss: number
  botMistakes: number
  botMistakeLoss: number
  punished: number
  keptPoints: number
}

export interface ReviewData {
  sessionId: string
  settings: ResolvedSettings
  initialMoves: Move[]
  moves: PlayedMove[]
  /** Length `moves.length + 1`. */
  positions: PositionReview[]
  moveReviews: MoveReview[]
  punishments: PunishmentEvent[]
  summary: ReviewSummary
}

export type HealthState = 'starting' | 'ready' | 'failed'

export interface HealthResponse {
  state: HealthState
  reason: string | null
}

export const otherColor = (c: Color): Color => (c === 'B' ? 'W' : 'B')

export const BOT_RANKS: readonly string[] = [
  ...Array.from({ length: 20 }, (_, i) => `${20 - i}k`),
  ...Array.from({ length: 9 }, (_, i) => `${i + 1}d`),
]

export const isBotRank = (s: string): boolean => BOT_RANKS.includes(s)

export const DEFAULT_BOT_RANK = '7k'
