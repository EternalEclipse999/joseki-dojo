import { BOARD_SIZE, type ClientMessage, type Vertex } from '@joseki-dojo/shared'
import { SessionError } from '../session/session'

const bad = (): SessionError => new SessionError({ key: 'error.message.bad' }, 'bad_request')

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const isVertex = (v: unknown): v is Vertex =>
  Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0 && n < BOARD_SIZE)

const isVariation = (moves: unknown): moves is Vertex[] => Array.isArray(moves) && moves.length <= 200 && moves.every(isVertex)

/** Validates the shape of a client message; session settings are validated by SessionService. */
export function parseClientMessage(text: string): ClientMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw bad()
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') throw bad()
  const msg = parsed
  const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : null
  const cardId = typeof msg.cardId === 'string' ? msg.cardId : null
  switch (msg.type) {
    case 'startSession':
      if (!isRecord(msg.settings)) throw bad()
      return msg as unknown as ClientMessage
    case 'playMove':
      if (!sessionId || !isVertex(msg.vertex)) throw bad()
      return { type: 'playMove', sessionId, vertex: msg.vertex }
    case 'replayFrom':
      if (!sessionId || !Number.isInteger(msg.turn)) throw bad()
      return { type: 'replayFrom', sessionId, turn: msg.turn as number }
    case 'analyzeVariation':
      if (!sessionId || !Number.isInteger(msg.fromTurn) || (msg.fromTurn as number) < 0) throw bad()
      if (!isVariation(msg.moves)) throw bad()
      return { type: 'analyzeVariation', sessionId, fromTurn: msg.fromTurn as number, moves: msg.moves }
    case 'stopVariation':
      if (!sessionId) throw bad()
      return { type: 'stopVariation', sessionId }
    case 'analyzeProblemVariation':
      if (!cardId || !isVertex(msg.answer) || (msg.fromTurn !== 0 && msg.fromTurn !== 1) || !isVariation(msg.moves)) throw bad()
      return { type: 'analyzeProblemVariation', cardId, answer: msg.answer, fromTurn: msg.fromTurn, moves: msg.moves }
    case 'stopProblemVariation':
      if (!cardId) throw bad()
      return { type: 'stopProblemVariation', cardId }
    case 'tenuki':
    case 'finish':
    case 'continuePlaying':
    case 'resync':
      if (!sessionId) throw bad()
      return { type: msg.type as 'tenuki' | 'finish' | 'continuePlaying' | 'resync', sessionId }
    default:
      throw bad()
  }
}
