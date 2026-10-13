import { writeFileSync } from 'node:fs'
import { gtpToVertex } from '@joseki-dojo/shared'
import { encodeJdb, type CanonicalMove, type JdbNode, type JdbTree, type NodeCategory } from '../jdb'

const mv = (gtp: string): CanonicalMove => (gtp === 'tenuki' ? 'tenuki' : (gtpToVertex(gtp) as CanonicalMove))
const node = (gtp: string, category: NodeCategory, children: JdbNode[] = []): JdbNode => ({ move: mv(gtp), category, loss: null, children })

/**
 * A small traps base in canonical form (top-right corner, Black first, first off-diagonal move closer to the top edge, i.e. needsMirror is false):
 *   Q16 O17 O18       answers P17 good, P18 good, N18 caught
 *   Q16 O17 Q14 R18   answers R17 good, tenuki good, Q18 caught
 */
export function testTrapsTree(): JdbTree {
  return {
    kind: 'traps',
    verified: true,
    roots: [
      node('Q16', 'none', [
        node('O17', 'none', [
          node('O18', 'trap', [node('P17', 'good'), node('P18', 'good'), node('N18', 'caught')]),
          node('Q14', 'none', [node('R18', 'trap', [node('R17', 'good'), node('tenuki', 'good'), node('Q18', 'caught')])]),
        ]),
      ]),
    ],
  }
}

export function writeTestTraps(file: string): void {
  writeFileSync(file, encodeJdb(testTrapsTree()))
}
