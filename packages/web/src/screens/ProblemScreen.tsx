import type { Marker } from '@sabaki/shudan'
import { useMemo, useState } from 'preact/hooks'
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-preact'
import { Position, type Move, type ProblemAnswer, type ProblemView, type Vertex } from '@joseki-dojo/shared'
import { emptyMap } from '../board-maps'
import { Board } from '../components/Board'
import { QueueActions, RepetitionPanel, type RepetitionLink } from '../components/RepetitionPanel'
import { BranchSteps, DeeperControls, VariationCandidates, VariationHead } from '../components/VariationAside'
import { colorLabel, formatPoints, moveLabel } from '../format'
import { useI18n } from '../i18n'
import { problemMarks, problemVariationNumbers, problemVerdict, withVerdictMarks } from '../problem-view'
import { useVariations, type VariationGame, type VariationLink } from '../use-variations'

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
  /** Problem variations 3.2: the variation search of this card, explored after the answer. */
  variations: VariationLink
}

/**
 * Repetition spec 5.4: «find a good move» on the whole board of the training, its last move marked; one click answers.
 * Then KataGo's verdict and the repetition panel with the queue's buttons; problem variations 2.2: the problem is
 * explored as a review of one move, the answer. The exploration is mounted with the verdict, so that its state belongs to
 * this answer only (the App keys the screen by the shown problem).
 */
export function ProblemScreen({ problem, answer, judging, unavailable, failed, onAnswer, repetition, busy, variations }: ProblemScreenProps) {
  if (answer) return <ProblemExplore problem={problem} answer={answer} repetition={repetition} busy={busy} variations={variations} />
  return <ProblemQuestion problem={problem} judging={judging} unavailable={unavailable} failed={failed} onAnswer={onAnswer} repetition={repetition} busy={busy} />
}

/** The problem's title, where it comes from, its move, its group and the player's colour. */
function ProblemHead({ problem }: { problem: ProblemView }) {
  const { t } = useI18n()
  const toMove = problem.userColor
  return (
    <>
      <div class="page-head">
        <h1>{t('problem.title')}</h1>
        <p>{t(`problem.source.${problem.source}`)}</p>
      </div>
      <p class="problem-facts">
        <span class={toMove === 'B' ? 'stone black' : 'stone white'} />
        {[t('problem.move', { n: problem.moveNumber }), problem.group, t('problem.yourColor', { color: colorLabel(toMove, t) })].filter((x) => x !== null).join(' · ')}
      </p>
    </>
  )
}

type ProblemQuestionProps = Omit<ProblemScreenProps, 'answer' | 'variations'>

/** Before the answer: the problem position, its last setup move marked; a click answers. */
function ProblemQuestion({ problem, judging, unavailable, failed, onAnswer, repetition, busy }: ProblemQuestionProps) {
  const { t } = useI18n()
  const [illegal, setIllegal] = useState(false)
  // Both sources are positions with the player to move; the setup is empty for a mistake on the very first move.
  const toMove = problem.userColor
  const setup = useMemo(() => Position.fromMoves(problem.moves), [problem])
  const signMap = useMemo(() => setup.signMap(), [setup])

  const markers = emptyMap<Marker | null>(null)
  for (const { vertex, marker } of problemMarks(problem, null)) markers[vertex[1]][vertex[0]] = marker

  const click = (v: Vertex): void => {
    if (judging || unavailable) return
    if (!setup.isLegal(toMove, v)) return setIllegal(true)
    setIllegal(false)
    onAnswer(v)
  }

  return (
    <main class="layout problem">
      <Board signMap={signMap} corner={problem.corner} markers={markers} busy={judging} onClick={click} />
      <aside class="panel">
        <ProblemHead problem={problem} />
        {illegal && !judging && !unavailable && <p class="hint">{t('problem.illegal')}</p>}
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
        {!judging && (unavailable || failed) && <QueueActions queue={repetition.queue} busy={busy} />}
      </aside>
    </main>
  )
}

