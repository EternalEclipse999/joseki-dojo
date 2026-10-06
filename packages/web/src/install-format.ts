import type { InstallFile, InstallStep } from '@joseki-dojo/shared'

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
