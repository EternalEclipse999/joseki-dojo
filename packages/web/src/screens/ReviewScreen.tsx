import type { JSX } from 'preact'
import type { Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ChevronLeft, ChevronRight, FolderOpen, GitBranch, LoaderCircle, Map as MapIcon, Play, RotateCcw, Swords, Telescope } from 'lucide-preact'
import { nextColor, Position, type AnalysisSettings, type Move, type MoveVertex, type ReviewData, type TrapVerdict, type Vertex } from '@joseki-dojo/shared'
import { emptyMap, isVertex, ownershipMap, pvMoves, sameVertex } from '../board-maps'
import { Board } from '../components/Board'
import { CandidateList, LABELS } from '../components/CandidateList'
import { LossBar } from '../components/LossBar'
import { VariationBar } from '../components/VariationBar'
import { ACTOR_LABEL, CATEGORY_LABEL, formatCount, formatPoints, moveLabel } from '../format'
import { summaryTiles } from '../review-summary'
import {
  bestIsPass,
  candidateIndex,
  candidateLeft,
  exitTurn,
  isLegalNext,
  mergeResult,
  moveLoss,
  playInVariation,
  positionKey,
  replyVertex,
  shouldReply,
  shownMoves,
  startAfterTurn,
  startVariation,
  stepVariation,
  variationMoves,
  type Variation,
  type VariationResult,
  type VariationUpdate,
} from '../variation'

/** Variations spec 3–6: the review's link to the deepening search on the server, and the visits settings. */
export interface VariationLink {
  /** The last `variationAnalysis` message, or null. */
  update: VariationUpdate | null
  analyze: (fromTurn: number, moves: Vertex[]) => void
  stop: () => void
  /** A search ends with its socket: the shown position is asked for again when the link is back. */
  connected: boolean
  /** Increments on every server error: a pending KataGo reply is given up. */
  errorSeq: number
  /** The visits of the stored review and the limit of a variation search; null until the settings are loaded. */
  visits: AnalysisSettings | null
}

export interface ReviewScreenProps {
  review: ReviewData | null
  progress: { done: number; total: number } | null
  onReplay: (turn: number) => void
  /** «К выбору тренировки»: the start screen. */
  onNew: () => void
  /** «Следующая позиция»: a new game with the last settings; null while they are unknown. */
  onNext: (() => void) | null
  busy?: boolean
  variations: VariationLink
}

export function ReviewScreen({ review, progress, onReplay, onNew, onNext, busy, variations }: ReviewScreenProps) {
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
              {onNext && (
                <button class="primary" disabled={busy} onClick={onNext}>
                  <Play aria-hidden="true" />
                  Следующая позиция
                </button>
              )}
              <button class="ghost" onClick={onNew}>
                <FolderOpen aria-hidden="true" />
                К выбору тренировки
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
              {onNext && (
                <button class="primary" disabled={busy} onClick={onNext}>
                  <Play aria-hidden="true" />
                  Следующая позиция
                </button>
              )}
              <button class={onNext ? 'ghost' : 'primary'} onClick={onNew}>
                <FolderOpen aria-hidden="true" />
                К выбору тренировки
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }
  return <ReviewLoaded key={review.sessionId} review={review} onReplay={onReplay} onNew={onNew} onNext={onNext} busy={busy} variations={variations} />
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const VERDICT: Record<TrapVerdict, { text: string; cls: string }> = {
  correct: { text: 'верный ответ', cls: 'cat exact' },
  caught: { text: 'попались в ловушку', cls: 'cat blunder' },
  other: { text: 'ход не из базы', cls: 'badge' },
}

/** Traps spec 7: the trick is marked; the answer to it gets the base's verdict and its correct answers. */
function trapNote(review: ReviewData, turn: number): JSX.Element | null {
  const trap = review.trap
  if (!trap) return null
  if (trap.trickTurn === turn) {
    return (
      <p class="trap-line">
        <Swords aria-hidden="true" />
        <span class="badge">ловушка</span>
        <span class="muted">известная ловушка из базы</span>
      </p>
    )
  }
  if (trap.answerTurn !== turn || trap.verdict === null) return null
  const v = VERDICT[trap.verdict]
  return (
    <p class="trap-line">
      <Swords aria-hidden="true" />
      <span class={v.cls}>{v.text}</span>
      {trap.good.length > 0 && <span class="muted">Верно: {trap.good.map((g) => (g === 'pass' ? 'тэнуки' : moveLabel(g))).join(', ')}</span>}
    </p>
  )
}

