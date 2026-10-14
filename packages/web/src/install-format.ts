import type { InstallFile, InstallStatus, InstallStep, Language, MessageKey, Translate } from '@joseki-dojo/shared'

/** Spec 5.2: what the install screen says during each step (nothing while idle). */
export const INSTALL_STEP_TEXT: Record<InstallStep, MessageKey | null> = {
  idle: null,
  downloading: 'install.step.downloading',
  extracting: 'install.step.extracting',
  'benchmarking-cpu': 'install.step.benchmarkingCpu',
  'benchmarking-gpu': 'install.step.benchmarkingGpu',
  finishing: 'install.step.finishing',
  done: 'install.step.done',
  failed: 'install.step.failed',
}

export const isInstalling = (step: InstallStep): boolean => step !== 'idle' && step !== 'done' && step !== 'failed'

const megabytes = (bytes: number, lang: Language): string =>
  new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / 1_048_576)

/** "12.3 of 93.4 MB" while downloading, "done" once checked; the megabytes have one decimal in the reader's language. */
export function fileProgressText(f: InstallFile, t: Translate, lang: Language): string {
  if (f.done) return t('install.progress.done')
  if (f.received === 0) return t('install.progress.waiting')
  const received = megabytes(f.received, lang)
  return f.total > 0 ? t('install.progress.of', { received, total: megabytes(f.total, lang) }) : t('install.progress.received', { received })
}

/** Spec 5: whether the install screen offers its button (an update starts by itself and only offers a retry). */
export function canStartInstall(s: { update: boolean; running: boolean; failed: boolean; installed: boolean | undefined }): boolean {
  if (s.running) return false
  return s.update ? s.failed : s.installed !== true
}

/** The screen hands over to the app at once on a plain "done"; with a note it stays so the player can read it. */
export const installFinishedAtOnce = (s: Pick<InstallStatus, 'step' | 'note'>): boolean => s.step === 'done' && !s.note

/** Total download: the CPU and OpenCL builds plus both networks (see katago.lock.json). */
export const downloadSizeText = (linux: boolean, t: Translate): string => t('install.downloadSize', { size: linux ? 280 : 210 })
