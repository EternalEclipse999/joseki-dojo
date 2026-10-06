import type { Category, Color, MoveReview } from '@joseki-dojo/shared'
import { ACTOR_LABEL, CATEGORY_LABEL, formatPoints, moveLabel } from '../format'

const SLOT = 14
const GAP = 2
const HALF = 48
const MAX_LOSS = 10
const CATEGORIES: Category[] = ['exact', 'inaccuracy', 'mistake', 'blunder']
const FILL: Record<Category, string> = {
  exact: 'var(--good)',
  inaccuracy: 'var(--warning)',
  mistake: 'var(--serious)',
  blunder: 'var(--critical)',
}

/** Bar with a 4px rounded data end (away from the baseline) and a square base. */
function barPath(x: number, y: number, w: number, h: number, up: boolean): string {
  const r = Math.min(4, w / 2, h)
  return up
    ? `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
    : `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`
}

export interface LossBarProps {
  moves: MoveReview[]
  userColor: Color
  selected: number
  onSelect: (turn: number) => void
}

export function LossBar({ moves, userColor, selected, onSelect }: LossBarProps) {
  const width = Math.max(moves.length, 1) * SLOT
  const height = HALF * 2 + 1
  return (
    <figure class="lossbar">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Потери по ходам">
        <line class="baseline" x1={0} x2={width} y1={HALF + 0.5} y2={HALF + 0.5} />
        {moves.map((m) => {
          const mine = m.color === userColor
          const h = Math.max(2, (Math.min(m.loss, MAX_LOSS) / MAX_LOSS) * (HALF - 2))
          const x = m.turn * SLOT + GAP / 2
          const y = mine ? HALF - h : HALF + 1
          return (
            <g key={m.turn} class={m.turn === selected ? 'slot selected' : 'slot'} onClick={() => onSelect(m.turn)}>
              <rect class="hit" x={m.turn * SLOT} y={0} width={SLOT} height={height} />
              <path d={barPath(x, y, SLOT - GAP, h, mine)} fill={FILL[m.category]} />
              <title>{`Ход ${m.turn + 1} (${ACTOR_LABEL[m.actor]}): ${moveLabel(m.vertex)} — потеря ${formatPoints(m.loss)}, ${CATEGORY_LABEL[m.category]}`}</title>
            </g>
          )
        })}
      </svg>
      <figcaption>
        <span>↑ ваши ходы · ↓ ходы бота</span>
        {CATEGORIES.map((c) => (
          <span key={c}>
            <i class="swatch" style={{ background: FILL[c] }} />
            {CATEGORY_LABEL[c]}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
