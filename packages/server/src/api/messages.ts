import { BOARD_SIZE, type ClientMessage, type Vertex } from '@joseki-dojo/shared'
import { SessionError } from '../session/session'

const bad = (): SessionError => new SessionError('Некорректное сообщение', 'bad_request')

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const isVertex = (v: unknown): v is Vertex =>
  Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0 && n < BOARD_SIZE)

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
