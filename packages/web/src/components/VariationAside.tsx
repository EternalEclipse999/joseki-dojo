import { ChevronLeft, ChevronRight, Telescope } from 'lucide-preact'
import type { MoveVertex } from '@joseki-dojo/shared'
import { formatCount, formatPoints, moveLabel, ZERO_LOSS } from '../format'
import { useI18n } from '../i18n'
import { richText } from '../rich-text'
import type { VariationState } from '../use-variations'
import { replyVertex, type VariationNumbers } from '../variation'
import { CandidateList } from './CandidateList'
import { VariationBar } from './VariationBar'

// The panel pieces the review and the problem screen share around `useVariations` (variations spec 3–5); each screen
// keeps its own layout and places them in it.

export interface VariationHeadProps {
  v: VariationState
  /** The variation's move numbers (`variationNumbers`; the problem screen counts from the problem's move). */
  numbers: VariationNumbers
  /** The caption of the way back, when the screen has its own (VariationBar's `closeLabel`). */
  closeLabel?: string
}

/** Variations spec 3–5: the open variation's bar, then its shown move with the points it loses. */
export function VariationHead({ v, numbers, closeLabel }: VariationHeadProps) {
  const { t, language } = useI18n()
  const { variation, last, lastLoss, result } = v
  if (!variation || !last) return null
  return (
    <>
      <VariationBar
        variation={variation}
        onStep={v.step}
        onClose={v.backToGame}
        autoReply={v.autoReply}
        onAutoReply={v.switchAutoReply}
        visits={result?.visits ?? null}
        thinking={v.awaiting !== null}
        limit={v.replyVisits}
        passed={v.passed}
        onAnswer={replyVertex(result) ? v.answer : null}
        fromNumber={numbers.from}
        closeLabel={closeLabel}
      />
      <div class="move-line">
        <span class={last.color === 'B' ? 'stone black' : 'stone white'} />
        <span>{richText(t('review.variationMove', { n: numbers.move }), { move: <b>{moveLabel(last.vertex, t)}</b> })}</span>
        {lastLoss !== null && <span class="loss">{lastLoss > ZERO_LOSS ? `−${formatPoints(lastLoss, language)}` : formatPoints(0, language)}</span>}
      </div>
    </>
  )
}

export interface VariationCandidatesProps {
  v: VariationState
  /** The shown game move, marked among the candidates outside a variation. */
  gameMove: MoveVertex
  connected: boolean
}

/** Spec 7 and variations spec 3: the candidates of the shown position; a row plays its move, «Ветка» opens its line. */
export function VariationCandidates({ v, gameMove, connected }: VariationCandidatesProps) {
  const { candidates, variation, result } = v
  return (
    <CandidateList
      candidates={candidates}
      selected={v.selIndex}
      hot={v.hot < 0 ? null : v.hot}
      onHot={(i) => v.setHotVertex(i === null ? null : (candidates[i]?.vertex ?? null))}
      onBranch={(i) => {
        v.setSelectedVertex(candidates[i]?.vertex ?? null)
        v.setPvStep(1)
      }}
      onPlay={v.awaiting === null ? (vertex) => v.play([vertex]) : null}
      gameMove={variation ? null : gameMove}
      pending={variation !== null && !result && connected}
    />
  )
}

/** Spec 7: the steps through the open branch and the way to hide it; nothing while no branch is open. */
export function BranchSteps({ v }: { v: VariationState }) {
  const { t } = useI18n()
  const { sel, branchStep, setPvStep } = v
  if (!sel || branchStep === null) return null
  return (
    <>
      <button class="icon" disabled={branchStep <= 1} onClick={() => setPvStep(branchStep - 1)} aria-label={t('review.branch.back')}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <span class="where">{t('review.branch.step', { step: branchStep, total: sel.pv.length })}</span>
      <button class="icon" disabled={branchStep >= sel.pv.length} onClick={() => setPvStep(branchStep + 1)} aria-label={t('review.branch.forward')}>
        <ChevronRight aria-hidden="true" />
      </button>
      <button class="ghost" onClick={() => setPvStep(null)}>
        {t('review.branch.hide')}
      </button>
    </>
  )
}

/** Variations spec 4: «Глубже» on a game position and the progress of its search; nothing in a variation. */
export function DeeperControls({ v, connected }: { v: VariationState; connected: boolean }) {
  const { t, language } = useI18n()
  const { variation, deeper, deepResult, result } = v
  if (variation) return null
  return (
    <>
      <button aria-pressed={deeper} onClick={v.switchDeeper}>
        <Telescope aria-hidden="true" />
        {t('review.deeper')}
      </button>
      {deeper && (
        <span class="where" aria-live="polite">
          {deepResult
            ? t('common.visits', { value: formatCount(deepResult.visits, language) })
            : !result && connected
              ? t('review.katagoCalculating')
              : ''}
        </span>
      )}
    </>
  )
}
