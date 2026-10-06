/** Body of a KataGo analysis query without `id` (the engine assigns ids). One turn per query. */
export interface KataGoQueryBody {
  moves: [string, string][]
  rules: string
  komi: number
  boardXSize: number
  boardYSize: number
  initialStones?: [string, string][]
  maxVisits?: number
  includeOwnership?: boolean
  includePolicy?: boolean
  priority?: number
  allowMoves?: { player: string; moves: string[]; untilDepth: number }[]
  overrideSettings?: Record<string, string | number | boolean>
}

export interface MoveInfo {
  move: string
  order: number
  visits: number
  scoreLead: number
  winrate: number
  pv: string[]
  prior?: number
  humanPrior?: number
}

export interface RootInfo {
  currentPlayer: 'B' | 'W'
  scoreLead: number
  winrate: number
  visits: number
}

export interface AnalysisResponse {
  id: string
  turnNumber: number
  isDuringSearch: boolean
  moveInfos: MoveInfo[]
  rootInfo: RootInfo
  ownership?: number[]
  policy?: number[]
  humanPolicy?: number[]
}

export interface VersionResponse {
  id: string
  action: 'query_version'
  version: string
  git_hash: string
}
