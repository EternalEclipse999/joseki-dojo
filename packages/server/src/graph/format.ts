import { gunzipSync, gzipSync } from 'node:zlib'
import { otherColor, Position, type Color, type Vertex } from '@joseki-dojo/shared'
import { crc32, readVarint, writeVarint, zoneIndex, zoneVertex } from '../jdb'
import { PACKED_KEY_BYTES, packedToMove, packPoints, pathMoves, pathToMove, positionKey, unpackKey, ZONE_POINTS, type ZoneMove } from './key'

export type EdgeCategory = 'ideal' | 'good' | 'bad' | 'trick' | 'question'
/**
 * Spec (progress) 3.2: a zone position with the side to move. `path` is a representative move sequence from the empty
 * corner to the node in its own orientation (the KataGo queries replay it; tenuki is a pass): it reads as `key` without
 * mirroring, and the moves of the node's edges are in the same orientation.
 */
export interface GraphNode {
  key: string
  toMove: Color
  path: ZoneMove[]
  listIds: string[]
}
/**
 * A move from a node. `to` is null when the position after the move is not a node of the graph; a child that is known only
 * by its key (no dictionary expanded it, but another path reached the position) still points to its node. The graph may hold
 * short cycles through tenuki (two tenukis in a row return to the same position), so traversals need a visited set.
 * Sources 0 and 1 are the two dictionaries in a fixed order.
 */
export interface GraphEdge {
  from: number
  to: number | null
  move: ZoneMove
  categories: { source: 0 | 1; category: EdgeCategory }[]
}
/**
 * nodes[0] is the empty corner; the edges are grouped by `from` in node order. Never mutate a decoded graph: it shares its
 * vertices and category lists, and a weights file is matched against the checksum it was read with.
 */
export interface JosekiGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
/**
 * Spec (progress) 3.3: the probabilities by level, [level][edge index] / [level][node index]. The rest of a node is not
 * stored in the file: it is derived, max(0, 1 - the sum of the node's edges), when the weights are decoded.
 */
export interface GraphWeights {
  levels: string[]
  edge: Float32Array[]
  rest: Float32Array[]
}

/** An edge as GraphBook shows it: its vertex and category list are shared between callers and must not be changed. */
export type ReadonlyEdge = Readonly<Omit<GraphEdge, 'categories'> & { categories: readonly Readonly<GraphEdge['categories'][number]>[] }>

export class GraphError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphError'
  }
}

/** The rest of every node: 1 minus the sum of its edge probabilities, not below 0 (spec 3.3). */
function restOf(graph: JosekiGraph, edge: Float32Array): Float32Array {
  const sums = new Float64Array(graph.nodes.length)
  graph.edges.forEach((e, i) => (sums[e.from] += edge[i]))
  return Float32Array.from(sums, (s) => Math.max(0, 1 - s))
}

// Both files: the magic, the version, three zero bytes, the body length and its CRC-32 (the weights file adds the CRC-32
// of its graph's body), then the body compressed with gzip.
const GRAPH_MAGIC = [0x4a, 0x44, 0x47, 0x31] // "JDG1"
const WEIGHTS_MAGIC = [0x4a, 0x44, 0x57, 0x31] // "JDW1"
const VERSION = 1
const GRAPH_HEADER = 16
const WEIGHTS_HEADER = 20
const GRAPH = 'графа вариантов'
const WEIGHTS = 'весов графа вариантов'
const BROKEN_GRAPH = `Файл ${GRAPH} повреждён`
const OTHER_GRAPH = 'Веса посчитаны для другого графа вариантов'

