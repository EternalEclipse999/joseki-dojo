import { GitBranch, LoaderCircle } from 'lucide-preact'
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
  /** «Ветка» on a row: selects the candidate and opens its line. */
  onBranch: (i: number) => void
  /** Plays a candidate (a click on its row); null while KataGo is thinking. */
  onPlay: ((v: Vertex) => void) | null
  /** The game move the candidates are alternatives to, marked «ваш ход»; null in a variation. */
  gameMove: MoveVertex | null
  /** No result yet: «KataGo считает…» instead of an empty list. */
  pending: boolean
}

/** Spec 7 and variations spec 3: the best moves, the selected one's line, a row click plays it, «Ветка» shows its line. */
export function CandidateList({ candidates, selected, hot, onHot, onBranch, onPlay, gameMove, pending }: CandidateListProps) {
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
            onClick={() => isVertex(v) && onPlay?.(v)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
              e.preventDefault()
              if (isVertex(v)) onPlay?.(v)
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
                aria-label={`Ветка ${moveLabel(v)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onBranch(i)
                }}
              >
                <GitBranch aria-hidden="true" />
                Ветка
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
