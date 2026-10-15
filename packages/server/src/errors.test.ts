import { describe, expect, it } from 'vitest'
import { IllegalMoveError } from '@joseki-dojo/shared'
import { EngineError } from './engine/engine'
import { toErrorMessage } from './errors'
import { SessionError } from './session/session'

describe('toErrorMessage', () => {
  it('maps known errors to protocol codes', () => {
    expect(toErrorMessage(new IllegalMoveError('Ko prevented'))).toEqual({ type: 'error', code: 'illegal_move', text: { key: 'error.move.illegal' } })
    expect(toErrorMessage(new SessionError({ key: 'error.move.notYourTurn' }, 'not_your_turn'))).toEqual({ type: 'error', code: 'not_your_turn', text: { key: 'error.move.notYourTurn' } })
    expect(toErrorMessage(new EngineError({ key: 'error.engine.stopped' }, 'engine_failed'))).toEqual({ type: 'error', code: 'engine_error', text: { key: 'error.engine.stopped' } })
  })

  it('sends a foreign error as error.internal with its text as detail', () => {
    expect(toErrorMessage(new Error('ECONNRESET'))).toEqual({ type: 'error', code: 'internal_error', text: { key: 'error.internal', params: { detail: 'ECONNRESET' } } })
  })
})