/** A move is one byte: a zone point 0..120 or tenuki. */
const TENUKI = ZONE_POINTS
const VERTICES: Vertex[] = Array.from({ length: ZONE_POINTS }, (_, i) => zoneVertex(i))
/** The move of a move code; the vertices are shared, so never change them. */
export const moveOf = (code: number): ZoneMove => (code === TENUKI ? 'tenuki' : VERTICES[code])
const moveCode = (m: ZoneMove): number | null => (m === 'tenuki' ? TENUKI : zoneIndex(m))
/** The categories of an edge are one byte: three bits per source, 0 = not in that dictionary, else 1 + the category. */
const CATEGORIES: EdgeCategory[] = ['ideal', 'good', 'bad', 'trick', 'question']
const KEY_OFFSET = 2 // `${toMove}:`
const STEPS = 65535

/** The body CRC-32 of each decoded graph: its weights file is checked without encoding the graph again. */
const bodyCrcs = new WeakMap<JosekiGraph, number>()
const graphCrc = (g: JosekiGraph): number => bodyCrcs.get(g) ?? crc32(graphBody(g))
const u32 = (bytes: Uint8Array, at: number): number => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true)

export function encodeGraph(g: JosekiGraph): Uint8Array {
  checkGraph(g)
  return wrap(GRAPH_MAGIC, graphBody(g), null)
}

/**
 * A graph file read into flat arrays, with no object per node or edge: the form GraphBook keeps (decodeGraph builds the
 * objects from it). Node i: its packed key (key.ts) at keys[i * PACKED_KEY_BYTES]; its path, the move codes
 * pathMoves[pathStart[i]] .. pathMoves[pathStart[i + 1] - 1]; its edges, the indices firstEdge[i] .. firstEdge[i + 1] - 1
 * in file order (the indices of the weights file), each with its move code, its target node (-1: none) and its categories
 * byte. A move code is a zone point 0..120 or tenuki (moveOf).
 */
export interface GraphArrays {
  nodeCount: number
  edgeCount: number
  keys: Uint8Array
  pathStart: Uint32Array
  pathMoves: Uint8Array
  firstEdge: Uint32Array
  edgeMove: Uint8Array
  edgeTo: Int32Array
  edgeCategories: Uint8Array
  /** The list ids with their nodes, in file order. */
  lists: { node: number; id: string }[]
  /** The CRC-32 of the graph's body: its weights file names the graph by it. */
  checksum: number
}

export function decodeGraphArrays(bytes: Uint8Array): GraphArrays {
  const r = new Reader(unwrap(bytes, GRAPH_MAGIC, GRAPH_HEADER, GRAPH), BROKEN_GRAPH)
  const nodeCount = r.size()
  const edgeCount = r.size()
  const pathStart = new Uint32Array(nodeCount + 1)
  // Every path move takes a byte of the rest of the body: the paths are copied into a buffer of that size, then trimmed.
  const paths = new Uint8Array(r.left())
  let length = 0
  for (let i = 0; i < nodeCount; i++) {
    const codes = r.moves(r.count())
    paths.set(codes, length)
    length += codes.length
    pathStart[i + 1] = length
  }
  const pathMoves = paths.slice(0, length)
  // The key is the path's stones without the captured points (spec 3.2), read in the path's own orientation.
  const keys = new Uint8Array(nodeCount * PACKED_KEY_BYTES)
  const points = new Uint8Array(ZONE_POINTS)
  for (let i = 0; i < nodeCount; i++) {
    points.fill(0)
    for (let k = pathStart[i]; k < pathStart[i + 1]; k++) {
      const c = pathMoves[k]
      if (c !== TENUKI) points[c] = (k - pathStart[i]) % 2 === 0 ? 1 : 2
    }
    for (const p of r.moves(r.count())) {
      if (p === TENUKI) throw new GraphError(BROKEN_GRAPH)
      points[p] = 0
    }
    packPoints(points, (pathStart[i + 1] - pathStart[i]) % 2 === 0 ? 'B' : 'W', keys, i * PACKED_KEY_BYTES)
  }
  const firstEdge = new Uint32Array(nodeCount + 1)
  let total = 0
  for (let i = 0; i < nodeCount; i++) {
    total += r.count()
    if (total > edgeCount) throw new GraphError(BROKEN_GRAPH)
    firstEdge[i + 1] = total
  }
  if (total !== edgeCount) throw new GraphError(BROKEN_GRAPH)
  // Copies, so that the arrays do not hold the body (the body is a Buffer, whose slice() is a view).
  const edgeMove = new Uint8Array(r.moves(edgeCount))
  const edgeCategories = new Uint8Array(r.take(edgeCount))
  for (const code of new Set(edgeCategories)) categoriesOf(code, BROKEN_GRAPH)
  const edgeTo = new Int32Array(edgeCount)
  for (let e = 0; e < edgeCount; e++) {
    const to = r.count()
    if (to > nodeCount) throw new GraphError(BROKEN_GRAPH)
    edgeTo[e] = to - 1
  }
  const lists = Array.from({ length: r.size() }, () => {
    const node = r.count()
    if (node >= nodeCount) throw new GraphError(BROKEN_GRAPH)
    return { node, id: r.text() }
  })
  r.end()
  return { nodeCount, edgeCount, keys, pathStart, pathMoves, firstEdge, edgeMove, edgeTo, edgeCategories, lists, checksum: u32(bytes, 12) }
}

