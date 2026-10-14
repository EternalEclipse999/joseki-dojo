import { BOARD_SIZE, gtpToVertex, ZONE_SIZE } from '@joseki-dojo/shared'

const N = ZONE_SIZE
const STEP = 10
const PAD = 6
const SIZE = PAD * 2 + STEP * (N - 1)
const at = (i: number): number => PAD + i * STEP
/** The zone is the top-right ZONE_SIZE x ZONE_SIZE corner: its first column. */
const ZONE_X0 = BOARD_SIZE - ZONE_SIZE
/** The 4-4 star point in zone coordinates. */
const STAR = 3
const BLACK = '#17181c'
const WHITE = '#f4f4f1'

const point = (gtp: string): { x: number; y: number } | null => {
  const v = gtpToVertex(gtp)
  return v === 'pass' ? null : { x: v[0] - ZONE_X0, y: v[1] }
}

/** A continuation's letter on its first move; `active` while it is hovered: then a ring instead of the letter. */
export interface CornerMark {
  letter: string
  move: string
  active: boolean
}

export interface CornerBoardProps {
  /** Canonical moves in GTP, Black first. */
  moves: string[]
  /** A continuation shown as translucent stones, numbered from moves.length + 1. */
  ghost?: string[]
  marks?: CornerMark[]
  /** Mark the last stone of `moves`. */
  lastMove?: boolean
  onMarkEnter?: (letter: string) => void
  onMarkLeave?: () => void
  onMarkClick?: (letter: string) => void
  class?: string
}

/** Spec (starts) 5.1: the top-right 11×11 corner with a position, its continuations' letters and a hovered continuation. */
export function CornerBoard({ moves, ghost = [], marks = [], lastMove = false, onMarkEnter, onMarkLeave, onMarkClick, class: cls = 'start-preview' }: CornerBoardProps) {
  const stones = moves.flatMap((m, i) => {
    const p = point(m)
    return p ? [{ ...p, black: i % 2 === 0 }] : []
  })
  const last = lastMove && moves.length > 0 ? point(moves[moves.length - 1]) : null
  const ghosts = ghost.flatMap((m, i) => {
    const p = point(m)
    return p ? [{ ...p, black: (moves.length + i) % 2 === 0, n: moves.length + i + 1 }] : []
  })
  const underGhost = new Set(ghosts.map((s) => `${s.x},${s.y}`))
  // A letter under a ghost stone would hide it: such letters are skipped, so the remaining inactive ones never overlap
  // a ghost. The active (hovered) one is only a ring around its point, the first ghost stone with its number visible inside.
  const shownMarks = marks.flatMap((m) => {
    const p = point(m.move)
    return p && (m.active || !underGhost.has(`${p.x},${p.y}`)) ? [{ ...m, ...p }] : []
  })
  return (
    <svg class={cls} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
      <rect width={SIZE} height={SIZE} rx="4" fill="var(--board)" />
      <g stroke="var(--board-line)" stroke-width="0.6">
        {Array.from({ length: N }, (_, i) => (
          <path key={`h${i}`} d={`M0 ${at(i)}H${at(N - 1)}`} />
        ))}
        {Array.from({ length: N }, (_, i) => (
          <path key={`v${i}`} d={`M${at(i)} ${at(0)}V${SIZE}`} />
        ))}
      </g>
      <circle cx={at(BOARD_SIZE - 1 - STAR - ZONE_X0)} cy={at(STAR)} r="1.4" fill="var(--board-line)" />
      {stones.map((s, i) => (
        <circle key={i} cx={at(s.x)} cy={at(s.y)} r="4.4" fill={s.black ? BLACK : WHITE} stroke="var(--stone-ring)" stroke-width="0.6" />
      ))}
      {last && <circle cx={at(last.x)} cy={at(last.y)} r="1.8" fill="none" stroke="var(--last-move)" stroke-width="1" />}
      {ghosts.map((s) => (
        <g key={`g${s.n}`} class="corner-ghost" opacity="0.6">
          <circle cx={at(s.x)} cy={at(s.y)} r="4.4" fill={s.black ? BLACK : WHITE} />
          <text x={at(s.x)} y={at(s.y) + 2.1} text-anchor="middle" font-size="6" fill={s.black ? WHITE : BLACK}>
            {s.n}
          </text>
        </g>
      ))}
      {/* All marks are drawn after the ghosts and a mark keeps its element when it turns active: the pointer stays on
          the same mark (no leave and re-enter, no flicker) and a click lands on the element that was hovered. */}
      {shownMarks.map((m) => (
        <g key={m.letter} class={`corner-mark${m.active ? ' active' : ''}`} onMouseEnter={() => onMarkEnter?.(m.letter)} onMouseLeave={() => onMarkLeave?.()} onClick={() => onMarkClick?.(m.letter)}>
          <circle cx={at(m.x)} cy={at(m.y)} r={STEP / 2} fill="transparent" pointer-events="all" />
          {m.active ? (
            <circle class="corner-mark-ring" cx={at(m.x)} cy={at(m.y)} r="5.4" fill="none" stroke="var(--last-move)" stroke-width="1.2" />
          ) : (
            <circle class="corner-mark-disc" cx={at(m.x)} cy={at(m.y)} r="4.6" />
          )}
          {!m.active && (
            <text x={at(m.x)} y={at(m.y) + 2.2} text-anchor="middle" font-size="6.4">
              {m.letter}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}
