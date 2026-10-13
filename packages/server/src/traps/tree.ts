import { sameMove, trapId, type CanonicalMove, type JdbNode, type JdbTree } from '../jdb'
import type { CompletedTrap } from './complete'

const copy = (n: JdbNode): JdbNode => ({ ...n, children: n.children.map(copy) })

function childOf(level: JdbNode[], move: CanonicalMove): JdbNode {
  let child = level.find((c) => sameMove(c.move, move))
  if (!child) {
    child = { move, category: 'none', loss: null, children: [] }
    level.push(child)
  }
  return child
}

/**
 * Spec 4.4: a copy of `tree` with the traps added. Missing path nodes come in as plain nodes and the nodes on the way
 * keep their marks. The trap's node becomes a trap (an answer of another trap keeps its loss); its answers get their
 * category and loss unless the node already carries a mark.
 * Callers add parents before nested traps (depth-first order, as `nodesOf` gives) so an answer's loss is kept when it becomes a trap.
 */
export function addTraps(tree: JdbTree, traps: readonly CompletedTrap[]): JdbTree {
  const roots = tree.roots.map(copy)
  for (const t of traps) {
    let level = roots
    let node: JdbNode | null = null
    for (const m of t.path) {
      node = childOf(level, m)
      level = node.children
    }
    if (!node) continue
    node.category = 'trap'
    for (const a of t.answers) {
      const child = childOf(node.children, a.move)
      if (child.category === 'none') {
        child.category = a.category
        child.loss = a.loss
      }
    }
  }
  return { ...tree, roots }
}

/** A copy of `tree` without the traps whose ids are given: each becomes a plain node with plain answers, and branches left without a mark go. */
export function removeTraps(tree: JdbTree, ids: ReadonlySet<string>): JdbTree {
  const walk = (n: JdbNode, parent: CanonicalMove[], underRemoved: boolean): JdbNode | null => {
    const path = [...parent, n.move]
    const removed = n.category === 'trap' && ids.has(trapId(path))
    const plain = removed || (underRemoved && (n.category === 'good' || n.category === 'caught'))
    const children = n.children.map((c) => walk(c, path, removed)).filter((c): c is JdbNode => c !== null)
    const out: JdbNode = plain ? { ...n, category: 'none', loss: null, children } : { ...n, children }
    return out.category !== 'none' || children.length > 0 ? out : null
  }
  return { ...tree, roots: tree.roots.map((r) => walk(r, [], false)).filter((r): r is JdbNode => r !== null) }
}
