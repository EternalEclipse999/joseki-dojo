import type { LocalizedText } from './i18n'
import type { PositionReview, SessionSettings, SessionView, Vertex } from './types'

export type ClientMessage =
  | { type: 'startSession'; settings: SessionSettings }
  | { type: 'playMove'; sessionId: string; vertex: Vertex }
  | { type: 'tenuki'; sessionId: string }
  | { type: 'finish'; sessionId: string }
  | { type: 'continuePlaying'; sessionId: string }
  | { type: 'replayFrom'; sessionId: string; turn: number }
  | { type: 'resync'; sessionId: string }
  | { type: 'analyzeVariation'; sessionId: string; fromTurn: number; moves: Vertex[] }
  | { type: 'stopVariation'; sessionId: string }
  /** Spec (problem variations) 3.1: a variation on a problem card — instead of the answer (fromTurn 0) or after it (1). */
  | { type: 'analyzeProblemVariation'; cardId: string; answer: Vertex; fromTurn: number; moves: Vertex[] }
  | { type: 'stopProblemVariation'; cardId: string }

export type ErrorCode =
  | 'bad_request'
  | 'illegal_move'
  | 'outside_zone'
  | 'not_your_turn'
  | 'session_not_found'
  | 'session_finished'
  | 'card_not_found'
  | 'engine_error'
  | 'internal_error'

/** `sessionState` carries every session change: user and bot moves, "bot thinking", end proposals. */
export type ServerMessage =
  | { type: 'sessionState'; session: SessionView }
  | { type: 'analysisProgress'; sessionId: string; done: number; total: number }
  | { type: 'reviewReady'; sessionId: string }
  /** Variations spec 6.2: the analysis of a variation position (or of a game position for «Глубже», with no moves). */
  | { type: 'variationAnalysis'; sessionId: string; fromTurn: number; moves: Vertex[]; visits: number; done: boolean; position: PositionReview }
  /** Spec (problem variations) 3.1: the analysis of a problem variation position (or of the problem position for «Глубже», with no moves). */
  | { type: 'problemVariationAnalysis'; cardId: string; fromTurn: number; moves: Vertex[]; visits: number; done: boolean; position: PositionReview }
  | { type: 'error'; code: ErrorCode; text: LocalizedText }
