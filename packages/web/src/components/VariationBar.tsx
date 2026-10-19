import { Fragment } from 'preact'
import { ChevronLeft, ChevronRight, LoaderCircle, Undo2 } from 'lucide-preact'
import { formatCount, moveLabel } from '../format'
import { useI18n } from '../i18n'
import { richText } from '../rich-text'
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
  /** The number of the variation's first move in the caption («Вариант от хода N»): see `variationNumbers`. */
  fromNumber: number
  /** The caption of the way back; the review's «Вернуться к партии» unless a screen names its own. */
  closeLabel?: string
}

/** Variations spec 3–5: the variation's moves and steps, the way back to the game, KataGo's replies and their progress. */
export function VariationBar({ variation, onStep, onClose, autoReply, onAutoReply, visits, thinking, limit, passed, onAnswer, fromNumber, closeLabel }: VariationBarProps) {
  const { t, language } = useI18n()
  const { moves, step } = variation
  const line = moves.map((m, i) => (
    <Fragment key={i}>
      {i > 0 && ' · '}
      {i + 1 === step ? <b>{moveLabel(m, t)}</b> : <span class={i >= step ? 'tail' : undefined}>{moveLabel(m, t)}</span>}
    </Fragment>
  ))
  // The noun agrees with the last number shown: the limit when known.
  const done = visits ?? 0
  const progress =
    limit !== null
      ? t('variation.thinkingOf', { visits: formatCount(done, language), limit: formatCount(limit, language), count: limit })
      : t('variation.thinking', { visits: formatCount(done, language), count: done })
  return (
    <div class="variation-bar">
      <div class="nav">
        <button class="ghost icon" onClick={() => onStep(-1)} aria-label={t('variation.back')}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <span class="line" data-testid="variation-line">
          {richText(t('variation.line', { n: fromNumber }), { moves: line })}
        </span>
        <button class="ghost icon" disabled={step >= moves.length} onClick={() => onStep(1)} aria-label={t('variation.forward')}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div class="tools">
        <label class="switch">
          <input type="checkbox" checked={autoReply} onChange={(e) => onAutoReply(e.currentTarget.checked)} />
          {t('variation.autoReply')}
        </label>
        <button class="ghost sm" onClick={onClose}>
          <Undo2 aria-hidden="true" />
          {closeLabel ?? t('variation.backToGame')}
        </button>
      </div>
      <div class="status" aria-live="polite">
      {thinking ? (
        <>
          <LoaderCircle class="spin" aria-hidden="true" />
          <span>{progress}</span>
          <button class="sm" disabled={!onAnswer} onClick={() => onAnswer?.()}>
            {t('variation.answerNow')}
          </button>
        </>
      ) : (
        <>
          {passed && <b>{t('variation.katagoPasses')}</b>}
          {visits !== null && <span>{t('common.visits', { value: formatCount(visits, language) })}</span>}
        </>
      )}
      </div>
    </div>
  )
}
