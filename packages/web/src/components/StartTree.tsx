import { useRef, useState } from 'preact/hooks'
import type { Language, StartCardState, Translate } from '@joseki-dojo/shared'
import { capitalize, formatPercent, formatWhen } from '../format'
import { useI18n, useT } from '../i18n'
import { dueLine, type NodePercent } from '../progress'
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
type Rows = ReadonlyMap<string, NodePercent>

/** Repetition spec 6: a position card's mark — due now, else its stage. */
const markClass = (own: StartCardState): string => `card-mark ${own.dueNow ? 'due' : own.stage}`
const markText = (own: StartCardState, t: Translate): string => t(own.dueNow ? 'tree.card.due' : own.stage === 'learned' ? 'tree.card.learned' : 'tree.card.learning')

/** Repetition spec 6: a group or a branch the player has begun shows «learned of all» instead of the positions inside. */
const summed = (n: StartTreeNode, p: NodeProgress): boolean => p.started && (n.kind === 'group' || n.kind === 'branch')

/** Repetition spec 6: the card marks in words — «изучается», «позиций: 1», «изучено 1 из 4, 1 карточка к повторению». */
const cardMarks = (n: StartTreeNode, p: NodeProgress, t: Translate): string[] => [
  ...(p.own ? [markText(p.own, t)] : []),
  ...(summed(n, p)
    ? [t('tree.progress', { learned: p.learned, total: p.total }), ...(p.due > 0 ? [t('header.dueBadge', { count: p.due })] : [])]
    : n.count > 0
      ? [t('tree.cardPositions', { count: n.count })]
      : []),
]

/** Spec (progress part 2) 6.2: only a position carries the «пора повторить» mark; the summary counts them. */
const dueHere = (n: StartTreeNode, row: NodePercent): boolean => n.kind === 'position' && row.due > 0

/** Spec (progress part 2) 6.2: the progress marks in words — «освоено 42 %», «пора повторить». */
const progressMarks = (n: StartTreeNode, row: NodePercent | undefined, language: Language, t: Translate): string[] =>
  row ? [t('progress.mastered', { percent: formatPercent(row.percent, language) }), ...(dueHere(n, row) ? [t('progress.dueMark')] : [])] : []

/** A card's accessible name: «A: Хане, позиций: 1», «B: Шапка, редко», «C: Снизу, изучается», with weights «D: Ветка, освоено 42 %». */
const cardLabel = (n: StartTreeNode, letter: string | null, marks: string[], t: Translate): string =>
  [`${letter ? `${letter}: ` : ''}${n.short}`, ...(n.rare ? [t('tree.rare')] : []), ...marks].join(t('common.listSeparator'))

/** Spec (progress part 2) 6: a thin bar of a percent (0..1); the number beside it says the same to a screen reader. */
export function PercentBar({ value }: { value: number }) {
  return (
    <span class="pbar" aria-hidden="true">
      <span style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  )
}

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

/** Spec (progress part 2) 6.2: with weights, the end of an outline row or a card — a position's due mark, a thin bar and the percent. */
function ProgressMarks({ node, row }: { node: StartTreeNode; row: NodePercent | undefined }) {
  const { language, t } = useI18n()
  if (!row) return null
  const percent = formatPercent(row.percent, language)
  const mastered = t('progress.mastered', { percent })
  const due = t('progress.dueMark')
  return (
    <span class="start-progress">
      {dueHere(node, row) && <span class="card-mark due" role="img" title={due} aria-label={due} />}
      <PercentBar value={row.percent} />
      <span class="start-percent" role="img" title={mastered} aria-label={mastered}>
        {percent}
      </span>
    </span>
  )
}

/** The marks at the end of a row or a card: the progress with weights (it replaces the card marks), else the card marks. */
function Marks({ node, cards, rows }: { node: StartTreeNode; cards: Cards; rows: Rows | null }) {
  return rows ? <ProgressMarks node={node} row={rows.get(node.key)} /> : <NodeMarks node={node} progress={nodeProgress(node, cards)} />
}

