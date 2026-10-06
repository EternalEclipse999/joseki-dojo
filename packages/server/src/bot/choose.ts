import { indexToVertex, inZone, PASS_INDEX, type Color, type Corner, type Position, type Vertex } from '@joseki-dojo/shared'
import type { Rng } from './rng'

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
 * Spec 8.4: split the human policy into zone and non-zone mass. Before the joseki starts the bot
 * always plays in the zone; afterwards it tenukis with probability p_out / (p_in + p_out), to the
 * strongest non-zone point. Zone moves are sampled from policy^(1/temperature).
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
  if (input.josekiStarted && pIn + pOut > 0 && rng() < pOut / (pIn + pOut)) return tenuki()
  return { kind: 'zone', vertex: sample(zone, input.temperature, rng) }
}

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
