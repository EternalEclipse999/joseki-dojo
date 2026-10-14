import { BOARD_SIZE, gtpToVertex, START_GROUPS, ZONE_SIZE, type StartListEntry } from '@joseki-dojo/shared'

const N = ZONE_SIZE
const STEP = 10
const PAD = 6
const SIZE = PAD * 2 + STEP * (N - 1)
const at = (i: number): number => PAD + i * STEP
/** The zone is the top-right ZONE_SIZE x ZONE_SIZE corner: its first column. */
const ZONE_X0 = BOARD_SIZE - ZONE_SIZE
/** The 4-4 star point in zone coordinates. */
const STAR = 3

/** Spec (starts) 5.1: the top-right 11×11 corner with the stones of a start (canonical moves, Black first). */
export function StartPreview({ moves }: { moves: string[] }) {
  const stones = moves.flatMap((m, i) => {
    const v = gtpToVertex(m)
    return v === 'pass' ? [] : [{ x: v[0] - ZONE_X0, y: v[1], black: i % 2 === 0 }]
  })
  return (
    <svg class="start-preview" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
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
        <circle key={i} cx={at(s.x)} cy={at(s.y)} r="4.4" fill={s.black ? '#17181c' : '#f4f4f1'} stroke="var(--stone-ring)" stroke-width="0.6" />
      ))}
    </svg>
  )
}

export interface StartListProps {
  entries: StartListEntry[]
  selected: string | null
  onSelect: (id: string) => void
}

/** Spec (starts) 5.1: the named list grouped by the first move, one radio row per position. */
export function StartList({ entries, selected, onSelect }: StartListProps) {
  return (
    <div class="start-list" role="radiogroup" aria-label="Стартовая позиция">
      {START_GROUPS.map((group) => {
        const rows = entries.filter((e) => e.group === group)
        if (rows.length === 0) return null
        return (
          <section key={group} role="group" aria-labelledby={`start-group-${group}`}>
            <div class="label" id={`start-group-${group}`}>{group}</div>
            <div class="start-rows">
              {rows.map((e) => (
                <label key={e.id} class="start-row">
                  <input type="radio" name="start" checked={selected === e.id} onChange={() => onSelect(e.id)} />
                  <StartPreview moves={e.moves} />
                  <span>{e.name}</span>
                </label>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
