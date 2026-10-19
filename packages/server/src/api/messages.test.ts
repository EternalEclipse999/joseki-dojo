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

  it('accepts the problem variation messages', () => {
    expect(parseClientMessage('{"type":"analyzeProblemVariation","cardId":"c1","answer":[16,5],"fromTurn":1,"moves":[[16,2]]}')).toEqual({ type: 'analyzeProblemVariation', cardId: 'c1', answer: [16, 5], fromTurn: 1, moves: [[16, 2]] })
    expect(parseClientMessage('{"type":"analyzeProblemVariation","cardId":"c1","answer":[16,5],"fromTurn":0,"moves":[]}')).toEqual({ type: 'analyzeProblemVariation', cardId: 'c1', answer: [16, 5], fromTurn: 0, moves: [] })
    expect(parseClientMessage('{"type":"stopProblemVariation","cardId":"c1"}')).toEqual({ type: 'stopProblemVariation', cardId: 'c1' })
  })

  it('rejects malformed problem variation messages', () => {
    const msg = (over: object): string => JSON.stringify({ type: 'analyzeProblemVariation', cardId: 'c1', answer: [16, 5], fromTurn: 0, moves: [], ...over })
    for (const bad of [
      msg({ cardId: undefined }),
      msg({ cardId: '' }),
      msg({ cardId: 7 }),
      msg({ answer: undefined }),
      msg({ answer: [19, 0] }),
      msg({ answer: 'R14' }),
      msg({ fromTurn: undefined }),
      msg({ fromTurn: -1 }),
      msg({ fromTurn: 2 }),
      msg({ fromTurn: 0.5 }),
      msg({ moves: undefined }),
      msg({ moves: 'D4' }),
      msg({ moves: [[19, 0]] }),
      msg({ moves: Array.from({ length: 201 }, () => [3, 3]) }),
      '{"type":"stopProblemVariation"}',
      '{"type":"stopProblemVariation","cardId":""}',
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
