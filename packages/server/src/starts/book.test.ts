import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CORNERS, gtpToVertex, vertexToGtp, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../test/helpers'
import { decodeJdb, encodeJdb, fromTopRight, JdbError, mirrorDiagonal, needsMirror, trapId, type JdbNode } from '../jdb'
import { testTrapsTree } from '../traps/fixture'
import { StartBook } from './book'
import { TEST_STARTS_LIST, testDubiousStartsTree, testStartsTree, writeTestStarts } from './fixture'

const v = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex
const id = (moves: string): string => trapId(moves.split(' ').map(v))
const A = id('Q16 O17')
const B = id('Q16 O17 R14')
const C = id('Q17 R15')
const base = () => decodeJdb(encodeJdb(testStartsTree()))
const book = (): StartBook => StartBook.fromBase(base())
const listed = (): StartBook => book().withList(JSON.stringify(TEST_STARTS_LIST), () => {})

describe('StartBook', () => {
  it('keeps the fixture canonical', () => {
    const b = base()
    for (const i of b.nodesOf('start')) expect(needsMirror(b.path(i))).toBe(false)
  })

  it('lists the starts of the base in tree order', () => {
    expect(book().count).toBe(3)
    expect(book().ids()).toEqual([A, B, C])
    expect(book().has(B)).toBe(true)
  })

  it('is empty without a base', () => {
    const e = StartBook.empty()
    expect([e.count, e.ids(), e.list(), e.pick(() => 0, () => 0.5)]).toEqual([0, [], [], null])
  })

  it('loads a base file and refuses a traps base or a broken file', () => {
    const dir = tempDir()
    writeTestStarts(join(dir, 'starts.jdb'), join(dir, 'list.json'))
    expect(StartBook.loadBase(join(dir, 'starts.jdb')).count).toBe(3)
    writeFileSync(join(dir, 'traps.jdb'), encodeJdb(testTrapsTree()))
    expect(() => StartBook.loadBase(join(dir, 'traps.jdb'))).toThrow(JdbError)
    writeFileSync(join(dir, 'bad.jdb'), 'nonsense')
    expect(() => StartBook.loadBase(join(dir, 'bad.jdb'))).toThrow(JdbError)
  })

  it('skips starts that cannot be played', () => {
    const n = (gtp: string, category: JdbNode['category'], children: JdbNode[] = []): JdbNode => ({ move: gtp === 'tenuki' ? 'tenuki' : v(gtp), category, loss: null, children })
    const tree = { kind: 'starts' as const, verified: false, roots: [n('Q16', 'none', [n('Q16', 'start'), n('tenuki', 'none', [n('O17', 'start')]), n('O17', 'start')])] }
    const b = StartBook.fromBase(decodeJdb(encodeJdb(tree)))
    expect(b.ids()).toEqual([A])
    expect(b.skipped).toHaveLength(2)
  })

  it('reads the named list in file order, with short names, rare marks and branches', () => {
    const b = listed()
    expect(b.list()).toEqual([
      { id: B, group: '4-4', name: 'Тестовое начало 4-4', short: 'Начало 4-4', rare: false, moves: ['Q16', 'O17', 'R14'] },
      { id: C, group: '3-4', name: 'Тестовое начало 3-4', short: 'Тестовое начало 3-4', rare: true, moves: ['Q17', 'R15'] },
    ])
    expect(b.branches()).toEqual([{ id: A, moves: ['Q16', 'O17'], name: 'Тестовая ветка' }])
    expect([b.isListed(B), b.isListed(A)]).toEqual([true, false])
    expect([b.entryOf(C)?.group, b.entryOf(C)?.name, b.entryOf(A)]).toEqual(['3-4', 'Тестовое начало 3-4', null])
  })

  it('offers the corner stone of each group whose positions all begin with it', () => {
    expect(listed().groups()).toEqual([
      { id: id('Q16'), group: '4-4', moves: ['Q16'] },
      { id: id('Q17'), group: '3-4', moves: ['Q17'] },
    ])
    const split = book().withList(JSON.stringify({ positions: [{ group: '4-4', name: 'a', moves: 'Q16 O17' }, { group: '4-4', name: 'b', moves: 'Q17 R15' }] }), () => {})
    expect(split.groups()).toEqual([])
  })

  it('starts the tree from a position, a branch or a group stone, each named for the crumbs', () => {
    const b = listed()
    expect(b.listStart(B)).toEqual({ name: 'Тестовое начало 4-4', group: '4-4' })
    expect(b.listStart(A)).toEqual({ name: 'Тестовая ветка', group: '4-4' })
    expect(b.listStart(id('Q17'))).toEqual({ name: '3-4' })
    expect(b.listStart(id('Q16 R14'))).toBeNull()
    expect(b.place(id('Q17'), 'TR', false)).toEqual([{ color: 'B', vertex: v('Q17') }])
  })

  it('canonicalizes the moves of positions and branches', () => {
    // R14 is O17 mirrored in the diagonal.
    const b = book().withList(JSON.stringify({ branches: [{ moves: 'Q16 R14', name: 'Ветка' }], positions: [{ group: '4-4', name: 'Зеркально', moves: 'Q16 R14 O17' }] }), () => {})
    expect(b.list().map((e) => e.moves)).toEqual([['Q16', 'O17', 'R14']])
    expect(b.branches()).toEqual([{ id: A, moves: ['Q16', 'O17'], name: 'Ветка' }])
  })

  it('skips bad positions with a log line each', () => {
    const lines: string[] = []
    const positions = [
      { group: '6-6', name: 'x', moves: 'Q16 O17' },
      { group: '4-4', name: ' ', moves: 'Q16 O17' },
      { group: '4-4', name: 'x', moves: 'Q16 Z99' },
      { group: '4-4', name: 'x', moves: 'Q16 O16' },
      { group: '4-4', name: 'first', moves: 'Q16 O17' },
      { group: '4-4', name: 'again', moves: 'Q16 O17' },
      null,
    ]
    const b = book().withList(JSON.stringify({ positions }), (l) => lines.push(l))
    expect(b.list().map((e) => e.name)).toEqual(['first'])
    expect(lines).toHaveLength(6)
    expect(lines[0]).toMatch(/^Список стартовых позиций, позиция 1: /)
  })

  it('skips bad branches with a log line each', () => {
    const lines: string[] = []
    const branches = [
      { moves: 'Q16 O17', name: ' ' },
      { moves: 'Q16', name: 'один ход' },
      { moves: 'Q16 Z99', name: 'плохой ход' },
      { moves: 'Q16 O17 R14', name: 'это позиция' },
      { moves: 'Q17 R16', name: 'без позиций' },
      { moves: 'Q16 O17', name: 'ветка' },
      { moves: 'Q16 O17', name: 'повтор' },
    ]
    const b = book().withList(JSON.stringify({ branches, positions: TEST_STARTS_LIST.positions }), (l) => lines.push(l))
    expect(b.branches()).toEqual([{ id: A, moves: ['Q16', 'O17'], name: 'ветка' }])
    expect(lines).toHaveLength(6)
    expect(lines[0]).toMatch(/^Список стартовых позиций, ветка 1: /)
  })

  it('refuses a list that is not an object with positions', () => {
    for (const text of ['[]', '{"branches":[]}', 'null']) expect(() => book().withList(text, () => {})).toThrow('Список стартовых позиций должен быть объектом с массивом positions')
    expect(() => book().withList('not json', () => {})).toThrow()
  })

  it('picks the less shown starts more often', () => {
    const shows = (s: string): number => (s === C ? 1e9 : 0)
    // Weights 1, 1, ~0: a draw near 1 lands on the second start, never on the heavily shown third.
    expect(book().pick(shows, () => 0.99)).toBe(B)
    expect(book().pick(shows, () => 0)).toBe(A)
  })

  it('places a start in any corner, mirrored or not, Black first', () => {
    for (const corner of CORNERS) {
      for (const mirror of [false, true]) {
        const moves = book().place(B, corner, mirror)
        const expected = ['Q16', 'O17', 'R14'].map((m) => fromTopRight(mirror ? mirrorDiagonal(v(m)) : v(m), corner))
        expect(moves).toEqual(expected.map((vertex, i) => ({ color: i % 2 === 0 ? 'B' : 'W', vertex })))
      }
    }
    // Start B in the bottom-left corner (a half turn), not mirrored: Q16 O17 R14 become D4 F3 C6.
    expect(book().place(B, 'BL', false).map((m) => `${m.color} ${vertexToGtp(m.vertex as Vertex)}`)).toEqual(['B D4', 'W F3', 'B C6'])
    expect(() => book().place('nope', 'TR', false)).toThrow()
  })
})

