export type Rng = () => number

/** Small seeded PRNG for reproducible tests; production passes Math.random. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A weighted random id, weight 1 / (1 + shows): the less an id was shown, the likelier it is. One `rng()` draw; null for no ids. */
export function pickLeastShown(ids: readonly string[], shows: (id: string) => number, rng: Rng): string | null {
  if (ids.length === 0) return null
  const weights = ids.map((id) => 1 / (1 + shows(id)))
  let r = rng() * weights.reduce((a, b) => a + b, 0)
  for (let k = 0; k < ids.length; k++) {
    r -= weights[k]
    if (r < 0) return ids[k]
  }
  return ids[ids.length - 1]
}
