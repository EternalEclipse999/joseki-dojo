import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gtpToVertex, vertexToIndex, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { EngineError } from '../../packages/server/src/engine/engine'
import { decodeJdb, encodeJdb, trapId, type CanonicalMove, type JdbNode, type JdbTree } from '../../packages/server/src/jdb'
import { testTrapsTree } from '../../packages/server/src/traps/fixture'
import { StubEngine } from '../../packages/server/test/helpers'
import { CANDIDATES_FILE, commitBases, gitProblem, parseGpuOptions, runGpu, TRAPS_FILE } from './gpu-steps'

// The git calls must not depend on the developer's own git config (a global commit.gpgsign would hang the commits).
const CONFIG_DIR = mkdtempSync(join(tmpdir(), 'joseki-gitcfg-'))
writeFileSync(join(CONFIG_DIR, 'gitconfig'), '')
process.env.GIT_CONFIG_GLOBAL = join(CONFIG_DIR, 'gitconfig')
process.env.GIT_CONFIG_NOSYSTEM = '1'

const AUTHOR = { name: 'Base Author', email: '1+author@users.noreply.github.com' }
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const mv = (gtp: string): CanonicalMove => gtpToVertex(gtp) as Vertex
const n = (gtp: string, category: JdbNode['category'], children: JdbNode[] = []): JdbNode => ({ move: mv(gtp), category, loss: null, children })
/** One candidate: Q16 O17 R14 R13 (Black answers) with the good answer Q13. */
const CANDIDATES: JdbTree = {
  kind: 'traps',
  verified: false,
  roots: [n('Q16', 'none', [n('O17', 'none', [n('R14', 'none', [n('R13', 'trap', [n('Q13', 'good')])])])])],
}

/** A repository on branch feat/x with both base files and other.txt committed by AUTHOR. */
function repo(candidates: JdbTree = CANDIDATES): string {
  const root = mkdtempSync(join(tmpdir(), 'joseki-gpu-'))
  git(root, 'init', '-q')
  git(root, 'checkout', '-q', '-b', 'feat/x')
  const write = (file: string, tree: JdbTree): void => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), encodeJdb(tree))
  }
  write(TRAPS_FILE, { ...testTrapsTree(), verified: false })
  write(CANDIDATES_FILE, candidates)
  writeFileSync(join(root, 'other.txt'), 'x')
  git(root, 'add', '-A')
  git(root, '-c', `user.name=${AUTHOR.name}`, '-c', `user.email=${AUTHOR.email}`, 'commit', '-q', '-m', 'init')
  return root
}

describe('parseGpuOptions', () => {
  it('has the spec defaults', () => {
    expect(parseGpuOptions([])).toEqual({ visits: 8000, goodMax: 1, caughtGap: 2, ranks: ['20k', '15k', '10k', '5k', '3k', '1k'], natural: 0.1 })
  })

  it('reads every option', () => {
    const args = ['--visits', '5000', '--good-max', '0.5', '--caught-gap', '3', '--ranks', '15k, 5k,1d,15k', '--natural', '0.2']
    expect(parseGpuOptions(args)).toEqual({ visits: 5000, goodMax: 0.5, caughtGap: 3, ranks: ['15k', '5k', '1d'], natural: 0.2 })
  })

  it.each([
    [['--visits', '0'], /--visits needs an integer of at least 1/],
    [['--visits', '1.5'], /--visits needs an integer of at least 1/],
    [['--good-max', '-1'], /--good-max needs a non-negative number/],
    [['--caught-gap', 'x'], /--caught-gap needs a number/],
    [['--natural', '0'], /--natural needs a number above 0 and at most 1/],
    [['--natural', '1.5'], /--natural needs a number above 0 and at most 1/],
    [['--ranks', '25k'], /unknown rank "25k"/],
    [['--ranks', ''], /--ranks needs a value/],
    [['--visits'], /--visits needs a value/],
    [['--fast', '1'], /Unknown option --fast/],
  ])('rejects %j', (args, error) => {
    expect(() => parseGpuOptions(args)).toThrow(error)
  })
})

describe('gitProblem', () => {
  it('accepts a clean pull request branch, even with other changes in the tree', () => {
    const root = repo()
    writeFileSync(join(root, 'other.txt'), 'changed')
    expect(gitProblem(root)).toBeNull()
  })

  it('refuses main', () => {
    const root = repo()
    git(root, 'checkout', '-q', '-b', 'main')
    expect(gitProblem(root)).toMatch(/on main/)
  })

  it('refuses a detached HEAD and a folder outside git', () => {
    const root = repo()
    git(root, 'checkout', '-q', '--detach')
    expect(gitProblem(root)).toMatch(/Not on a branch/)
    expect(gitProblem(mkdtempSync(join(tmpdir(), 'joseki-nogit-')))).toMatch(/Not on a branch/)
  })

  it('refuses uncommitted changes in a base file', () => {
    const root = repo()
    writeFileSync(join(root, CANDIDATES_FILE), 'x')
    expect(gitProblem(root)).toMatch(/Uncommitted changes in the base files/)
  })
})

