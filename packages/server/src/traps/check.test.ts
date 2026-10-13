import { gtpToVertex, vertexToGtp, zoneVertices, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { StubEngine } from '../../test/helpers'
import { EngineError } from '../engine/engine'
import { decodeJdb, encodeJdb, trapId, type CanonicalMove, type JdbBase, type JdbNode, type JdbTree } from '../jdb'
import { checkTraps } from './check'
import { testTrapsTree } from './fixture'

const v = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex
const OPTS = { visits: 100, goodMax: 1, caughtGap: 2 }
const base = (tree: JdbTree = testTrapsTree()): JdbBase => decodeJdb(encodeJdb({ ...tree, verified: false }))
const ID1 = trapId(['Q16', 'O17', 'O18'].map(v))
const ID2 = trapId(['Q16', 'O17', 'Q14', 'R18'].map(v))
const key = (...m: string[]): string => m.join(' ')

function node(gtp: string, category: JdbNode['category'], children: JdbNode[] = []): JdbNode {
  return { move: gtp === 'tenuki' ? 'tenuki' : v(gtp), category, loss: null, children }
}

/** Trap 1 (answer index 3, White): best -3 in the Black view; losses 0, 0.5 and 4. */
const TRAP1: Record<string, number> = {
  [key('Q16', 'O17', 'O18', 'P17')]: -3,
  [key('Q16', 'O17', 'O18', 'P18')]: -2.5,
  [key('Q16', 'O17', 'O18', 'N18')]: 1,
}
/** Trap 2 (answer index 4, Black): best +3; losses 0, 0.5 (the tenuki, +2.5 outside the zone) and 3. */
const TRAP2: Record<string, number> = {
  [key('Q16', 'O17', 'Q14', 'R18', 'R17')]: 3,
  [key('Q16', 'O17', 'Q14', 'R18', 'Q18')]: 0,
}

const ZONE = new Set(zoneVertices('TR').map(vertexToGtp))

/**
 * The zone query returns the answerer's best (-3 before trap 1's answer, +3 before trap 2's); the query among the points
 * outside the zone (a tenuki answer) returns `tenuki`; other queries look the position up.
 */
function leadEngine(after: Record<string, number>, tenuki = 2.5): StubEngine {
  const engine = new StubEngine()
  engine.lead = (q) => {
    if (!q.allowMoves) return after[key(...q.moves.map(([, m]) => m))] ?? 0
    if (!ZONE.has(q.allowMoves[0].moves[0])) return tenuki
    return q.moves.length === 3 ? -3 : 3
  }
  return engine
}

describe('checkTraps', () => {
  it('queries the zone for the answering colour before the answer', async () => {
    const engine = leadEngine(TRAP1)
    await checkTraps(base(), engine, OPTS, () => {})
    const before = engine.queries.find((q) => q.allowMoves && q.moves.length === 3)
    expect(before?.moves.map(([c, m]) => `${c}${m}`)).toEqual(['BQ16', 'WO17', 'BO18'])
    expect(before?.allowMoves).toHaveLength(1)
    expect(before?.allowMoves?.[0].player).toBe('W')
    expect(before?.allowMoves?.[0].untilDepth).toBe(1)
    expect(before?.allowMoves?.[0].moves).not.toContain('O18')
    expect(before?.allowMoves?.[0].moves).toContain('P17')
    expect(before?.maxVisits).toBe(100)
  })

  it('writes loss = best zone lead minus the lead after the answer, in the answerer view', async () => {
    const out = await checkTraps(base(), leadEngine(TRAP1), OPTS, () => {})
    const b = decodeJdb(encodeJdb(out.tree))
    const loss = (m: string): number | null => b.loss(b.find([...['Q16', 'O17', 'O18'].map(v), v(m)])!)
    expect(loss('P17')).toBe(0)
    expect(loss('P18')).toBe(0.5)
    expect(loss('N18')).toBe(4)
  })

  it('uses the Black view when Black answers', async () => {
    const tree: JdbTree = {
      kind: 'traps',
      verified: false,
      roots: [node('Q16', 'none', [node('O17', 'trap', [node('P17', 'good'), node('N18', 'caught')])])],
    }
    const engine = new StubEngine()
    engine.lead = (q) => (q.allowMoves ? 2 : ({ [key('Q16', 'O17', 'P17')]: 2, [key('Q16', 'O17', 'N18')]: -1 }[key(...q.moves.map(([, m]) => m))] ?? 0))
    const out = await checkTraps(base(tree), engine, OPTS, () => {})
    expect(engine.queries.find((q) => q.allowMoves)?.allowMoves?.[0].player).toBe('B')
    const b = decodeJdb(encodeJdb(out.tree))
    expect(b.loss(b.find(['Q16', 'O17', 'P17'].map(v))!)).toBe(0)
    expect(b.loss(b.find(['Q16', 'O17', 'N18'].map(v))!)).toBe(3)
  })

  it('keeps traps that pass both thresholds and sets verified', async () => {
    const out = await checkTraps(base(), leadEngine({ ...TRAP1, ...TRAP2 }), OPTS, () => {})
    expect(out.kept).toBe(2)
    expect(out.dropped).toEqual([])
    expect(out.tree.verified).toBe(true)
  })

  it('drops a trap whose good answer loses too much (goodMax)', async () => {
    // Trap 2: both good answers lose more than 1.
    const engine = leadEngine({
      ...TRAP1,
      [key('Q16', 'O17', 'Q14', 'R18', 'R17')]: 1.5,
      [key('Q16', 'O17', 'Q14', 'R18', 'Q18')]: -5,
    }, 1.4)
    const out = await checkTraps(base(), engine, OPTS, () => {})
    expect(out.kept).toBe(1)
    expect(out.dropped).toHaveLength(1)
    expect(out.dropped[0].id).toBe(ID2)
    expect(out.dropped[0].reason).toMatch(/good/)
  })

  it('drops a trap whose caught answer is not bad enough (caughtGap)', async () => {
    // Trap 1: the caught answer N18 loses only 1, gap 1 < 2.
    const engine = leadEngine({
      ...TRAP2,
      [key('Q16', 'O17', 'O18', 'P17')]: -3,
      [key('Q16', 'O17', 'O18', 'P18')]: -3,
      [key('Q16', 'O17', 'O18', 'N18')]: -2,
    })
    const out = await checkTraps(base(), engine, OPTS, () => {})
    expect(out.kept).toBe(1)
    expect(out.dropped.map((d) => d.id)).toEqual([ID1])
    expect(out.dropped[0].reason).toMatch(/caught/)
  })

  it('keeps a good answer losing exactly goodMax', async () => {
    // Trap 1: best for White is +3; P17 and P18 end at +2 (loss exactly 1), N18 at -1 (loss 4).
    const engine = leadEngine({ ...TRAP2, [key('Q16', 'O17', 'O18', 'P17')]: -2, [key('Q16', 'O17', 'O18', 'P18')]: -2, [key('Q16', 'O17', 'O18', 'N18')]: 1 })
    const out = await checkTraps(base(), engine, OPTS, () => {})
    expect(out.dropped).toEqual([])
    expect(out.kept).toBe(2)
    expect(out.weakAnswers).toEqual([])
  })

  it('removes a good answer that loses more than goodMax from a kept trap and reports it', async () => {
    // Trap 1: P17 loses 0, P18 ends at +1.5 for White (loss 1.5), N18 loses 4.
    const engine = leadEngine({ ...TRAP2, [key('Q16', 'O17', 'O18', 'P17')]: -3, [key('Q16', 'O17', 'O18', 'P18')]: -1.5, [key('Q16', 'O17', 'O18', 'N18')]: 1 })
    const lines: string[] = []
    const out = await checkTraps(base(), engine, OPTS, (l) => lines.push(l))
    expect(out.kept).toBe(2)
    expect(out.weakAnswers).toEqual([{ id: ID1, move: v('P18'), loss: 1.5 }])
    expect(lines).toContain(`[1/2] ${ID1}: kept, good answers dropped: P18 1.5`)
    const b = decodeJdb(encodeJdb(out.tree))
    const trap = b.find(['Q16', 'O17', 'O18'].map(v))!
    expect(b.children(trap).map((c) => [vertexToGtp(b.move(c) as Vertex), b.category(c), b.loss(c)])).toEqual([['P17', 'good', 0], ['N18', 'caught', 4]])
  })

  it('keeps a trap whose caught answer is exactly caughtGap worse than the good one', async () => {
    // Trap 1: the good answers lose 0, N18 ends at +1 for White (loss exactly 2).
    const engine = leadEngine({ ...TRAP2, [key('Q16', 'O17', 'O18', 'P17')]: -3, [key('Q16', 'O17', 'O18', 'P18')]: -3, [key('Q16', 'O17', 'O18', 'N18')]: -1 })
    const out = await checkTraps(base(), engine, OPTS, () => {})
    expect(out.dropped).toEqual([])
    expect(out.kept).toBe(2)
  })

  it('compares the unrounded losses and stores the rounded ones', async () => {
    // A good loss of 1.04 rounds to 1 but is over goodMax; the trap is dropped.
    const over = leadEngine({ ...TRAP2, [key('Q16', 'O17', 'O18', 'P17')]: -1.96, [key('Q16', 'O17', 'O18', 'P18')]: -1.96, [key('Q16', 'O17', 'O18', 'N18')]: 5 })
    const dropped = await checkTraps(base(), over, OPTS, () => {})
    expect(dropped.dropped.map((d) => d.id)).toEqual([ID1])
    expect(dropped.dropped[0].reason).toMatch(/good/)
    // A loss of 0.14 is stored as 0.1.
    const ok = leadEngine({ ...TRAP1, ...TRAP2, [key('Q16', 'O17', 'O18', 'P17')]: -2.86 })
    const out = await checkTraps(base(), ok, OPTS, () => {})
    const b = decodeJdb(encodeJdb(out.tree))
    expect(b.loss(b.find(['Q16', 'O17', 'O18', 'P17'].map(v))!)).toBe(0.1)
  })

  it('drops a trap that has no caught answer', async () => {
    const tree: JdbTree = {
      kind: 'traps',
      verified: false,
      roots: [node('Q16', 'none', [node('O17', 'trap', [node('P17', 'good'), node('P18', 'good')])])],
    }
    const out = await checkTraps(base(tree), new StubEngine(), OPTS, () => {})
    expect(out.kept).toBe(0)
    expect(out.dropped).toEqual([{ id: trapId(['Q16', 'O17'].map(v)), reason: 'no caught answer' }])
  })

  it('leaves a trap whose query is rejected unchanged, goes on and does not mark the base as verified', async () => {
    const engine = leadEngine(TRAP2)
    // The first zone query belongs to trap 1.
    engine.fail = { when: (q) => q.allowMoves !== undefined, error: new EngineError('boom', 'query_error') }
    const lines: string[] = []
    const out = await checkTraps(base(), engine, OPTS, (l) => lines.push(l))
    expect(out.dropped).toEqual([])
    expect(out.failed).toEqual([{ id: ID1, reason: 'error: boom' }])
    expect(out.kept).toBe(1)
    expect(out.tree.verified).toBe(false)
    expect(lines.some((l) => l.includes(ID1) && l.includes('error: boom'))).toBe(true)
    const b = decodeJdb(encodeJdb(out.tree))
    const unchanged = b.find(['Q16', 'O17', 'O18'].map(v))!
    expect(b.category(unchanged)).toBe('trap')
    expect(b.children(unchanged).map((c) => [b.category(c), b.loss(c)])).toEqual([['good', null], ['good', null], ['caught', null]])
  })

  it('drops a trap with an illegal position', async () => {
    const tree: JdbTree = {
      kind: 'traps',
      verified: false,
      roots: [node('Q16', 'none', [node('Q16', 'trap', [node('P17', 'good'), node('N18', 'caught')])])],
    }
    const out = await checkTraps(base(tree), new StubEngine(), OPTS, () => {})
    expect(out.dropped).toEqual([{ id: trapId(['Q16', 'Q16'].map(v)), reason: 'illegal position' }])
    expect(out.failed).toEqual([])
    expect(out.kept).toBe(0)
    expect(out.tree.verified).toBe(true)
    expect(out.tree.roots).toEqual([])
  })

  it('drops a trap with an illegal answer', async () => {
    // O17 is taken by the trap move itself.
    const tree: JdbTree = {
      kind: 'traps',
      verified: false,
      roots: [node('Q16', 'none', [node('O17', 'trap', [node('P17', 'good'), node('O17', 'good'), node('N18', 'caught')])])],
    }
    const out = await checkTraps(base(tree), new StubEngine(), OPTS, () => {})
    expect(out.dropped).toEqual([{ id: trapId(['Q16', 'O17'].map(v)), reason: 'illegal answer O17' }])
    expect(out.failed).toEqual([])
    expect(out.tree.verified).toBe(true)
  })

  it('retries a query once when the engine fails, and judges the trap normally', async () => {
    const engine = leadEngine({ ...TRAP1, ...TRAP2 })
    engine.fail = { when: (q) => q.allowMoves !== undefined && q.moves.length === 3, error: new EngineError('query hung', 'engine_failed') }
    const out = await checkTraps(base(), engine, OPTS, () => {})
    expect(out.kept).toBe(2)
    expect(out.dropped).toEqual([])
    expect(out.tree.verified).toBe(true)
  })

  it('rejects when a query fails twice in a row', async () => {
    const engine = leadEngine({ ...TRAP1, ...TRAP2 })
    const analyze = engine.analyze.bind(engine)
    engine.analyze = async (q) => {
      if (q.allowMoves !== undefined && q.moves.length === 3) throw new EngineError('query hung', 'engine_failed')
      return analyze(q)
    }
    await expect(checkTraps(base(), engine, OPTS, () => {})).rejects.toMatchObject({ code: 'engine_failed' })
  })

  it('rejects when the engine keeps failing, so nothing is written', async () => {
    const engine = leadEngine({ ...TRAP1, ...TRAP2 })
    // Trap 1 is judged first; the zone query of trap 2 (four moves) fails on the retry too.
    const analyze = engine.analyze.bind(engine)
    engine.analyze = async (q) => {
      if (q.allowMoves !== undefined && q.moves.length === 4) throw new EngineError('KataGo stopped', 'engine_failed')
      return analyze(q)
    }
    await expect(checkTraps(base(), engine, OPTS, () => {})).rejects.toMatchObject({ code: 'engine_failed' })
  })

  it('prunes branches left without traps', async () => {
    const out = await checkTraps(base(), new StubEngine(), OPTS, () => {}) // all leads 0: nothing is caught
    expect(out.kept).toBe(0)
    expect(out.dropped).toHaveLength(2)
    expect(out.tree.roots).toEqual([])
    expect(out.tree.verified).toBe(true)
  })

  it('prunes only the dead branch', async () => {
    const out = await checkTraps(base(), leadEngine(TRAP2), OPTS, () => {}) // trap 1 has no sensible leads
    const b = decodeJdb(encodeJdb(out.tree))
    expect(out.dropped.map((d) => d.id)).toEqual([ID1])
    expect(b.nodesOf('trap')).toHaveLength(1)
    expect(b.find(['Q16', 'O17', 'O18'].map(v))).toBeNull()
    expect(b.find(['Q16', 'O17', 'Q14', 'R18'].map(v))).not.toBeNull()
    // Q16, O17, Q14, R18 and its three answers.
    expect(b.size).toBe(7)
  })

  it('measures a tenuki answer as the best move outside the zone, not as a pass', async () => {
    const engine = leadEngine(TRAP2) // outside the zone Black keeps +2.5, the zone best is +3
    const out = await checkTraps(base(), engine, OPTS, () => {})
    expect(engine.queries.some((q) => !q.allowMoves && q.moves.at(-1)?.[1] === 'pass')).toBe(false)
    const outside = engine.queries.find((q) => q.allowMoves && !ZONE.has(q.allowMoves[0].moves[0]))!
    expect(outside.moves.map(([c, m]) => `${c}${m}`)).toEqual(['BQ16', 'WO17', 'BQ14', 'WR18'])
    expect(outside.allowMoves).toHaveLength(1)
    expect(outside.allowMoves![0]).toMatchObject({ player: 'B', untilDepth: 1 })
    expect(outside.allowMoves![0].moves.every((m) => !ZONE.has(m))).toBe(true)
    expect(outside.allowMoves![0].moves.length).toBeGreaterThan(200)
    expect(outside.maxVisits).toBe(100)
    const b = decodeJdb(encodeJdb(out.tree))
    const path: CanonicalMove[] = [...['Q16', 'O17', 'Q14', 'R18'].map(v), 'tenuki']
    expect(b.loss(b.find(path)!)).toBe(0.5)
  })

  describe('nested traps', () => {
    // Q16 O17 O18 (trap, White answers) -> P17 (good) -> Q14 (trap, White answers: R17 good, N18 caught).
    const nested = (): JdbTree => ({
      kind: 'traps',
      verified: false,
      roots: [
        node('Q16', 'none', [
          node('O17', 'none', [
            node('O18', 'trap', [
              node('P17', 'good', [node('Q14', 'trap', [node('R17', 'good'), node('N18', 'caught')])]),
              node('P18', 'good'),
              node('N18', 'caught'),
            ]),
          ]),
        ]),
      ],
    })
    const OUTER = trapId(['Q16', 'O17', 'O18'].map(v))
    const INNER = trapId(['Q16', 'O17', 'O18', 'P17', 'Q14'].map(v))
    const engineFor = (outerCaught: number): StubEngine => {
      const engine = new StubEngine()
      engine.lead = (q) => {
        if (q.allowMoves) return -3
        const last = q.moves.at(-1)![1]
        return last === 'N18' ? (q.moves.length === 4 ? outerCaught : 1) : -3
      }
      return engine
    }

    it('checks a nested trap and keeps it while the outer one is kept', async () => {
      const lines: string[] = []
      const out = await checkTraps(base(nested()), engineFor(1), OPTS, (l) => lines.push(l))
      expect(out.kept).toBe(2)
      expect(out.dropped).toEqual([])
      const b = decodeJdb(encodeJdb(out.tree))
      expect(b.nodesOf('trap')).toHaveLength(2)
      expect(b.loss(b.find([...['Q16', 'O17', 'O18', 'P17', 'Q14'].map(v), v('N18')])!)).toBe(4)
      expect(lines.some((l) => l.startsWith('[2/2]') && l.includes(INNER))).toBe(true)
    })

    it('keeps the way to a nested trap below a good answer it removes', async () => {
      // P17 ends at -1 for Black, +1 for White: it loses 2 against the zone best of +3.
      const engine = engineFor(1)
      const lead = engine.lead
      engine.lead = (q) => (!q.allowMoves && q.moves.length === 4 && q.moves[3][1] === 'P17' ? -1 : lead(q))
      const out = await checkTraps(base(nested()), engine, OPTS, () => {})
      expect(out.kept).toBe(2)
      expect(out.weakAnswers).toEqual([{ id: OUTER, move: v('P17'), loss: 2 }])
      const b = decodeJdb(encodeJdb(out.tree))
      const p17 = b.find(['Q16', 'O17', 'O18', 'P17'].map(v))!
      expect([b.category(p17), b.loss(p17)]).toEqual(['none', null])
      expect(b.category(b.find(['Q16', 'O17', 'O18', 'P17', 'Q14'].map(v))!)).toBe('trap')
    })

    it('keeps a nested trap when the outer one is dropped, as a plain node', async () => {
      const out = await checkTraps(base(nested()), engineFor(-3), OPTS, () => {}) // the outer caught answer is not bad enough
      expect(out.kept).toBe(1)
      expect(out.dropped.map((d) => d.id)).toEqual([OUTER])
      expect(out.tree.verified).toBe(true)
      const b = decodeJdb(encodeJdb(out.tree))
      expect(b.nodesOf('trap')).toHaveLength(1)
      expect(b.category(b.find(['Q16', 'O17', 'O18'].map(v))!)).toBe('none')
      expect(b.category(b.find(['Q16', 'O17', 'O18', 'P17', 'Q14'].map(v))!)).toBe('trap')
      // The answers without a trap below them are pruned.
      expect(b.find([...['Q16', 'O17', 'O18'].map(v), v('P18')])).toBeNull()
      expect(b.find([...['Q16', 'O17', 'O18'].map(v), v('N18')])).toBeNull()
    })
  })

  describe('a trap directly under an answer of another trap', () => {
    // Q16 O17 O18 (trap, White answers): P17 good, P18 good, Q14 trap (an answer of the outer one; Black answers: R17 good, N18 caught).
    const direct = (): JdbTree => ({
      kind: 'traps',
      verified: false,
      roots: [
        node('Q16', 'none', [
          node('O17', 'none', [
            node('O18', 'trap', [node('P17', 'good'), node('P18', 'good'), node('N18', 'caught'), node('Q14', 'trap', [node('R17', 'good'), node('N18', 'caught')])]),
          ]),
        ]),
      ],
    })
    const OUTER = trapId(['Q16', 'O17', 'O18'].map(v))
    const INNER = trapId(['Q16', 'O17', 'O18', 'Q14'].map(v))
    const engineFor = (outerCaught: number): StubEngine => {
      const engine = new StubEngine()
      engine.lead = (q) => {
        if (q.allowMoves) return -3
        const last = q.moves.at(-1)![1]
        if (q.moves.length === 5) return last === 'N18' ? -6 : -3 // the inner trap, Black answers
        return last === 'N18' ? outerCaught : -3
      }
      return engine
    }

    it('judges the inner trap and keeps the outer loss on its node', async () => {
      const lines: string[] = []
      const out = await checkTraps(base(direct()), engineFor(1), OPTS, (l) => lines.push(l))
      expect(out.kept).toBe(2)
      expect(out.dropped).toEqual([])
      const b = decodeJdb(encodeJdb(out.tree))
      const inner = b.find([...['Q16', 'O17', 'O18'].map(v), v('Q14')])!
      expect(b.category(inner)).toBe('trap')
      expect(b.loss(inner)).toBe(0)
      expect(b.loss(b.find([...['Q16', 'O17', 'O18', 'Q14'].map(v), v('N18')])!)).toBe(3)
      expect(lines.some((l) => l.startsWith('[2/2]') && l.includes(INNER))).toBe(true)
    })

    it('judges the inner trap even when the outer one is dropped', async () => {
      const out = await checkTraps(base(direct()), engineFor(-3), OPTS, () => {})
      expect(out.dropped.map((d) => d.id)).toEqual([OUTER])
      expect(out.kept).toBe(1)
      const b = decodeJdb(encodeJdb(out.tree))
      expect(b.category(b.find(['Q16', 'O17', 'O18'].map(v))!)).toBe('none')
      expect(b.category(b.find([...['Q16', 'O17', 'O18'].map(v), v('Q14')])!)).toBe('trap')
      expect(b.nodesOf('trap')).toHaveLength(1)
    })
  })

  it('logs progress', async () => {
    const lines: string[] = []
    await checkTraps(base(), new StubEngine(), OPTS, (l) => lines.push(l))
    expect(lines.length).toBeGreaterThan(0)
  })
})