export function decodeGraph(bytes: Uint8Array): JosekiGraph {
  const a = decodeGraphArrays(bytes)
  const nodes: GraphNode[] = Array.from({ length: a.nodeCount }, (_, i) => ({
    key: unpackKey(a.keys, i * PACKED_KEY_BYTES),
    toMove: packedToMove(a.keys, i * PACKED_KEY_BYTES),
    path: Array.from(a.pathMoves.subarray(a.pathStart[i], a.pathStart[i + 1]), moveOf),
    listIds: [],
  }))
  for (const { node, id } of a.lists) nodes[node].listIds.push(id)
  const lists = new Map<number, GraphEdge['categories']>()
  const edges: GraphEdge[] = []
  for (let from = 0; from < a.nodeCount; from++) {
    for (let e = a.firstEdge[from]; e < a.firstEdge[from + 1]; e++) {
      const code = a.edgeCategories[e]
      let categories = lists.get(code)
      if (!categories) lists.set(code, (categories = categoriesOf(code, BROKEN_GRAPH)))
      edges.push({ from, to: a.edgeTo[e] < 0 ? null : a.edgeTo[e], move: moveOf(a.edgeMove[e]), categories })
    }
  }
  const graph = { nodes, edges }
  bodyCrcs.set(graph, a.checksum)
  return graph
}

/** Spec (progress) 3.3: probabilities quantised to 1/65535; the file names its graph by the CRC-32 of the graph's body. */
export function encodeWeights(w: GraphWeights, graph: JosekiGraph): Uint8Array {
  const levels = w.levels.length
  const edges = graph.edges.length
  const nodes = graph.nodes.length
  if (w.levels.some((l) => l === '') || new Set(w.levels).size !== levels) throw new GraphError('weights: the levels must be named and distinct')
  if (w.edge.length !== levels || w.rest.length !== levels || w.edge.some((a) => a.length !== edges) || w.rest.some((a) => a.length !== nodes)) {
    throw new GraphError(`weights: need one edge array (${edges}) and one rest array (${nodes}) per level`)
  }
  const head: number[] = []
  writeVarint(head, levels)
  for (const level of w.levels) writeText(head, level)
  writeVarint(head, edges)
  writeVarint(head, nodes)
  // Per level: the edge values, each a little-endian uint16. The rests are derived by the decoder, so w.rest is not written.
  const body = new Uint8Array(head.length + 2 * levels * edges)
  body.set(head)
  let k = head.length
  for (let l = 0; l < levels; l++) {
    for (const p of w.edge[l]) {
      if (!(p >= -1e-6 && p <= 1 + 1e-6)) throw new GraphError(`weights: ${p} is not a probability`)
      const q = Math.round(Math.min(1, Math.max(0, p)) * STEPS)
      body[k++] = q & 0xff
      body[k++] = q >> 8
    }
    const rest = restOf(graph, w.edge[l])
    if (rest.some((r, i) => Math.abs(r - w.rest[l][i]) > 1e-3)) throw new GraphError(`weights: the rest at ${w.levels[l]} is not 1 minus the sum of the edges`)
  }
  return wrap(WEIGHTS_MAGIC, body, graphCrc(graph))
}

