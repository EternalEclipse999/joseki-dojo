import type { InstallFile, InstallStatus, InstallStep } from '@joseki-dojo/shared'

/** Spec 5.2: what the install screen says during each step. */
export const INSTALL_STEP_TEXT: Record<InstallStep, string> = {
  idle: '',
  downloading: 'Скачиваю файлы…',
  extracting: 'Распаковываю KataGo…',
  'benchmarking-cpu': 'Проверяю скорость на процессоре…',
  'benchmarking-gpu': 'Настраиваю видеокарту — это может занять несколько минут',
  finishing: 'Запускаю KataGo…',
  done: 'Готово',
  failed: 'Не получилось установить KataGo',
}

export const isInstalling = (step: InstallStep): boolean => step !== 'idle' && step !== 'done' && step !== 'failed'

const megabytes = (bytes: number): string =>
  (bytes / 1_048_576).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** "12,3 из 93,4 МБ" while downloading, "готово" once checked. */
export function fileProgressText(f: InstallFile): string {
  if (f.done) return 'готово'
  if (f.received === 0) return 'ожидает'
  return f.total > 0 ? `${megabytes(f.received)} из ${megabytes(f.total)} МБ` : `${megabytes(f.received)} МБ`
}

/** Spec 5: whether the install screen offers its button (an update starts by itself and only offers a retry). */
export function canStartInstall(s: { update: boolean; running: boolean; failed: boolean; installed: boolean | undefined }): boolean {
  if (s.running) return false
  return s.update ? s.failed : s.installed !== true
}

/** The screen hands over to the app at once on a plain "done"; with a note it stays so the player can read it. */
export const installFinishedAtOnce = (s: Pick<InstallStatus, 'step' | 'note'>): boolean => s.step === 'done' && !s.note

/** Total download: the CPU and OpenCL builds plus both networks (see katago.lock.json). */
export const downloadSizeText = (linux: boolean): string => (linux ? 'около 280 МБ' : 'около 210 МБ')
