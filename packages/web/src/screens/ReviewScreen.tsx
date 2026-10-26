import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { FolderOpen, GitBranch, LoaderCircle, Map as MapIcon, Play, RotateCcw, Swords } from 'lucide-preact'
import type { Actor, MessageKey, ProgressDelta, ReviewData, Translate, TrapVerdict } from '@joseki-dojo/shared'
import { ownershipMap } from '../board-maps'
import { Board } from '../components/Board'
import { LossBar } from '../components/LossBar'
import { RepetitionPanel, type RepetitionLink } from '../components/RepetitionPanel'
import { BranchSteps, DeeperControls, VariationCandidates, VariationHead } from '../components/VariationAside'
import { CATEGORY_LABEL, formatPercentPair, formatPoints, moveLabel, ZERO_LOSS } from '../format'
import { useI18n, useT } from '../i18n'
import { summaryTiles } from '../review-summary'
import { richText } from '../rich-text'
import type { ReviewLabels } from '../session-title'
import { useVariations, type VariationLink } from '../use-variations'
import { variationNumbers, type VariationUpdate } from '../variation'

export interface ReviewScreenProps {
  review: ReviewData | null
  progress: { done: number; total: number } | null
  onReplay: (turn: number) => void
  /** Back to the start screen. */
  onNew: () => void
  /** A new game with the last settings; null while they are unknown. */
  onNext: (() => void) | null
  /** The captions of `onNext` and `onNew`, which depend on the mode. */
  labels: ReviewLabels
  busy?: boolean
  /** Variations spec 3–6: an update names the session it belongs to; the review keeps only its own. */
  variations: VariationLink<VariationUpdate>
  repetition?: RepetitionLink
}

