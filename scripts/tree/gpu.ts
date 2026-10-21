import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EngineError } from '../../packages/server/src/engine/engine'
import { decodeGraph } from '../../packages/server/src/graph/format'
import { withHumanNet } from '../gpu-run'
import { gitProblem, GRAPH_FILE, parseTreeOptions, runWeighing, treeEngineOverrides } from './weigh-steps'

const root = fileURLToPath(new URL('../../', import.meta.url))
const log = (line: string): void => console.log(line)

/** Spec (progress) 3.3: `npm run tree:gpu` — the checks and the graph first, then the move probabilities with the owner's KataGo. */
async function main(): Promise<void> {
  const { threads } = parseTreeOptions(process.argv.slice(2))
  const problem = gitProblem(root)
  if (problem) throw new Error(problem)
  const graphFile = join(root, GRAPH_FILE)
  if (!existsSync(graphFile)) throw new Error(`No ${GRAPH_FILE}: switch to a branch with the joseki graph`)
  const graph = decodeGraph(readFileSync(graphFile))
  await withHumanNet(root, log, (engine, engineInfo) => runWeighing({ root, engine, graph, engineInfo, log }), treeEngineOverrides(threads))
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  if (err instanceof EngineError && err.code === 'engine_failed') {
    console.error('If KataGo runs on the CPU or keeps failing, run npm run setup again and pick a GPU build.')
  }
  process.exit(1)
})
