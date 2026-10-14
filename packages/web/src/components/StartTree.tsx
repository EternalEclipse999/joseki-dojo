import { useRef, useState } from 'preact/hooks'
import type { StartTreeNode } from '../start-tree'
import { CornerBoard } from './CornerBoard'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** A continuation's letter; past the 26th there is none: no board mark and no shortcut, only the card. */
const letterOf = (i: number): string | null => (i >= 0 && i < LETTERS.length ? LETTERS[i] : null)

const chain = (n: StartTreeNode): StartTreeNode[] => {
  const out: StartTreeNode[] = []
  for (let x: StartTreeNode | null = n; x; x = x.parent) out.unshift(x)
  return out
}

/** The line under the name: the moves on the board (a start begins with them) and the positions inside. */
const details = (n: StartTreeNode): string => {
  const parts = [...(n.moves.length > 0 ? [`ходов на доске: ${n.moves.length}`] : []), ...(n.count > 0 ? [`позиций внутри: ${n.count}`] : [])].join(' · ')
  return parts.charAt(0).toUpperCase() + parts.slice(1)
}

/** A card's accessible name: «A: Хане, позиций: 1», «B: Шапка, редко». */
const cardLabel = (n: StartTreeNode, letter: string | null): string =>
  [`${letter ? `${letter}: ` : ''}${n.short}`, ...(n.rare ? ['редко'] : []), ...(n.count > 0 ? [`позиций: ${n.count}`] : [])].join(', ')

export interface StartTreeProps {
  root: StartTreeNode
  current: StartTreeNode
  onCurrent: (node: StartTreeNode) => void
  /** Enter on any node but the empty corner: «Начать тренировку». */
  onStart: () => void
}

/** Spec (starts) 5.1: «Из списка» — the outline, the corner board with lettered continuations, the cards. */
export function StartTree({ root, current, onCurrent, onStart }: StartTreeProps) {
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const path = chain(current)
  const kids = current.children
  const hovered = hover !== null ? (kids[hover] ?? null) : null
  const shown = hovered ?? current
  const go = (n: StartTreeNode): void => {
    setHover(null)
    onCurrent(n)
    // The clicked card or crumb is about to unmount and take the focus with it: keep it in the tree, so the letters,
    // ←, Backspace and Enter go on working.
    const el = box.current
    const active = document.activeElement
    if (el && (!active || active === document.body || el.contains(active))) el.focus({ preventScroll: true })
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const letter = /^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : e.code.startsWith('Key') ? e.code.slice(3) : null
    if (letter) {
      const i = LETTERS.indexOf(letter)
      if (i >= 0 && i < kids.length) {
        e.preventDefault()
        go(kids[i])
      }
    } else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && current.parent) {
      e.preventDefault()
      go(current.parent)
    } else if (e.key === 'Enter' && e.target === e.currentTarget && current.id !== null) {
      e.preventDefault()
      onStart()
    }
  }
  return (
    <div
      ref={box}
      class="start-tree"
      tabIndex={0}
      role="group"
      onKeyDown={onKey}
      aria-label="Дерево стартовых позиций: буква — продолжение, ← — назад, Enter — начать"
    >
      <nav class="start-outline" aria-label="Оглавление">
        <OutlineRow node={root} depth={0} path={path} current={current} onPick={go} />
      </nav>
      <div class="start-explorer">
        <div class="start-crumbs">
          {path.map((n, i) =>
            i < path.length - 1 ? (
              <span key={n.key} class="start-crumb">
                <button type="button" onClick={() => go(n)}>
                  {n.short}
                </button>
                <span aria-hidden="true">›</span>
              </span>
            ) : (
              <span key={n.key} aria-current="location">
                {n.short}
              </span>
            ),
          )}
        </div>
        <div class="start-focus">
          <CornerBoard
            class="start-board"
            moves={current.moves}
            lastMove
            ghost={hovered ? hovered.moves.slice(current.moves.length) : []}
            marks={kids.flatMap((c, i) => {
              const letter = letterOf(i)
              const move = c.moves[current.moves.length]
              return letter && move ? [{ letter, move, active: i === hover }] : []
            })}
            onMarkEnter={(l) => setHover(LETTERS.indexOf(l))}
            onMarkLeave={() => setHover(null)}
            onMarkClick={(l) => go(kids[LETTERS.indexOf(l)])}
          />
          <div class="start-info">
            <div class="start-info-name">{shown.name}</div>
            <div class="start-info-sub">{details(shown)}</div>
            {shown.rare && <div class="start-rare">редко играют</div>}
          </div>
        </div>
        {kids.length > 0 && (
          <div class="start-cards" onMouseLeave={() => setHover(null)}>
            {kids.map((c, i) => {
              const letter = letterOf(i)
              return (
                <button
                  type="button"
                  key={c.key}
                  class={`start-card${c.rare ? ' rare' : ''}${i === hover ? ' hover' : ''}`}
                  aria-label={cardLabel(c, letter)}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => go(c)}
                >
                  <b>{letter}</b>
                  <CornerBoard moves={c.moves} />
                  <span class="start-card-name">{c.short}</span>
                  {c.rare && <span class="start-rare">редко</span>}
                  {c.count > 0 && <span class="start-count">{c.count}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface OutlineRowProps {
  node: StartTreeNode
  depth: number
  path: StartTreeNode[]
  current: StartTreeNode
  onPick: (node: StartTreeNode) => void
}

/** One row of the outline; the rows on the path to the current node are open. */
function OutlineRow({ node, depth, path, current, onPick }: OutlineRowProps) {
  const onPath = path.includes(node)
  const open = onPath && node.children.length > 0
  const cls = `start-outline-row${node === current ? ' current' : onPath ? ' on-path' : ''}${node.rare ? ' rare' : ''}`
  return (
    <>
      <button
        type="button"
        class={cls}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
        aria-current={node === current ? 'true' : undefined}
        aria-expanded={node.children.length > 0 ? open : undefined}
        onClick={() => onPick(node)}
      >
        <span class="start-outline-arrow" aria-hidden="true">
          {node.children.length === 0 ? '' : open ? '▾' : '▸'}
        </span>
        <span class="start-outline-name">{node.short}</span>
        {node.rare && <span class="start-rare">редко</span>}
        {node.count > 0 && <span class="start-count">{node.count}</span>}
      </button>
      {open && node.children.map((c) => <OutlineRow key={c.key} node={c} depth={depth + 1} path={path} current={current} onPick={onPick} />)}
    </>
  )
}