export function decodeWeights(bytes: Uint8Array, graph: JosekiGraph): GraphWeights {
  const edges = graph.edges.length
  const { levels, values } = weightsBody(bytes, graphCrc(graph), graph.nodes.length, edges)
  const edge = levels.map((_, l) => levelEdges(values, l, edges))
  return { levels, edge, rest: edge.map((e) => restOf(graph, e)) }
}

/** The levels of a weights file checked against `graph` (the checks of decodeWeights), without keeping its values. */
export function weightsLevels(bytes: Uint8Array, graph: GraphArrays): string[] {
  return weightsBody(bytes, graph.checksum, graph.nodeCount, graph.edgeCount).levels
}

/**
 * Level `level` (an index into weightsLevels) of a weights file of `graph`: the edge values and the rest of every node,
 * the same numbers as decodeWeights. The whole body is unpacked again and only this level is kept.
 */
export function decodeWeightsLevel(bytes: Uint8Array, graph: GraphArrays, level: number): { edge: Float32Array; rest: Float32Array } {
  const { levels, values } = weightsBody(bytes, graph.checksum, graph.nodeCount, graph.edgeCount)
  if (!Number.isInteger(level) || level < 0 || level >= levels.length) throw new RangeError(`weights: no level ${level}`)
  const edge = levelEdges(values, level, graph.edgeCount)
  const rest = new Float32Array(graph.nodeCount)
  for (let n = 0; n < graph.nodeCount; n++) {
    let sum = 0
    for (let e = graph.firstEdge[n]; e < graph.firstEdge[n + 1]; e++) sum += edge[e]
    rest[n] = Math.max(0, 1 - sum)
  }
  return { edge, rest }
}

/** The checked body of a weights file for the graph with the body CRC-32 `checksum`: its levels and the values of all of them. */
function weightsBody(bytes: Uint8Array, checksum: number, nodes: number, edges: number): { levels: string[]; values: Uint8Array } {
  const r = new Reader(unwrap(bytes, WEIGHTS_MAGIC, WEIGHTS_HEADER, WEIGHTS), `Файл ${WEIGHTS} повреждён`)
  if (u32(bytes, 16) !== checksum) throw new GraphError(OTHER_GRAPH)
  const levels = Array.from({ length: r.size() }, () => r.text())
  if (r.count() !== edges || r.count() !== nodes) throw new GraphError(OTHER_GRAPH)
  const values = r.take(2 * levels.length * edges)
  r.end()
  return { levels, values }
}

/** The edge values of level `l`: each a little-endian uint16 in steps of 1/65535. */
function levelEdges(values: Uint8Array, l: number, edges: number): Float32Array {
  const out = new Float32Array(edges)
  for (let i = 0, k = 2 * l * edges; i < edges; i++, k += 2) out[i] = (values[k] | (values[k + 1] << 8)) / STEPS
  return out
}

/**
 * The checks that keep the files consistent (the build script's guard): the empty corner first; each node's side to move,
 * key and orientation from its path; distinct keys and list ids; edges grouped by `from`, playable from their node,
 * leading to the node of their target.
 */
