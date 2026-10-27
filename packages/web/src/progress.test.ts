import { LANGUAGES, type LocalizedName, type ProgressEntry, type ProgressView, type StartBranch, type StartGroupHead, type StartListEntry } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { aggregate, dueLine, mergeColors, treeProgress, viewsFor } from './progress'
import { buildStartTree, findById } from './start-tree'

const named = (ru: string): LocalizedName => Object.fromEntries(LANGUAGES.map((l) => [l, ru])) as LocalizedName
const pos = (id: string, group: StartListEntry['group'], moves: string): StartListEntry => ({ id, group, name: named(id), short: named(id), rare: false, moves: moves.split(' ') })
const branch = (moves: string): StartBranch => ({ id: `ветка ${moves}`, moves: moves.split(' '), name: named(moves) })
// As in start-tree.test: «хане» and «лавина» are nested in «снизу»; «меч» is not in the graph.
const LIST = [
  pos('косуми', '3-4', 'R16 P17 Q15'),
  pos('снизу', '3-4', 'R16 P16 P17'),
  pos('хане', '3-4', 'R16 P16 P17 O17'),
  pos('лавина', '3-4', 'R16 P16 P17 Q16 Q17 R15'),
  pos('кэйма', '4-4', 'Q16 R14 O17'),
  pos('меч', '3-4', 'R16 P16 M16'),
]
const GROUPS: StartGroupHead[] = [{ id: 'камень 3-4', group: '3-4', moves: ['R16'] }]
const tree = buildStartTree(LIST, [branch('R16 P17'), branch('R16 P16'), branch('Q16 R14')], GROUPS, 'Пустой угол', 'ru')
const key = (id: string): string => findById(tree, id)!.key

const entry = (percent: number, weight: number, due = false, dueAt: string | null = null): ProgressEntry => ({ percent, weight, due, dueAt })
const view = (color: 'B' | 'W', positions: Record<string, ProgressEntry>, overall = { percent: 0, due: 0 }): ProgressView => ({ hasWeights: true, level: '5k', color, overall, positions })

const BLACK = view(
  'B',
  { косуми: entry(0.5, 0.2), снизу: entry(0.4, 0.5, true), хане: entry(0.8, 0.25, true), лавина: entry(0, 0.05), кэйма: entry(1, 0.6) },
  { percent: 1.1 / 1.6, due: 2 },
)

describe('aggregate', () => {
  const rows = aggregate(tree, BLACK)

  it('gives a position its own percent and due mark, the positions nested in it not mixed in', () => {
    expect(rows.get(key('снизу'))).toEqual({ percent: 0.4, due: 1, dueAt: null })
    expect(rows.get(key('хане'))).toEqual({ percent: 0.8, due: 1, dueAt: null })
    expect(rows.get(key('кэйма'))).toEqual({ percent: 1, due: 0, dueAt: null })
  })

  it('weighs the positions under a branch, a group and the root by their weights, a nested one on its own', () => {
    // Σ weight × percent / Σ weight: (0.5 × 0.4 + 0.25 × 0.8 + 0.05 × 0) / 0.8.
    expect(rows.get('R16 P16')).toMatchObject({ due: 2 })
    expect(rows.get('R16 P16')!.percent).toBeCloseTo(0.5)
    expect(rows.get('R16 P17')!.percent).toBeCloseTo(0.5)
    expect(rows.get('group:3-4')).toMatchObject({ due: 2 })
    expect(rows.get('group:3-4')!.percent).toBeCloseTo(0.5)
    expect(rows.get('group:4-4')).toEqual({ percent: 1, due: 0, dueAt: null })
    expect(rows.get('')!.percent).toBeCloseTo(BLACK.overall.percent)
    expect(rows.get('')!.due).toBe(BLACK.overall.due)
  })

  it('gives no row to a position the view does not hold, nor to a node with none under it', () => {
    expect(rows.has(key('меч'))).toBe(false)
    const only = aggregate(tree, view('B', { кэйма: entry(0.3, 0.1) }))
    expect([...only.keys()].sort()).toEqual(['', 'Q16 R14', 'Q16 R14 O17', 'group:4-4'])
  })

  it('carries a position’s due time; a branch, a group and the root have none', () => {
    const soon = '2026-10-22T10:00:00.000Z'
    const timed = aggregate(tree, view('B', { снизу: entry(0.4, 0.5, true, soon), хане: entry(0.8, 0.25) }))
    expect(timed.get(key('снизу'))).toEqual({ percent: 0.4, due: 1, dueAt: soon })
    expect(timed.get(key('хане'))!.dueAt).toBeNull()
    expect(['R16 P16', 'group:3-4', ''].map((k) => timed.get(k)!.dueAt)).toEqual([null, null, null])
  })

  it('makes a node whose positions all have no weight 0 %, not NaN', () => {
    const zero = aggregate(tree, view('B', { кэйма: entry(0.7, 0, true) }))
    expect(zero.get(key('кэйма'))).toEqual({ percent: 0.7, due: 1, dueAt: null })
    expect(zero.get('group:4-4')).toEqual({ percent: 0, due: 1, dueAt: null })
  })
})

