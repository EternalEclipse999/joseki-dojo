import { START_GROUPS, type Language, type StartBranch, type StartCardState, type StartGroupHead, type StartListEntry } from '@joseki-dojo/shared'

export type StartTreeKind = 'root' | 'group' | 'branch' | 'position'

/** Spec (starts) 5.1: a node of the tree of start positions in «Из списка». */
export interface StartTreeNode {
  /** '' for the root, `group:<group>` for a group, the moves joined by spaces for a branch or a position. */
  key: string
  kind: StartTreeKind
  /** A position's full name, a branch's name, the group, or the root caption (`tree.root`, «Пустой угол»), in the tree's language. */
  name: string
  /** The caption in the outline, the crumbs and on the cards. */
  short: string
  /** Canonical GTP moves; a group has the first move of its positions (none if they differ), the root none. */
  moves: string[]
  /** The start id: a training can start from any node that has one — all but the root and a group whose positions begin differently. */
  id: string | null
  rare: boolean
  /** Positions below the node, the node itself not counted. */
  count: number
  parent: StartTreeNode | null
  children: StartTreeNode[]
}

const make = (key: string, kind: StartTreeKind, name: string, short: string, moves: string[], id: string | null, rare: boolean): StartTreeNode => ({
  key,
  kind,
  name,
  short,
  moves,
  id,
  rare,
  count: 0,
  parent: null,
  children: [],
})

/** `moves` continue `prefix` (and are longer). */
const continues = (moves: readonly string[], prefix: readonly string[]): boolean => prefix.length < moves.length && prefix.every((m, i) => moves[i] === m)

const adopt = (parent: StartTreeNode, child: StartTreeNode): void => {
  child.parent = parent
  parent.children.push(child)
}

/**
 * Spec (starts) 5.1: «Пустой угол» → the groups with positions, in the fixed order → branches and positions. The parent
 * of a branch or a position is the branch or position with the longest moves that begin its moves, else its group;
 * unnamed moves in between are skipped. Children follow the file order of the first position in their subtree.
 * `rootName` is the root's caption and `lang` the language of the names (languages spec 7).
 */
export function buildStartTree(list: readonly StartListEntry[], branches: readonly StartBranch[], groups: readonly StartGroupHead[], rootName: string, lang: Language): StartTreeNode {
  const root = make('', 'root', rootName, rootName, [], null, false)
  const fileIndex = new Map<StartTreeNode, number>()
  for (const group of START_GROUPS) {
    const entries = list.filter((e) => e.group === group)
    if (entries.length === 0) continue
    const first = entries[0].moves[0]
    const stone = groups.find((g) => g.group === group)
    const moves = stone ? [...stone.moves] : entries.every((e) => e.moves[0] === first) ? [first] : []
    const head = make(`group:${group}`, 'group', group, group, moves, stone?.id ?? null, false)
    adopt(root, head)
    const items = [
      ...branches.filter((b) => entries.some((e) => continues(e.moves, b.moves))).map((b) => make(b.moves.join(' '), 'branch', b.name[lang], b.name[lang], [...b.moves], b.id, false)),
      ...entries.map((e) => {
        const n = make(e.moves.join(' '), 'position', e.name[lang], e.short[lang], [...e.moves], e.id, e.rare)
        fileIndex.set(n, list.indexOf(e))
        return n
      }),
    ]
    for (const item of items) {
      const parent = items.filter((p) => continues(item.moves, p.moves)).reduce<StartTreeNode | null>((best, p) => (best && best.moves.length >= p.moves.length ? best : p), null)
      adopt(parent ?? head, item)
    }
  }
  finish(root, fileIndex, new Map())
  return root
}

/** Counts the positions below each node and orders the children (not the groups) by their first position in the file. */
function finish(n: StartTreeNode, own: ReadonlyMap<StartTreeNode, number>, first: Map<StartTreeNode, number>): void {
  let min = own.get(n) ?? Number.POSITIVE_INFINITY
  let count = 0
  for (const c of n.children) {
    finish(c, own, first)
    min = Math.min(min, first.get(c) ?? Number.POSITIVE_INFINITY)
    count += c.count + (c.kind === 'position' ? 1 : 0)
  }
  if (n.kind !== 'root') n.children.sort((a, b) => (first.get(a) ?? 0) - (first.get(b) ?? 0))
  first.set(n, min)
  n.count = count
}

/** The name of a start from `n` in the crumbs (starts spec 5.4): the group and the name, or the group alone for its stone. */
export function nodeTitle(n: StartTreeNode): string {
  if (n.kind === 'root' || n.kind === 'group') return n.name
  let group: StartTreeNode | null = n.parent
  while (group && group.kind !== 'group') group = group.parent
  return group ? `${group.name} · ${n.name}` : n.name
}

export interface NodeProgress {
  /** The node's own card, when it is a position with a card. */
  own: StartCardState | null
  /** Positions at or under the node: learned, all, due now. */
  learned: number
  total: number
  due: number
  /** Some position at or under the node has a card. */
  started: boolean
}

/** Spec (repetition) 6: the card progress of a node. */
export function nodeProgress(node: StartTreeNode, cards: Readonly<Record<string, StartCardState>>): NodeProgress {
  const p: NodeProgress = { own: node.id ? (cards[node.id] ?? null) : null, learned: 0, total: 0, due: 0, started: false }
  const walk = (n: StartTreeNode): void => {
    if (n.kind === 'position' && n.id) {
      p.total++
      const c = cards[n.id]
      if (c) {
        p.started = true
        if (c.stage === 'learned') p.learned++
        if (c.dueNow) p.due++
      }
    }
    n.children.forEach(walk)
  }
  walk(node)
  return p
}

function find(root: StartTreeNode, test: (n: StartTreeNode) => boolean): StartTreeNode | null {
  if (test(root)) return root
  for (const c of root.children) {
    const hit = find(c, test)
    if (hit) return hit
  }
  return null
}

export const findNode = (root: StartTreeNode, key: string): StartTreeNode | null => find(root, (n) => n.key === key)
export const findById = (root: StartTreeNode, id: string): StartTreeNode | null => find(root, (n) => n.id === id)
