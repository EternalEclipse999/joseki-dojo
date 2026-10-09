import { indexToVertex, inZone, PASS_INDEX, zoneVertices, type Color, type Corner, type Position, type Vertex } from '@joseki-dojo/shared'
import type { Rng } from './rng'

/** At this share of the policy outside the zone the corner is settled: the bot plays elsewhere. */
export const SETTLED_SHARE = 0.6
/** Below this share the position is sharp: the bot always answers in the corner. */
export const CALM_SHARE = 0.2
/** In a calm corner that is not settled the bot leaves this often: a mistake for the player to punish. */
export const MISTAKE_TENUKI_RATE = 0.05
/** Zone moves stay within this Chebyshev distance of the stones already in the zone. */
export const LOCAL_RADIUS = 4

/** The 4-4 point of each corner: the local area's centre while the zone is still empty. */
const CORNER_4_4: Record<Corner, Vertex> = { TL: [3, 3], TR: [15, 3], BL: [3, 15], BR: [15, 15] }

export interface BotChoiceInput {
  /** KataGo humanPolicy: 362 values, -1 for illegal points, the last one is pass. */
  humanPolicy: readonly number[]
  position: Position
  color: Color
  corner: Corner
  josekiStarted: boolean
  temperature: number
}

export type BotChoice = { kind: 'zone'; vertex: Vertex } | { kind: 'tenuki'; vertex: Vertex } | { kind: 'pass' }

interface Entry {
  vertex: Vertex
  p: number
}

/**
 * Spec 8.4 (revised 2026-10-09): the share of the human policy outside the zone decides whether the bot leaves the
 * corner — always when it is settled, rarely (a mistake) when it is calm, never when it is sharp or the joseki has not
 * started. Zone moves are sampled from policy^(1/temperature) over the local area around the stones in the zone.
 */
export function chooseBotMove(input: BotChoiceInput, rng: Rng): BotChoice {
  const zone: Entry[] = []
  const outside: Entry[] = []
  for (let i = 0; i < PASS_INDEX; i++) {
    const p = input.humanPolicy[i] ?? 0
    if (p < 0) continue
    const vertex = indexToVertex(i) as Vertex
    if (!input.position.isLegal(input.color, vertex)) continue
    ;(inZone(input.corner, vertex) ? zone : outside).push({ vertex, p })
  }
  const passMass = Math.max(0, input.humanPolicy[PASS_INDEX] ?? 0)
  const pIn = zone.reduce((s, e) => s + e.p, 0)
  const pOut = outside.reduce((s, e) => s + e.p, 0) + passMass

  const tenuki = (): BotChoice => {
    const best = outside.reduce<Entry | null>((b, e) => (b === null || e.p > b.p ? e : b), null)
    return best ? { kind: 'tenuki', vertex: best.vertex } : { kind: 'pass' }
  }

  if (zone.length === 0) return tenuki()
  if (input.josekiStarted && pIn + pOut > 0) {
    const share = pOut / (pIn + pOut)
    if (share >= SETTLED_SHARE) return tenuki()
    if (share >= CALM_SHARE && rng() < MISTAKE_TENUKI_RATE) return tenuki()
  }
  const anchors = localAnchors(input.position, input.corner)
  const local = zone.filter((e) => anchors.some((a) => chebyshev(a, e.vertex) <= LOCAL_RADIUS))
  return { kind: 'zone', vertex: sample(local.length > 0 ? local : zone, input.temperature, rng) }
}

/** The stones in the zone, or the corner's 4-4 point while the zone is empty. */
function localAnchors(position: Position, corner: Corner): Vertex[] {
  const stones = zoneVertices(corner).filter((v) => position.colorAt(v) !== null)
  return stones.length > 0 ? stones : [CORNER_4_4[corner]]
}

const chebyshev = (a: Vertex, b: Vertex): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))

function sample(entries: Entry[], temperature: number, rng: Rng): Vertex {
  const weights = entries.map((e) => (e.p > 0 ? Math.pow(e.p, 1 / temperature) : 0))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total === 0) return entries[Math.floor(rng() * entries.length)].vertex
  let r = rng() * total
  for (let i = 0; i < entries.length; i++) {
    r -= weights[i]
    if (r < 0) return entries[i].vertex
  }
  return entries[entries.length - 1].vertex
}
