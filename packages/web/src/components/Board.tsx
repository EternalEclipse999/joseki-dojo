import { BoundedGoban, type GhostStone, type Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useState } from 'preact/hooks'
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

const fit = (): { width: number; height: number } => ({
  width: Math.min(720, window.innerWidth - 32),
  height: Math.min(720, window.innerHeight - 96),
})

export function Board({ signMap, corner, markers, ghosts, paint, busy, onClick }: BoardProps) {
  const [size, setSize] = useState(fit)
  useEffect(() => {
    const onResize = (): void => setSize(fit())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const lines = useMemo(() => zoneBorder(corner), [corner])

  return (
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
  )
}
