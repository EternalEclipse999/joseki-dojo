import { fileURLToPath } from 'node:url'
import { EngineError } from '../../packages/server/src/engine/engine'
import { withHumanNet } from '../gpu-run'
import { gitProblem, parseCalibrateOptions, runCalibration } from './calibrate-steps'

const root = fileURLToPath(new URL('../../', import.meta.url))
let visits: number | undefined
const log = (line: string): void => console.log(line)

/** Spec (repetition) 3.3: `npm run thresholds:gpu` — the checks first, then the calibration with the owner's KataGo. */
async function main(): Promise<void> {
  const opts = parseCalibrateOptions(process.argv.slice(2))
  visits = opts.visits
  const problem = gitProblem(root)
  if (problem) throw new Error(problem)
  await withHumanNet(root, log, (engine, engineInfo) => runCalibration({ root, engine, opts, engineInfo, log }))
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  if (err instanceof EngineError && err.code === 'engine_failed') {
    console.error(`If KataGo runs on the CPU or is too slow for --visits ${visits}, lower --visits or run npm run setup again and pick a GPU build.`)
  }
  process.exit(1)
})
