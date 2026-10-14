import { describe, expect, it } from 'vitest'
import { parseClientMessage } from './messages'

describe('parseClientMessage', () => {
  it('accepts well-formed messages', () => {
    expect(parseClientMessage('{"type":"playMove","sessionId":"s1","vertex":[15,3]}')).toEqual({ type: 'playMove', sessionId: 's1', vertex: [15, 3] })
    expect(parseClientMessage('{"type":"replayFrom","sessionId":"s1","turn":2}')).toEqual({ type: 'replayFrom', sessionId: 's1', turn: 2 })
    expect(parseClientMessage('{"type":"finish","sessionId":"s1"}')).toEqual({ type: 'finish', sessionId: 's1' })
  })

  it('accepts the variation messages', () => {
    expect(parseClientMessage('{"type":"analyzeVariation","sessionId":"s1","fromTurn":2,"moves":[[3,3],[15,15]]}')).toEqual({ type: 'analyzeVariation', sessionId: 's1', fromTurn: 2, moves: [[3, 3], [15, 15]] })
    expect(parseClientMessage('{"type":"analyzeVariation","sessionId":"s1","fromTurn":0,"moves":[]}')).toEqual({ type: 'analyzeVariation', sessionId: 's1', fromTurn: 0, moves: [] })
    expect(parseClientMessage('{"type":"stopVariation","sessionId":"s1"}')).toEqual({ type: 'stopVariation', sessionId: 's1' })
  })

  it('rejects malformed variation messages', () => {
    const tooMany = JSON.stringify({ type: 'analyzeVariation', sessionId: 's1', fromTurn: 0, moves: Array.from({ length: 201 }, () => [3, 3]) })
    for (const bad of [
      '{"type":"analyzeVariation","fromTurn":0,"moves":[]}',
      '{"type":"analyzeVariation","sessionId":"s1","moves":[]}',
      '{"type":"analyzeVariation","sessionId":"s1","fromTurn":-1,"moves":[]}',
      '{"type":"analyzeVariation","sessionId":"s1","fromTurn":1.5,"moves":[]}',
      '{"type":"analyzeVariation","sessionId":"s1","fromTurn":0}',
      '{"type":"analyzeVariation","sessionId":"s1","fromTurn":0,"moves":"D4"}',
      '{"type":"analyzeVariation","sessionId":"s1","fromTurn":0,"moves":[[19,0]]}',
      tooMany,
      '{"type":"stopVariation"}',
    ]) {
      expect(() => parseClientMessage(bad)).toThrow(expect.objectContaining({ code: 'bad_request' }))
    }
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