describe('dubious starts', () => {
  const D = id('Q16 O17 O16')
  const dubiousBook = (): StartBook => StartBook.fromBase(decodeJdb(encodeJdb(testDubiousStartsTree())))

  it('keeps the dubious set apart from the normal starts', () => {
    const b = dubiousBook()
    expect([b.count, b.dubiousCount]).toEqual([4, 1])
    expect(b.ids()).toEqual([A, B, C])
    expect(b.dubiousIds()).toEqual([D])
    expect(b.isDubious(D)).toBe(true)
    expect(b.isDubious(A)).toBe(false)
    expect(b.has(D)).toBe(true)
  })

  it('skips a dubious path in the list', () => {
    const log: string[] = []
    const b = dubiousBook().withList(JSON.stringify({ positions: [{ group: '4-4', name: 'X', moves: 'Q16 O17 O16' }] }), (l) => log.push(l))
    expect(b.list()).toEqual([])
    expect(log).toHaveLength(1)
    expect(log[0].endsWith('такой стартовой позиции нет в базе')).toBe(true)
  })

  it('picks a dubious start by the share and a normal one otherwise', () => {
    const draws = (...d: number[]) => () => d.shift() ?? 0
    expect(dubiousBook().pick(() => 0, draws(0.05, 0))).toBe(D)
    expect(dubiousBook().pick(() => 0, draws(0.5, 0))).toBe(A)
  })

  it('picks a dubious start without a share draw when there is nothing else', () => {
    const only = StartBook.fromBase(decodeJdb(encodeJdb({ kind: 'starts', verified: false, roots: [{ move: v('Q16'), category: 'none', loss: null, children: [{ move: v('O17'), category: 'dubious', loss: null, children: [] }] }] })))
    let draws = 0
    expect(only.pick(() => 0, () => (draws++, 0.99))).toBe(id('Q16 O17'))
    expect(draws).toBe(1)
  })

  it('knows the colour of the last move', () => {
    const b = dubiousBook()
    expect([b.lastColor(A), b.lastColor(B), b.lastColor(D)]).toEqual(['W', 'B', 'B'])
    expect(() => b.lastColor('nope')).toThrow()
  })

  it('places a dubious start with the colours swapped', () => {
    expect(dubiousBook().place(D, 'TR', false, true)).toEqual([
      { color: 'W', vertex: v('Q16') },
      { color: 'B', vertex: v('O17') },
      { color: 'W', vertex: v('O16') },
    ])
  })
})
