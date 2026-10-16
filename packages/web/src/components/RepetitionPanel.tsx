import { RATINGS, type CardKind, type Rating, type RepetitionInfo } from '@joseki-dojo/shared'
import { CATEGORY_LABEL, formatPoints, formatWhen } from '../format'
import { useI18n } from '../i18n'

/** Repetition spec 5.3, 5.4: the screen's link to the shown card repetition and to the queue. */
export interface RepetitionLink {
  /** Replaces the rating of the shown repetition. */
  onRate: (rating: Rating) => void
  /** The card came from the queue: its «Дальше» and «Закончить»; null otherwise. */
  queue: { onNext: () => void; onFinish: () => void } | null
  /** A re-rating that failed, in the reader's language. */
  error: string | null
}

export interface RepetitionPanelProps {
  info: RepetitionInfo | null
  link: RepetitionLink
  busy?: boolean
  /** The card repeated: a position (the review of its training, the default) or a problem (its own screen). */
  kind?: CardKind
}

/** Repetition spec 5.2: the queue's «Дальше» and «Закончить повторение»; nothing for a card shown outside the queue. */
export function QueueActions({ queue, busy }: { queue: RepetitionLink['queue']; busy?: boolean }) {
  const { t } = useI18n()
  if (!queue) return null
  return (
    <div class="actions">
      <button class="primary" disabled={busy} onClick={queue.onNext}>
        {t('review.repetition.continue')}
      </button>
      <button class="ghost" disabled={busy} onClick={queue.onFinish}>
        {t('review.repetition.finish')}
      </button>
    </div>
  )
}

/**
 * Repetition spec 4.4, 5.3, 5.4: KataGo's rating of the training or the problem answer as a card repetition, the four
 * buttons that replace it, when the card comes back, and the queue's «Дальше» / «Закончить». A position's rating names
 * its reason (the worst move) in the same line; a problem's verdict above the panel already does. Without `info` (a
 * training with no move of the player's in the corner zone is not a repetition) the panel says so above the queue's
 * buttons.
 */
export function RepetitionPanel({ info, link, busy, kind = 'position' }: RepetitionPanelProps) {
  const { language, t } = useI18n()
  const { onRate, queue, error } = link
  const problem = kind === 'move'
  const worst = info?.worst ?? null
  const reason = !worst
    ? t('review.repetition.clean')
    : worst.category === 'unpunished'
      ? t('review.repetition.unpunished', { loss: formatPoints(worst.loss, language) })
      : t('review.repetition.worst', { category: t(CATEGORY_LABEL[worst.category]), loss: formatPoints(worst.loss, language) })
  const title = t(problem ? 'problem.repetition.title' : 'review.repetition.title')
  return (
    <section class="repetition-panel" aria-label={title}>
      <div class="label">{title}</div>
      {!info && <p>{t('review.repetition.notCounted')}</p>}
      {info && (
        <>
          <p>
            {t('review.repetition.auto', { rating: t(`rating.${info.auto}`) })}
            {!problem && ` · ${reason}`}
          </p>
          <div class="segmented" role="group" aria-label={t('review.repetition.ratings')}>
            {RATINGS.map((r) => (
              <button key={r} aria-pressed={info.rating === r} disabled={!info.editable} onClick={() => onRate(r)}>
                {t(`rating.${r}`)}
              </button>
            ))}
          </div>
          {!info.editable && <p class="hint">{t(problem ? 'problem.repetition.locked' : 'review.repetition.locked')}</p>}
          <p class="hint">{t('review.repetition.next', { when: formatWhen(info.due, new Date(), language, t) })}</p>
        </>
      )}
      {error && <p class="hint error">{error}</p>}
      <QueueActions queue={queue} busy={busy} />
    </section>
  )
}
