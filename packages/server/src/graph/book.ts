import type { Color, Corner, Move } from '@joseki-dojo/shared'
import { categoryList, decodeGraphArrays, decodeWeightsLevel, moveOf, weightsLevels, type GraphArrays, type ReadonlyEdge } from './format'
import { PACKED_KEY_BYTES, packedToMove, packKey, trainingKey, unpackKey, type ZoneMove } from './key'

const KEY_WORDS = PACKED_KEY_BYTES / 4

/**
 * The node of each packed key: open addressing with linear probing over a power-of-two table at most half full; a slot
 * holds the node + 1, 0 when it is free. The keys are read as 32-bit words, so `keys` starts on a multiple of 4 bytes.
 */
class KeyIndex {
  private readonly words: Uint32Array
  private readonly slots: Uint32Array
  private readonly mask: number
  private readonly probe = new Uint8Array(PACKED_KEY_BYTES)
  private readonly probeWords = new Uint32Array(this.probe.buffer)

  constructor(keys: Uint8Array, count: number) {
    this.words = new Uint32Array(keys.buffer, keys.byteOffset, count * KEY_WORDS)
    let size = 2
    while (size < 2 * count) size *= 2
    this.slots = new Uint32Array(size)
    this.mask = size - 1
    // A repeated key (the build script never writes one) leads to its last node, as a Map would.
    for (let node = 0; node < count; node++) this.slots[this.slotOf(this.words, node * KEY_WORDS)] = node + 1
  }

  /** The node of a key string, or null. */
  find(key: string): number | null {
    if (!packKey(key, this.probe, 0)) return null
    const node = this.slots[this.slotOf(this.probeWords, 0)]
    return node === 0 ? null : node - 1
  }

  /** The slot of the key at words[at]: the one that holds it, or the free slot that ends its probe sequence. */
  private slotOf(words: Uint32Array, at: number): number {
    let h = 0x9e3779b9
    for (let k = 0; k < KEY_WORDS; k++) {
      h = Math.imul(h ^ words[at + k], 0x85ebca6b)
      h ^= h >>> 13
    }
    h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35)
    let slot = (h ^ (h >>> 16)) & this.mask
    for (;;) {
      const node = this.slots[slot]
      if (node === 0 || this.same(words, at, (node - 1) * KEY_WORDS)) return slot
      slot = (slot + 1) & this.mask
    }
  }

  private same(words: Uint32Array, at: number, other: number): boolean {
    for (let k = 0; k < KEY_WORDS; k++) if (words[at + k] !== this.words[other + k]) return false
    return true
  }
}

/** The list ids of the start list, both ways. */
interface ListIndex {
  nodeOf: Map<string, number>
  idsOf: Map<number, string[]>
}

function indexLists(graph: GraphArrays): ListIndex {
  const nodeOf = new Map<string, number>()
  const idsOf = new Map<number, string[]>()
  for (const { node, id } of graph.lists) {
    nodeOf.set(id, node)
    const ids = idsOf.get(node)
    if (ids) ids.push(id)
    else idsOf.set(node, [id])
  }
  return { nodeOf, idsOf }
}

/** The weights file, kept as it was read (compressed), and the one level decoded from it last. */
class Weights {
  private level: { index: number; edge: Float32Array; rest: Float32Array } | null = null

  constructor(
    private readonly bytes: Uint8Array,
    private readonly graph: GraphArrays,
    readonly levels: Map<string, number>,
  ) {}

  /** Level `index`: decoded on its first use, it replaces the level decoded before. */
  at(index: number): { edge: Float32Array; rest: Float32Array } {
    if (this.level?.index !== index) {
      this.level = null // the old level goes before the new one is decoded
      this.level = { index, ...decodeWeightsLevel(this.bytes, this.graph, index) }
    }
    return this.level
  }
}

const NO_LIST_IDS: readonly string[] = []

/**
 * Spec (progress) 3.4: the joseki graph and its move probabilities by level, for the progress and the trainer.
 *
 * The graph is kept in flat typed arrays (no object per node or edge): node i is the index of the files, 0 the empty
 * corner; the edges are numbered globally in node order, node i owning firstEdge(i) .. firstEdge(i + 1) - 1 (the indices
 * of the weights file; edges(i)[k] is edge firstEdge(i) + k, and probabilities(i, level).edges[k] belongs to it). Keys and
 * paths are decoded on request. Of the weights, the file's bytes are kept and one level is decoded at a time: the level
 * asked for last.
 *
 * Index arguments: node(), nodeOfTraining(), listNode() return null and edges() / probabilities() return nothing for
 * what is not in the graph; the node accessors (nodeKey … firstEdge) take an index of the graph and throw a RangeError
 * for anything else.
 */
export class GraphBook {
  readonly hasWeights: boolean

  private constructor(
    private readonly g: GraphArrays,
    private readonly keys: KeyIndex,
    private readonly lists: ListIndex,
    private readonly weights: Weights | null,
  ) {
    this.hasWeights = weights !== null
  }

