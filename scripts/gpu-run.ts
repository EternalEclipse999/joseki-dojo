import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { humanProfile, localize } from '@joseki-dojo/shared'
import { loadConfig } from '../packages/server/src/config'
import { engineCommand } from '../packages/server/src/engine/command'
import { KataGoEngine, type AnalysisEngine, type EngineCommand } from '../packages/server/src/engine/engine'
import { checkEngine } from '../packages/server/src/engine/health'
import { baseQuery } from '../packages/server/src/engine/query'
import { renameRetrying } from '../packages/server/src/install/download'

// What the GPU runs on the owner's machine share (`thresholds:gpu`, `tree:gpu`): the checks before the work, the engine
// of `config.local.json` answering with the human net, and the result file written and committed alone.

const git = (root: string, args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const fileChanges = (root: string, files: readonly string[]): string => git(root, ['status', '--porcelain', '--', ...files])

/**
 * Spec (repetition) 3.3: why a run could not commit its result `file` here, or null; `runBranch` is the branch it suggests for the result.
 * `inputs` are files the run reads and the result depends on: they must be committed too (not changed, not untracked).
 */
export function resultGitProblem(root: string, file: string, runBranch: string, inputs: readonly string[] = []): string | null {
  let branch: string
  try {
    branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])
  } catch (err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? '').trim()
    const detail = stderr !== '' ? `\ngit says: ${stderr}` : ''
    return `Not on a branch (a detached HEAD or not a git repository): switch to the pull request branch or create a branch for the result (e.g. git switch -c ${runBranch})${detail}`
  }
  if (branch === 'main') return `You are on main: switch to the pull request branch or create a branch for the result (e.g. git switch -c ${runBranch})`
  const files = [file, ...inputs]
  const changed = fileChanges(root, files)
  if (changed !== '') return `Uncommitted changes in ${files.join(', ')}:\n${changed}\nCommit, restore or delete it first`
  return null
}

/** Spec (repetition) 3.3: commits only `file` (new or changed) with the repository's configured identity; false when it did not change. */
export function commitResult(root: string, file: string, subject: string, body: string): boolean {
  if (fileChanges(root, [file]) === '') return false
  // A path commit only takes files git knows: the first run creates the file.
  git(root, ['add', '--', file])
  git(root, ['commit', '-q', '-m', subject, '-m', body, '--', file])
  return true
}

/** Writes `data` to `file` through a temporary file, then commits it (commitResult); a failure says how to commit or discard what may be written. */
export async function saveResult(root: string, file: string, data: string | Uint8Array, subject: string, body: string): Promise<boolean> {
  const path = join(root, file)
  const tmp = `${path}.tmp`
  try {
    try {
      writeFileSync(tmp, data)
      await renameRetrying(tmp, path)
    } finally {
      rmSync(tmp, { force: true })
    }
    return commitResult(root, file, subject, body)
  } catch (err) {
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0]
    throw new Error(`The result may already be written to ${file}. Commit it with: git add -- ${file} && git commit -- ${file} or discard it with: git restore --staged --worktree -- ${file} (for a newly added file: git rm --cached -- ${file}, then delete the file)\n${first}`)
  }
}

type Overrides = Readonly<Record<string, string | number | boolean>>

/** The overrides as KataGo's `KEY=VALUE` pairs: joined by commas they are the argument of `-override-config` and the log line. */
export const overridePairs = (overrides: Overrides): string[] => Object.entries(overrides).map(([key, value]) => `${key}=${value}`)

/** The engine command with KataGo's `-override-config KEY=VALUE,...` for this run only (the config files stay as they are). */
export function withConfigOverrides(command: EngineCommand, overrides: Overrides): EngineCommand {
  const pairs = overridePairs(overrides)
  return pairs.length === 0 ? command : { ...command, args: [...command.args, '-override-config', pairs.join(',')] }
}

/**
 * Starts the engine of `config.local.json`, checks that it is ready and answers with the human net (the pro profile),
 * logs the KataGo version and networks, runs `run` with them and stops the engine.
 */
export async function withHumanNet<T>(root: string, log: (line: string) => void, run: (engine: AnalysisEngine, engineInfo: string) => Promise<T>, overrides: Overrides = {}): Promise<T> {
  const configFile = join(root, 'config.local.json')
  if (!existsSync(configFile)) throw new Error(`No ${configFile}: run npm run setup first`)
  const config = loadConfig(configFile)
  const command = withConfigOverrides(engineCommand(config), overrides)
  const pairs = overridePairs(overrides)
  if (pairs.length > 0) log(`KataGo config overrides for this run: ${pairs.join(',')}`)
  const engine = new KataGoEngine(command, (line) => log(`  [katago] ${line}`))
  try {
    const health = await checkEngine(config, engine)
    if (health.state !== 'ready') throw new Error(`KataGo is not ready: ${health.reason ? localize('en', health.reason) : health.state}`)
    const pro = humanProfile('pro')
    const probe = await engine.analyze({ ...baseQuery([]), maxVisits: 1, includePolicy: true, overrideSettings: { humanSLProfile: pro } })
    if (!probe.humanPolicy) throw new Error(`KataGo has no pro profile (${pro})`)
    const engineInfo = `KataGo ${await engine.version()}; networks: ${basename(config.katago.mainModel)}, ${basename(config.katago.humanModel)}`
    log(engineInfo)
    return await run(engine, engineInfo)
  } finally {
    await engine.stop()
  }
}
