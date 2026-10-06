import { gtpToVertex, inZone, zoneVertices, type Corner, type Position } from '@joseki-dojo/shared'
import type { StoredAnalysis } from '../store/records'

/** The joseki has started once the zone holds stones of both colors. */
export function josekiStartedIn(position: Position, corner: Corner): boolean {
  let black = false
  let white = false
  for (const v of zoneVertices(corner)) {
    const c = position.colorAt(v)
    if (c === 'B') black = true
    else if (c === 'W') white = true
    if (black && white) return true
  }
  return false
}

export function bestMoveOutsideZone(a: StoredAnalysis, corner: Corner): boolean {
  const best = [...a.moveInfos].sort((x, y) => x.order - y.order)[0]
  if (!best) return false
  return !inZone(corner, gtpToVertex(best.move))
}

/** Spec 8.5: the position and the pass probe both say the biggest move is elsewhere. */
export function shouldProposeEnd(position: StoredAnalysis, passProbe: StoredAnalysis, corner: Corner): boolean {
  return bestMoveOutsideZone(position, corner) && bestMoveOutsideZone(passProbe, corner)
}
