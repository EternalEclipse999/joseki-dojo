/** A rectangle in pixels, relative to the board wrapper. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The smallest box holding both. */
export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** `box` in the coordinates of a container whose top-left corner is at `origin`. */
export const relativeTo = (box: Box, origin: { x: number; y: number }): Box => ({ ...box, x: box.x - origin.x, y: box.y - origin.y })
