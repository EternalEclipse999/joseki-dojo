import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { describe, expect, it } from 'vitest'
import { unzip } from './unzip'

const temp = (): string => mkdtempSync(join(tmpdir(), 'joseki-unzip-'))
const archive = (files: Zippable): string => {
  const zip = join(temp(), 'build.zip')
  writeFileSync(zip, zipSync(files))
  return zip
}
/** A Unix symbolic link entry: made on Unix (os 3), mode 0o120777 in the high half of the external attributes. */
const symlink = (target: string): [Uint8Array, { os: number; attrs: number }] => [strToU8(target), { os: 3, attrs: (0o120777 << 16) >>> 0 }]

describe('unzip', () => {
  it('unpacks files and folders', async () => {
    const dir = join(temp(), 'out')
    await unzip(archive({ 'top.txt': strToU8('top'), 'a/b/deep.txt': strToU8('deep'), 'empty/': new Uint8Array() }), dir)
    expect(readFileSync(join(dir, 'top.txt'), 'utf8')).toBe('top')
    expect(readFileSync(join(dir, 'a', 'b', 'deep.txt'), 'utf8')).toBe('deep')
    expect(statSync(join(dir, 'empty')).isDirectory()).toBe(true)
  })

  it('refuses a symbolic link', async () => {
    const root = temp()
    const zip = archive({ 'katago.txt': strToU8('ok'), link: symlink('../outside.txt') })
    await expect(unzip(zip, join(root, 'out'))).rejects.toThrow('Не удалось распаковать build.zip: в архиве есть символическая ссылка link')
    expect(existsSync(join(root, 'outside.txt'))).toBe(false)
    expect(existsSync(join(root, 'out', 'link'))).toBe(false)
  })

  it.each(['../evil.txt', 'a/../../evil.txt', 'a\\..\\..\\evil.txt', '/evil.txt', 'C:/evil.txt'])('refuses an entry that leaves the folder: %s', async (name) => {
    const root = temp()
    await expect(unzip(archive({ [name]: strToU8('evil') }), join(root, 'out'))).rejects.toThrow(/^Не удалось распаковать build\.zip: /)
    expect(existsSync(join(root, 'evil.txt'))).toBe(false)
  })

  it('reports a file that is not an archive', async () => {
    const file = join(temp(), 'build.zip')
    writeFileSync(file, 'not a zip')
    await expect(unzip(file, join(temp(), 'out'))).rejects.toThrow(/^Не удалось распаковать build\.zip: /)
  })
})
