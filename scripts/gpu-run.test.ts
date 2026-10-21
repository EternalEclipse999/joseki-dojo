import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commitResult, resultGitProblem, saveResult, overridePairs, withConfigOverrides } from './gpu-run'

// The git calls must not depend on the developer's own git config (a global commit.gpgsign would hang the commits).
const CONFIG_DIR = mkdtempSync(join(tmpdir(), 'joseki-gitcfg-'))
writeFileSync(join(CONFIG_DIR, 'gitconfig'), '')
process.env.GIT_CONFIG_GLOBAL = join(CONFIG_DIR, 'gitconfig')
process.env.GIT_CONFIG_NOSYSTEM = '1'

const FILE = 'packages/server/bases/result.json'
/** The identity configured in the repository; the last commit is by someone else. */
const CONFIGURED = { name: 'Result Author', email: '1+author@users.noreply.github.com' }
const OTHER = { name: 'Someone Else', email: '2+other@users.noreply.github.com' }
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A repository on branch feat/x configured with CONFIGURED, with other.txt committed by OTHER and no result file yet. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'joseki-gpu-run-'))
  git(root, 'init', '-q')
  git(root, 'checkout', '-q', '-b', 'feat/x')
  git(root, 'config', 'user.name', CONFIGURED.name)
  git(root, 'config', 'user.email', CONFIGURED.email)
  writeFileSync(join(root, 'other.txt'), 'x')
  git(root, 'add', '-A')
  git(root, '-c', `user.name=${OTHER.name}`, '-c', `user.email=${OTHER.email}`, 'commit', '-q', '-m', 'init')
  mkdirSync(dirname(join(root, FILE)), { recursive: true })
  return root
}

describe('the result of a GPU run', () => {
  it('is refused on a detached HEAD, on main and over an uncommitted result file', () => {
    const root = repo()
    expect(resultGitProblem(root, FILE, 'x-gpu-run')).toBeNull()
    writeFileSync(join(root, FILE), '{}')
    expect(resultGitProblem(root, FILE, 'x-gpu-run')).toMatch(/^Uncommitted changes in packages\/server\/bases\/result.json:\n.*\nCommit, restore or delete it first$/)
    git(root, 'checkout', '-q', '--detach')
    expect(resultGitProblem(root, FILE, 'x-gpu-run')).toMatch(/^Not on a branch \(a detached HEAD or not a git repository\): .*\(e\.g\. git switch -c x-gpu-run\)/)
    git(root, 'checkout', '-q', '-b', 'main')
    expect(resultGitProblem(root, FILE, 'x-gpu-run')).toBe('You are on main: switch to the pull request branch or create a branch for the result (e.g. git switch -c x-gpu-run)')
  })

  it("is committed alone, new or changed, with the repository's configured identity", () => {
    const root = repo()
    writeFileSync(join(root, FILE), '{}')
    writeFileSync(join(root, 'other.txt'), 'changed')
    git(root, 'add', 'other.txt')
    expect(commitResult(root, FILE, 'subject', 'body line')).toBe(true)
    const configured = `${CONFIGURED.name} <${CONFIGURED.email}>`
    expect(git(root, 'log', '-1', '--format=%an <%ae>|%cn <%ce>|%s|%b')).toBe(`${configured}|${configured}|subject|body line`)
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe(FILE)
    expect(git(root, 'status', '--porcelain')).toBe('M  other.txt')
    expect(commitResult(root, FILE, 'subject', 'body')).toBe(false)
    writeFileSync(join(root, FILE), '{"a":1}')
    expect(commitResult(root, FILE, 'second', 'body')).toBe(true)
    expect(git(root, 'show', '--name-only', '--format=%s', 'HEAD')).toBe(`second\n\n${FILE}`)
  })

  it('is refused over an uncommitted input file too, with the single-file message unchanged', () => {
    const root = repo()
    writeFileSync(join(root, 'in.bin'), 'x')
    expect(resultGitProblem(root, FILE, 'x-gpu-run')).toBeNull()
    expect(resultGitProblem(root, FILE, 'x-gpu-run', ['in.bin'])).toMatch(/^Uncommitted changes in packages\/server\/bases\/result.json, in.bin:\n\?\? in.bin\nCommit, restore or delete it first$/)
  })

  it('says it may already be written when the rename fails', async () => {
    const root = repo()
    // The target is a directory: the rename cannot replace it.
    mkdirSync(join(root, FILE), { recursive: true })
    await expect(saveResult(root, FILE, '{}', 'subject', 'body')).rejects.toThrow(/^The result may already be written to packages\/server\/bases\/result.json\. Commit it with: .*discard it with: /s)
  })

  it('says it may already be written when the commit fails', async () => {
    const root = repo()
    // A failing pre-commit hook makes the commit fail after the file is written.
    mkdirSync(join(root, '.git', 'hooks'), { recursive: true })
    writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await expect(saveResult(root, FILE, '{}', 'subject', 'body')).rejects.toThrow(/may already be written to packages\/server\/bases\/result.json/)
    expect(git(root, 'status', '--porcelain', '--', FILE)).toBe('A  ' + FILE)
  })

  it('writes and commits the result when all is well', async () => {
    const root = repo()
    expect(await saveResult(root, FILE, '{}', 'subject', 'body')).toBe(true)
    expect(git(root, 'show', '--name-only', '--format=%s', 'HEAD')).toBe(`subject\n\n${FILE}`)
  })
})

describe('the engine overrides of a run', () => {
  it("are appended as KataGo's -override-config and leave the command alone when empty", () => {
    const command = { command: 'katago', args: ['analysis', '-config', 'a.cfg'] }
    expect(withConfigOverrides(command, { numAnalysisThreads: 16, nnRandomize: false })).toEqual({ command: 'katago', args: ['analysis', '-config', 'a.cfg', '-override-config', 'numAnalysisThreads=16,nnRandomize=false'] })
    expect(withConfigOverrides(command, {})).toBe(command)
    expect(overridePairs({ a: 1, b: false, c: 'x' })).toEqual(['a=1', 'b=false', 'c=x'])
  })
})
