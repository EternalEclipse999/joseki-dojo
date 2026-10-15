import { useEffect, useState } from 'preact/hooks'
import type { CardListItem, CardSummary, LocalizedText } from '@joseki-dojo/shared'
import { deleteCard, failureText, fetchCardSummary, fetchCards } from '../api'
import { CornerBoard } from '../components/CornerBoard'
import { errorText } from '../error-text'
import { dayStart, formatWhen } from '../format'
import { useI18n } from '../i18n'
import { findById, nodeTitle, type StartTreeNode } from '../start-tree'

export interface RepetitionScreenProps {
  tree: StartTreeNode
  busy: boolean
  /** «На сегодня всё» after the queue ran out. */
  notice: string | null
  onStartQueue: () => void
  /** A card was deleted or fell due: the header's counter is stale. */
  onChanged: () => void
}

/** Nothing is due: the tab reads the cards again when the next one falls due, and at least hourly (the relative times age). */
const REFRESH_MAX_MS = 3_600_000
/** Never sooner: a client clock ahead of the server's must not turn the wait into a burst of requests. */
const REFRESH_MIN_MS = 30_000

/** Spec (repetition) 5.1: what is due, the week ahead, the cards. */
export function RepetitionScreen({ tree, busy, notice, onStartQueue, onChanged }: RepetitionScreenProps) {
  const { language, t } = useI18n()
  const [summary, setSummary] = useState<CardSummary | null>(null)
  const [cards, setCards] = useState<CardListItem[]>([])
  const [error, setError] = useState<LocalizedText | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    Promise.all([fetchCardSummary(), fetchCards()])
      .then(([s, c]) => {
        if (cancelled) return
        setSummary(s)
        setCards(c)
        setError(null)
        if (s.dueNow === 0 && s.nextDue) {
          const wait = Math.min(Math.max(new Date(s.nextDue).getTime() - Date.now(), REFRESH_MIN_MS), REFRESH_MAX_MS)
          timer = setTimeout(() => {
            setTick((n) => n + 1)
            onChanged()
          }, wait)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(failureText(e))
      })
    // A refetch (a deleted card) or leaving the tab drops the pending answer and the timer.
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tick])
  const now = new Date()
  const remove = (c: CardListItem): void => {
    if (!window.confirm(t('repetition.deleteConfirm'))) return
    deleteCard(c.id)
      .then(() => {
        setTick((n) => n + 1)
        onChanged()
      })
      .catch((e: unknown) => setError(failureText(e)))
  }
  const weekday = new Intl.DateTimeFormat(language, { weekday: 'short' })
  const day = (d: number): string => {
    if (d === 0) return t('repetition.today')
    const date = dayStart(now)
    date.setDate(date.getDate() + d)
    return weekday.format(date)
  }
  return (
    <main>
      <div class="page repetition">
        <div class="page-head">
          <h1>{t('repetition.title')}</h1>
          <p>{t('repetition.lead')}</p>
        </div>
        {error && <p class="hint error">{errorText(error, language)}</p>}
        {summary && summary.total === 0 && cards.length === 0 && <p class="hint">{t('repetition.empty')}</p>}
        {summary && summary.total > 0 && (
          <>
            <div class="metrics">
              <div class="metric">
                <span class="k">{t('repetition.dueNow')}</span>
                <span class="v">{summary.dueNow}</span>
                {summary.dueNow > 0 && <span class="s">{t('repetition.dueKinds', { count: summary.dueByKind.position })}</span>}
                {summary.nextDue && <span class="s">{t('repetition.nextDue', { when: formatWhen(summary.nextDue, now, language, t) })}</span>}
              </div>
              <div class="metric">
                <span class="k">{t('repetition.learned')}</span>
                <span class="v">{t('repetition.learnedOf', { learned: summary.learned, total: summary.total })}</span>
              </div>
            </div>
            <div class="forecast" role="group" aria-label={t('repetition.forecast')}>
              {summary.forecast.map((n, d) => (
                <div key={d} class={`forecast-day${n > 0 ? '' : ' empty'}`}>
                  <b>{n}</b>
                  <span>{day(d)}</span>
                </div>
              ))}
            </div>
            <div class="start-actions">
              {notice && <span class="notice">{notice}</span>}
              <button class="primary lg" disabled={busy || summary.dueNow === 0} onClick={onStartQueue}>
                {t('repetition.start')}
              </button>
            </div>
          </>
        )}
        {/* Orphaned cards are not counted in the summary: a list of only them still shows, so that they can be deleted. */}
        {summary && cards.length > 0 && (
          <section class="card-list" aria-label={t('repetition.list')}>
            <h2>{t('repetition.list')}</h2>
            {cards.map((c) => {
              const node = c.startId ? findById(tree, c.startId) : null
              const name = node ? nodeTitle(node) : t('repetition.kind.position')
              return (
                <div class="card-row" key={c.id}>
                  <CornerBoard moves={c.moves} />
                  <div class="card-row-text">
                    <b>{name}</b>
                    {c.orphan ? (
                      <span>{t('repetition.orphan')}</span>
                    ) : (
                      <span>
                        {t(c.stage === 'learned' ? 'repetition.stage.learned' : 'repetition.stage.learning')} · {t('repetition.due', { when: formatWhen(c.due, now, language, t) })}
                        {c.lastRating && <> · {t('repetition.last', { rating: t(`rating.${c.lastRating}`) })}</>}
                      </span>
                    )}
                  </div>
                  <button class="ghost sm" aria-label={t('repetition.deleteNamed', { name })} onClick={() => remove(c)}>
                    {t('repetition.delete')}
                  </button>
                </div>
              )
            })}
          </section>
        )}
      </div>
    </main>
  )
}
