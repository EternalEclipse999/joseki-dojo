import { Fragment } from 'preact'
import { ChevronLeft, ChevronRight, LoaderCircle, Undo2 } from 'lucide-preact'
import { formatCount, moveLabel } from '../format'
import type { Variation } from '../variation'

export interface VariationBarProps {
  variation: Variation
  onStep: (delta: number) => void
  onClose: () => void
  autoReply: boolean
  onAutoReply: (on: boolean) => void
  /** Visits of the shown position's latest result; null before the first one. */
  visits: number | null
  /** KataGo is to answer the shown position. */
  thinking: boolean
  /** The visits at which KataGo replies (the review's visits), when known. */
  limit: number | null
  /** KataGo's best reply is a pass. */
  passed: boolean
  /** «Ответить сейчас»; null while there is nothing to play yet. */
  onAnswer: (() => void) | null
}

/** Variations spec 3–5: the variation's moves and steps, the way back to the game, KataGo's replies and their progress. */
export function VariationBar({ variation, onStep, onClose, autoReply, onAutoReply, visits, thinking, limit, passed, onAnswer }: VariationBarProps) {
  const { fromTurn, moves, step } = variation
  return (
    <div class="variation-bar">
      <div class="nav">
        <button class="ghost icon" onClick={() => onStep(-1)} aria-label="Назад по варианту">
          <ChevronLeft aria-hidden="true" />
        </button>
        <span class="line" data-testid="variation-line">
          Вариант от хода {fromTurn + 1}:{' '}
          {moves.map((m, i) => (
            <Fragment key={i}>
              {i > 0 && ' · '}
              {i + 1 === step ? <b>{moveLabel(m)}</b> : <span class={i >= step ? 'tail' : undefined}>{moveLabel(m)}</span>}
            </Fragment>
          ))}
        </span>
        <button class="ghost icon" disabled={step >= moves.length} onClick={() => onStep(1)} aria-label="Вперёд по варианту">
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div class="tools">
        <label class="switch">
          <input type="checkbox" checked={autoReply} onChange={(e) => onAutoReply(e.currentTarget.checked)} />
          Отвечает KataGo
        </label>
        <button class="ghost sm" onClick={onClose}>
          <Undo2 aria-hidden="true" />
          Вернуться к партии
        </button>
      </div>
      <div class="status" aria-live="polite">
      {thinking ? (
        <>
          <LoaderCircle class="spin" aria-hidden="true" />
          <span>
            KataGo думает: {formatCount(visits ?? 0)}
            {limit !== null && ` / ${formatCount(limit)}`} визитов
          </span>
          <button class="sm" disabled={!onAnswer} onClick={() => onAnswer?.()}>
            Ответить сейчас
          </button>
        </>
      ) : (
        <>
          {passed && <b>KataGo пасует</b>}
          {visits !== null && <span>визитов: {formatCount(visits)}</span>}
        </>
      )}
      </div>
    </div>
  )
}
