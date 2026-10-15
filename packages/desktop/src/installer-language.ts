import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_LANGUAGE, isLanguage, languageFromWindowsId, type Language } from '@joseki-dojo/shared'

const FILE = 'installer-language'

/**
 * Spec (languages) 8.1: the LANGID the Windows installer wrote into the data folder, or null when there is no usable
 * choice (no file, or an empty or non-numeric one left by an installer that stopped mid-write: the first-start screen asks).
 * A numeric LANGID the app does not know is English.
 */
export function readInstallerLanguage(userData: string): Language | null {
  try {
    const text = readFileSync(join(userData, FILE), 'utf8').trim()
    return /^\d+$/.test(text) ? languageFromWindowsId(Number.parseInt(text, 10)) : null
  } catch {
    return null
  }
}

/**
 * Removes the file once the server has taken the language over. Best effort: the language is already saved, so a file
 * that is locked or denied (antivirus, the indexer) is only reported to `log`, never thrown (it would stop the start).
 */
export function forgetInstallerLanguage(userData: string, log: (line: string) => void = () => undefined): void {
  try {
    rmSync(join(userData, FILE), { force: true })
  } catch (err) {
    log(`Could not remove the installer language file: ${String(err)}`)
  }
}

/** The language of the startup error box: the saved one, English when the config is missing or broken. */
export function configLanguage(configFile: string): Language {
  try {
    const language = (JSON.parse(readFileSync(configFile, 'utf8')) as { ui?: { language?: unknown } }).ui?.language
    return isLanguage(language) ? language : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}
