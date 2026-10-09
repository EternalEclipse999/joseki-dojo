import { describe, expect, it } from 'vitest'
import { Position } from '@joseki-dojo/shared'
import { josekiStartedIn } from './joseki-start'

describe('josekiStartedIn', () => {
  it('needs stones of both colors inside the zone', () => {
    expect(josekiStartedIn(Position.fromMoves([{ color: 'B', vertex: [15, 3] }]), 'TR')).toBe(false)
    expect(josekiStartedIn(Position.fromMoves([{ color: 'B', vertex: [15, 3] }, { color: 'W', vertex: [3, 15] }]), 'TR')).toBe(false)
    expect(josekiStartedIn(Position.fromMoves([{ color: 'B', vertex: [15, 3] }, { color: 'W', vertex: [16, 5] }]), 'TR')).toBe(true)
  })
})
