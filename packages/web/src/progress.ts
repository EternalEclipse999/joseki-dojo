import type { ProgressEntry, ProgressView, SessionSettings } from '@joseki-dojo/shared'
import type { StartTreeNode } from './start-tree'

/** The progress for the start screen's colour: one colour's view, or Black's and White's for a random colour. */
export type ColorViews = readonly [ProgressView] | readonly [ProgressView, ProgressView]

/** Spec (progress part 2) 4.3–4.4: a row of the tree — its percent (0..1) and the list positions due in it. */
export interface NodePercent {
  percent: number
  due: number
}

/**
 * Spec (progress part 2) 4.3–4.4: the rows of the tree for one colour, by node key. A position is its own entry of
 * `view` (the positions nested in it are already in its percent). A branch, a group and the root are Σ (weight ×
 * percent) / Σ weight over the positions under them — a nested position counted on its own with its own weight — and
 * `due` counts those due. A node with no position of `view` at or under it has no row; one whose positions have no weight
 * at all is 0 %.
 */
export function aggregate(tree: StartTreeNode, view: ProgressView): Map<string, NodePercent> {
  const rows = new Map<string, NodePercent>()
  // The sums over the positions at or under `n`: Σ weight, Σ weight × percent, the due ones, and whether there are any.
  const walk = (n: StartTreeNode): { weight: number; score: number; due: number; any: boolean } => {
    const own: ProgressEntry | undefined = n.kind === 'position' && n.id ? view.positions[n.id] : undefined
    const sum = own ? { weight: own.weight, score: own.weight * own.percent, due: own.due ? 1 : 0, any: true } : { weight: 0, score: 0, due: 0, any: false }
    for (const c of n.children) {
      const s = walk(c)
      sum.weight += s.weight
      sum.score += s.score
      sum.due += s.due
      sum.any ||= s.any
    }
    if (own) rows.set(n.key, { percent: own.percent, due: own.due ? 1 : 0 })
    else if (sum.any) rows.set(n.key, { percent: sum.weight > 0 ? sum.score / sum.weight : 0, due: sum.due })
    return sum
  }
  walk(tree)
  return rows
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * Spec (progress part 2) 6.1 and the owner's answer 2: the view of a random colour — each position's percent and weight
 * the mean of both colours', due when it is due in either; the whole list the mean of both percents, its due count the
 * positions due in either. `color` stays Black's: the view is of both.
 */
export function mergeColors(black: ProgressView, white: ProgressView): ProgressView {
  const positions: Record<string, ProgressEntry> = {}
  for (const id of new Set([...Object.keys(black.positions), ...Object.keys(white.positions)])) {
    const both = [black.positions[id], white.positions[id]].filter((e): e is ProgressEntry => e !== undefined)
    positions[id] = { percent: mean(both.map((e) => e.percent)), weight: mean(both.map((e) => e.weight)), due: both.some((e) => e.due) }
  }
  return {
    hasWeights: black.hasWeights && white.hasWeights,
    level: black.level,
    color: black.color,
    overall: { percent: (black.overall.percent + white.overall.percent) / 2, due: Object.values(positions).filter((e) => e.due).length },
    positions,
  }
}

/**
 * Spec (progress part 2) 6.2: the rows of the tree for the start screen's colour — one colour's view, or Black's and
 * White's for a random colour: then a node has a row when either colour has one, its percent the mean of both colours'
 * rows (so the root matches the summary's bar), and its due positions those due in either, counted as `aggregate` does.
 */
export function treeProgress(tree: StartTreeNode, views: ColorViews): Map<string, NodePercent> {
  if (views.length === 1) return aggregate(tree, views[0])
  const colors = views.map((v) => aggregate(tree, v))
  const rows = new Map<string, NodePercent>()
  // The positions at or under `n` due in either colour; a listed position's own row counts itself only.
  const walk = (n: StartTreeNode): number => {
    const own = n.kind === 'position' && n.id ? views.map((v) => v.positions[n.id!]).filter((e): e is ProgressEntry => e !== undefined) : []
    const ownDue = own.some((e) => e.due) ? 1 : 0
    const due = n.children.reduce((sum, c) => sum + walk(c), ownDue)
    const percents = colors.map((c) => c.get(n.key)).filter((r): r is NodePercent => r !== undefined).map((r) => r.percent)
    if (percents.length > 0) rows.set(n.key, { percent: mean(percents), due: own.length > 0 ? ownDue : due })
    return due
  }
  walk(tree)
  return rows
}

/** The views the start screen shows; `stale`: another colour's, kept while the colour picked is being read. */
export interface ShownViews {
  views: ColorViews
  stale: boolean
}

/**
 * The views to show for the colour picked: those fetched, when they are of that colour (both colours for a random one).
 * While a colour switch is being read, the previous colour's, stale (shown dimmed), when they had weights, so that the
 * summary and the rows keep their place instead of falling back to the card marks for a moment; else null.
 */
export function viewsFor(views: ColorViews | null, color: SessionSettings['userColor']): ShownViews | null {
  if (!views) return null
  if (color === 'random' ? views.length === 2 : views.length === 1 && views[0].color === color) return { views, stale: false }
  return views.every((v) => v.hasWeights) ? { views, stale: true } : null
}
