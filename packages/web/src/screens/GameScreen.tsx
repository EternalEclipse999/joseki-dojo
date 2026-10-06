import type { Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { inZone, Position, type ClientMessage, type SessionView, type Vertex } from '@joseki-dojo/shared'
import { emptyMap, isVertex } from '../board-maps'
import { Board } from '../components/Board'
import { colorLabel, CORNER_LABEL, rankLabel } from '../format'

export interface GameScreenProps {
  session: SessionView
  /** Increments on every server error so a pending action can be released. */
  errorSeq: number
  send: (msg: ClientMessage) => void
}

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
    if (last && isVertex(last.vertex)) m[last.vertex[1]][last.vertex[0]] = { type: 'circle' }
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

  const status = session.botThinking
    ? 'Бот думает…'
    : session.toMove === userColor
      ? `Ваш ход (${colorLabel(userColor)})`
      : 'Ход бота'

  return (
    <main class="game">
      <Board signMap={position.signMap()} corner={corner} markers={markers} busy={session.botThinking || pending} onClick={play} />
      <aside class="panel">
        <p class="status">{status}</p>
        <p class="meta">
          Бот: {rankLabel(botRank)} · угол: {CORNER_LABEL[corner]} · ходов: {session.moves.length}
        </p>
        {session.endProposed && (
          <div class="proposal" role="status">
            <p>Похоже, дзёсеки закончилось.</p>
            <div class="row">
              <button class="primary" onClick={finish}>
                К разбору
              </button>
              <button onClick={keepPlaying}>Играть дальше</button>
            </div>
          </div>
        )}
        {hint && <p class="hint">{hint}</p>}
        <div class="row">
          <button disabled={!userTurn} onClick={tenuki}>
            Тэнуки
          </button>
          <button onClick={finish}>Закончить</button>
        </div>
      </aside>
    </main>
  )
}