const WHITE = view(
  'W',
  { косуми: entry(0.1, 0.4), снизу: entry(0.2, 0.3), хане: entry(0, 0.1, true), лавина: entry(0.6, 0.1, true), кэйма: entry(0, 0.2) },
  { percent: 0.16 / 1.1, due: 2 },
)

describe('mergeColors', () => {
  const both = mergeColors(BLACK, WHITE)

  it('takes the mean of both colours for each position, due when it is due in either', () => {
    expect(both.positions.косуми.percent).toBeCloseTo(0.3)
    expect(both.positions.косуми.weight).toBeCloseTo(0.3)
    expect(both.positions.снизу).toMatchObject({ due: true })
    expect(both.positions.лавина).toMatchObject({ due: true })
    expect(both.positions.кэйма).toMatchObject({ percent: 0.5, due: false })
  })

  it('makes the whole list the mean of both percents and counts the positions due in either', () => {
    expect(both.overall.percent).toBeCloseTo((BLACK.overall.percent + WHITE.overall.percent) / 2)
    expect(both.overall.due).toBe(3)
    expect(both).toMatchObject({ hasWeights: true, level: '5k' })
  })

  it('gives each position the earlier due of both colours', () => {
    const dueAt = (black: string | null, white: string | null) => mergeColors(view('B', { x: entry(0, 1, false, black) }), view('W', { x: entry(0, 1, false, white) })).positions.x.dueAt
    const soon = '2026-10-22T10:00:00.000Z'
    const later = '2026-10-24T10:00:00.000Z'
    expect([dueAt(null, null), dueAt(later, null), dueAt(later, soon)]).toEqual([null, later, soon])
  })

  it('has weights only when both colours have them', () => {
    expect(mergeColors(BLACK, { ...WHITE, hasWeights: false, positions: {}, overall: { percent: 0, due: 0 } }).hasWeights).toBe(false)
  })
})

