import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism, totalmem } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainThread, parentPort, Worker } from 'node:worker_threads'
import { GraphBook } from '../../packages/server/src/graph/book'
import { parseSimOptions, pool, report, scenarioName, SEEDS_PER_SCENARIO, simulate, WORKER_BYTES, type Scenario, type SimResult } from './sim-steps'

const root = fileURLToPath(new URL('../../', import.meta.url))
const GRAPH_FILE = join(root, 'packages/server/bases/joseki-graph.bin')
const WEIGHTS_FILE = join(root, 'packages/server/bases/joseki-weights.bin')

interface Job {
  index: number
  /** The index of the scenario the run belongs to among the options' scenarios. */
  group: number
  scenario: Scenario
  seed: number
}

interface Done {
  index: number
  result: SimResult
  ms: number
}

const load = (): GraphBook => GraphBook.load(readFileSync(GRAPH_FILE), readFileSync(WEIGHTS_FILE))

/** A worker thread: the graph and weights loaded once, then one run per job. */
function serve(): void {
  const graph = load()
  parentPort!.on('message', (job: Job) => {
    const started = Date.now()
    const result = simulate(graph, job.scenario, job.seed)
    parentPort!.postMessage({ index: job.index, result, ms: Date.now() - started } satisfies Done)
  })
}

const minutes = (ms: number): string => `${(ms / 60_000).toFixed(1)} min`

/**
 * Part 3 spec 8: `npm run trainer:sim` — every scenario of the options with the natural bot and SEEDS_PER_SCENARIO seeds
 * (the same for every scenario), on worker threads (the longest scenarios first); a line per finished run, then the report
 * of the pooled scenarios at the checkpoint days on stdout and in the --out file. Nothing else is written.
 */
async function main(): Promise<void> {
  const opts = parseSimOptions(process.argv.slice(2), availableParallelism(), totalmem())
  if (!existsSync(WEIGHTS_FILE)) {
    throw new Error('No packages/server/bases/joseki-weights.bin: the move probabilities come from npm run tree:gpu on the GPU machine (docs/gpu-calibration.md).')
  }
  const graph = load()
  for (const s of opts.scenarios) if (!graph.hasLevel(s.level)) throw new Error(`The weights have no level ${s.level}`)
  const seeds = Array.from({ length: SEEDS_PER_SCENARIO }, (_, k) => opts.seed + k)
  const jobs: Job[] = opts.scenarios.flatMap((scenario, group) => seeds.map((seed) => ({ group, scenario, seed }))).map((job, index) => ({ index, ...job }))
  const cost = (j: Job): number => j.scenario.perDay * j.scenario.days
  const queue = [...jobs].sort((a, b) => cost(b) - cost(a))
  const threads = Math.min(opts.jobs, jobs.length)
  const scenarios = opts.scenarios.length === 1 ? '1 scenario' : `${opts.scenarios.length} scenarios`
  console.log(
    `${jobs.length} runs on ${threads} threads, peak memory about ${((threads * WORKER_BYTES) / 2 ** 30).toFixed(1)} GB: ${scenarios} × seeds ${seeds[0]}–${seeds.at(-1)}; the report at days ${opts.checkpoints.join(', ')}`,
  )

  const results = new Array<SimResult>(jobs.length)
  const started = Date.now()
  let done = 0
  await new Promise<void>((resolve, reject) => {
    for (let t = 0; t < threads; t++) {
      const worker = new Worker(new URL(import.meta.url))
      const feed = (): void => {
        const job = queue.shift()
        if (job) worker.postMessage(job)
        else void worker.terminate()
      }
      worker.on('message', ({ index, result, ms }: Done) => {
        results[index] = result
        done++
        const last = (curve: number[]): number => curve.at(-1) ?? 0
        console.log(
          `[${done}/${jobs.length}] ${scenarioName(result.scenario)}, seed ${jobs[index].seed}: coverage ${(100 * last(result.coverage)).toFixed(1)} %, seen ${last(result.seen)} (${result.seenByReach.map(last).join('/')} by reach), mastered ${last(result.mastered).toFixed(1)}, queue top ${(100 * result.queueTop).toFixed(1)} %, ${minutes(ms)} (${minutes(Date.now() - started)} in all)`,
        )
        if (done === jobs.length) resolve()
        feed()
      })
      worker.on('error', reject)
      feed()
    }
  })
  const pooled = opts.scenarios.map((_, group) => pool(jobs.filter((j) => j.group === group).map((j) => results[j.index])))
  const text = report(pooled, opts.checkpoints)
  console.log(`\n${text}`)
  if (opts.out) writeFileSync(opts.out, `${text}\n`)
}

if (isMainThread) {
  main().catch((err: unknown) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
} else serve()
