import { IllegalMoveError, type ServerMessage } from '@joseki-dojo/shared'
import { EngineError } from './engine/engine'
import { SessionError } from './session/session'

export function toErrorMessage(err: unknown): Extract<ServerMessage, { type: 'error' }> {
  if (err instanceof IllegalMoveError) return { type: 'error', code: 'illegal_move', message: 'Недопустимый ход' }
  if (err instanceof SessionError) return { type: 'error', code: err.code, message: err.message }
  if (err instanceof EngineError) return { type: 'error', code: 'engine_error', message: err.message }
  return { type: 'error', code: 'internal_error', message: err instanceof Error ? err.message : String(err) }
}