describe('treeProgress', () => {
  it('is the colour’s own rows for one colour', () => {
    expect(treeProgress(tree, [BLACK])).toEqual(aggregate(tree, BLACK))
  })

  it('gives each node the mean of both colours’ percents for a random colour, its due positions those due in either', () => {
    const black = aggregate(tree, BLACK)
    const white = aggregate(tree, WHITE)
    const rows = treeProgress(tree, [BLACK, WHITE])
    for (const k of ['', 'group:3-4', 'R16 P16', key('снизу'), key('кэйма')]) expect(rows.get(k)!.percent, k).toBeCloseTo((black.get(k)!.percent + white.get(k)!.percent) / 2)
    // The root row matches the summary's bar: the mean of both colours' whole-list percents.
    expect(rows.get('')!.percent).toBeCloseTo(mergeColors(BLACK, WHITE).overall.percent)
    expect(rows.get('')!.due).toBe(3)
    expect(rows.get(key('лавина'))!.due).toBe(1)
    expect(rows.get('R16 P16')!.due).toBe(3)
    // A position's own row counts itself only: «снизу» is due for Black, the nested «хане» and «лавина» are not in it.
    expect(rows.get(key('снизу'))!.due).toBe(1)
  })

  it('gives a position the earlier due time of both colours for a random colour; a branch and the root have none', () => {
    const soon = '2026-10-22T10:00:00.000Z'
    const later = '2026-10-24T10:00:00.000Z'
    const black = view('B', { снизу: entry(0.4, 0.5, false, later), кэйма: entry(1, 0.6, false, later), косуми: entry(0.5, 0.2, true, soon) })
    const white = view('W', { снизу: entry(0.2, 0.3, true, soon), кэйма: entry(0, 0.2) })
    const rows = treeProgress(tree, [black, white])
    expect([key('снизу'), key('кэйма'), key('косуми')].map((k) => rows.get(k)!.dueAt)).toEqual([soon, later, soon])
    expect(['R16 P16', 'group:4-4', ''].map((k) => rows.get(k)!.dueAt)).toEqual([null, null, null])
  })

  it('gives a row to a node either colour holds, from that colour alone', () => {
    const rows = treeProgress(tree, [BLACK, view('W', { косуми: entry(0.1, 0.4, true) })])
    expect(rows.get(key('кэйма'))).toEqual({ percent: 1, due: 0, dueAt: null })
    expect(rows.get('group:4-4')).toEqual({ percent: 1, due: 0, dueAt: null })
    expect(rows.get(key('косуми'))!.percent).toBeCloseTo(0.3)
    expect(rows.get(key('косуми'))!.due).toBe(1)
    expect(rows.has(key('меч'))).toBe(false)
    expect([...rows.keys()].sort()).toEqual([...aggregate(tree, BLACK).keys()].sort())
  })
})

describe('viewsFor', () => {
  it('takes the views of the colour picked', () => {
    const black = [BLACK] as const
    const both = [BLACK, WHITE] as const
    expect(viewsFor(black, 'B')).toEqual({ views: black, stale: false })
    expect(viewsFor(black, 'B')!.views).toBe(black)
    expect(viewsFor([WHITE], 'W')).toEqual({ views: [WHITE], stale: false })
    expect(viewsFor(both, 'random')).toEqual({ views: both, stale: false })
  })

  it("keeps another colour's views with weights, stale, while the picked one is read", () => {
    expect(viewsFor([BLACK], 'W')).toEqual({ views: [BLACK], stale: true })
    expect(viewsFor([WHITE], 'B')).toEqual({ views: [WHITE], stale: true })
    expect(viewsFor([BLACK], 'random')).toEqual({ views: [BLACK], stale: true })
    expect(viewsFor([BLACK, WHITE], 'B')).toEqual({ views: [BLACK, WHITE], stale: true })
  })

  it("drops another colour's views without weights: nothing to keep in place", () => {
    const bare = (v: ProgressView): ProgressView => ({ ...v, hasWeights: false, positions: {} })
    expect(viewsFor([bare(BLACK)], 'W')).toBeNull()
    expect(viewsFor([BLACK, bare(WHITE)], 'B')).toBeNull()
    expect(viewsFor([bare(BLACK)], 'B')).toEqual({ views: [bare(BLACK)], stale: false })
    expect(viewsFor(null, 'B')).toBeNull()
  })
})

describe('dueLine', () => {
  const now = new Date('2026-10-26T12:00:00Z')
  const future = '2026-10-30T12:00:00Z'
  const card = { stage: 'learning', due: future, dueNow: false } as const
  const row = (due: number, dueAt: string | null) => ({ percent: 0.5, due, dueAt })

  it('shows nothing with rows when the position is due now: the mark beside the percent says it', () => {
    expect(dueLine(true, row(1, '2026-10-20T12:00:00Z'), card, now)).toBeNull()
  })
  it('shows a future due with rows', () => {
    expect(dueLine(true, row(0, future), card, now)).toEqual({ now: false, at: future })
  })
  it('shows nothing with rows and no dueAt', () => {
    expect(dueLine(true, row(0, null), card, now)).toBeNull()
    expect(dueLine(true, undefined, card, now)).toBeNull()
  })
  it("shows the position card's line without rows, due or future", () => {
    expect(dueLine(false, undefined, card, now)).toEqual({ now: false, at: future })
    expect(dueLine(false, undefined, { ...card, dueNow: true }, now)).toEqual({ now: true, at: future })
    expect(dueLine(false, undefined, null, now)).toBeNull()
  })
})
