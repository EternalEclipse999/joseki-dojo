// Writes e2e/starts.test.jdb and e2e/starts-list.test.json: «Тестовое начало» — Q16 R17, on the corner's diagonal, so
// its coordinates do not depend on the random mirror, Black (the user) to move — and «Тестовое продолжение», one more
// Black move, under it in the tree.
import { writeFileSync } from 'node:fs'
import { canonicalize, encodeJdb, moveText, type CanonicalMove, type JdbNode } from '../packages/server/src/jdb'

const node = (move: CanonicalMove, category: JdbNode['category'] = 'none', children: JdbNode[] = []): JdbNode => ({ move, category, loss: null, children })

const [a, b, c] = canonicalize([[15, 3], [16, 2], [16, 3]])
const tree = { kind: 'starts' as const, verified: false, roots: [node(a, 'none', [node(b, 'start', [node(c, 'start')])])] }
writeFileSync('e2e/starts.test.jdb', encodeJdb(tree))
const positions = [
  { group: '4-4', name: 'Тестовое начало', short: 'Начало', moves: [a, b].map(moveText).join(' ') },
  { group: '4-4', name: 'Тестовое продолжение', short: 'Продолжение', moves: [a, b, c].map(moveText).join(' ') },
]
writeFileSync('e2e/starts-list.test.json', JSON.stringify({ branches: [], positions }))
