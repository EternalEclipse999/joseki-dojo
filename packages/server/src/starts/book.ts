import { readFileSync } from 'node:fs'
import {
  gtpToVertex,
  isStartGroup,
  otherColor,
  Position,
  START_GROUPS,
  vertexToGtp,
  type Color,
  type Corner,
  type Move,
  type StartBranch,
  type StartGroup,
  type StartGroupHead,
  type StartListEntry,
  type Vertex,
} from '@joseki-dojo/shared'
import { pickLeastShown, type Rng } from '../bot/rng'
import { canonicalize, decodeJdb, fromTopRight, JdbError, mirrorMoves, trapId, type CanonicalMove, type JdbBase } from '../jdb'
import { nameFor, type StartNames } from './names'

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

/** What a start from the tree of «Из списка» is called, in Russian: the group goes with the name unless the name is the group. */
export interface ListStart {
  name: string
  group?: StartGroup
}

/** A branch or a group's corner stone: a node of the tree that is not a list position but can be started from. */
interface TreeStart extends ListStart {
  path: CanonicalMove[]
}

/** Spec (starts) 4: the start positions of a starts base and its named list — picking one and putting it on the board. */
export class StartBook {
  private constructor(
    /** Canonical path of each playable start, by id (the trap id of the path), in tree order. */
    private readonly paths: ReadonlyMap<string, CanonicalMove[]>,
    /** The same for the starts after the opponent's dubious move. */
    private readonly dubiousPaths: ReadonlyMap<string, CanonicalMove[]>,
    private readonly entries: readonly StartListEntry[],
    private readonly branchList: readonly StartBranch[],
    private readonly heads: readonly StartGroupHead[],
    /** The branches and the group stones by id. */
    private readonly treeStarts: ReadonlyMap<string, TreeStart>,
    /** Ids of the starts left out because they cannot be played. */
    readonly skipped: readonly string[] = [],
  ) {}

  static empty(): StartBook {
    return new StartBook(new Map(), new Map(), [], [], [], new Map())
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
    return new StartBook(paths, dubiousPaths, [], [], [], new Map(), skipped)
  }

  /**
   * Spec (starts) 4.2: this book with the named list from `json`, the text of starts-list.json — `positions` (the list)
   * and `branches` (names of tree nodes that are not positions). A bad position or branch is left out with one `log`
   * line. Throws when the text is not an object with a `positions` array. The names come in every language from `names`
   * (starts-i18n.json, languages spec 7), keyed by the canonical moves.
   */
  withList(json: string, log: (line: string) => void, names: StartNames = {}): StartBook {
    const raw = JSON.parse(json) as unknown
    const file = (raw ?? {}) as Record<string, unknown>
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !Array.isArray(file.positions)) {
      throw new Error('Список стартовых позиций должен быть объектом с массивом positions')
    }
    const entries: StartListEntry[] = []
    ;(file.positions as unknown[]).forEach((item, k) => {
      const skip = (why: string): void => log(`Список стартовых позиций, позиция ${k + 1}: ${why}`)
      const e = (item ?? {}) as Record<string, unknown>
      if (!isStartGroup(e.group)) return skip('неизвестная группа')
      if (typeof e.name !== 'string' || e.name.trim() === '') return skip('нет названия')
      const path = parseMoves(e.moves)
      if (!path) return skip('недопустимые ходы')
      const id = trapId(path)
      if (!this.paths.has(id)) return skip('такой стартовой позиции нет в базе')
      if (entries.some((x) => x.id === id)) return skip('эта позиция уже есть в списке')
      const moves = path.map(vertexToGtp)
      const short = typeof e.short === 'string' && e.short.trim() !== '' ? e.short.trim() : undefined
      const local = nameFor(names, moves.join(' '), { name: e.name.trim(), short }, log)
      entries.push({ id, group: e.group, name: local.name, short: local.short ?? local.name, rare: e.rare === true, moves })
    })
    const branches: StartBranch[] = []
    const treeStarts = new Map<string, TreeStart>()
    const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((m, i) => m === b[i])
    ;(Array.isArray(file.branches) ? (file.branches as unknown[]) : []).forEach((item, k) => {
      const skip = (why: string): void => log(`Список стартовых позиций, ветка ${k + 1}: ${why}`)
      const b = (item ?? {}) as Record<string, unknown>
      if (typeof b.name !== 'string' || b.name.trim() === '') return skip('нет названия')
      const path = parseMoves(b.moves)
      if (!path || path.length < 2 || path.length > 8) return skip('недопустимые ходы')
      const moves = path.map(vertexToGtp)
      if (entries.some((e) => same(e.moves, moves))) return skip('совпадает с позицией списка')
      if (branches.some((x) => same(x.moves, moves))) return skip('эта ветка уже есть')
      const below = entries.find((e) => e.moves.length > moves.length && same(e.moves.slice(0, moves.length), moves))
      if (!below) return skip('под веткой нет позиций')
      const name = b.name.trim()
      const branch: StartBranch = { id: trapId(path), moves, name: nameFor(names, moves.join(' '), { name }, log).name }
      branches.push(branch)
      treeStarts.set(branch.id, { path, name, group: below.group })
    })
    // A group can be started from its corner stone when all its positions begin with the same one.
    const heads: StartGroupHead[] = []
    for (const group of START_GROUPS) {
      const own = entries.filter((e) => e.group === group)
      if (own.length === 0 || own.some((e) => e.moves[0] !== own[0].moves[0])) continue
      const path = [gtpToVertex(own[0].moves[0]) as Vertex]
      const head: StartGroupHead = { id: trapId(path), group, moves: [own[0].moves[0]] }
      heads.push(head)
      treeStarts.set(head.id, { path, name: group })
    }
    return new StartBook(this.paths, this.dubiousPaths, entries, branches, heads, treeStarts, this.skipped)
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
  branches(): StartBranch[] {
    return [...this.branchList]
  }
  groups(): StartGroupHead[] {
    return [...this.heads]
  }
  isListed(id: string): boolean {
    return this.entries.some((e) => e.id === id)
  }
  /** The list entry of `id`; null when it is not on the list. */
  entryOf(id: string): StartListEntry | null {
    return this.entries.find((e) => e.id === id) ?? null
  }
  /** Spec (starts) 5.1: a node of the tree «Из списка» can start from — a list position, a branch or a group stone; null for anything else. */
  listStart(id: string): ListStart | null {
    const entry = this.entryOf(id)
    if (entry) return { name: entry.name.ru, group: entry.group }
    const node = this.treeStarts.get(id)
    return node ? { name: node.name, ...(node.group ? { group: node.group } : {}) } : null
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
    const path = this.paths.get(id) ?? this.dubiousPaths.get(id) ?? this.treeStarts.get(id)?.path
    if (!path) throw new Error(`Unknown start ${id}`)
    return (mirror ? mirrorMoves(path) : path).map((m, i): Move => ({ color: swapColors ? otherColor(colorAt(i)) : colorAt(i), vertex: fromTopRight(m as Vertex, corner) }))
  }
}
