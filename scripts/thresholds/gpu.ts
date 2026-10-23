import { fileURLToPath } from 'node:url'
import { EngineError } from '../../packages/server/src/engine/engine'
import { withHumanNet } from '../gpu-run'
import { gitProblem, parseCalibrateOptions, prepareCalibration, runCalibration } from './calibrate-steps'

const root = fileURLToPath(new URL('../../', import.meta.url))
let visits: number | undefined
const log = (line: string): void => console.log(line)

/** Spec (repetition) 3.3, (resume) 3: `npm run thresholds:gpu` — the checks and the save first, then the calibration with the owner's KataGo. */
async function main(): Promise<void> {
  const opts = parseCalibrateOptions(process.argv.slice(2))
  visits = opts.visits
  const problem = gitProblem(root)
  if (problem) throw new Error(problem)
  const prepared = prepareCalibration(root, opts, log)
  await withHumanNet(root, log, (engine, engineInfo) => runCalibration({ root, engine, opts, engineInfo, log, prepared }))
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  if (err instanceof EngineError && err.code === 'engine_failed') {
    console.error(`If KataGo runs on the CPU or is too slow for --visits ${visits}, run npm run setup again and pick a GPU build, or lower --visits (with --restart when positions are saved).`)
  }
  process.exit(1)
})
