import { LoaderCircle } from 'lucide-preact'
import type { Candidate, MoveVertex, Vertex } from '@joseki-dojo/shared'
import { isVertex, sameVertex } from '../board-maps'
import { formatPoints, moveLabel } from '../format'

export const LABELS = 'ABCDEF'

export interface CandidateListProps {
  candidates: Candidate[]
  /** The candidate whose line «Показать ветку» shows. */
  selected: number
  /** The candidate under the pointer, highlighted on the board too. */
  hot: number | null
  onHot: (i: number | null) => void
  onSelect: (i: number) => void
  /** Plays a candidate («Сыграть»); null while KataGo is thinking. */
  onPlay: ((v: Vertex) => void) | null
  /** The game move the candidates are alternatives to, marked «ваш ход»; null in a variation. */
  gameMove: MoveVertex | null
  /** No result yet: «KataGo считает…» instead of an empty list. */
  pending: boolean
}

/** Spec 7 and variations spec 3: the best moves, the selected one's line, and «Сыграть» for each. */
export function CandidateList({ candidates, selected, hot, onHot, onSelect, onPlay, gameMove, pending }: CandidateListProps) {
  if (pending) {
    return (
      <p class="pending-line" aria-live="polite">
        <LoaderCircle class="spin" aria-hidden="true" />
        KataGo считает…
      </p>
    )
  }
  if (candidates.length === 0) return <p class="muted small">нет ходов-кандидатов</p>
  return (
    <ul class="candidates" role="listbox" aria-label="Лучшие ходы">
      {candidates.map((c, i) => {
        const v = c.vertex
        const cls = [i === hot && 'hot', i === selected && 'selected'].filter(Boolean).join(' ')
        return (
          <li
            key={i}
            class={cls || undefined}
            role="option"
            tabIndex={0}
            aria-selected={i === selected}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
              e.preventDefault()
              onSelect(i)
            }}
            onMouseEnter={() => onHot(i)}
            onMouseLeave={() => onHot(null)}
            onFocus={(e) => e.target === e.currentTarget && onHot(i)}
            onBlur={(e) => e.target === e.currentTarget && onHot(null)}
          >
            <span class="letter">{LABELS[i]}</span>
            <span>{moveLabel(v)}</span>
            {gameMove !== null && sameVertex(v, gameMove) && <span class="badge">ваш ход</span>}
            {i === 0 ? <span class="best">лучший</span> : <span class="loss">−{formatPoints(c.loss)}</span>}
            {isVertex(v) && (
              <button
                class="play"
                disabled={!onPlay}
                aria-label={`Сыграть ${moveLabel(v)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onPlay?.(v)
                }}
              >
                Сыграть
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