describe('commitBases', () => {
  it('commits only the two base files, as the author of the last commit', () => {
    const root = repo()
    writeFileSync(join(root, TRAPS_FILE), encodeJdb({ kind: 'traps', verified: true, roots: [] }))
    writeFileSync(join(root, 'other.txt'), 'changed')
    git(root, 'add', 'other.txt')
    expect(commitBases(root, 'subject', 'body line')).toBe(true)
    expect(git(root, 'log', '-1', '--format=%an <%ae>|%s|%b')).toBe(`${AUTHOR.name} <${AUTHOR.email}>|subject|body line`)
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe(TRAPS_FILE)
    expect(git(root, 'status', '--porcelain')).toBe('M  other.txt')
  })

  it('does not commit when the base files did not change', () => {
    const root = repo()
    const head = git(root, 'rev-parse', 'HEAD')
    expect(commitBases(root, 'subject', 'body')).toBe(false)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })
})

describe('runGpu', () => {
  const opts = parseGpuOptions(['--visits', '10'])
  const ENGINE_INFO = 'KataGo 1.18.1; networks: main.bin.gz, human.bin.gz'

  it('moves an accepted candidate into the base and commits both files', async () => {
    const root = repo()
    const engine = new StubEngine()
    const s13 = vertexToIndex(mv('S13') as Vertex)
    engine.human = () => Array.from({ length: 362 }, (_, i) => (i === s13 ? 0.5 : 0))
    const after: Record<string, number> = { Q13: 5, S13: 2 }
    engine.lead = (q) => (q.allowMoves ? 5 : (after[q.moves.at(-1)?.[1] ?? ''] ?? 0))
    const lines: string[] = []
    const out = await runGpu({ root, engine, opts, engineInfo: ENGINE_INFO, log: (l) => lines.push(l) })
    expect(out.committed).toBe(true)
    const traps = decodeJdb(readFileSync(join(root, TRAPS_FILE)))
    const node = traps.find(['Q16', 'O17', 'R14', 'R13'].map(mv))
    expect(node === null ? null : traps.category(node)).toBe('trap')
    expect(decodeJdb(readFileSync(join(root, CANDIDATES_FILE))).size).toBe(0)
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([CANDIDATES_FILE, TRAPS_FILE].sort())
    const message = git(root, 'log', '-1', '--format=%B')
    expect(message).toMatch(/^feat\(traps\): verify the base and complete the candidates with KataGo/)
    expect(message).toContain('Candidates: accepted 1, not accepted 0')
    expect(message).toContain(ENGINE_INFO)
    expect(message).toContain('Options: visits 10, good-max 1, caught-gap 2, ranks 20k,15k,10k,5k,3k,1k, natural 0.1')
    expect(lines.at(-1)).toBe('Committed. Next: git push (git push -u origin HEAD for a new branch)')
  })

  it('reports the good answers it drops', async () => {
    const path = ['Q16', 'O17', 'R14', 'R13']
    const root = repo({ ...CANDIDATES, roots: [n('Q16', 'none', [n('O17', 'none', [n('R14', 'none', [n('R13', 'trap', [n('Q13', 'good'), n('Q12', 'good')])])])])] })
    const engine = new StubEngine()
    const s13 = vertexToIndex(mv('S13') as Vertex)
    engine.human = () => Array.from({ length: 362 }, (_, i) => (i === s13 ? 0.5 : 0))
    const after: Record<string, number> = { Q13: 5, Q12: 3, S13: 2 }
    engine.lead = (q) => (q.allowMoves ? 5 : (after[q.moves.at(-1)?.[1] ?? ''] ?? 0))
    await runGpu({ root, engine, opts, engineInfo: ENGINE_INFO, log: () => {} })
    expect(git(root, 'log', '-1', '--format=%B')).toContain(`  good answer dropped ${trapId(path.map(mv))}: Q12 2`)
  })

  it('says what to do with the written files when the commit fails', async () => {
    const root = repo()
    writeFileSync(join(root, '.git', 'index.lock'), '')
    const engine = new StubEngine()
    const s13 = vertexToIndex(mv('S13') as Vertex)
    engine.human = () => Array.from({ length: 362 }, (_, i) => (i === s13 ? 0.5 : 0))
    const after: Record<string, number> = { Q13: 5, S13: 2 }
    engine.lead = (q) => (q.allowMoves ? 5 : (after[q.moves.at(-1)?.[1] ?? ''] ?? 0))
    const error = await runGpu({ root, engine, opts, engineInfo: ENGINE_INFO, log: () => {} }).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('git restore -- ')
    expect((error as Error).message).toContain('may already be written')
    expect(decodeJdb(readFileSync(join(root, CANDIDATES_FILE))).size).toBe(0)
    expect(existsSync(join(root, `${TRAPS_FILE}.tmp`))).toBe(false)
  })

  it('writes and commits nothing when the engine fails', async () => {
    const root = repo()
    const head = git(root, 'rev-parse', 'HEAD')
    const before = readFileSync(join(root, TRAPS_FILE))
    const engine = {
      analyze: async (): Promise<never> => {
        throw new EngineError({ key: 'error.engine.stopped' }, 'engine_failed')
      },
    }
    await expect(runGpu({ root, engine, opts, engineInfo: ENGINE_INFO, log: () => {} })).rejects.toThrow('KataGo was stopped')
    expect(readFileSync(join(root, TRAPS_FILE))).toEqual(before)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
  })
})
