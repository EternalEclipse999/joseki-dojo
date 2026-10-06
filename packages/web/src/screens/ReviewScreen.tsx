import type { GhostStone, Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { colorSign, Position, type ReviewData } from '@joseki-dojo/shared'
import { emptyMap, GHOST_TYPE, isVertex, ownershipMap, pvMoves } from '../board-maps'
import { Board } from '../components/Board'
import { LossBar } from '../components/LossBar'
import { ACTOR_LABEL, CATEGORY_LABEL, colorLabel, formatPoints, moveLabel, plural } from '../format'

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
      <main class="engine">
        <p class="status">Анализирую позиции…{progress ? ` ${progress.done} из ${progress.total}` : ''}</p>
        <div class="row">
          <button onClick={onNew}>Новая тренировка</button>
        </div>
      </main>
    )
  }
  if (review.moves.length === 0) {
    return (
      <main class="engine">
        <p>В этой тренировке не было ходов.</p>
        <div class="row">
          <button class="primary" onClick={onNew}>
            Новая тренировка
          </button>
        </div>
      </main>
    )
  }
  return <ReviewLoaded review={review} onReplay={onReplay} onNew={onNew} busy={busy} />
}

function ReviewLoaded({ review, onReplay, onNew, busy }: { review: ReviewData; onReplay: (turn: number) => void; onNew: () => void; busy?: boolean }) {
  const [turn, setTurn] = useState(0)
  const [pvStep, setPvStep] = useState<number | null>(null)
  const [showOwnership, setShowOwnership] = useState(false)
  useEffect(() => setPvStep(null), [turn])

  const move = review.moveReviews[turn]
  const position = review.positions[turn]
  const best = position.candidates[0] ?? null
  const variation = useMemo(
    () => (best && pvStep !== null ? pvMoves(move.color, best.pv, pvStep) : []),
    [best, pvStep, move.color],
  )
  const signMap = useMemo(() => {
    const base = [...review.initialMoves, ...review.moves.slice(0, turn)]
    try {
      return Position.fromMoves([...base, ...variation]).signMap()
    } catch {
      return Position.fromMoves(base).signMap()
    }
  }, [review, turn, variation])

  const markers = emptyMap<Marker | null>(null)
  const ghosts = emptyMap<GhostStone | null>(null)
  if (pvStep === null) {
    position.candidates.forEach((c, i) => {
      if (isVertex(c.vertex)) markers[c.vertex[1]][c.vertex[0]] = { type: 'label', label: LABELS[i] }
    })
    if (isVertex(move.vertex)) ghosts[move.vertex[1]][move.vertex[0]] = { sign: colorSign(move.color), type: GHOST_TYPE[move.category] }
  } else {
    variation.forEach((m, i) => {
      if (isVertex(m.vertex)) markers[m.vertex[1]][m.vertex[0]] = { type: 'label', label: String(i + 1) }
    })
  }
  const paint = showOwnership ? ownershipMap(review.positions[turn + 1].ownership) : null

  const s = review.summary
  const punishment = review.punishments.find((e) => e.turn === turn || e.turn + 1 === turn) ?? null
  const lastTurn = review.moves.length - 1

  return (
    <main class="review">
      <Board signMap={signMap} corner={review.settings.corner} markers={markers} ghosts={ghosts} paint={paint} />
      <aside class="panel">
        <div class="summary">
          <p>Вы потеряли {formatPoints(s.userLoss)} очка.</p>
          <p>
            Бот ошибся {s.botMistakes} {plural(s.botMistakes, 'раз', 'раза', 'раз')}
            {s.botMistakes > 0 && ` на ${formatPoints(s.botMistakeLoss)} очка`}.
          </p>
          {s.botMistakes > 0 && (
            <p>
              Наказано {s.punished} из {s.botMistakes}, удержано {formatPoints(s.keptPoints)} из {formatPoints(s.botMistakeLoss)} очка.
            </p>
          )}
        </div>
        <LossBar moves={review.moveReviews} userColor={review.settings.userColor} selected={turn} onSelect={setTurn} />
        <div class="row">
          <button disabled={turn === 0} onClick={() => setTurn(turn - 1)} aria-label="Предыдущий ход">
            ◀
          </button>
          <span>
            Ход {turn + 1} из {review.moves.length}
          </span>
          <button disabled={turn === lastTurn} onClick={() => setTurn(turn + 1)} aria-label="Следующий ход">
            ▶
          </button>
        </div>
        <p>
          {colorLabel(move.color)} ({ACTOR_LABEL[move.actor]}): <b>{moveLabel(move.vertex)}</b> — потеря {formatPoints(move.loss)}, {CATEGORY_LABEL[move.category]}
        </p>
        {punishment && (
          <p>
            {punishment.turn === turn ? 'Ошибка бота' : 'Ваш ответ на ошибку бота'}: бот потерял {formatPoints(punishment.botLoss)}, ваш ответ —{' '}
            {formatPoints(punishment.userLoss)}. {punishment.punished ? 'Наказано.' : `Не наказано, удержано ${formatPoints(punishment.kept)}.`}
          </p>
        )}
        <ul class="candidates">
          {position.candidates.map((c, i) => (
            <li key={i}>
              <b>{LABELS[i]}</b> {moveLabel(c.vertex)} {i === 0 ? '— лучший ход' : `— −${formatPoints(c.loss)}`}
            </li>
          ))}
        </ul>
        {best && best.pv.length > 0 && (
          <div class="row">
            {pvStep === null ? (
              <button onClick={() => setPvStep(1)}>Показать ветку</button>
            ) : (
              <>
                <button disabled={pvStep <= 1} onClick={() => setPvStep(pvStep - 1)} aria-label="Назад по ветке">
                  ◀
                </button>
                <span>
                  Ветка: {pvStep} из {best.pv.length}
                </span>
                <button disabled={pvStep >= best.pv.length} onClick={() => setPvStep(pvStep + 1)} aria-label="Вперёд по ветке">
                  ▶
                </button>
                <button onClick={() => setPvStep(null)}>Скрыть ветку</button>
              </>
            )}
          </div>
        )}
        <label>
          <input type="checkbox" checked={showOwnership} onChange={() => setShowOwnership(!showOwnership)} /> Чья территория
        </label>
        <div class="row">
          <button class="primary" disabled={busy} onClick={() => onReplay(turn)}>
            Переиграть с этого хода
          </button>
          <button onClick={onNew}>Новая тренировка</button>
        </div>
      </aside>
    </main>
  )
}
