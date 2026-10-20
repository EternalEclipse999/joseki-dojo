/** Spec (about) 3.2: what `GET /api/about` returns, the engine block of the «О программе» window. */
export interface AboutInfo {
  katago: {
    /** The version pinned in katago.lock.json. */
    lockedVersion: string
    /** The running KataGo's version; null while it is not ready. */
    runningVersion: string | null
    /** Who set KataGo up: the installer or `npm run setup` (the build they chose), the player by hand, or nobody (its files are missing). */
    setup: 'cpu' | 'gpu' | 'manual' | 'missing'
    /** The networks' file names without the folder and the extension. */
    mainModel: string
    humanModel: string
  }
}
