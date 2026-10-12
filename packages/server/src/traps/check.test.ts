import { gtpToVertex, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { StubEngine } from '../../test/helpers'
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
/** Trap 2 (answer index 4, Black): best +3; losses 0, 0.5 (the tenuki) and 3. */
const TRAP2: Record<string, number> = {
  [key('Q16', 'O17', 'Q14', 'R18', 'R17')]: 3,
  [key('Q16', 'O17', 'Q14', 'R18', 'pass')]: 2.5,
  [key('Q16', 'O17', 'Q14', 'R18', 'Q18')]: 0,
}

/** The restricted query returns the answerer's best (-3 before trap 1's answer, +3 before trap 2's); other queries look the position up. */
function leadEngine(after: Record<string, number>): StubEngine {
  const engine = new StubEngine()
  engine.lead = (q) => (q.allowMoves ? (q.moves.length === 3 ? -3 : 3) : (after[key(...q.moves.map(([, m]) => m))] ?? 0))
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
      [key('Q16', 'O17', 'Q14', 'R18', 'pass')]: 1.4,
      [key('Q16', 'O17', 'Q14', 'R18', 'Q18')]: -5,
    })
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

  it('appends a real pass for a tenuki answer', async () => {
    const engine = leadEngine(TRAP2)
    const out = await checkTraps(base(), engine, OPTS, () => {})
    const pass = engine.queries.find((q) => !q.allowMoves && q.moves.length === 5 && q.moves[4][1] === 'pass')
    expect(pass).toBeDefined()
    expect(pass?.moves[4][0]).toBe('B')
    const b = decodeJdb(encodeJdb(out.tree))
    const path: CanonicalMove[] = [...['Q16', 'O17', 'Q14', 'R18'].map(v), 'tenuki']
    expect(b.loss(b.find(path)!)).toBe(0.5)
  })

  it('logs progress', async () => {
    const lines: string[] = []
    await checkTraps(base(), new StubEngine(), OPTS, (l) => lines.push(l))
    expect(lines.length).toBeGreaterThan(0)
  })
})
