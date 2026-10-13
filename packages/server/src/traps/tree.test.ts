import { gtpToVertex, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { decodeJdb, encodeJdb, moveText, trapId, type CanonicalMove, type JdbNode, type JdbTree } from '../jdb'
import { TrapBook } from './book'
import type { CompletedTrap } from './complete'
import { addTraps, removeTraps } from './tree'

const mv = (gtp: string): CanonicalMove => (gtp === 'tenuki' ? 'tenuki' : (gtpToVertex(gtp) as Vertex))
const n = (gtp: string, category: JdbNode['category'], children: JdbNode[] = [], loss: number | null = null): JdbNode => ({ move: mv(gtp), category, loss, children })
const id = (path: string): string => trapId(path.split(' ').map(mv))

/** Q16 O17 O18 is a trap: P17 good (loss 0), N18 caught (loss 4). */
const base = (): JdbTree => ({
  kind: 'traps',
  verified: true,
  roots: [n('Q16', 'none', [n('O17', 'none', [n('O18', 'trap', [n('P17', 'good', [], 0), n('N18', 'caught', [], 4)])])])],
})

function trap(path: string, answers: [string, 'good' | 'caught', number, string[]?][]): CompletedTrap {
  return {
    id: id(path),
    path: path.split(' ').map(mv),
    answers: answers.map(([m, category, loss, ranks]) => ({ move: mv(m), category, loss, ranks: ranks ?? [] })),
  }
}

/** A node of `tree` by its path: category, loss and its children as "move:category:loss". */
function at(tree: JdbTree, path: string): { category: string; loss: number | null; children: string[] } | null {
  const b = decodeJdb(encodeJdb(tree))
  const i = b.find(path.split(' ').map(mv))
  if (i === null) return null
  return { category: b.category(i), loss: b.loss(i), children: b.children(i).map((c) => `${moveText(b.move(c))}:${b.category(c)}:${b.loss(c)}`) }
}

describe('addTraps', () => {
  it('adds a trap on a new path with plain path nodes and leaves the input alone', () => {
    const tree = base()
    const out = addTraps(tree, [trap('Q16 O17 R14 R13', [['Q13', 'good', 0], ['S13', 'caught', 3, ['10k']]])])
    expect(at(out, 'Q16 O17 R14 R13')).toEqual({ category: 'trap', loss: null, children: ['Q13:good:0', 'S13:caught:3'] })
    expect(at(out, 'Q16 O17 R14')?.category).toBe('none')
    expect(tree.roots[0].children[0].children).toHaveLength(1)
    expect(out.verified).toBe(true)
  })

  it('keeps the marks of the nodes on the way', () => {
    const out = addTraps(base(), [trap('Q16 O17 O18 P17 Q18', [['R17', 'good', 0], ['R18', 'caught', 3]])])
    expect(at(out, 'Q16 O17 O18')?.category).toBe('trap')
    expect(at(out, 'Q16 O17 O18 P17')).toMatchObject({ category: 'good', loss: 0 })
    expect(at(out, 'Q16 O17 O18 P17 Q18')).toEqual({ category: 'trap', loss: null, children: ['R17:good:0', 'R18:caught:3'] })
  })

  it('turns an existing answer into the trap and keeps its loss', () => {
    const out = addTraps(base(), [trap('Q16 O17 O18 N18', [['M18', 'good', 0], ['M17', 'caught', 2.5]])])
    expect(at(out, 'Q16 O17 O18 N18')).toEqual({ category: 'trap', loss: 4, children: ['M18:good:0', 'M17:caught:2.5'] })
  })

  it('gives the book a playable trap', () => {
    const out = addTraps(base(), [trap('Q16 O17 R14 R13', [['Q13', 'good', 0], ['S13', 'caught', 3]])])
    const book = TrapBook.fromBase(decodeJdb(encodeJdb(out)))
    expect(book.ids().sort()).toEqual([id('Q16 O17 O18'), id('Q16 O17 R14 R13')].sort())
    expect(book.skipped).toEqual([])
  })
})

describe('removeTraps', () => {
  /** Two candidates under R14; R13's good answer Q13 leads to a nested candidate Q12. */
  const candidates = (): JdbTree => ({
    kind: 'traps',
    verified: false,
    roots: [
      n('Q16', 'none', [
        n('O17', 'none', [
          n('R14', 'none', [
            n('R13', 'trap', [n('Q13', 'good', [n('Q12', 'trap', [n('P12', 'good')])]), n('S13', 'good')]),
            n('R12', 'trap', [n('Q13', 'good')]),
          ]),
        ]),
      ]),
    ],
  })

  it('turns a removed trap and its answers into plain nodes and prunes what leads to no trap', () => {
    const out = removeTraps(candidates(), new Set([id('Q16 O17 R14 R13'), id('Q16 O17 R14 R12')]))
    expect(at(out, 'Q16 O17 R14')?.children).toEqual(['R13:none:null'])
    expect(at(out, 'Q16 O17 R14 R13')).toEqual({ category: 'none', loss: null, children: ['Q13:none:null'] })
    expect(at(out, 'Q16 O17 R14 R13 Q13 Q12')).toEqual({ category: 'trap', loss: null, children: ['P12:good:null'] })
  })

  it('removes the whole tree when no trap is left', () => {
    const out = removeTraps(candidates(), new Set([id('Q16 O17 R14 R13'), id('Q16 O17 R14 R12'), id('Q16 O17 R14 R13 Q13 Q12')]))
    expect(out.roots).toEqual([])
  })

  it('keeps the tree as it is when nothing is removed', () => {
    expect(removeTraps(candidates(), new Set())).toEqual(candidates())
  })
})
