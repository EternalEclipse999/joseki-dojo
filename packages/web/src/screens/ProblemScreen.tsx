import type { Marker } from '@sabaki/shudan'
import { useMemo, useState } from 'preact/hooks'
import { ChevronLeft, ChevronRight, GitBranch, LoaderCircle } from 'lucide-preact'
import { Position, type ProblemAnswer, type ProblemView, type Vertex } from '@joseki-dojo/shared'
import { emptyMap, pvMoves } from '../board-maps'
import { Board } from '../components/Board'
import { QueueActions, RepetitionPanel, type RepetitionLink } from '../components/RepetitionPanel'
import { colorLabel, formatPoints, moveLabel } from '../format'
import { useI18n } from '../i18n'
import { problemMarks, problemVerdict } from '../problem-view'

export interface ProblemScreenProps {
  problem: ProblemView
  /** KataGo's verdict on the answer; null until it is judged. */
  answer: ProblemAnswer | null
  /** The answer is with KataGo. */
  judging: boolean
  /** KataGo was not ready: no verdict, and the repetition is not counted. */
  unavailable: boolean
  /** The last answer could not be judged for another reason (the app's banner says why): the queue can go on. */
  failed: boolean
  onAnswer: (v: Vertex) => void
  repetition: RepetitionLink
  busy: boolean
}

/**
 * Repetition spec 5.4: «find a good move» on the whole board of the training, its last move marked; one click answers.
 * Then KataGo's verdict, its best move with the line step by step, the move played in the training (the player's own
 * mistake) and the repetition panel with the queue's buttons.
 */
export function ProblemScreen({ problem, answer, judging, unavailable, failed, onAnswer, repetition, busy }: ProblemScreenProps) {
  const { language, t } = useI18n()
  const [lineStep, setLineStep] = useState<number | null>(null)
  const [illegal, setIllegal] = useState(false)
  // Both sources are positions with the player to move; the setup is empty for a mistake on the very first move.
  const toMove = problem.userColor
  const setup = useMemo(() => Position.fromMoves(problem.moves), [problem])
  const line = answer?.line ?? null
  const step = line && lineStep !== null ? Math.max(1, Math.min(lineStep, line.pv.length)) : null
  const branch = useMemo(() => (line && step !== null ? pvMoves(toMove, line.pv, step) : null), [line, step, toMove])
  // Before the answer the setup; then the setup with the answer, or with KataGo's line instead.
  const signMap = useMemo(() => {
    if (!answer) return setup.signMap()
    try {
      return Position.fromMoves([...problem.moves, ...(branch ?? [{ color: toMove, vertex: answer.vertex }])]).signMap()
    } catch {
      return setup.signMap()
    }
  }, [problem, setup, answer, branch, toMove])

  const markers = emptyMap<Marker | null>(null)
  for (const { vertex, marker } of problemMarks(problem, answer, branch)) markers[vertex[1]][vertex[0]] = marker

  const click = (v: Vertex): void => {
    if (answer || judging || unavailable) return
    if (!setup.isLegal(toMove, v)) return setIllegal(true)
    setIllegal(false)
    onAnswer(v)
  }

  return (
    <main class="layout problem">
      <Board signMap={signMap} corner={problem.corner} markers={markers} busy={judging} onClick={click} />
      <aside class="panel">
        <div class="page-head">
          <h1>{t('problem.title')}</h1>
          <p>{t(`problem.source.${problem.source}`)}</p>
        </div>
        <p class="problem-facts">
          <span class={toMove === 'B' ? 'stone black' : 'stone white'} />
          {[t('problem.move', { n: problem.moveNumber }), problem.group, t('problem.yourColor', { color: colorLabel(toMove, t) })].filter((x) => x !== null).join(' · ')}
        </p>

        {illegal && !answer && !judging && !unavailable && <p class="hint">{t('problem.illegal')}</p>}
        {judging && (
          <p class="status-line" aria-live="polite">
            <LoaderCircle class="spin" aria-hidden="true" />
            {t('problem.judging')}
          </p>
        )}

        {unavailable && (
          <p class="note warning" role="status">
            {t('problem.unavailable')}
          </p>
        )}
        {/* No verdict to rate: the queue's buttons alone, so that the player can move on. */}
        {!answer && !judging && (unavailable || failed) && <QueueActions queue={repetition.queue} busy={busy} />}

        {answer && (
          <>
            <div class="move-line">
              <span class={toMove === 'B' ? 'stone black' : 'stone white'} />
              <b>{moveLabel(answer.vertex, t)}</b>
              <span class={`cat ${answer.best ? 'exact' : answer.category}`}>{problemVerdict(answer, t, language)}</span>
            </div>
            <p>{t('problem.kataGoBest', { move: moveLabel(answer.line.vertex, t) })}</p>
            {problem.source === 'mistake' && (
              <p class="hint">{t('problem.inGame', { move: moveLabel(problem.userMove, t), loss: formatPoints(problem.userLoss, language) })}</p>
            )}
            {answer.line.pv.length > 0 && (
              <div class="branch">
                {step === null ? (
                  <button onClick={() => setLineStep(1)}>
                    <GitBranch aria-hidden="true" />
                    {t('review.branch.show')}
                  </button>
                ) : (
                  <>
                    <button class="icon" disabled={step <= 1} onClick={() => setLineStep(step - 1)} aria-label={t('review.branch.back')}>
                      <ChevronLeft aria-hidden="true" />
                    </button>
                    <span class="where">{t('review.branch.step', { step, total: answer.line.pv.length })}</span>
                    <button class="icon" disabled={step >= answer.line.pv.length} onClick={() => setLineStep(step + 1)} aria-label={t('review.branch.forward')}>
                      <ChevronRight aria-hidden="true" />
                    </button>
                    <button class="ghost" onClick={() => setLineStep(null)}>
                      {t('review.branch.hide')}
                    </button>
                  </>
                )}
              </div>
            )}
            <RepetitionPanel kind="move" info={answer.repetition} link={repetition} busy={busy} />
          </>
        )}
      </aside>
    </main>
  )
}
