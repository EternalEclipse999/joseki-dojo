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

/** A move the bot may play and its probability (0 for a tenuki it never plays); `tenuki`: the move outside the corner (the best outside point, or a pass). */
export interface NaturalMove {
  vertex: Vertex | 'pass'
  tenuki: boolean
  p: number
}

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
  const { zone, outside, pIn, pOut } = splitPolicy(input)

  const tenuki = (): BotChoice => {
    const best = bestOutside(outside)
    return best ? { kind: 'tenuki', vertex: best.vertex } : { kind: 'pass' }
  }

  if (zone.length === 0) return tenuki()
  if (input.josekiStarted && pIn + pOut > 0) {
    const share = pOut / (pIn + pOut)
    if (share >= SETTLED_SHARE) return tenuki()
    if (share >= CALM_SHARE && rng() < MISTAKE_TENUKI_RATE) return tenuki()
  }
  return { kind: 'zone', vertex: sample(localZone(zone, input), input.temperature, rng) }
}

/**
 * Part 3 spec 5.4: the distribution chooseBotMove samples from (Σ p = 1) — the tenuki with the probability its rule gives
 * (1 settled, MISTAKE_TENUKI_RATE calm, else 0), the rest over the local area's zone moves ∝ policy^(1/temperature),
 * evenly when none of them has policy. The tenuki is listed whenever there is an outside point, with p 0 where the bot
 * never leaves (a sharp corner, a joseki not started): a guide plays it for a tenuki edge of a deep start's path. Other
 * moves the bot never plays are left out; chooseBotMove itself is unchanged.
 */
export function naturalMoves(input: BotChoiceInput): NaturalMove[] {
  const { zone, outside, pIn, pOut } = splitPolicy(input)
  const best = bestOutside(outside)
  const tenuki = (p: number): NaturalMove => ({ vertex: best ? best.vertex : 'pass', tenuki: true, p })

  if (zone.length === 0) return [tenuki(1)]
  let tenukiRate = 0
  if (input.josekiStarted && pIn + pOut > 0) {
    const share = pOut / (pIn + pOut)
    if (share >= SETTLED_SHARE) return [tenuki(1)]
    if (share >= CALM_SHARE) tenukiRate = MISTAKE_TENUKI_RATE
  }
  const local = localZone(zone, input)
  const weights = weightsOf(local, input.temperature)
  const total = weights.reduce((a, b) => a + b, 0)
  const moves: NaturalMove[] = best || tenukiRate > 0 ? [tenuki(tenukiRate)] : []
  for (let i = 0; i < local.length; i++) {
    const share = total > 0 ? weights[i] / total : 1 / local.length
    if (share > 0) moves.push({ vertex: local[i].vertex, tenuki: false, p: (1 - tenukiRate) * share })
  }
  return moves
}

/** The legal points of the human policy in the zone and outside it, and the policy mass of each side (a pass counts outside). */
function splitPolicy(input: BotChoiceInput): { zone: Entry[]; outside: Entry[]; pIn: number; pOut: number } {
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
  return { zone, outside, pIn, pOut }
}

/** The bot's tenuki: the strongest outside point (the first on a tie), null when there is none and the bot passes. */
const bestOutside = (outside: Entry[]): Entry | null => outside.reduce<Entry | null>((b, e) => (b === null || e.p > b.p ? e : b), null)

/** The zone points the bot samples from: the local area, or the whole zone when the local area has no legal point. */
function localZone(zone: Entry[], input: BotChoiceInput): Entry[] {
  const anchors = localAnchors(input.position, input.corner)
  const local = zone.filter((e) => anchors.some((a) => chebyshev(a, e.vertex) <= LOCAL_RADIUS))
  return local.length > 0 ? local : zone
}

/** The stones in the zone, or the corner's 4-4 point while the zone is empty. */
function localAnchors(position: Position, corner: Corner): Vertex[] {
  const stones = zoneVertices(corner).filter((v) => position.colorAt(v) !== null)
  return stones.length > 0 ? stones : [CORNER_4_4[corner]]
}

const chebyshev = (a: Vertex, b: Vertex): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))

/** The sampling weights policy^(1/temperature), 0 for a point without policy. */
const weightsOf = (entries: Entry[], temperature: number): number[] => entries.map((e) => (e.p > 0 ? Math.pow(e.p, 1 / temperature) : 0))

function sample(entries: Entry[], temperature: number, rng: Rng): Vertex {
  const weights = weightsOf(entries, temperature)
  const total = weights.reduce((a, b) => a + b, 0)
  if (total === 0) return entries[Math.floor(rng() * entries.length)].vertex
  let r = rng() * total
  for (let i = 0; i < entries.length; i++) {
    r -= weights[i]
    if (r < 0) return entries[i].vertex
  }
  return entries[entries.length - 1].vertex
}