function checkGraph(g: JosekiGraph): void {
  if (g.nodes.length === 0 || g.nodes[0].path.length > 0) throw new GraphError('nodes[0] must be the empty corner')
  const keys = new Set<string>()
  const lists = new Set<string>()
  let e = 0
  g.nodes.forEach((n, i) => {
    const at = `node ${i}`
    if (n.path.some((m) => moveCode(m) === null)) throw new GraphError(`${at}: a path move is outside the zone`)
    if (n.toMove !== pathToMove(n.path)) throw new GraphError(`${at}: toMove does not match the path`)
    const position = playOrThrow(at, () => Position.fromMoves(pathMoves(n.path)))
    const own = positionKey(position, n.toMove)
    if (own.key !== n.key) throw new GraphError(`${at}: the key does not match the path`)
    if (own.mirrored) throw new GraphError(`${at}: the path reads mirrored; give it, and the moves of the node's edges, in the orientation of the key`)
    if (keys.has(n.key)) throw new GraphError(`${at}: the key of another node`)
    keys.add(n.key)
    for (const id of n.listIds) {
      if (lists.has(id)) throw new GraphError(`${at}: list id ${id} is on another node`)
      lists.add(id)
    }
    const moves = new Set<number>()
    for (; e < g.edges.length && g.edges[e].from === i; e++) {
      const edge = g.edges[e]
      const where = `edge ${e}`
      const code = moveCode(edge.move)
      if (code === null) throw new GraphError(`${where}: the move is outside the zone`)
      if (moves.has(code)) throw new GraphError(`${where}: the move is already an edge of node ${i}`)
      moves.add(code)
      if (edge.categories.length === 0) throw new GraphError(`${where}: the edge has no categories`)
      categoriesCode(edge.categories, where)
      const next = playOrThrow(where, () => position.play({ color: n.toMove, vertex: edge.move === 'tenuki' ? 'pass' : edge.move }))
      if (edge.to === null) continue
      const target = g.nodes[edge.to]
      if (!target || positionKey(next, otherColor(n.toMove)).key !== target.key) throw new GraphError(`${where}: the move does not lead to node ${edge.to}`)
    }
  })
  if (e < g.edges.length) throw new GraphError(`edge ${e}: the edges must be grouped by from, in node order`)
}

