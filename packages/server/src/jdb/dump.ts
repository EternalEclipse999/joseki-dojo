import { moveText, trapId, type CanonicalMove } from './canonical'
import type { JdbBase } from './format'

/** Text dump: a header line, then one line per node, indented by depth. */
export function dumpText(base: JdbBase): string {
  const counts = base.kind === 'starts' ? `starts: ${base.nodesOf('start').length}, dubious: ${base.nodesOf('dubious').length}` : `traps: ${base.nodesOf('trap').length}`
  const lines = [`${base.kind}, verified: ${base.verified ? 'yes' : 'no'}, nodes: ${base.size}, ${counts}`]
  const walk = (i: number, depth: number): void => {
    const cat = base.category(i)
    const loss = base.loss(i)
    let line = `${'  '.repeat(depth)}${moveText(base.move(i))}`
    if (cat !== 'none') line += ` [${cat}]`
    if (loss !== null) line += ` loss ${loss}`
    if (cat === 'trap' || cat === 'start' || cat === 'dubious') line += ` ${trapId(base.path(i))}`
    lines.push(line)
    for (const c of base.children(i)) walk(c, depth + 1)
  }
  for (const r of base.roots()) walk(r, 0)
  return lines.join('\n')
}

const sgfCoord = (m: CanonicalMove): string => (m === 'tenuki' ? '' : String.fromCharCode(97 + m[0], 97 + m[1]))

/** SGF dump: one 19x19 game tree from the empty board, Black first; a tenuki is a pass. */
export function dumpSgf(base: JdbBase): string {
  const node = (i: number, depth: number): string => {
    const cat = base.category(i)
    const loss = base.loss(i)
    let s = `;${depth % 2 === 0 ? 'B' : 'W'}[${sgfCoord(base.move(i))}]`
    if (cat === 'trap' || cat === 'caught') s += 'BM[1]'
    if (cat === 'good') s += 'TE[1]'
    if (loss !== null) s += `C[loss ${loss}]`
    return s
  }
  const sequence = (i: number, depth: number): string => {
    let s = node(i, depth)
    const kids = base.children(i)
    if (kids.length === 1) s += sequence(kids[0], depth + 1)
    else for (const k of kids) s += `(${sequence(k, depth + 1)})`
    return s
  }
  const roots = base.roots()
  const head = '(;GM[1]FF[4]SZ[19]'
  if (roots.length === 0) return `${head})\n`
  if (roots.length === 1) return `${head}${sequence(roots[0], 0)})\n`
  return `${head}${roots.map((r) => `(${sequence(r, 0)})`).join('')})\n`
}
