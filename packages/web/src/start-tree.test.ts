import { translator, type StartBranch, type StartGroupHead, type StartListEntry } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { buildStartTree, findById, findNode, nodeTitle, type StartTreeNode } from './start-tree'

const pos = (id: string, group: StartListEntry['group'], moves: string, rare = false): StartListEntry => ({ id, group, name: `Полное ${id}`, short: id, rare, moves: moves.split(' ') })
const branch = (moves: string, name: string): StartBranch => ({ id: `ветка ${moves}`, moves: moves.split(' '), name })
// File order: chapter order, with a 4-4 position in the middle.
const LIST = [
  pos('косуми', '3-4', 'R16 P17 Q15'),
  pos('снизу', '3-4', 'R16 P16 P17'),
  pos('хане', '3-4', 'R16 P16 P17 O17'),
  pos('лавина', '3-4', 'R16 P16 P17 Q16 Q17 R15'),
  pos('кэйма', '4-4', 'Q16 R14 O17'),
  pos('меч', '3-4', 'R16 P16 M16', true),
]
const BRANCHES = [branch('R16 P17', 'Малое приближение'), branch('R16 P16', 'Высокое приближение'), branch('Q16 R14', 'Малое приближение'), branch('R17 Q16', 'Без позиций')]
// The server offers the 3-4 stone only.
const GROUPS: StartGroupHead[] = [{ id: 'камень 3-4', group: '3-4', moves: ['R16'] }]
const names = (n: StartTreeNode): string[] => n.children.map((c) => c.short)
const ROOT = translator('ru')('tree.root')

describe('buildStartTree', () => {
  const root = buildStartTree(LIST, BRANCHES, GROUPS, ROOT)
  const g44 = root.children[0]
  const g34 = root.children[1]
  const high = g34.children[1]
  const under = high.children[0]

  it('puts the groups under the empty corner in the fixed order, only those with positions', () => {
    expect(root).toMatchObject({ key: '', kind: 'root', name: 'Пустой угол', short: 'Пустой угол', moves: [], id: null, parent: null, count: 6 })
    expect(names(root)).toEqual(['4-4', '3-4'])
    expect(g34).toMatchObject({ key: 'group:3-4', kind: 'group', name: '3-4', moves: ['R16'], count: 5 })
  })

  it('gives a group the id of its stone from the server, and none without one', () => {
    expect(g34.id).toBe('камень 3-4')
    expect(g44).toMatchObject({ id: null, moves: ['Q16'] })
  })

  it('hangs each node under the longest branch or position that begins its moves, skipping unnamed moves', () => {
    expect(names(g34)).toEqual(['Малое приближение', 'Высокое приближение'])
    expect(names(high)).toEqual(['снизу', 'меч'])
    expect(names(under)).toEqual(['хане', 'лавина'])
    expect(under).toMatchObject({ key: 'R16 P16 P17', kind: 'position', id: 'снизу', name: 'Полное снизу', count: 2 })
    expect(under.children[1].parent).toBe(under)
    expect(high).toMatchObject({ kind: 'branch', id: 'ветка R16 P16', name: 'Высокое приближение', count: 4 })
  })

  it('keeps the rare mark and leaves out a branch with no positions under it', () => {
    expect(high.children[1].rare).toBe(true)
    expect(findNode(root, 'R17 Q16')).toBeNull()
  })

  it('names a start for the crumbs with its group, and a group stone by the group alone', () => {
    expect(nodeTitle(under)).toBe('3-4 · Полное снизу')
    expect(nodeTitle(high)).toBe('3-4 · Высокое приближение')
    expect(nodeTitle(g34)).toBe('3-4')
  })

  it('finds nodes by key and by id', () => {
    expect(findNode(root, 'group:4-4')?.short).toBe('4-4')
    expect(findNode(root, '')).toBe(root)
    expect(findById(root, 'хане')?.key).toBe('R16 P16 P17 O17')
    expect(findById(root, 'камень 3-4')).toBe(g34)
    expect(findById(root, 'нет')).toBeNull()
  })

  it('is just the root for an empty list', () => {
    expect(buildStartTree([], [], [], ROOT)).toMatchObject({ kind: 'root', children: [], count: 0 })
  })
})
