import { BoundedGoban, type GhostStone, type Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Corner, Vertex } from '@joseki-dojo/shared'
import { zoneBorder } from '../board-maps'

export interface BoardProps {
  signMap: (0 | 1 | -1)[][]
  corner: Corner
  markers?: (Marker | null)[][]
  ghosts?: (GhostStone | null)[][]
  /** Ownership -1..1 (Black positive); Shudan scales the paint opacity by the magnitude. */
  paint?: number[][] | null
  busy?: boolean
  onClick?: (vertex: Vertex) => void
}

/** Keep in sync with the 900px breakpoint, the side panel's min width and the gap in styles.css. */
const TWO_COLUMNS = '(min-width: 901px)'
const PANEL_AND_GAP = 280 + 24

/** The room left for the board: the width of the layout grid minus the side panel (when beside it) and the window height. */
const fit = (grid: HTMLElement | null): { width: number; height: number } => {
  let available = window.innerWidth - 32
  if (grid) {
    const style = getComputedStyle(grid)
    available = grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  }
  if (window.matchMedia(TWO_COLUMNS).matches) available -= PANEL_AND_GAP
  return { width: Math.max(120, Math.min(720, available)), height: Math.max(120, Math.min(720, window.innerHeight - 96)) }
}

export function Board({ signMap, corner, markers, ghosts, paint, busy, onClick }: BoardProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(() => fit(null))
  useEffect(() => {
    const grid = wrap.current?.parentElement ?? null
    const update = (): void => setSize(fit(grid))
    update()
    window.addEventListener('resize', update)
    // The grid's width changes without a window resize too (scrollbar, panel content).
    const observer = grid && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    if (grid) observer?.observe(grid)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [])
  const lines = useMemo(() => zoneBorder(corner), [corner])

  // The wrapper is not stretched by the layout grid, so the goban is measured at its own size.
  return (
    <div class="board" ref={wrap}>
      <BoundedGoban
        maxWidth={size.width}
        maxHeight={size.height}
        showCoordinates
        fuzzyStonePlacement
        animateStonePlacement
        busy={busy}
        signMap={signMap}
        markerMap={markers}
        ghostStoneMap={ghosts}
        paintMap={(paint ?? undefined) as (0 | 1 | -1)[][] | undefined}
        lines={lines}
        onVertexClick={(_evt, v) => onClick?.([v[0], v[1]])}
      />
    </div>
  )
}
