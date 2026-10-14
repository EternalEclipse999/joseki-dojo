// Writes e2e/starts.test.jdb and e2e/starts-list.test.json: one start whose moves lie on the corner's diagonal, so its
// coordinates do not depend on the random mirror. Q16 and R17; Black (the user) is to move.
import { writeFileSync } from 'node:fs'
import { encodeJdb, type JdbNode } from '../packages/server/src/jdb'

const node = (move: [number, number], category: JdbNode['category'] = 'none', children: JdbNode[] = []): JdbNode => ({ move, category, loss: null, children })

const tree = { kind: 'starts' as const, verified: false, roots: [node([15, 3], 'none', [node([16, 2], 'start')])] }
writeFileSync('e2e/starts.test.jdb', encodeJdb(tree))
writeFileSync('e2e/starts-list.test.json', JSON.stringify([{ group: '4-4', name: 'Тестовое начало', moves: 'Q16 R17' }]))
