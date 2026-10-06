/** Spec 5.3: the built-in KataGo installer's steps; `failed` keeps the reason in `InstallStatus.error`. */
export type InstallStep =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'benchmarking-cpu'
  | 'benchmarking-gpu'
  | 'finishing'
  | 'done'
  | 'failed'

export interface InstallFile {
  /** File name on disk, e.g. `b18c384nbt-humanv0.bin.gz`. */
  name: string
  /** What the file is, for the install screen. */
  label: string
  received: number
  /** Expected size in bytes; 0 while unknown. */
  total: number
  /** Downloaded (or found on disk) and its SHA-256 checked. */
  done: boolean
}

export interface InstallStatus {
  step: InstallStep
  files: InstallFile[]
  error: string | null
  /** The KataGo files named in the settings exist. */
  installed: boolean
  /** Spec 5.1: the installer set KataGo up from a different katago.lock.json. */
  updateAvailable: boolean
  /** The build chosen by the last successful installation. */
  kind: 'cpu' | 'gpu' | null
  /** A thing the player should know after a successful installation (e.g. the video card did not start), or null. */
  note: string | null
}