/** ← and → step through the moves unless the focus is in a text field (a checkbox does not take the arrows). */
function useArrowKeys(onStep: (delta: number) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !target.matches('input[type=checkbox]')))) return
      if (e.key === 'ArrowLeft') onStep(-1)
      else if (e.key === 'ArrowRight') onStep(1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStep])
}

interface ReviewLoadedProps {
  review: ReviewData
  onReplay: (turn: number) => void
  onNew: () => void
  onNext: (() => void) | null
  busy?: boolean
  variations: VariationLink
}

/**
 * Spec 7: summary, loss chart, move navigator, candidates and the branch, next to the board.
 * Variations spec 3–5: a variation instead of a game move, its deepening analysis and KataGo's replies.
 */
function ReviewLoaded({ review, onReplay, onNew, onNext, busy, variations }: ReviewLoadedProps) {
  const [turn, setTurn] = useState(0)
  const [pvStep, setPvStep] = useState<number | null>(null)
  const [showOwnership, setShowOwnership] = useState(false)
  // Candidates are chosen by their vertex: a deeper analysis may reorder the list.
  const [hotVertex, setHotVertex] = useState<MoveVertex | null>(null)
  const [selectedVertex, setSelectedVertex] = useState<MoveVertex | null>(null)
  const [variation, setVariation] = useState<Variation | null>(null)
  const [results, setResults] = useState<ReadonlyMap<string, VariationResult>>(() => new Map())
  const [autoReply, setAutoReply] = useState(true)
  // The key of the position KataGo is to answer; board clicks wait meanwhile.
  const [awaiting, setAwaiting] = useState<string | null>(null)
  // «Глубже» is on for one game move.
  const [deeperTurn, setDeeperTurn] = useState<number | null>(null)
  // The key of the position where KataGo's best reply was a pass.
  const [passedKey, setPassedKey] = useState<string | null>(null)

  const { update, connected, errorSeq } = variations
  const replyVisits = variations.visits?.reviewVisits ?? null
  const deeper = deeperTurn === turn
  const link = useRef(variations)
  link.current = variations
  useEffect(() => {
    if (update && update.sessionId === review.sessionId) setResults((r) => mergeResult(r, update))
  }, [update, review.sessionId])
  useEffect(() => setAwaiting(null), [errorSeq])

  // The position the candidates belong to: before game move `turn`, or after the shown moves of the variation.
  const fromTurn = variation?.fromTurn ?? turn
  const vMoves = useMemo(() => (variation ? shownMoves(variation) : []), [variation])
  const key = positionKey(fromTurn, vMoves)
  const base = useMemo(() => variationMoves([...review.initialMoves, ...review.moves.slice(0, fromTurn)], vMoves), [review, fromTurn, vMoves])
  const result = results.get(key)
  useEffect(() => {
    setPvStep(null)
    setHotVertex(null)
    setSelectedVertex(null)
  }, [key])

  // Spec 4: the shown variation position (or a deepened game position) is searched until it is done or left.
  const live = variation !== null || deeper
  const finished = result?.done === true
  useEffect(() => {
    if (!live || finished || !connected) return
    link.current.analyze(fromTurn, vMoves)
    return () => link.current.stop()
  }, [live, key, finished, connected])

  const lastTurn = review.moves.length - 1
  const step = useMemo(
    () => (delta: number) => {
      if (variation) {
        // Spec 8: «←» on the first variation move leaves the variation for the game position it started from.
        if (delta < 0 && variation.step <= 1) {
          setTurn(exitTurn(variation))
          setVariation(null)
        } else setVariation(stepVariation(variation, delta))
        setAwaiting(null)
      } else setTurn((t) => Math.min(lastTurn, Math.max(0, t + delta)))
    },
    [variation, lastTurn],
  )
  useArrowKeys(step)

  const move = review.moveReviews[turn]
  // «Глубже»: the deepened candidates replace the stored ones once they rest on more visits.
  const deepResult = !variation && deeper && result && result.visits > review.positions[turn].visits ? result : null
  const shown = variation ? (result?.position ?? null) : (deepResult?.position ?? review.positions[turn])
  const candidates = shown?.candidates ?? []
  const selIndex = candidateIndex(candidates, selectedVertex)
  const hot = hotVertex === null ? -1 : candidates.findIndex((c) => sameVertex(c.vertex, hotVertex))
  const sel = candidates[selIndex] ?? null
  // The chosen candidate left the list: back to the best one, and its branch is gone.
  useEffect(() => {
    if (!candidateLeft(candidates, selectedVertex)) return
    setSelectedVertex(null)
    setPvStep(null)
  }, [candidates, selectedVertex])
  const branchStep = sel && pvStep !== null ? Math.max(1, Math.min(pvStep, sel.pv.length)) : null
  const toMove = variation ? nextColor(base) : move.color
  const branch = useMemo(() => (sel && branchStep !== null ? pvMoves(toMove, sel.pv, branchStep) : []), [sel, branchStep, toMove])
  // The board shows the position after the selected move (or the variation's last shown move); a branch continues from
  // the position the candidates belong to.
  const signMap = useMemo(() => {
    const onBoard = branchStep !== null ? [...base, ...branch] : variation ? base : [...base, review.moves[turn]]
    try {
      return Position.fromMoves(onBoard).signMap()
    } catch {
      return Position.fromMoves(base).signMap()
    }
  }, [review, turn, variation, base, branch, branchStep])

  // Spec 5: KataGo plays the best move of the latest result for the awaited position.
  const answer = (): void => {
    const r = results.get(key)
    const v = replyVertex(r)
    setAwaiting(null)
    if (bestIsPass(r)) setPassedKey(key)
    if (variation && v && isLegalNext(base, v)) setVariation(playInVariation(variation, v))
  }
  useEffect(() => {
    if (awaiting === null) return
    if (awaiting !== key || !variation) setAwaiting(null)
    else if (shouldReply(results.get(awaiting), replyVisits)) answer()
  }, [awaiting, key, results, replyVisits])

  /** The user's moves from the shown position: a variation instead of game move `turn`, or more of the open one. */
  const play = (vertices: Vertex[], afterTurn = false): void => {
    if (awaiting !== null) return
    let next: Variation | null = variation
    for (const v of vertices) next = next ? playInVariation(next, v) : afterTurn ? startAfterTurn(turn, v) : startVariation(turn, v)
    if (!next) return
    setVariation(next)
    setPassedKey(null)
    setAwaiting(autoReply ? positionKey(next.fromTurn, shownMoves(next)) : null)
  }
  // A click plays after the shown game move, or in the open variation, or after the shown branch.
  const onBoardClick = (v: Vertex): void => {
    if (awaiting !== null) return
    const pv = branch.map((m) => m.vertex)
    // Spec 8: in the game, a click plays after the shown move (the letters are only hints); a shown branch is continued.
    const plain = !variation && branchStep === null
    if (plain) {
      if (isLegalNext([...base, review.moves[turn]], v)) play([v], true)
      return
    }
    if (!pv.every(isVertex) || !isLegalNext([...base, ...branch], v)) return
    play([...pv, v])
  }
  const backToGame = (): void => {
    if (variation) setTurn(exitTurn(variation))
    setVariation(null)
    setAwaiting(null)
  }
  const selectTurn = (t: number): void => {
    setVariation(null)
    setAwaiting(null)
    setTurn(t)
  }
  const switchAutoReply = (on: boolean): void => {
    setAutoReply(on)
    if (!on) setAwaiting(null)
  }

  const last: Move | null = variation ? (base.at(-1) ?? null) : review.moves[turn]
  const markers = emptyMap<Marker | null>(null)
  const dimmed: Vertex[] = []
  let highlighted: Vertex[] = []
  if (branchStep === null) {
    // The letters show where to play next; in the game, a candidate that is the move itself keeps its dot.
    candidates.forEach((c, i) => {
      if (!isVertex(c.vertex)) return
      if (i === hot) highlighted = [c.vertex]
      if (last && sameVertex(c.vertex, last.vertex)) return
      markers[c.vertex[1]][c.vertex[0]] = { type: 'label', label: LABELS[i] }
      if (i > 0) dimmed.push(c.vertex)
    })
    if (last && isVertex(last.vertex)) markers[last.vertex[1]][last.vertex[0]] = { type: 'point' }
  } else {
    branch.forEach((m, i) => {
      if (isVertex(m.vertex)) markers[m.vertex[1]][m.vertex[0]] = { type: 'label', label: String(i + 1) }
    })
  }
  const ownership = variation ? (result?.position.ownership ?? null) : review.positions[turn + 1].ownership
  const paint = showOwnership ? ownershipMap(ownership) : null

  // Spec 3: the last variation move loses against the best move of the position before it, once both are analysed.
  let lastLoss: number | null = null
  if (variation && last && result) {
    const prevMoves = vMoves.slice(0, -1)
    const prev = results.get(positionKey(fromTurn, prevMoves))
    const before = prevMoves.length > 0 ? prev?.position : prev && prev.visits > review.positions[fromTurn].visits ? prev.position : review.positions[fromTurn]
    if (before) lastLoss = moveLoss(last.color, before.scoreLeadBlack, result.position.scoreLeadBlack)
  }

  const punishment = review.punishments.find((e) => e.turn === turn || e.turn + 1 === turn) ?? null

  return (
    <main class="layout review">
      <Board
        signMap={signMap}
        corner={review.settings.corner}
        markers={markers}
        paint={paint}
        dimmed={dimmed}
        selected={highlighted}
        lastTone={branchStep === null && !variation ? move.category : undefined}
        busy={awaiting !== null}
        onClick={onBoardClick}
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

        <LossBar moves={review.moveReviews} userColor={review.settings.userColor} selected={turn} onSelect={selectTurn} />

        {variation && last ? (
          <>
            <VariationBar
              variation={variation}
              onStep={step}
              onClose={backToGame}
              autoReply={autoReply}
              onAutoReply={switchAutoReply}
              visits={result?.visits ?? null}
              thinking={awaiting !== null}
              limit={replyVisits}
              passed={passedKey === key}
              onAnswer={replyVertex(result) ? answer : null}
            />
            <div class="move-line">
              <span class={last.color === 'B' ? 'stone black' : 'stone white'} />
              <span>
                Ход {fromTurn + variation.step}: <b>{moveLabel(last.vertex)}</b>
              </span>
              {lastLoss !== null && <span class="loss">{lastLoss > 0.05 ? `−${formatPoints(lastLoss)}` : formatPoints(0)}</span>}
            </div>
          </>
        ) : (
          <>
            <div class="navigator">
              <span class="where">
                Ход {turn + 1} из {review.moves.length}
                <kbd aria-hidden="true">← →</kbd>
              </span>
              <input
                type="range"
                min={1}
                max={review.moves.length}
                value={turn + 1}
                aria-label="Ход партии"
                onInput={(e) => selectTurn(Number(e.currentTarget.value) - 1)}
              />
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
            {trapNote(review, turn)}
            {punishment && (
              <p class="punishment">
                {punishment.turn === turn ? 'Ошибка бота' : 'Ваш ответ на ошибку бота'}: бот потерял {formatPoints(punishment.botLoss)}, ваш ответ —{' '}
                {formatPoints(punishment.userLoss)}. {punishment.punished ? 'Наказано.' : `Не наказано, удержано ${formatPoints(punishment.kept)}.`}
              </p>
            )}
          </>
        )}

        <CandidateList
          candidates={candidates}
          selected={selIndex}
          hot={hot < 0 ? null : hot}
          onHot={(i) => setHotVertex(i === null ? null : (candidates[i]?.vertex ?? null))}
          onSelect={(i) => setSelectedVertex(candidates[i]?.vertex ?? null)}
          onPlay={awaiting === null ? (v) => play([v]) : null}
          gameMove={variation ? null : move.vertex}
          pending={variation !== null && !result && connected}
        />

        <div class="branch">
          {sel && sel.pv.length > 0 && branchStep === null && (
            <button onClick={() => setPvStep(1)}>
              <GitBranch aria-hidden="true" />
              Показать ветку
            </button>
          )}
          {sel && branchStep !== null && (
            <>
              <button class="icon" disabled={branchStep <= 1} onClick={() => setPvStep(branchStep - 1)} aria-label="Назад по ветке">
                <ChevronLeft aria-hidden="true" />
              </button>
              <span class="where">
                Ветка: {branchStep} из {sel.pv.length}
              </span>
              <button class="icon" disabled={branchStep >= sel.pv.length} onClick={() => setPvStep(branchStep + 1)} aria-label="Вперёд по ветке">
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
          {!variation && (
            <button aria-pressed={deeper} onClick={() => setDeeperTurn(deeper ? null : turn)}>
              <Telescope aria-hidden="true" />
              Глубже
            </button>
          )}
          {!variation && deeper && (
            <span class="where" aria-live="polite">
              {deepResult ? `визитов: ${formatCount(deepResult.visits)}` : !result && connected ? 'KataGo считает…' : ''}
            </span>
          )}
        </div>

        <hr class="divider" />
        <div class="actions">
          {onNext && (
            <button class="primary" disabled={busy} onClick={onNext}>
              <Play aria-hidden="true" />
              Следующая позиция
            </button>
          )}
          <button disabled={busy} onClick={() => onReplay(turn)}>
            <RotateCcw aria-hidden="true" />
            Переиграть этот ход
          </button>
          <button class="ghost" onClick={onNew}>
            <FolderOpen aria-hidden="true" />
            К выбору тренировки
          </button>
        </div>
      </aside>
    </main>
  )
}
