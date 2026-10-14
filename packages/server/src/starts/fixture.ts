import { writeFileSync } from 'node:fs'
import { gtpToVertex } from '@joseki-dojo/shared'
import { encodeJdb, type CanonicalMove, type JdbNode, type JdbTree, type NodeCategory } from '../jdb'

const mv = (gtp: string): CanonicalMove => gtpToVertex(gtp) as CanonicalMove
const node = (gtp: string, category: NodeCategory, children: JdbNode[] = []): JdbNode => ({ move: mv(gtp), category, loss: null, children })

/**
 * A small starts base in canonical form (the first move off the diagonal is closer to the top edge):
 *   Q16 O17       start
 *   Q16 O17 R14   start (on the list, group 4-4)
 *   Q17 R15       start (on the list, group 3-4)
 */
export function testStartsTree(): JdbTree {
  return {
    kind: 'starts',
    verified: false,
    roots: [node('Q16', 'none', [node('O17', 'start', [node('R14', 'start')])]), node('Q17', 'none', [node('R15', 'start')])],
  }
}

/** testStartsTree plus one start after a dubious move: Q16 O17 O16 (Black's dubious O16). */
export function testDubiousStartsTree(): JdbTree {
  const tree = testStartsTree()
  tree.roots[0].children[0].children.push(node('O16', 'dubious'))
  return tree
}

export const TEST_STARTS_LIST = [
  { group: '4-4', name: 'Тестовое начало 4-4', moves: 'Q16 O17 R14' },
  { group: '3-4', name: 'Тестовое начало 3-4', moves: 'Q17 R15' },
]

export function writeTestStarts(baseFile: string, listFile: string): void {
  writeFileSync(baseFile, encodeJdb(testStartsTree()))
  writeFileSync(listFile, JSON.stringify(TEST_STARTS_LIST))
}
