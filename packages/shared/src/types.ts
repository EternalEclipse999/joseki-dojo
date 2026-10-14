import type { Language, LocalizedText } from './i18n'

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

export type Mode = 'free' | 'traps' | 'random' | 'list'
export type Environment = 'empty'

export interface SessionSettings {
  mode: Mode
  environment: Environment
  userColor: Color | 'random'
  botRank: string
  corner: Corner | 'random'
  /** Mode 'list': the id of the chosen node of the tree — a position, a branch or a group's corner stone. */
  startId?: string
}

/** The trap of a traps-mode session and how its canonical form was put on the board. */
export interface TrapRef {
  id: string
  /** Position of the trick in the full move list (`initialMoves` + `moves`). */
  index: number
  mirror: boolean
  swapColors: boolean
}

/** The start position of a 'random' or 'list' session and how its canonical form was put on the board. */
export interface StartRef {
  id: string
  /** The name on the list: a position's full name, a branch's name, or the group for its corner stone; null for a position that is not on it. */
  name: string | null
  /**
   * The group on the list; the same name can stand in two groups (starts spec 5.4). None for a group's corner stone,
   * whose name is the group, and in sessions saved before it.
   */
  group?: StartGroup
  mirror: boolean
  /** Spec (starts) 3.4: the start ends with the opponent's dubious move («Случайно» only). */
  dubious?: boolean
  /** The colours of a dubious start were swapped so that the user answers the dubious move. */
  swapColors?: boolean
}

export interface ResolvedSettings {
  mode: Mode
  environment: Environment
  userColor: Color
  botRank: string
  corner: Corner
  /** Only in traps mode. */
  trap?: TrapRef
  /** Only in the start modes ('random', 'list'). */
  start?: StartRef
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
  /** The visits the analysis rests on. */
  visits: number
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

export type TrapVerdict = 'correct' | 'caught' | 'other'

/** Turns are relative to the session's `moves`; null when the move is in `initialMoves` or was not played. */
export interface ReviewTrap {
  trickTurn: number | null
  answerTurn: number | null
  verdict: TrapVerdict | null
  good: MoveVertex[]
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
  /** Only in traps mode. */
  trap?: ReviewTrap
}

export type HealthState = 'starting' | 'ready' | 'failed'

export interface HealthResponse {
  state: HealthState
  reason: LocalizedText | null
}

export const otherColor = (c: Color): Color => (c === 'B' ? 'W' : 'B')

export const BOT_RANKS: readonly string[] = [
  ...Array.from({ length: 20 }, (_, i) => `${20 - i}k`),
  ...Array.from({ length: 9 }, (_, i) => `${i + 1}d`),
]

export const isBotRank = (s: string): boolean => BOT_RANKS.includes(s)

export const DEFAULT_BOT_RANK = '7k'

/** The colour theme: «Как в системе», «Светлая», «Тёмная». */
export type Theme = 'system' | 'light' | 'dark'
export const THEMES: readonly Theme[] = ['system', 'light', 'dark']

/** `GET/PUT /api/ui`: interface preferences saved in the config file. */
export interface UiSettings {
  theme: Theme
  /** Spec (languages) 3: absent until the player (or the installer) chooses; the interface is English meanwhile. */
  language?: Language
}

/** What `GET /api/traps` reports about the loaded traps base. */
export interface TrapsInfo {
  count: number
  verified: boolean
}

/** Groups of the named start list, in screen order: the first move in the corner. */
export const START_GROUPS = ['4-4', '3-4', '3-3', '5-4', '5-3'] as const
export type StartGroup = (typeof START_GROUPS)[number]
export const isStartGroup = (value: unknown): value is StartGroup => (START_GROUPS as readonly unknown[]).includes(value)

/** One position of the named list; `moves` are canonical (top-right corner, Black first) in GTP. */
export interface StartListEntry {
  id: string
  group: StartGroup
  /** The full name: crumbs of the game and the review. */
  name: string
  /** The caption in the tree (starts spec 5.1); the full name when the list file has none. */
  short: string
  /** Played by pros fewer than 10 times since 2016 (starts spec 3.3): shown muted with «редко». */
  rare: boolean
  moves: string[]
}

/** A named node of the tree that is not a position itself, e.g. «Малое приближение» (starts spec 3.3); canonical GTP moves. */
export interface StartBranch {
  /** A training can start from a branch (starts spec 5.1): the start id of its moves. */
  id: string
  moves: string[]
  name: string
}

/** The corner stone of a group whose positions all begin with it; a training can start from it (starts spec 5.1). */
export interface StartGroupHead {
  id: string
  group: StartGroup
  /** The one canonical GTP move. */
  moves: string[]
}

/** What `GET /api/starts` reports: how many start positions the base holds, the named list, its branches and group stones. */
export interface StartsInfo {
  count: number
  list: StartListEntry[]
  branches: StartBranch[]
  groups: StartGroupHead[]
}