export interface StartTreeProps {
  root: StartTreeNode
  current: StartTreeNode
  onCurrent: (node: StartTreeNode) => void
  /** Enter on any node but the empty corner: «Начать тренировку». */
  onStart: () => void
  /** Repetition spec 6: the position cards' states by start id. */
  cards?: Record<string, StartCardState>
  /** Spec (progress part 2) 6.2: the rows' percents by node key when the graph has weights; they replace the card marks. */
  progress?: Rows | null
  /** The rows are another colour's, kept while the colour picked is being read: dimmed and busy. */
  progressStale?: boolean
}

/** Spec (starts) 5.1: «Из списка» — the outline, the corner board with lettered continuations, the cards. */
export function StartTree({ root, current, onCurrent, onStart, cards = NO_CARDS, progress: rows = null, progressStale = false }: StartTreeProps) {
  const { language, t } = useI18n()
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const path = chain(current)
  const kids = current.children
  const hovered = hover !== null ? (kids[hover] ?? null) : null
  const shown = hovered ?? current
  const shownCard = shown.id ? (cards[shown.id] ?? null) : null
  const shownRow = rows?.get(shown.key)
  // «Когда повторять»: with weights only a future due of the position's graph cards (part 3 spec 6.4: the earlier of both
  // colours for a random colour; a due position has the mark beside the percent), else its position card's line.
  const shownDue = dueLine(rows !== null, shownRow, shownCard, new Date())
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
      class={rows ? `start-tree with-progress${progressStale ? ' stale' : ''}` : 'start-tree'}
      tabIndex={0}
      role="group"
      aria-busy={(rows !== null && progressStale) || undefined}
      onKeyDown={onKey}
      aria-label={t('tree.label')}
    >
      <nav class="start-outline" aria-label={t('tree.outline')}>
        <OutlineRow node={root} depth={0} path={path} current={current} cards={cards} rows={rows} onPick={go} />
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
            <div class="start-info-name">
              {shown.name}
              {shownRow && (
                // Spec (progress part 2) 6.3: the percent beside the full name and, when it is time, «пора повторить».
                <span class="start-info-progress">
                  <PercentBar value={shownRow.percent} />
                  {t('progress.mastered', { percent: formatPercent(shownRow.percent, language) })}
                  {dueHere(shown, shownRow) && (
                    <span class="start-info-due">
                      <span class="card-mark due" aria-hidden="true" />
                      {t('progress.dueMark')}
                    </span>
                  )}
                </span>
              )}
            </div>
            <div class="start-info-sub">{details(shown, t)}</div>
            {shown.rare && <div class="start-rare">{t('tree.rarelyPlayed')}</div>}
            {shownDue && (
              <div class="start-info-card">
                {shownCard && !rows && <span class={markClass(shownCard)} aria-hidden="true" />}
                {capitalize(shownDue.now ? t('tree.card.due') : t('tree.card.next', { when: formatWhen(shownDue.at, new Date(), language, t) }))}
              </div>
            )}
          </div>
        </div>
        {kids.length > 0 && (
          <div class="start-cards" onMouseLeave={() => setHover(null)}>
            {kids.map((c, i) => {
              const letter = letterOf(i)
              const marks = rows ? progressMarks(c, rows.get(c.key), language, t) : cardMarks(c, nodeProgress(c, cards), t)
              return (
                <button
                  type="button"
                  key={c.key}
                  class={`start-card${c.rare ? ' rare' : ''}${i === hover ? ' hover' : ''}`}
                  aria-label={cardLabel(c, letter, marks, t)}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => go(c)}
                >
                  <b>{letter}</b>
                  <CornerBoard moves={c.moves} />
                  <span class="start-card-name">{c.short}</span>
                  {c.rare && <span class="start-rare">{t('tree.rare')}</span>}
                  <Marks node={c} cards={cards} rows={rows} />
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
  rows: Rows | null
  onPick: (node: StartTreeNode) => void
}

/** One row of the outline; the rows on the path to the current node are open. */
function OutlineRow({ node, depth, path, current, cards, rows, onPick }: OutlineRowProps) {
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
        <Marks node={node} cards={cards} rows={rows} />
      </button>
      {open && node.children.map((c) => <OutlineRow key={c.key} node={c} depth={depth + 1} path={path} current={current} cards={cards} rows={rows} onPick={onPick} />)}
    </>
  )
}
