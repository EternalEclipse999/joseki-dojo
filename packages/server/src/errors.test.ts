import { describe, expect, it } from 'vitest'
import { IllegalMoveError } from '@joseki-dojo/shared'
import { EngineError } from './engine/engine'
import { toErrorMessage } from './errors'
import { SessionError } from './session/session'

describe('toErrorMessage', () => {
  it('maps known errors to protocol codes', () => {
    expect(toErrorMessage(new IllegalMoveError('Ko prevented'))).toEqual({ type: 'error', code: 'illegal_move', message: 'Недопустимый ход' })
    expect(toErrorMessage(new SessionError('Сейчас ход бота', 'not_your_turn'))).toEqual({ type: 'error', code: 'not_your_turn', message: 'Сейчас ход бота' })
    expect(toErrorMessage(new EngineError('boom', 'engine_failed'))).toEqual({ type: 'error', code: 'engine_error', message: 'boom' })
    expect(toErrorMessage(new Error('x'))).toEqual({ type: 'error', code: 'internal_error', message: 'x' })
  })
})
