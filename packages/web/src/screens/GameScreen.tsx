import type { Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { Flag, LoaderCircle, Split } from 'lucide-preact'
import { inZone, Position, type ClientMessage, type SessionView, type Vertex } from '@joseki-dojo/shared'
import { emptyMap, isVertex } from '../board-maps'
import { Board } from '../components/Board'
import { colorLabel, CORNER_LABEL, moveLabel, rankLabel } from '../format'

export interface GameScreenProps {
  session: SessionView
  /** Increments on every server error so a pending action can be released. */
  errorSeq: number
  send: (msg: ClientMessage) => void
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Spec 6: the board on the left; status, facts, moves and actions on the right. */
export function GameScreen({ session, errorSeq, send }: GameScreenProps) {
  const [pending, setPending] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
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
    if (!inZone(corner, v)) return setHint('Ходить можно только внутри выделенной зоны угла')
    if (!position.isLegal(userColor, v)) return setHint('Недопустимый ход')
    setPending(true)
    send({ type: 'playMove', sessionId: session.id, vertex: v })
  }
  const tenuki = (): void => {
    setPending(true)
    send({ type: 'tenuki', sessionId: session.id })
  }
  const finish = (): void => send({ type: 'finish', sessionId: session.id })
  const keepPlaying = (): void => send({ type: 'continuePlaying', sessionId: session.id })

  const status = session.botThinking ? 'Бот думает…' : session.toMove === userColor ? 'Ваш ход' : 'Ход бота'

  return (
    <main class="layout game">
      <Board signMap={position.signMap()} corner={corner} markers={markers} busy={session.botThinking || pending} onClick={play} />
      <aside class="panel">
        <div class="status-block">
          <h1 class="status" aria-live="polite">
            {status}
            {session.botThinking && <LoaderCircle class="spin" aria-hidden="true" />}
          </h1>
          <p class="muted">
            {capitalize(colorLabel(userColor))} против бота {rankLabel(botRank)} · {CORNER_LABEL[corner]} угол
          </p>
        </div>

        <hr class="divider" />
        <div class="facts">
          <div class="fact">
            <span>Сыграно ходов</span>
            <span data-testid="moves-count">{session.moves.length}</span>
          </div>
          <div class="fact">
            <span>Последний ход</span>
            <span>{last ? `${moveLabel(last.vertex)} · ${last.color === userColor ? 'вы' : 'бот'}` : '—'}</span>
          </div>
        </div>

        {session.moves.length > 0 && (
          <ol class="chips moves" aria-label="Ходы">
            {session.moves.map((m, i) => (
              <li key={i} class={i === session.moves.length - 1 ? 'chip last' : 'chip'} title={`Ход ${i + 1}`}>
                <span class={m.color === 'B' ? 'stone black' : 'stone white'} />
                {moveLabel(m.vertex)}
              </li>
            ))}
          </ol>
        )}

        {session.endProposed && (
          <div class="card accent proposal" role="status">
            <p>Бот сыграл в другом месте.</p>
            <div class="actions">
              <button class="primary" onClick={finish}>
                К разбору
              </button>
              <button onClick={keepPlaying}>Играть дальше</button>
            </div>
          </div>
        )}
        {hint && <p class="hint">{hint}</p>}

        <div class="actions">
          <button disabled={!userTurn} onClick={tenuki}>
            <Split aria-hidden="true" />
            Тэнуки
          </button>
          <button class="ghost" onClick={finish}>
            <Flag aria-hidden="true" />
            Закончить
          </button>
        </div>
      </aside>
    </main>
  )
}
