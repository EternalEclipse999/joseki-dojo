// Writes e2e/traps.test.jdb: one trap whose every move lies on the corner's diagonal, so its coordinates do not
// depend on the random mirror. Q16, R17, the trick S18; the correct answer O14, the caught one T19.
import { writeFileSync } from 'node:fs'
import { encodeJdb, type JdbNode } from '../packages/server/src/jdb'

const node = (move: [number, number], category: JdbNode['category'] = 'none', children: JdbNode[] = []): JdbNode => ({ move, category, loss: null, children })

const trick = node([17, 1], 'trap', [node([13, 5], 'good'), node([18, 0], 'caught')])
const tree = { kind: 'traps' as const, verified: false, roots: [node([15, 3], 'none', [node([16, 2], 'none', [trick])])] }
writeFileSync('e2e/traps.test.jdb', encodeJdb(tree))
