import { createWriteStream, mkdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { TextError } from '../text-error'

/** File type bits of a Unix mode, kept in the high half of an entry's external attributes. */
const S_IFMT = 0o170000
const S_IFLNK = 0o120000

const openZip = (file: string): Promise<ZipFile> =>
  new Promise((done, fail) => yauzl.open(file, { lazyEntries: true }, (err, zip) => (err ? fail(err) : done(zip))))
const openStream = (zip: ZipFile, entry: Entry): Promise<Readable> =>
  new Promise((done, fail) => zip.openReadStream(entry, (err, stream) => (err ? fail(err) : done(stream))))

async function writeEntry(zip: ZipFile, entry: Entry, root: string): Promise<void> {
  if (((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) throw new TextError({ key: 'install.error.symlink', params: { name: entry.fileName } })
  const target = resolve(root, entry.fileName)
  if (entry.fileName.endsWith('/')) return void mkdirSync(target, { recursive: true })
  mkdirSync(dirname(target), { recursive: true })
  await pipeline(await openStream(zip, entry), createWriteStream(target))
}

/**
 * Unpacks a zip archive into `dir`, one entry at a time. Only plain files and folders are written: a symbolic link
 * fails the whole extraction, and so does a path that leaves `dir` (yauzl refuses absolute paths and `..` segments
 * while it reads the entry names).
 */
export async function unzip(zipFile: string, dir: string): Promise<void> {
  const root = resolve(dir)
  mkdirSync(root, { recursive: true })
  let zip: ZipFile | null = null
  try {
    const opened = await openZip(zipFile)
    zip = opened
    await new Promise<void>((done, fail) => {
      opened.on('error', fail)
      opened.on('end', () => done())
      opened.on('entry', (entry: Entry) => void writeEntry(opened, entry, root).then(() => opened.readEntry(), fail))
      opened.readEntry()
    })
  } catch (err) {
    const detail = err instanceof TextError ? err.text : err instanceof Error ? err.message : String(err)
    throw new TextError({ key: 'install.error.unzip', params: { name: basename(zipFile), detail } }, { cause: err })
  } finally {
    zip?.close()
  }
}
