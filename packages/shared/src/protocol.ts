import type { SessionSettings, SessionView, Vertex } from './types'

export type ClientMessage =
  | { type: 'startSession'; settings: SessionSettings }
  | { type: 'playMove'; sessionId: string; vertex: Vertex }
  | { type: 'tenuki'; sessionId: string }
  | { type: 'finish'; sessionId: string }
  | { type: 'continuePlaying'; sessionId: string }
  | { type: 'replayFrom'; sessionId: string; turn: number }
  | { type: 'resync'; sessionId: string }

export type ErrorCode =
  | 'bad_request'
  | 'illegal_move'
  | 'outside_zone'
  | 'not_your_turn'
  | 'session_not_found'
  | 'session_finished'
  | 'engine_error'
  | 'internal_error'

/** `sessionState` carries every session change: user and bot moves, "bot thinking", end proposals. */
export type ServerMessage =
  | { type: 'sessionState'; session: SessionView }
  | { type: 'analysisProgress'; sessionId: string; done: number; total: number }
  | { type: 'reviewReady'; sessionId: string }
  | { type: 'error'; code: ErrorCode; message: string }
