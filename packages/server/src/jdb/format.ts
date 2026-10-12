import { crc32 } from './crc32'
import { zoneIndex, zoneVertex, type CanonicalMove } from './canonical'
import { JdbError } from './errors'
import { readVarint, writeVarint } from './varint'

export type JdbKind = 'traps' | 'starts'
export type NodeCategory = 'none' | 'good' | 'caught' | 'trap'
export interface JdbNode {
  move: CanonicalMove
  category: NodeCategory
  loss: number | null
  children: JdbNode[]
}
export interface JdbTree {
  kind: JdbKind
  verified: boolean
  roots: JdbNode[]
}

const MAGIC = [0x4a, 0x44, 0x42, 0x31] // "JDB1"
export const JDB_VERSION = 1
const HEADER = 16
const KIND_CODE: Record<JdbKind, number> = { traps: 1, starts: 2 }
const CATEGORIES: NodeCategory[] = ['none', 'good', 'caught', 'trap']
const HAS_LOSS = 0x08
const TENUKI = 121
const ESCAPE = 255
const NO_LOSS = -32768
const OUTSIDE = 1000 // moves[] holds 1000 + board index for a move outside the zone

function writeMove(out: number[], m: CanonicalMove): void {
  if (m === 'tenuki') return void out.push(TENUKI)
  const z = zoneIndex(m)
  if (z !== null) return void out.push(z)
  const i = m[0] + 19 * m[1]
  out.push(ESCAPE, i & 0xff, i >> 8)
}

export function encodeJdb(tree: JdbTree): Uint8Array {
  const body: number[] = []
  let count = 0
  const writeNode = (n: JdbNode): void => {
    count++
    writeMove(body, n.move)
    body.push(CATEGORIES.indexOf(n.category) | (n.loss === null ? 0 : HAS_LOSS))
    writeVarint(body, n.children.length)
    if (n.loss !== null) {
      const v = Math.max(-32767, Math.min(32767, Math.round(n.loss * 10))) & 0xffff
      body.push(v & 0xff, v >> 8)
    }
    for (const c of n.children) writeNode(c)
  }
  writeVarint(body, tree.roots.length)
  for (const r of tree.roots) writeNode(r)
  const bytes = new Uint8Array(HEADER + body.length)
  bytes.set(MAGIC, 0)
  bytes[4] = JDB_VERSION
  bytes[5] = KIND_CODE[tree.kind]
  bytes[6] = tree.verified ? 1 : 0
  bytes.set(body, HEADER)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, count, true)
  view.setUint32(12, crc32(bytes.subarray(HEADER)), true)
  return bytes
}

