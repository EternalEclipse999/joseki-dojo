import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { KataGoEngine } from '../../packages/server/src/engine/engine'
import { compareVersions, MIN_KATAGO_VERSION } from '../../packages/server/src/engine/health'
import { buildsFor, loadLock, versionWarning, type LockedBuild } from '../../packages/server/src/engine/lock'
import { defaultKind, parseCpuAnswer } from './build-kind'
import { measureVisitsPerSecond, visitsForBudget } from './calibrate'
import { download, findKatagoBinary, unzip } from './download'
import { analysisConfigText, searchThreadsFor } from './katago-config'

type Json = Record<string, unknown>

const root = fileURLToPath(new URL('../../', import.meta.url))
const configFile = join(root, 'config.local.json')
const enginesDir = join(root, 'engines')

/**
 * Line-queue prompter. Unlike readline's question(), it keeps lines that arrive before the question
 * is asked, so piped answers (`printf '\n1\n\n' | npm run setup`) work. After EOF every answer is ''.
 */
function prompter(): { ask: (question: string) => Promise<string>; close: () => void } {
  const rl = createInterface({ input: process.stdin })
  const lines: string[] = []
  const waiting: ((line: string) => void)[] = []
  let closed = false
  rl.on('line', (line) => {
    const waiter = waiting.shift()
    if (waiter) waiter(line)
    else lines.push(line)
  })
  rl.on('close', () => {
    closed = true
    for (const waiter of waiting.splice(0)) waiter('')
  })
  return {
    ask(question: string): Promise<string> {
      process.stdout.write(question)
      const line = lines.shift()
      if (line !== undefined) return Promise.resolve(line.trim())
      if (closed) return Promise.resolve('')
      return new Promise((done) => waiting.push((l) => done(l.trim())))
    },
    close: () => rl.close(),
  }
}

async function main(): Promise<void> {
  const lock = loadLock()
  const rl = prompter()
  let existing: Json = {}
  if (existsSync(configFile)) {
    try {
      existing = JSON.parse(readFileSync(configFile, 'utf8')) as Json
    } catch {
      throw new Error(`Файл ${configFile} содержит некорректный JSON. Исправьте или удалите его и запустите setup снова.`)
    }
  }
  const existingKatago = (existing.katago ?? {}) as Json
  const knownPath = typeof existingKatago.path === 'string' && existsSync(existingKatago.path) ? existingKatago.path : null

  console.log(`Настройка KataGo ${lock.katago.version} для Joseki Dojo (версии из katago.lock.json)\n`)
  const answer = await rl.ask(`Путь к установленной KataGo (Enter — ${knownPath ?? 'скачать проверенную версию'}): `)
  let katagoPath: string
  let kind: LockedBuild['kind']
  if (answer || knownPath) {
    katagoPath = resolve(answer || (knownPath as string))
    if (!existsSync(katagoPath)) throw new Error(`Файл не найден: ${katagoPath}`)
    const storedKind = answer ? undefined : ((existing.setup ?? {}) as Json).kind
    const fallback = defaultKind(storedKind, katagoPath)
    kind = parseCpuAnswer(await rl.ask(`Это CPU-сборка (eigen)? ${fallback === 'cpu' ? '[Y/n]' : '[y/N]'}: `), fallback)
  } else {
    const options = buildsFor(lock, process.platform)
    if (options.length === 0) throw new Error(`Для ${process.platform} нет готовых сборок KataGo: установите её сами и укажите путь.`)
    options.forEach((b, i) => console.log(`  ${i + 1}) ${b.label}`))
    const build = options[Number(await rl.ask(`Бэкенд [1-${options.length}]: `)) - 1]
    if (!build) throw new Error('Нет такого варианта')
    const zip = join(enginesDir, 'downloads', basename(new URL(build.url).pathname))
    await download(build.url, zip, build.sha256)
    const dir = join(enginesDir, `katago-${lock.katago.version}-${build.id}`)
    await unzip(zip, dir)
    const bin = findKatagoBinary(dir)
    if (!bin) throw new Error(`В архиве нет исполняемого файла KataGo: ${zip}`)
    if (process.platform !== 'win32') chmodSync(bin, 0o755)
    katagoPath = bin
    kind = build.kind
  }
  const customModel = await rl.ask(`Путь к своей основной сети (Enter — ${lock.models.main.file}): `)
  rl.close()

  const mainModel = customModel ? resolve(customModel) : join(enginesDir, 'models', lock.models.main.file)
  if (customModel && !existsSync(mainModel)) throw new Error(`Файл основной сети не найден: ${mainModel}`)
  if (!customModel) await download(lock.models.main.url, mainModel, lock.models.main.sha256)
  const humanModel = join(enginesDir, 'models', lock.models.human.file)
  await download(lock.models.human.url, humanModel, lock.models.human.sha256)

  const logDir = join(root, 'data', 'katago-logs')
  mkdirSync(logDir, { recursive: true })
  const analysisConfig = join(enginesDir, 'analysis.cfg')
  writeFileSync(analysisConfig, analysisConfigText({ logDir, searchThreadsPerAnalysisThread: searchThreadsFor(kind, availableParallelism()) }))

  console.log('\nЗапускаю KataGo и замеряю скорость. Первый запуск OpenCL может настраиваться несколько минут…')
  const engine = new KataGoEngine(
    { command: katagoPath, args: ['analysis', '-config', analysisConfig, '-model', mainModel, '-human-model', humanModel] },
    (line) => console.log(`  [katago] ${line}`),
  )
  engine.start()
  try {
    const version = await engine.version()
    if (compareVersions(version, MIN_KATAGO_VERSION) < 0) throw new Error(`Нужна KataGo ${MIN_KATAGO_VERSION} или новее, установлена ${version}`)
    const warning = versionWarning(lock, version)
    if (warning) console.log(`\nВнимание: ${warning}`)
    const vps = await measureVisitsPerSecond(engine)
    const visits = visitsForBudget(vps)
    console.log(`Скорость ≈ ${Math.round(vps)} визитов/с → разбор: ${visits.reviewVisits}, проверка конца: ${visits.endVisits} визитов`)
    const { commandOverride: _ignored, ...katagoRest } = existingKatago
    const config = {
      ...existing,
      setup: { ...((existing.setup ?? {}) as Json), kind },
      katago: { ...katagoRest, path: katagoPath, analysisConfig, mainModel, humanModel },
      analysis: { ...((existing.analysis ?? {}) as Json), ...visits },
    }
    writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`)
    console.log(`\nГотово: ${configFile}\nЗапуск: npm start`)
  } finally {
    await engine.stop()
  }
}

main().catch((err: unknown) => {
  console.error(`\nОшибка: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
