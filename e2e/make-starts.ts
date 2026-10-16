// Writes e2e/starts.test.jdb, e2e/starts-list.test.json and its translations e2e/starts-i18n.test.json: «Тестовое
// начало» — Q16 R17, on the corner's diagonal, so its coordinates do not depend on the random mirror, Black (the user)
// to move — «Тестовое продолжение», one more Black move, under it in the tree, and «Тестовая очередь», one more White
// move under that: the repetition spec's queue test owns its card, which no other test trains or deletes.
import { writeFileSync } from 'node:fs'
import { canonicalize, encodeJdb, moveText, type CanonicalMove, type JdbNode } from '../packages/server/src/jdb'

const node = (move: CanonicalMove, category: JdbNode['category'] = 'none', children: JdbNode[] = []): JdbNode => ({ move, category, loss: null, children })

const [a, b, c, d] = canonicalize([[15, 3], [16, 2], [16, 3], [15, 2]])
const tree = { kind: 'starts' as const, verified: false, roots: [node(a, 'none', [node(b, 'start', [node(c, 'start', [node(d, 'start')])])])] }
writeFileSync('e2e/starts.test.jdb', encodeJdb(tree))
const positions = [
  { group: '4-4', name: 'Тестовое начало', short: 'Начало', moves: [a, b].map(moveText).join(' ') },
  { group: '4-4', name: 'Тестовое продолжение', short: 'Продолжение', moves: [a, b, c].map(moveText).join(' ') },
  { group: '4-4', name: 'Тестовая очередь', short: 'Очередь', moves: [a, b, c, d].map(moveText).join(' ') },
]
writeFileSync('e2e/starts-list.test.json', JSON.stringify({ branches: [], positions }))
const names = {
  [positions[0].moves]: {
    en: { name: 'Test start', short: 'Start' },
    'zh-Hans': { name: '测试起始', short: '起始' },
    'zh-Hant': { name: '測試起始', short: '起始' },
    ko: { name: '테스트 시작', short: '시작' },
    ja: { name: 'テスト開始', short: '開始' },
  },
  [positions[1].moves]: {
    en: { name: 'Test continuation', short: 'Continuation' },
    'zh-Hans': { name: '测试后续', short: '后续' },
    'zh-Hant': { name: '測試後續', short: '後續' },
    ko: { name: '테스트 계속', short: '계속' },
    ja: { name: 'テスト続き', short: '続き' },
  },
  [positions[2].moves]: {
    en: { name: 'Test queue', short: 'Queue' },
    'zh-Hans': { name: '测试队列', short: '队列' },
    'zh-Hant': { name: '測試佇列', short: '佇列' },
    ko: { name: '테스트 대기열', short: '대기열' },
    ja: { name: 'テストキュー', short: 'キュー' },
  },
}
writeFileSync('e2e/starts-i18n.test.json', JSON.stringify(names, null, 2))
