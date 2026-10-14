import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Category, Color, MoveReview } from '@joseki-dojo/shared'
import { ACTOR_LABEL, CATEGORY_LABEL, formatPoints, moveLabel } from '../format'
import { useI18n } from '../i18n'

const GAP = 2
const HALF = 43
const MAX_LOSS = 10
const MAX_SLOT = 28
const MIN_SLOT = 6
const CATEGORIES: Category[] = ['exact', 'inaccuracy', 'mistake', 'blunder']
const FILL: Record<Category, string> = {
  exact: 'var(--good)',
  inaccuracy: 'var(--warning)',
  mistake: 'var(--serious)',
  blunder: 'var(--critical)',
}

/** Bar with a rounded data end (away from the baseline) and a square base. */
function barPath(x: number, y: number, w: number, h: number, up: boolean): string {
  const r = Math.min(3, w / 2, h)
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

/** Spec 7: the loss of every move, the player's up and the bot's down, across the panel's width. */
export function LossBar({ moves, userColor, selected, onSelect }: LossBarProps) {
  const { t, language } = useI18n()
  const ref = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(320)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (): void => setWidth(el.clientWidth || 320)
    update()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [])

  const slot = Math.max(MIN_SLOT, Math.min(MAX_SLOT, width / Math.max(moves.length, 1)))
  // A long training overflows the panel: keep the selected move in view (← and → move it).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const left = selected * slot
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (left + slot > el.scrollLeft + el.clientWidth) el.scrollLeft = left + slot - el.clientWidth
  }, [selected, slot])
  const svgWidth = Math.max(width, slot * moves.length)
  const height = HALF * 2 + 1
  return (
    <figure class="lossbar" ref={ref}>
      <svg width={svgWidth} height={height} viewBox={`0 0 ${svgWidth} ${height}`} role="img" aria-label={t('review.lossBar.label')}>
        <line class="baseline" x1={0} x2={svgWidth} y1={HALF + 0.5} y2={HALF + 0.5} />
        {moves.map((m) => {
          const mine = m.color === userColor
          const h = Math.max(2, (Math.min(m.loss, MAX_LOSS) / MAX_LOSS) * (HALF - 3))
          const x = m.turn * slot + GAP / 2
          const y = mine ? HALF - h : HALF + 1
          const title = t('review.lossBar.moveTitle', {
            n: m.turn + 1,
            actor: t(ACTOR_LABEL[m.actor]),
            move: moveLabel(m.vertex, t),
            loss: formatPoints(m.loss, language),
            category: t(CATEGORY_LABEL[m.category]),
          })
          return (
            <g key={m.turn} class={m.turn === selected ? 'slot selected' : 'slot'} onClick={() => onSelect(m.turn)}>
              <rect class="hit" x={m.turn * slot} y={0} width={slot} height={height} rx={4} />
              <path d={barPath(x, y, slot - GAP, h, mine)} fill={FILL[m.category]} />
              <title>{title}</title>
            </g>
          )
        })}
      </svg>
      <figcaption>
        <span>{t('review.lossBar.legend')}</span>
        {CATEGORIES.map((c) => (
          <span key={c}>
            <i class="swatch" style={{ background: FILL[c] }} />
            {t(CATEGORY_LABEL[c])}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
