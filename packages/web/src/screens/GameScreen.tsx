import type { Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { Flag, LoaderCircle, Split } from 'lucide-preact'
import { inZone, Position, type ClientMessage, type MessageKey, type SessionView, type Vertex } from '@joseki-dojo/shared'
import { emptyMap, isVertex } from '../board-maps'
import { Board } from '../components/Board'
import { ACTOR_LABEL, colorLabel, CORNER_LABEL, moveLabel, rankLabel } from '../format'
import { useT } from '../i18n'

export interface GameScreenProps {
  session: SessionView
  /** Increments on every server error so a pending action can be released. */
  errorSeq: number
  send: (msg: ClientMessage) => void
}

/** Spec 6: the board on the left; status, facts, moves and actions on the right. */
export function GameScreen({ session, errorSeq, send }: GameScreenProps) {
  const t = useT()
  const [pending, setPending] = useState(false)
  // A key, so that the hint follows a language switch.
  const [hint, setHint] = useState<MessageKey | null>(null)
  useEffect(() => setPending(false), [session, errorSeq])
  useEffect(() => setHint(null), [session.moves.length])

  const { userColor, corner, botRank } = session.settings
  const position = useMemo(() => Position.fromMoves([...session.initialMoves, ...session.moves]), [session])
  const userTurn = session.status === 'playing' && session.toMove === userColor && !session.botThinking && !pending
  const last = session.moves.at(-1) ?? session.initialMoves.at(-1) ?? null
  const markers = useMemo(() => {
    const m = emptyMap<Marker | null>(null)
    if (last && isVertex(last.vertex)) m[last.vertex[1]][last.vertex[0]] = { type: 'point' }
    return m
  }, [last])

  const play = (v: Vertex): void => {
    if (!userTurn) return
    if (!inZone(corner, v)) return setHint('game.hint.outsideZone')
    if (!position.isLegal(userColor, v)) return setHint('error.move.illegal')
    setPending(true)
    send({ type: 'playMove', sessionId: session.id, vertex: v })
  }
  const tenuki = (): void => {
    setPending(true)
    send({ type: 'tenuki', sessionId: session.id })
  }
  const finish = (): void => send({ type: 'finish', sessionId: session.id })
  const keepPlaying = (): void => send({ type: 'continuePlaying', sessionId: session.id })

  const status = t(session.botThinking ? 'game.status.botThinking' : session.toMove === userColor ? 'game.status.yourTurn' : 'game.status.botTurn')

  return (
    <main class="layout game">
      <Board signMap={position.signMap()} corner={corner} markers={markers} busy={session.botThinking || pending} onClick={play} />
      <aside class="panel">
        <div class="status-block">
          <h1 class="status" aria-live="polite">
            {status}
            {session.botThinking && <LoaderCircle class="spin" aria-hidden="true" />}
          </h1>
          <p class="muted">{t('game.matchup', { color: colorLabel(userColor, t), rank: rankLabel(botRank, t), corner: t(CORNER_LABEL[corner]) })}</p>
        </div>

        <hr class="divider" />
        <div class="facts">
          <div class="fact">
            <span>{t('game.movesPlayed')}</span>
            <span data-testid="moves-count">{session.moves.length}</span>
          </div>
          <div class="fact">
            <span>{t('game.lastMove')}</span>
            <span>
              {last ? t('game.lastMoveBy', { move: moveLabel(last.vertex, t), actor: t(ACTOR_LABEL[last.color === userColor ? 'user' : 'bot']) }) : '—'}
            </span>
          </div>
        </div>

        {session.moves.length > 0 && (
          <ol class="chips moves" aria-label={t('game.moves')}>
            {session.moves.map((m, i) => (
              <li key={i} class={i === session.moves.length - 1 ? 'chip last' : 'chip'} title={t('game.moveN', { n: i + 1 })}>
                <span class={m.color === 'B' ? 'stone black' : 'stone white'} />
                {moveLabel(m.vertex, t)}
              </li>
            ))}
          </ol>
        )}

        {session.endProposed && (
          <div class="card accent proposal" role="status">
            <p>{t('game.botTenuki')}</p>
            <div class="actions">
              <button class="primary" onClick={finish}>
                {t('game.toReview')}
              </button>
              <button onClick={keepPlaying}>{t('game.keepPlaying')}</button>
            </div>
          </div>
        )}
        {hint && <p class="hint">{t(hint)}</p>}

        <div class="actions">
          <button disabled={!userTurn} onClick={tenuki}>
            <Split aria-hidden="true" />
            {t('game.tenuki')}
          </button>
          <button class="ghost" onClick={finish}>
            <Flag aria-hidden="true" />
            {t('game.finish')}
          </button>
        </div>
      </aside>
    </main>
  )
}
