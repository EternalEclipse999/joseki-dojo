import { readFileSync } from 'node:fs'
import { gtpToVertex, isStartGroup, otherColor, Position, vertexToGtp, type Color, type Corner, type Move, type StartListEntry, type Vertex } from '@joseki-dojo/shared'
import { pickLeastShown, type Rng } from '../bot/rng'
import { canonicalize, decodeJdb, fromTopRight, JdbError, mirrorMoves, trapId, type CanonicalMove, type JdbBase } from '../jdb'

const colorAt = (i: number): Color => (i % 2 === 0 ? 'B' : 'W')

/** A start can be played when its path has no tenuki and is a legal sequence of moves, Black first. */
function isPlayable(path: readonly CanonicalMove[]): boolean {
  if (path.length === 0 || path.includes('tenuki')) return false
  try {
    Position.fromMoves(path.map((m, i) => ({ color: colorAt(i), vertex: m as Vertex })))
    return true
  } catch {
    return false
  }
}

/** The moves of a list entry, canonical; null for anything that is not a list of board points. */
function parseMoves(text: unknown): Vertex[] | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  try {
    const moves = text.trim().split(/\s+/).map(gtpToVertex)
    if (moves.some((m) => m === 'pass')) return null
    return canonicalize(moves as Vertex[]) as Vertex[]
  } catch {
    return null
  }
}

/** Spec (starts) 5.3: the share of «Случайно» picks that start after the opponent's dubious move. */
export const DUBIOUS_SHARE = 0.1

/** Spec (starts) 4: the start positions of a starts base and its named list — picking one and putting it on the board. */
export class StartBook {
  private constructor(
    /** Canonical path of each playable start, by id (the trap id of the path), in tree order. */
    private readonly paths: ReadonlyMap<string, CanonicalMove[]>,
    /** The same for the starts after the opponent's dubious move. */
    private readonly dubiousPaths: ReadonlyMap<string, CanonicalMove[]>,
    private readonly entries: readonly StartListEntry[],
    /** Ids of the starts left out because they cannot be played. */
    readonly skipped: readonly string[] = [],
  ) {}

  static empty(): StartBook {
    return new StartBook(new Map(), new Map(), [])
  }

  /** Throws `JdbError` for a bad file or a base of another kind, a file system error for an unreadable file. */
  static loadBase(file: string): StartBook {
    const base = decodeJdb(readFileSync(file))
    if (base.kind !== 'starts') throw new JdbError(`Это не база стартовых позиций (тип: ${base.kind})`)
    return StartBook.fromBase(base)
  }

  static fromBase(base: JdbBase): StartBook {
    const paths = new Map<string, CanonicalMove[]>()
    const dubiousPaths = new Map<string, CanonicalMove[]>()
    const skipped: string[] = []
    for (const [category, target] of [['start', paths], ['dubious', dubiousPaths]] as const) {
      for (const i of base.nodesOf(category)) {
        const path = base.path(i)
        const id = trapId(path)
        if (isPlayable(path)) target.set(id, path)
        else skipped.push(id)
      }
    }
    return new StartBook(paths, dubiousPaths, [], skipped)
  }

  /**
   * Spec (starts) 4.2: this book with the named list from `json`, the text of starts-list.json. An entry with an unknown
   * group, no name, bad moves, a path that is not a start of the base, or a position already on the list is left out
   * with one `log` line. Throws when the text is not a JSON array.
   */
  withList(json: string, log: (line: string) => void): StartBook {
    const raw = JSON.parse(json) as unknown
    if (!Array.isArray(raw)) throw new Error('Список стартовых позиций должен быть массивом')
    const entries: StartListEntry[] = []
    raw.forEach((item: unknown, k) => {
      const skip = (why: string): void => log(`Список стартовых позиций, запись ${k + 1}: ${why}`)
      const e = (item ?? {}) as Record<string, unknown>
      if (!isStartGroup(e.group)) return skip('неизвестная группа')
      if (typeof e.name !== 'string' || e.name.trim() === '') return skip('нет названия')
      const path = parseMoves(e.moves)
      if (!path) return skip('недопустимые ходы')
      const id = trapId(path)
      if (!this.paths.has(id)) return skip('такой стартовой позиции нет в базе')
      if (entries.some((x) => x.id === id)) return skip('эта позиция уже есть в списке')
      entries.push({ id, group: e.group, name: e.name.trim(), moves: path.map(vertexToGtp) })
    })
    return new StartBook(this.paths, this.dubiousPaths, entries, this.skipped)
  }

  get count(): number {
    return this.paths.size + this.dubiousPaths.size
  }
  get dubiousCount(): number {
    return this.dubiousPaths.size
  }
  /** The normal starts only. */
  ids(): string[] {
    return [...this.paths.keys()]
  }
  dubiousIds(): string[] {
    return [...this.dubiousPaths.keys()]
  }
  isDubious(id: string): boolean {
    return this.dubiousPaths.has(id)
  }
  has(id: string): boolean {
    return this.paths.has(id) || this.dubiousPaths.has(id)
  }
  list(): StartListEntry[] {
    return [...this.entries]
  }
  isListed(id: string): boolean {
    return this.entries.some((e) => e.id === id)
  }
  /** The name of `id` on the list; null when it is not on it. */
  nameOf(id: string): string | null {
    return this.entries.find((e) => e.id === id)?.name ?? null
  }

  /** Spec (starts) 5.3: a dubious start with probability DUBIOUS_SHARE (when there are both kinds), weight 1 / (1 + shows) inside the set. */
  pick(shows: (id: string) => number, rng: Rng): string | null {
    const dubious = this.dubiousPaths.size > 0 && (this.paths.size === 0 || rng() < DUBIOUS_SHARE)
    return pickLeastShown(dubious ? this.dubiousIds() : this.ids(), shows, rng)
  }

  /** The colour of the last move of the canonical path of `id`, before any colour swap. */
  lastColor(id: string): Color {
    const path = this.paths.get(id) ?? this.dubiousPaths.get(id)
    if (!path) throw new Error(`Unknown start ${id}`)
    return colorAt(path.length - 1)
  }

  /** Spec (starts) 5.2: the moves of `id` in `corner`, mirrored in the corner's diagonal when `mirror`; Black first, or White first when `swapColors`. */
  place(id: string, corner: Corner, mirror: boolean, swapColors = false): Move[] {
    const path = this.paths.get(id) ?? this.dubiousPaths.get(id)
    if (!path) throw new Error(`Unknown start ${id}`)
    return (mirror ? mirrorMoves(path) : path).map((m, i): Move => ({ color: swapColors ? otherColor(colorAt(i)) : colorAt(i), vertex: fromTopRight(m as Vertex, corner) }))
  }
}
