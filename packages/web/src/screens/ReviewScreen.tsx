import type { Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { ChevronLeft, ChevronRight, GitBranch, LoaderCircle, Map as MapIcon, Plus, RotateCcw } from 'lucide-preact'
import { Position, type ReviewData, type Vertex } from '@joseki-dojo/shared'
import { emptyMap, isVertex, ownershipMap, pvMoves, sameVertex } from '../board-maps'
import { Board } from '../components/Board'
import { LossBar } from '../components/LossBar'
import { ACTOR_LABEL, CATEGORY_LABEL, formatPoints, moveLabel } from '../format'
import { summaryTiles } from '../review-summary'

const LABELS = 'ABC'

export interface ReviewScreenProps {
  review: ReviewData | null
  progress: { done: number; total: number } | null
  onReplay: (turn: number) => void
  onNew: () => void
  busy?: boolean
}

export function ReviewScreen({ review, progress, onReplay, onNew, busy }: ReviewScreenProps) {
  if (!review) {
    return (
      <main>
        <div class="page">
          <div class="card section">
            <p class="status-line">
              <LoaderCircle class="spin" aria-hidden="true" />
              Анализирую позиции…
            </p>
            {progress && (
              <>
                <progress max={progress.total} value={progress.done} />
                <p class="small muted">
                  {progress.done} из {progress.total}
                </p>
              </>
            )}
            <div class="actions">
              <button class="ghost" onClick={onNew}>
                Новая тренировка
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }
  if (review.moves.length === 0) {
    return (
      <main>
        <div class="page">
          <div class="card section">
            <p>В этой тренировке не было ходов.</p>
            <div class="actions">
              <button class="primary" onClick={onNew}>
                Новая тренировка
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }
  return <ReviewLoaded review={review} onReplay={onReplay} onNew={onNew} busy={busy} />
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** ← and → step through the moves unless the focus is in a text field. */
function useArrowKeys(onStep: (delta: number) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (e.key === 'ArrowLeft') onStep(-1)
      else if (e.key === 'ArrowRight') onStep(1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStep])
}

/** Spec 7: summary, loss chart, move navigator, candidates and the branch, next to the board. */
function ReviewLoaded({ review, onReplay, onNew, busy }: { review: ReviewData; onReplay: (turn: number) => void; onNew: () => void; busy?: boolean }) {
  const [turn, setTurn] = useState(0)
  const [pvStep, setPvStep] = useState<number | null>(null)
  const [showOwnership, setShowOwnership] = useState(false)
  const [hot, setHot] = useState<number | null>(null)
  useEffect(() => {
    setPvStep(null)
    setHot(null)
  }, [turn])

  const lastTurn = review.moves.length - 1
  const step = useMemo(() => (delta: number) => setTurn((t) => Math.min(lastTurn, Math.max(0, t + delta))), [lastTurn])
  useArrowKeys(step)

  const move = review.moveReviews[turn]
  const position = review.positions[turn]
  const best = position.candidates[0] ?? null
  const variation = useMemo(
    () => (best && pvStep !== null ? pvMoves(move.color, best.pv, pvStep) : []),
    [best, pvStep, move.color],
  )
  // The board shows the position after the selected move; a branch replaces that move with the best line.
  const signMap = useMemo(() => {
    const before = [...review.initialMoves, ...review.moves.slice(0, turn)]
    const shown = pvStep === null ? [...before, review.moves[turn]] : [...before, ...variation]
    try {
      return Position.fromMoves(shown).signMap()
    } catch {
      return Position.fromMoves(before).signMap()
    }
  }, [review, turn, pvStep, variation])

  const markers = emptyMap<Marker | null>(null)
  const dimmed: Vertex[] = []
  let selected: Vertex[] = []
  if (pvStep === null) {
    // The letters show where to play instead of the selected move; a candidate that is the move itself keeps its dot.
    position.candidates.forEach((c, i) => {
      if (!isVertex(c.vertex)) return
      if (i === hot) selected = [c.vertex]
      if (sameVertex(c.vertex, move.vertex)) return
      markers[c.vertex[1]][c.vertex[0]] = { type: 'label', label: LABELS[i] }
      if (i > 0) dimmed.push(c.vertex)
    })
    if (isVertex(move.vertex)) markers[move.vertex[1]][move.vertex[0]] = { type: 'point' }
  } else {
    variation.forEach((m, i) => {
      if (isVertex(m.vertex)) markers[m.vertex[1]][m.vertex[0]] = { type: 'label', label: String(i + 1) }
    })
  }
  const paint = showOwnership ? ownershipMap(review.positions[turn + 1].ownership) : null

  const punishment = review.punishments.find((e) => e.turn === turn || e.turn + 1 === turn) ?? null

  return (
    <main class="layout review">
      <Board
        signMap={signMap}
        corner={review.settings.corner}
        markers={markers}
        paint={paint}
        dimmed={dimmed}
        selected={selected}
        lastTone={pvStep === null ? move.category : undefined}
      />
      <aside class="panel">
        <div class="metrics">
          {summaryTiles(review.summary).map((t) => (
            <div class="metric" key={t.k}>
              <span class="k">{t.k}</span>
              <span class="v">{t.v}</span>
              <span class="s">{t.s}</span>
            </div>
          ))}
        </div>

        <LossBar moves={review.moveReviews} userColor={review.settings.userColor} selected={turn} onSelect={setTurn} />

        <div class="navigator">
          <button class="ghost icon" disabled={turn === 0} onClick={() => step(-1)} aria-label="Предыдущий ход">
            <ChevronLeft aria-hidden="true" />
          </button>
          <span class="where">
            Ход {turn + 1} из {review.moves.length}
            <kbd aria-hidden="true">← →</kbd>
          </span>
          <button class="ghost icon" disabled={turn === lastTurn} onClick={() => step(1)} aria-label="Следующий ход">
            <ChevronRight aria-hidden="true" />
          </button>
        </div>

        <div class="move-line">
          <span class={move.color === 'B' ? 'stone black' : 'stone white'} />
          <span>
            {capitalize(ACTOR_LABEL[move.actor])}: <b>{moveLabel(move.vertex)}</b>
          </span>
          <span class={`cat ${move.category}`}>
            {CATEGORY_LABEL[move.category]}
            {move.loss > 0.05 && ` −${formatPoints(move.loss)}`}
          </span>
        </div>
        {punishment && (
          <p class="punishment">
            {punishment.turn === turn ? 'Ошибка бота' : 'Ваш ответ на ошибку бота'}: бот потерял {formatPoints(punishment.botLoss)}, ваш ответ —{' '}
            {formatPoints(punishment.userLoss)}. {punishment.punished ? 'Наказано.' : `Не наказано, удержано ${formatPoints(punishment.kept)}.`}
          </p>
        )}

        <ul class="candidates" aria-label="Лучшие ходы">
          {position.candidates.map((c, i) => (
            <li key={i} class={i === hot ? 'hot' : undefined} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)}>
              <span class="letter">{LABELS[i]}</span>
              <span>{moveLabel(c.vertex)}</span>
              {sameVertex(c.vertex, move.vertex) && <span class="badge">ваш ход</span>}
              {i === 0 ? <span class="best">лучший</span> : <span class="loss">−{formatPoints(c.loss)}</span>}
            </li>
          ))}
        </ul>

        <div class="branch">
          {best && best.pv.length > 0 && pvStep === null && (
            <button onClick={() => setPvStep(1)}>
              <GitBranch aria-hidden="true" />
              Показать ветку
            </button>
          )}
          {best && pvStep !== null && (
            <>
              <button class="icon" disabled={pvStep <= 1} onClick={() => setPvStep(pvStep - 1)} aria-label="Назад по ветке">
                <ChevronLeft aria-hidden="true" />
              </button>
              <span class="where">
                Ветка: {pvStep} из {best.pv.length}
              </span>
              <button class="icon" disabled={pvStep >= best.pv.length} onClick={() => setPvStep(pvStep + 1)} aria-label="Вперёд по ветке">
                <ChevronRight aria-hidden="true" />
              </button>
              <button class="ghost" onClick={() => setPvStep(null)}>
                Скрыть ветку
              </button>
            </>
          )}
          <button aria-pressed={showOwnership} onClick={() => setShowOwnership(!showOwnership)}>
            <MapIcon aria-hidden="true" />
            Территория
          </button>
        </div>

        <hr class="divider" />
        <div class="actions">
          <button class="primary" disabled={busy} onClick={() => onReplay(turn)}>
            <RotateCcw aria-hidden="true" />
            Переиграть этот ход
          </button>
          <button class="ghost" onClick={onNew}>
            <Plus aria-hidden="true" />
            Новая тренировка
          </button>
        </div>
      </aside>
    </main>
  )
}
