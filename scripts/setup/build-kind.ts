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

export type SourceChoice = { action: 'download' } | { action: 'known' | 'typed'; path: string }

/**
 * Parses the answer to the first setup question: "скачать" always opens the download menu (also to switch
 * CPU to GPU on a re-run), an empty answer keeps the known path (or downloads when there is none), anything
 * else is a path typed by the user.
 */
export function parseSourceAnswer(answer: string, knownPath: string | null): SourceChoice {
  const a = answer.trim()
  if (a.toLowerCase() === 'скачать') return { action: 'download' }
  if (a) return { action: 'typed', path: a }
  return knownPath ? { action: 'known', path: knownPath } : { action: 'download' }
}
