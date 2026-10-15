import { useRef, useState } from 'preact/hooks'
import type { StartCardState, Translate } from '@joseki-dojo/shared'
import { formatWhen } from '../format'
import { useI18n, useT } from '../i18n'
import { nodeProgress, type NodeProgress, type StartTreeNode } from '../start-tree'
import { CornerBoard } from './CornerBoard'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** A continuation's letter; past the 26th there is none: no board mark and no shortcut, only the card. */
const letterOf = (i: number): string | null => (i >= 0 && i < LETTERS.length ? LETTERS[i] : null)

const chain = (n: StartTreeNode): StartTreeNode[] => {
  const out: StartTreeNode[] = []
  for (let x: StartTreeNode | null = n; x; x = x.parent) out.unshift(x)
  return out
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** The line under the name: the moves on the board (a start begins with them) and the positions inside. */
const details = (n: StartTreeNode, t: Translate): string =>
  capitalize(
    [
      ...(n.moves.length > 0 ? [t('tree.movesOnBoard', { count: n.moves.length })] : []),
      ...(n.count > 0 ? [t('tree.positionsInside', { count: n.count })] : []),
    ].join(' · '),
  )

type Cards = Readonly<Record<string, StartCardState>>
const NO_CARDS: Cards = {}

/** Repetition spec 6: a position card's mark — due now, else its stage. */
const markClass = (own: StartCardState): string => `card-mark ${own.dueNow ? 'due' : own.stage}`
const markText = (own: StartCardState, t: Translate): string => t(own.dueNow ? 'tree.card.due' : own.stage === 'learned' ? 'tree.card.learned' : 'tree.card.learning')

/** Repetition spec 6: a group or a branch the player has begun shows «learned of all» instead of the positions inside. */
const summed = (n: StartTreeNode, p: NodeProgress): boolean => p.started && (n.kind === 'group' || n.kind === 'branch')

/** A card's accessible name: «A: Хане, позиций: 1», «B: Шапка, редко», «C: Снизу, изучается», «D: Ветка, изучено 1 из 4, 1 карточка к повторению». */
const cardLabel = (n: StartTreeNode, letter: string | null, p: NodeProgress, t: Translate): string =>
  [
    `${letter ? `${letter}: ` : ''}${n.short}`,
    ...(n.rare ? [t('tree.rare')] : []),
    ...(p.own ? [markText(p.own, t)] : []),
    ...(summed(n, p)
      ? [t('tree.progress', { learned: p.learned, total: p.total }), ...(p.due > 0 ? [t('header.dueBadge', { count: p.due })] : [])]
      : n.count > 0
        ? [t('tree.cardPositions', { count: n.count })]
        : []),
  ].join(t('common.listSeparator'))

/** Repetition spec 6: the end of an outline row or a card — the card's mark, the positions inside or «learned/all», and the due ones. */
function NodeMarks({ node, progress: p }: { node: StartTreeNode; progress: NodeProgress }) {
  const t = useT()
  const progress = t('tree.progress', { learned: p.learned, total: p.total })
  const due = t('header.dueBadge', { count: p.due })
  return (
    <>
      {p.own && <span class={markClass(p.own)} role="img" title={markText(p.own, t)} aria-label={markText(p.own, t)} />}
      {summed(node, p) ? (
        <>
          <span class="start-count" role="img" title={progress} aria-label={progress}>
            {p.learned}/{p.total}
          </span>
          {p.due > 0 && (
            <span class="badge due" role="img" title={due} aria-label={due}>
              {p.due}
            </span>
          )}
        </>
      ) : (
        node.count > 0 && <span class="start-count">{node.count}</span>
      )}
    </>
  )
}

export interface StartTreeProps {
  root: StartTreeNode
  current: StartTreeNode
  onCurrent: (node: StartTreeNode) => void
  /** Enter on any node but the empty corner: «Начать тренировку». */
  onStart: () => void
  /** Repetition spec 6: the position cards' states by start id. */
  cards?: Record<string, StartCardState>
}

/** Spec (starts) 5.1: «Из списка» — the outline, the corner board with lettered continuations, the cards. */
export function StartTree({ root, current, onCurrent, onStart, cards = NO_CARDS }: StartTreeProps) {
  const { language, t } = useI18n()
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const path = chain(current)
  const kids = current.children
  const hovered = hover !== null ? (kids[hover] ?? null) : null
  const shown = hovered ?? current
  const shownCard = shown.id ? (cards[shown.id] ?? null) : null
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
      aria-label={t('tree.label')}
    >
      <nav class="start-outline" aria-label={t('tree.outline')}>
        <OutlineRow node={root} depth={0} path={path} current={current} cards={cards} onPick={go} />
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
            <div class="start-info-sub">{details(shown, t)}</div>
            {shown.rare && <div class="start-rare">{t('tree.rarelyPlayed')}</div>}
            {shownCard && (
              <div class="start-info-card">
                <span class={markClass(shownCard)} aria-hidden="true" />
                {capitalize(shownCard.dueNow ? t('tree.card.due') : t('tree.card.next', { when: formatWhen(shownCard.due, new Date(), language, t) }))}
              </div>
            )}
          </div>
        </div>
        {kids.length > 0 && (
          <div class="start-cards" onMouseLeave={() => setHover(null)}>
            {kids.map((c, i) => {
              const letter = letterOf(i)
              const progress = nodeProgress(c, cards)
              return (
                <button
                  type="button"
                  key={c.key}
                  class={`start-card${c.rare ? ' rare' : ''}${i === hover ? ' hover' : ''}`}
                  aria-label={cardLabel(c, letter, progress, t)}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => go(c)}
                >
                  <b>{letter}</b>
                  <CornerBoard moves={c.moves} />
                  <span class="start-card-name">{c.short}</span>
                  {c.rare && <span class="start-rare">{t('tree.rare')}</span>}
                  <NodeMarks node={c} progress={progress} />
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
  cards: Cards
  onPick: (node: StartTreeNode) => void
}

/** One row of the outline; the rows on the path to the current node are open. */
function OutlineRow({ node, depth, path, current, cards, onPick }: OutlineRowProps) {
  const t = useT()
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
        {node.rare && <span class="start-rare">{t('tree.rare')}</span>}
        <NodeMarks node={node} progress={nodeProgress(node, cards)} />
      </button>
      {open && node.children.map((c) => <OutlineRow key={c.key} node={c} depth={depth + 1} path={path} current={current} cards={cards} onPick={onPick} />)}
    </>
  )
}
