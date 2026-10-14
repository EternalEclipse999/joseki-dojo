import { IllegalMoveError, type ServerMessage } from '@joseki-dojo/shared'
import { EngineError } from './engine/engine'
import { SessionError } from './session/session'
import { textOf } from './text-error'

export function toErrorMessage(err: unknown): Extract<ServerMessage, { type: 'error' }> {
  if (err instanceof IllegalMoveError) return { type: 'error', code: 'illegal_move', text: { key: 'error.move.illegal' } }
  if (err instanceof SessionError) return { type: 'error', code: err.code, text: err.text }
  if (err instanceof EngineError) return { type: 'error', code: 'engine_error', text: err.text }
  return { type: 'error', code: 'internal_error', text: textOf(err) }
}
