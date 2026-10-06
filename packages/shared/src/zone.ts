import { BOARD_SIZE } from './coords'
import type { Corner, MoveVertex, Vertex } from './types'

export const ZONE_SIZE = 11

export function zoneRanges(corner: Corner): { x: [number, number]; y: [number, number] } {
  const low: [number, number] = [0, ZONE_SIZE - 1]
  const high: [number, number] = [BOARD_SIZE - ZONE_SIZE, BOARD_SIZE - 1]
  return {
    x: corner === 'TL' || corner === 'BL' ? low : high,
    y: corner === 'TL' || corner === 'TR' ? low : high,
  }
}

export function inZone(corner: Corner, v: MoveVertex): boolean {
  if (v === 'pass') return false
  const { x, y } = zoneRanges(corner)
  return v[0] >= x[0] && v[0] <= x[1] && v[1] >= y[0] && v[1] <= y[1]
}

export function zoneVertices(corner: Corner): Vertex[] {
  const { x, y } = zoneRanges(corner)
  const out: Vertex[] = []
  for (let yy = y[0]; yy <= y[1]; yy++) for (let xx = x[0]; xx <= x[1]; xx++) out.push([xx, yy])
  return out
}
