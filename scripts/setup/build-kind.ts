export type BuildKind = 'cpu' | 'gpu'

/** Default answer to "is this a CPU build?": the kind stored by a previous setup, else guessed from the path. */
export function defaultKind(storedKind: unknown, katagoPath: string): BuildKind {
  if (storedKind === 'cpu' || storedKind === 'gpu') return storedKind
  return /eigen/i.test(katagoPath) ? 'cpu' : 'gpu'
}

/** Parses the y/n answer; empty or unrecognised input keeps the default. */
export function parseCpuAnswer(answer: string, fallback: BuildKind): BuildKind {
  const a = answer.trim().toLowerCase()
  if (a === 'y') return 'cpu'
  if (a === 'n') return 'gpu'
  return fallback
}