interface ProblemExploreProps {
  problem: ProblemView
  answer: ProblemAnswer
  repetition: RepetitionLink
  busy: boolean
  variations: VariationLink
}

/**
 * Problem variations 2.2: after the verdict, «Начало задачи» (the problem position, turn −1) and «Ваш ответ» (turn 0);
 * variations for both sides with KataGo's replies, the candidates of the problem position with «Ветка», «Глубже». The
 * verdict and the repetition panel stay: the exploration changes neither the rating nor the schedule.
 */
function ProblemExplore({ problem, answer, repetition, busy, variations }: ProblemExploreProps) {
  const { language, t } = useI18n()
  const toMove = problem.userColor
  const moves = useMemo<Move[]>(() => [{ color: toMove, vertex: answer.vertex }], [toMove, answer.vertex])
  // Spec 2.3: the position after the answer holds only its lead, the «before» of the first move after the answer.
  const game = useMemo<VariationGame>(
    () => ({
      setup: problem.moves,
      moves,
      positions: [answer.position, { turn: 1, scoreLeadBlack: answer.leadAfter, visits: 0, candidates: [], ownership: null }],
      startView: true,
    }),
    [problem, moves, answer.position, answer.leadAfter],
  )
  const v = useVariations(game, variations)
  const { turn, step, variation, sel, branchStep, signMap, markers, dimmed, highlighted, last, awaiting, onBoardClick } = v
  const { connected } = variations

  // «Ваш ответ» without a variation or a branch keeps the verdict's marks.
  const board = turn === 0 && !variation && branchStep === null ? withVerdictMarks(problem, answer, { markers, dimmed }) : { markers, dimmed }

  const startLabel = t('problem.view.start')
  const answerLabel = t('problem.view.answer', { move: moveLabel(answer.vertex, t) })

  return (
    <main class="layout problem">
      <Board
        signMap={signMap}
        corner={problem.corner}
        markers={board.markers}
        dimmed={board.dimmed}
        selected={highlighted}
        busy={awaiting !== null}
        onClick={onBoardClick}
      />
      <aside class="panel">
        <ProblemHead problem={problem} />
        <div class="move-line">
          <span class={toMove === 'B' ? 'stone black' : 'stone white'} />
          <b>{moveLabel(answer.vertex, t)}</b>
          <span class={`cat ${answer.best ? 'exact' : answer.category}`}>{problemVerdict(answer, t, language)}</span>
        </div>
        <p>{t('problem.kataGoBest', { move: moveLabel(answer.line.vertex, t) })}</p>
        {problem.source === 'mistake' && (
          <p class="hint">{t('problem.inGame', { move: moveLabel(problem.userMove, t), loss: formatPoints(problem.userLoss, language) })}</p>
        )}

        {variation && last ? (
          <VariationHead v={v} numbers={problemVariationNumbers(problem, variation)} closeLabel={t('problem.backToProblem')} />
        ) : (
          <>
            <div class="navigator view-nav">
              <button class="ghost icon" disabled={turn < 0} onClick={() => step(-1)} aria-label={startLabel}>
                <ChevronLeft aria-hidden="true" />
              </button>
              <span class="where">
                {turn < 0 ? startLabel : answerLabel}
                <kbd aria-hidden="true">← →</kbd>
              </span>
              <button class="ghost icon" disabled={turn >= 0} onClick={() => step(1)} aria-label={answerLabel}>
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
            <p class="hint">{t('problem.explore')}</p>
          </>
        )}

        <VariationCandidates v={v} gameMove={answer.vertex} connected={connected} />

        {/* The line of a candidate opens with its «Ветка»; the problem has no separate «Показать ветку». */}
        {((sel && branchStep !== null) || !variation) && (
          <div class="branch">
            <BranchSteps v={v} />
            <DeeperControls v={v} connected={connected} />
          </div>
        )}

        <RepetitionPanel kind="move" info={answer.repetition} link={repetition} busy={busy} />
      </aside>
    </main>
  )
}