export function decodeJdb(bytes: Uint8Array): JdbBase {
  if (bytes.length < HEADER || MAGIC.some((b, i) => bytes[i] !== b)) throw new JdbError('Это не файл базы ходов')
  if (bytes[4] !== JDB_VERSION) throw new JdbError(`Неизвестная версия базы ходов: ${bytes[4]}`)
  const kind = (Object.keys(KIND_CODE) as JdbKind[]).find((k) => KIND_CODE[k] === bytes[5])
  if (!kind) throw new JdbError(`Неизвестный тип базы ходов: ${bytes[5]}`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(8, true)
  if (crc32(bytes.subarray(HEADER)) !== view.getUint32(12, true)) throw new JdbError('Файл базы ходов повреждён')

  const moves = new Int16Array(count)
  const flags = new Uint8Array(count)
  const losses = new Int16Array(count).fill(NO_LOSS)
  const firstChild = new Int32Array(count).fill(-1)
  const nextSibling = new Int32Array(count).fill(-1)
  const parents = new Int32Array(count).fill(-1)
  let pos = HEADER
  let rootCount: number
  ;[rootCount, pos] = readVarint(bytes, pos)
  // Each frame: the parent (-1 = first level), children still to read, and the last child linked so far.
  const stack: { parent: number; left: number; last: number }[] = [{ parent: -1, left: rootCount, last: -1 }]
  let rootFirst = -1
  let n = 0
  while (stack.length > 0) {
    const top = stack[stack.length - 1]
    if (top.left === 0) {
      stack.pop()
      continue
    }
    top.left--
    if (n >= count) throw new JdbError('В файле базы больше узлов, чем указано')
    if (pos >= bytes.length) throw new JdbError('Файл базы обрывается')
    const code = bytes[pos++]
    if (code === ESCAPE) {
      if (pos + 2 > bytes.length) throw new JdbError('Файл базы обрывается')
      moves[n] = OUTSIDE + (bytes[pos] | (bytes[pos + 1] << 8))
      pos += 2
    } else if (code <= TENUKI) moves[n] = code
    else throw new JdbError(`Неизвестный код хода в базе: ${code}`)
    if (pos >= bytes.length) throw new JdbError('Файл базы обрывается')
    flags[n] = bytes[pos++]
    if ((flags[n] & 0x07) >= CATEGORIES.length || (flags[n] & 0xf0) !== 0) throw new JdbError('Повреждённые флаги узла в базе')
    let kids: number
    ;[kids, pos] = readVarint(bytes, pos)
    if (flags[n] & HAS_LOSS) {
      if (pos + 2 > bytes.length) throw new JdbError('Файл базы обрывается')
      losses[n] = view.getInt16(pos, true)
      pos += 2
    }
    parents[n] = top.parent
    if (top.last === -1) {
      if (top.parent === -1) rootFirst = n
      else firstChild[top.parent] = n
    } else nextSibling[top.last] = n
    top.last = n
    stack.push({ parent: n, left: kids, last: -1 })
    n++
  }
  if (n !== count) throw new JdbError('В файле базы меньше узлов, чем указано')
  if (pos !== bytes.length) throw new JdbError('Лишние данные в конце файла базы')
  return new JdbBase(kind, (bytes[6] & 1) === 1, moves, flags, losses, firstChild, nextSibling, parents, rootFirst)
}

/** A decoded base in typed arrays (spec 3.4). Node indices are preorder positions. */
export class JdbBase {
  constructor(
    readonly kind: JdbKind,
    readonly verified: boolean,
    private readonly moves: Int16Array,
    private readonly flags: Uint8Array,
    private readonly losses: Int16Array,
    private readonly firstChild: Int32Array,
    private readonly nextSibling: Int32Array,
    private readonly parents: Int32Array,
    private readonly rootFirst: number,
  ) {}

  get size(): number {
    return this.moves.length
  }
  private siblingsFrom(first: number): number[] {
    const out: number[] = []
    for (let i = first; i !== -1; i = this.nextSibling[i]) out.push(i)
    return out
  }
  roots(): number[] {
    return this.siblingsFrom(this.rootFirst)
  }
  children(i: number): number[] {
    return this.siblingsFrom(this.firstChild[i])
  }
  parent(i: number): number {
    return this.parents[i]
  }
  move(i: number): CanonicalMove {
    const m = this.moves[i]
    if (m === TENUKI) return 'tenuki'
    if (m >= OUTSIDE) return [(m - OUTSIDE) % 19, Math.floor((m - OUTSIDE) / 19)]
    return zoneVertex(m)
  }
  category(i: number): NodeCategory {
    return CATEGORIES[this.flags[i] & 0x07]
  }
  loss(i: number): number | null {
    return this.losses[i] === NO_LOSS ? null : this.losses[i] / 10
  }
  path(i: number): CanonicalMove[] {
    const out: CanonicalMove[] = []
    for (let k = i; k !== -1; k = this.parents[k]) out.push(this.move(k))
    return out.reverse()
  }
  find(path: readonly CanonicalMove[]): number | null {
    let level = this.roots()
    let found = -1
    for (const m of path) {
      found = level.find((i) => sameMove(this.move(i), m)) ?? -1
      if (found === -1) return null
      level = this.children(found)
    }
    return found === -1 ? null : found
  }
  nodesOf(category: NodeCategory): number[] {
    const out: number[] = []
    for (let i = 0; i < this.size; i++) if (this.category(i) === category) out.push(i)
    return out
  }
  toTree(): JdbTree {
    const build = (i: number): JdbNode => ({
      move: this.move(i),
      category: this.category(i),
      loss: this.loss(i),
      children: this.children(i).map(build),
    })
    return { kind: this.kind, verified: this.verified, roots: this.roots().map(build) }
  }
}

export const sameMove = (a: CanonicalMove, b: CanonicalMove): boolean =>
  a === 'tenuki' || b === 'tenuki' ? a === b : a[0] === b[0] && a[1] === b[1]