export function ReviewScreen({ review, progress, onReplay, onNew, onNext, labels, busy, variations, repetition }: ReviewScreenProps) {
  const t = useT()
  if (!review) {
    return (
      <main>
        <div class="page">
          <div class="card section">
            <p class="status-line">
              <LoaderCircle class="spin" aria-hidden="true" />
              {t('review.analysingPositions')}
            </p>
            {progress && (
              <>
                <progress max={progress.total} value={progress.done} />
                <p class="small muted">{t('review.progress', { done: progress.done, total: progress.total })}</p>
              </>
            )}
            <div class="actions">
              {onNext && (
                <button class="primary" disabled={busy} onClick={onNext}>
                  <Play aria-hidden="true" />
                  {labels.next}
                </button>
              )}
              <button class="ghost" onClick={onNew}>
                <FolderOpen aria-hidden="true" />
                {labels.back}
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
            {/* A training without moves is not a repetition, but the queue goes on from it. */}
            {repetition?.queue && <RepetitionPanel info={null} link={repetition} busy={busy} />}
            <p>{t('review.noMoves')}</p>
            <div class="actions">
              {onNext && (
                <button class={repetition?.queue ? undefined : 'primary'} disabled={busy} onClick={onNext}>
                  <Play aria-hidden="true" />
                  {labels.next}
                </button>
              )}
              <button class={onNext ? 'ghost' : 'primary'} onClick={onNew}>
                <FolderOpen aria-hidden="true" />
                {labels.back}
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }
  return (
    <ReviewLoaded
      key={review.sessionId}
      review={review}
      onReplay={onReplay}
      onNew={onNew}
      onNext={onNext}
      labels={labels}
      busy={busy}
      variations={variations}
      repetition={repetition}
    />
  )
}

/** The move line of a game move: who played it, then the move («Вы: Q16»). */
const MOVE_BY: Record<Actor, MessageKey> = { user: 'review.moveBy.user', bot: 'review.moveBy.bot', 'auto-tenuki': 'review.moveBy.autoTenuki' }

const VERDICT: Record<TrapVerdict, { text: MessageKey; cls: string }> = {
  correct: { text: 'review.trap.correct', cls: 'cat exact' },
  caught: { text: 'review.trap.caught', cls: 'cat blunder' },
  other: { text: 'review.trap.other', cls: 'badge' },
}

/** Traps spec 7: the trick is marked; the answer to it gets the base's verdict and its correct answers. */
function trapNote(review: ReviewData, turn: number, t: Translate): JSX.Element | null {
  const trap = review.trap
  if (!trap) return null
  if (trap.trickTurn === turn) {
    return (
      <p class="trap-line">
        <Swords aria-hidden="true" />
        <span class="badge">{t('review.trap.badge')}</span>
        <span class="muted">{t('review.trap.known')}</span>
      </p>
    )
  }
  if (trap.answerTurn !== turn || trap.verdict === null) return null
  const v = VERDICT[trap.verdict]
  // A pass among the base's answers is a tenuki.
  const good = trap.good.map((g) => (g === 'pass' ? t('common.tenuki') : moveLabel(g, t))).join(t('common.listSeparator'))
  return (
    <p class="trap-line">
      <Swords aria-hidden="true" />
      <span class={v.cls}>{t(v.text)}</span>
      {trap.good.length > 0 && <span class="muted">{t('review.trap.good', { moves: good })}</span>}
    </p>
  )
}

/**
 * Part 3 spec 7: the progress the training gained — the percent of its list position (or of the whole list) before and
 * after it, and the positions it reviewed for the first time. The colour is the crumbs' and the matchup's.
 */
function ProgressGain({ delta }: { delta: ProgressDelta }) {
  const { t, language } = useI18n()
  const [before, after] = formatPercentPair(delta.before, delta.after, language)
  return (
    <div class="progress-gain">
      <p>{t(delta.listId === null ? 'review.progress.overall' : 'review.progress.position', { before, after })}</p>
      {delta.newPositions > 0 && <p>{t('review.progress.new', { count: delta.newPositions })}</p>}
    </div>
  )
}

interface ReviewLoadedProps {
  review: ReviewData
  onReplay: (turn: number) => void
  onNew: () => void
  onNext: (() => void) | null
  labels: ReviewLabels
  busy?: boolean
  variations: VariationLink<VariationUpdate>
  repetition?: RepetitionLink
}

/**
 * Spec 7: summary, loss chart, move navigator, candidates and the branch, next to the board.
 * Variations spec 3–5: a variation instead of a game move, its deepening analysis and KataGo's replies.
 * Repetition spec 5.3: the repetition panel above them; part 3 spec 7: the progress gained above it.
 */
function ReviewLoaded({ review, onReplay, onNew, onNext, labels, busy, variations, repetition }: ReviewLoadedProps) {
  const { t, language } = useI18n()
  const [showOwnership, setShowOwnership] = useState(false)
  // The hook is given only the analyses of this review's session.
  const link: VariationLink = { ...variations, update: variations.update?.sessionId === review.sessionId ? variations.update : null }
  const v = useVariations({ setup: review.initialMoves, moves: review.moves, positions: review.positions, startView: false }, link)
  const { turn, selectTurn, variation, result, sel, branchStep, setPvStep, signMap, markers, dimmed, highlighted, last, awaiting, onBoardClick } = v
  const { connected } = variations

  const move = review.moveReviews[turn]
  const ownership = variation ? (result?.position.ownership ?? null) : review.positions[turn + 1].ownership
  const paint = showOwnership ? ownershipMap(ownership) : null

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
        {review.progress && <ProgressGain delta={review.progress} />}
        {repetition && (review.repetition || repetition.queue) && (
          <RepetitionPanel info={review.repetition ?? null} link={repetition} busy={busy} counted={review.progress !== undefined} />
        )}
        <div class="metrics">
          {summaryTiles(review.summary, t, language).map((tile) => (
            <div class="metric" key={tile.k}>
              <span class="k">{tile.k}</span>
              <span class="v">{tile.v}</span>
              <span class="s">{tile.s}</span>
            </div>
          ))}
        </div>

        <LossBar moves={review.moveReviews} userColor={review.settings.userColor} selected={turn} onSelect={selectTurn} />

        {variation && last ? (
          <VariationHead v={v} numbers={variationNumbers(variation)} />
        ) : (
          <>
            <div class="navigator">
              <span class="where">
                {t('review.moveOf', { n: turn + 1, total: review.moves.length })}
                <kbd aria-hidden="true">← →</kbd>
              </span>
              <input
                type="range"
                min={1}
                max={review.moves.length}
                value={turn + 1}
                aria-label={t('review.gameMove')}
                onInput={(e) => selectTurn(Number(e.currentTarget.value) - 1)}
              />
            </div>

            <div class="move-line">
              <span class={move.color === 'B' ? 'stone black' : 'stone white'} />
              <span>{richText(t(MOVE_BY[move.actor]), { move: <b>{moveLabel(move.vertex, t)}</b> })}</span>
              <span class={`cat ${move.category}`}>
                {t(CATEGORY_LABEL[move.category])}
                {move.loss > ZERO_LOSS && ` −${formatPoints(move.loss, language)}`}
              </span>
            </div>
            {trapNote(review, turn, t)}
            {punishment && (
              <p class="punishment">
                {t('review.punishment.text', {
                  who: t(punishment.turn === turn ? 'review.punishment.botMistake' : 'review.punishment.yourAnswer'),
                  botLoss: formatPoints(punishment.botLoss, language),
                  userLoss: formatPoints(punishment.userLoss, language),
                  verdict: punishment.punished
                    ? t('review.punishment.punished')
                    : t('review.punishment.notPunished', { kept: formatPoints(punishment.kept, language) }),
                })}
              </p>
            )}
          </>
        )}

        <VariationCandidates v={v} gameMove={move.vertex} connected={connected} />

        <div class="branch">
          {sel && sel.pv.length > 0 && branchStep === null && (
            <button onClick={() => setPvStep(1)}>
              <GitBranch aria-hidden="true" />
              {t('review.branch.show')}
            </button>
          )}
          <BranchSteps v={v} />
          <button aria-pressed={showOwnership} onClick={() => setShowOwnership(!showOwnership)}>
            <MapIcon aria-hidden="true" />
            {t('review.territory')}
          </button>
          <DeeperControls v={v} connected={connected} />
        </div>

        <hr class="divider" />
        <div class="actions">
          {onNext && (
            <button class={repetition?.queue ? undefined : 'primary'} disabled={busy} onClick={onNext}>
              <Play aria-hidden="true" />
              {labels.next}
            </button>
          )}
          <button disabled={busy} onClick={() => onReplay(turn)}>
            <RotateCcw aria-hidden="true" />
            {t('review.replayMove')}
          </button>
          <button class="ghost" onClick={onNew}>
            <FolderOpen aria-hidden="true" />
            {labels.back}
          </button>
        </div>
      </aside>
    </main>
  )
}
