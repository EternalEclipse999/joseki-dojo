import { zoneVertices, type Corner, type Position } from '@joseki-dojo/shared'

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
