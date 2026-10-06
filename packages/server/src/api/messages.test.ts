import { describe, expect, it } from 'vitest'
import { parseClientMessage } from './messages'

describe('parseClientMessage', () => {
  it('accepts well-formed messages', () => {
    expect(parseClientMessage('{"type":"playMove","sessionId":"s1","vertex":[15,3]}')).toEqual({ type: 'playMove', sessionId: 's1', vertex: [15, 3] })
    expect(parseClientMessage('{"type":"replayFrom","sessionId":"s1","turn":2}')).toEqual({ type: 'replayFrom', sessionId: 's1', turn: 2 })
    expect(parseClientMessage('{"type":"finish","sessionId":"s1"}')).toEqual({ type: 'finish', sessionId: 's1' })
  })

  it('rejects malformed messages', () => {
    const codeOf = (text: string): string | null => {
      try {
        parseClientMessage(text)
        return null
      } catch (err) {
        return (err as { code?: string }).code ?? 'no-code'
      }
    }
    for (const bad of ['nope', '{}', '{"type":"dance"}', '{"type":"finish"}', '{"type":"playMove","sessionId":"s1","vertex":[19,0]}', '{"type":"replayFrom","sessionId":"s1","turn":1.5}', '{"type":"startSession"}']) {
      expect(codeOf(bad)).toBe('bad_request')
    }
  })
})