function playOrThrow(at: string, play: () => Position): Position {
  try {
    return play()
  } catch (err) {
    throw new GraphError(`${at}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** The uncompressed graph file body, column by column; its CRC-32 ties a weights file to the graph. */
function graphBody(g: JosekiGraph): Uint8Array {
  const out: number[] = []
  writeVarint(out, g.nodes.length)
  writeVarint(out, g.edges.length)
  for (const n of g.nodes) {
    writeVarint(out, n.path.length)
    for (const m of n.path) out.push(moveCode(m)!)
  }
  // The points played on the path that the key has empty: the captured stones.
  for (const n of g.nodes) {
    const played = new Set(n.path.flatMap((m) => (m === 'tenuki' ? [] : [zoneIndex(m)!])))
    const captured = [...played].filter((p) => n.key[KEY_OFFSET + p] === '0').sort((a, b) => a - b)
    writeVarint(out, captured.length)
    out.push(...captured)
  }
  const counts = new Array<number>(g.nodes.length).fill(0)
  for (const e of g.edges) counts[e.from]++
  for (const c of counts) writeVarint(out, c)
  for (const e of g.edges) out.push(moveCode(e.move)!)
  g.edges.forEach((e, i) => out.push(categoriesCode(e.categories, `edge ${i}`)))
  for (const e of g.edges) writeVarint(out, e.to === null ? 0 : e.to + 1)
  const lists = g.nodes.flatMap((n, i) => n.listIds.map((id) => [i, id] as const))
  writeVarint(out, lists.length)
  for (const [i, id] of lists) {
    writeVarint(out, i)
    writeText(out, id)
  }
  return Uint8Array.from(out)
}

function categoriesCode(categories: GraphEdge['categories'], at: string): number {
  let code = 0
  let last = -1
  for (const { source, category } of categories) {
    const k = CATEGORIES.indexOf(category)
    if ((source !== 0 && source !== 1) || source <= last || k < 0) throw new GraphError(`${at}: the categories must be known, one per source, in source order`)
    code |= (k + 1) << (3 * source)
    last = source
  }
  return code
}

const CATEGORY_LISTS = new Map<number, ReadonlyEdge['categories']>()

/** The categories of a categories byte that decodeGraphArrays accepted: one list per byte shared by every caller, so never change it. */
export function categoryList(code: number): ReadonlyEdge['categories'] {
  let list = CATEGORY_LISTS.get(code)
  if (!list) CATEGORY_LISTS.set(code, (list = categoriesOf(code, BROKEN_GRAPH)))
  return list
}

function categoriesOf(code: number, broken: string): GraphEdge['categories'] {
  const out: GraphEdge['categories'] = []
  for (const source of [0, 1] as const) {
    const k = (code >> (3 * source)) & 7
    if (k > CATEGORIES.length) throw new GraphError(broken)
    if (k > 0) out.push({ source, category: CATEGORIES[k - 1] })
  }
  if (code >> 6) throw new GraphError(broken)
  return out
}

const utf8 = new TextEncoder()
const utf8Text = new TextDecoder()

function writeText(out: number[], text: string): void {
  const bytes = utf8.encode(text)
  writeVarint(out, bytes.length)
  out.push(...bytes)
}

function wrap(magic: readonly number[], body: Uint8Array, graphChecksum: number | null): Uint8Array {
  const header = graphChecksum === null ? GRAPH_HEADER : WEIGHTS_HEADER
  const packed = gzipSync(body, { level: 9 })
  const out = new Uint8Array(header + packed.length)
  out.set(magic)
  out[4] = VERSION
  const view = new DataView(out.buffer)
  view.setUint32(8, body.length, true)
  view.setUint32(12, crc32(body), true)
  if (graphChecksum !== null) view.setUint32(16, graphChecksum, true)
  out.set(packed, header)
  return out
}

function unwrap(bytes: Uint8Array, magic: readonly number[], header: number, what: string): Uint8Array {
  if (bytes.length < header || magic.some((b, i) => bytes[i] !== b)) throw new GraphError(`Это не файл ${what}`)
  if (bytes[4] !== VERSION) throw new GraphError(`Неизвестная версия файла ${what}: ${bytes[4]}`)
  const length = u32(bytes, 8)
  let body: Uint8Array
  try {
    body = gunzipSync(bytes.subarray(header), { maxOutputLength: Math.max(1, length) })
  } catch {
    throw new GraphError(`Файл ${what} повреждён`)
  }
  if ((bytes[5] | bytes[6] | bytes[7]) !== 0 || body.length !== length || crc32(body) !== u32(bytes, 12)) throw new GraphError(`Файл ${what} повреждён`)
  return body
}

/** Reads a checked body; anything out of place is the `broken` error. */
class Reader {
  private pos = 0
  constructor(
    private readonly bytes: Uint8Array,
    private readonly broken: string,
  ) {}

  count(): number {
    const [value, next] = readVarint(this.bytes, this.pos)
    this.pos = next
    return value
  }
  /** The bytes not read yet. */
  left(): number {
    return this.bytes.length - this.pos
  }
  /** A count of items that each take at least a byte of the rest. */
  size(): number {
    const n = this.count()
    if (n > this.bytes.length - this.pos) throw new GraphError(this.broken)
    return n
  }
  take(n: number): Uint8Array {
    if (n > this.bytes.length - this.pos) throw new GraphError(this.broken)
    this.pos += n
    return this.bytes.subarray(this.pos - n, this.pos)
  }
  moves(n: number): Uint8Array {
    const codes = this.take(n)
    if (codes.some((c) => c > TENUKI)) throw new GraphError(this.broken)
    return codes
  }
  text(): string {
    return utf8Text.decode(this.take(this.count()))
  }
  end(): void {
    if (this.pos !== this.bytes.length) throw new GraphError(this.broken)
  }
}