  static empty(): GraphBook {
    const empty = new Uint8Array(0)
    const g: GraphArrays = {
      nodeCount: 0,
      edgeCount: 0,
      keys: empty,
      pathStart: new Uint32Array(1),
      pathMoves: empty,
      firstEdge: new Uint32Array(1),
      edgeMove: empty,
      edgeTo: new Int32Array(0),
      edgeCategories: empty,
      lists: [],
      checksum: 0,
    }
    return new GraphBook(g, new KeyIndex(g.keys, 0), indexLists(g), null)
  }

  /** Throws a GraphError for a damaged file or for the weights of another graph. */
  static load(graphBytes: Uint8Array, weightsBytes: Uint8Array | null): GraphBook {
    const g = decodeGraphArrays(graphBytes)
    const book = new GraphBook(g, new KeyIndex(g.keys, g.nodeCount), indexLists(g), null)
    return weightsBytes ? book.withWeights(weightsBytes) : book
  }

  /**
   * The same graph with the weights file `bytes`; throws a GraphError for a damaged file or the weights of another graph.
   * The book keeps `bytes` to decode a level when it is asked for, so they must not change afterwards.
   */
  withWeights(bytes: Uint8Array): GraphBook {
    const levels = new Map(weightsLevels(bytes, this.g).map((level, i) => [level, i]))
    return new GraphBook(this.g, this.keys, this.lists, new Weights(bytes, this.g, levels))
  }

  get nodeCount(): number {
    return this.g.nodeCount
  }

  get edgeCount(): number {
    return this.g.edgeCount
  }

  node(key: string): number | null {
    return this.keys.find(key)
  }

  /**
   * The node of a training position, or null outside the graph. `mirrored`: the training moves, seen in the top-right
   * corner, are the mirror of the node's orientation (its path and the moves of its edges).
   */
  nodeOfTraining(moves: readonly Move[], corner: Corner, toMove: Color): { node: number; mirrored: boolean } | null {
    if (this.g.nodeCount === 0) return null
    const { key, mirrored } = trainingKey(moves, corner, toMove)
    const node = this.keys.find(key)
    return node === null ? null : { node, mirrored }
  }

  listNode(listId: string): number | null {
    return this.lists.nodeOf.get(listId) ?? null
  }

  /** The position key of a node (spec 3.2), built on each call. */
  nodeKey(node: number): string {
    return unpackKey(this.g.keys, this.checked(node) * PACKED_KEY_BYTES)
  }

  nodeToMove(node: number): Color {
    return packedToMove(this.g.keys, this.checked(node) * PACKED_KEY_BYTES)
  }

  /** The representative path of a node (see GraphNode), a new array on each call; its vertices are shared, so never change them. */
  nodePath(node: number): readonly ZoneMove[] {
    const { pathStart, pathMoves } = this.g
    const i = this.checked(node)
    return Array.from(pathMoves.subarray(pathStart[i], pathStart[i + 1]), moveOf)
  }

  /** The start list ids at a node, in file order. */
  nodeListIds(node: number): readonly string[] {
    return this.lists.idsOf.get(this.checked(node)) ?? NO_LIST_IDS
  }

  /** The global index of a node's first edge; firstEdge(nodeCount) is edgeCount, so node i owns firstEdge(i) .. firstEdge(i + 1) - 1. */
  firstEdge(node: number): number {
    if (node === this.g.nodeCount) return this.g.edgeCount
    return this.g.firstEdge[this.checked(node)]
  }

  /**
   * The edges of a node in file order, built on each call; none for an index outside the graph. The moves are in the
   * node's orientation; the vertices and the category lists are shared, so never change them.
   */
  edges(node: number): readonly ReadonlyEdge[] {
    if (!this.inRange(node)) return []
    const { firstEdge, edgeMove, edgeTo, edgeCategories } = this.g
    const out: ReadonlyEdge[] = []
    for (let e = firstEdge[node]; e < firstEdge[node + 1]; e++) {
      out.push({ from: node, to: edgeTo[e] < 0 ? null : edgeTo[e], move: moveOf(edgeMove[e]), categories: categoryList(edgeCategories[e]) })
    }
    return out
  }

  /**
   * Spec 3.3: the probabilities of a node's edges (in the order of edges()) and of its rest at a level; null without
   * weights, for an unknown level or for a node outside the graph. Asking for another level than the last one decodes it
   * from the weights file and drops the last one.
   */
  probabilities(node: number, level: string): { edges: number[]; rest: number } | null {
    const l = this.weights?.levels.get(level)
    if (!this.weights || l === undefined || !this.inRange(node)) return null
    const { edge, rest } = this.weights.at(l)
    const { firstEdge } = this.g
    return { edges: Array.from(edge.subarray(firstEdge[node], firstEdge[node + 1])), rest: rest[node] }
  }

  private inRange(node: number): boolean {
    return Number.isInteger(node) && node >= 0 && node < this.g.nodeCount
  }

  private checked(node: number): number {
    if (!this.inRange(node)) throw new RangeError(`No node ${node} in the joseki graph`)
    return node
  }
}
