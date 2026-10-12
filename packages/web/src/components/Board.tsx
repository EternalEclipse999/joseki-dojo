import { BoundedGoban, type GhostStone, type Marker } from '@sabaki/shudan'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { zoneRanges, type Corner, type Vertex } from '@joseki-dojo/shared'
import { relativeTo, union, type Box } from '../zone-overlay'

export interface BoardProps {
  signMap: (0 | 1 | -1)[][]
  corner: Corner
  markers?: (Marker | null)[][]
  ghosts?: (GhostStone | null)[][]
  /** Ownership -1..1 (Black positive); Shudan scales the paint opacity by the magnitude. */
  paint?: number[][] | null
  /** Points drawn faded (the review's weaker candidates). */
  dimmed?: Vertex[]
  /** Points highlighted (the candidate under the pointer). */
  selected?: Vertex[]
  busy?: boolean
  onClick?: (vertex: Vertex) => void
}

/** Keep in sync with the styles: the 900px breakpoint, the panel's min width and the layout gap (base.css), the board's padding (board.css), the header and main paddings. */
const TWO_COLUMNS = '(min-width: 901px)'
const PANEL_AND_GAP = 300 + 28
const BOARD_PADDING = 2 * 10
const CHROME_HEIGHT = 52 + 24 + 32 + BOARD_PADDING

/** The room left for the board: the width of the layout grid minus the side panel (when beside it) and the window height. */
const fit = (grid: HTMLElement | null): { width: number; height: number } => {
  let available = window.innerWidth - 40
  if (grid) {
    const style = getComputedStyle(grid)
    available = grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  }
  if (window.matchMedia(TWO_COLUMNS).matches) available -= PANEL_AND_GAP
  available -= BOARD_PADDING
  return { width: Math.max(120, Math.min(760, available)), height: Math.max(120, Math.min(760, window.innerHeight - CHROME_HEIGHT)) }
}

interface Overlay {
  /** The zone in the wrapper's coordinates (the dashed frame). */
  frame: Box
  /** The zone in the goban's coordinates (the unveiled part of the board background). */
  inGoban: Box
}

/** Spec 6: the zone, measured from Shudan's rendered points: a dashed frame, and the rest of the board in a lighter wood. */
function measureOverlay(root: HTMLElement, corner: Corner): Overlay | null {
  const goban = root.querySelector('.shudan-goban')
  if (!goban) return null
  const base = root.getBoundingClientRect()
  const box = (x: number, y: number): Box | null => {
    const el = root.querySelector(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }
  }
  const { x, y } = zoneRanges(corner)
  const a = box(x[0], y[0])
  const b = box(x[1], y[1])
  if (!a || !b) return null
  const frame = union(a, b)
  const g = goban.getBoundingClientRect()
  return { frame, inGoban: relativeTo(frame, { x: g.left - base.left, y: g.top - base.top }) }
}

const sameBox = (a: Box, b: Box): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

export function Board({ signMap, corner, markers, ghosts, paint, dimmed, selected, busy, onClick }: BoardProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(() => fit(null))
  const [overlay, setOverlay] = useState<Overlay | null>(null)

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

  useLayoutEffect(() => {
    const root = wrap.current
    if (!root) return
    const measure = (): void => {
      const next = measureOverlay(root, corner)
      // A resize callback with nothing moved must not re-render the 361 points.
      setOverlay((prev) => (prev && next && sameBox(prev.frame, next.frame) && sameBox(prev.inGoban, next.inGoban) ? prev : next))
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(root)
    return () => observer?.disconnect()
  }, [corner, size.width, size.height])

  // The wrapper is not stretched by the layout grid, so the goban is measured at its own size.
  return (
    <div
      class="board"
      ref={wrap}
      style={
        overlay
          ? { '--zx': `${overlay.inGoban.x}px`, '--zy': `${overlay.inGoban.y}px`, '--zw': `${overlay.inGoban.w}px`, '--zh': `${overlay.inGoban.h}px` }
          : undefined
      }
    >
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
        dimmedVertices={dimmed ?? []}
        selectedVertices={selected ?? []}
        onVertexClick={(_evt, v) => onClick?.([v[0], v[1]])}
      />
      {overlay && (
        <svg class="zone-overlay" aria-hidden="true">
          <rect class="frame" x={overlay.frame.x + 0.75} y={overlay.frame.y + 0.75} width={overlay.frame.w - 1.5} height={overlay.frame.h - 1.5} rx={4} />
        </svg>
      )}
    </div>
  )
}
