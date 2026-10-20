import type { AboutInfo, MessageKey, Translate } from '@joseki-dojo/shared'

/** Spec (about) 3.1: the root package.json version, set at build time. */
export const APP_VERSION: string = __APP_VERSION__

const REPO = 'https://github.com/EternalEclipse999/joseki-dojo'

/** Spec (about) 2.3: the project's pages. */
export const PROJECT_LINKS: readonly { key: MessageKey; href: string }[] = [
  { key: 'about.links.project', href: REPO },
  { key: 'about.links.releases', href: `${REPO}/releases` },
  { key: 'about.links.issues', href: `${REPO}/issues/new` },
]

/** Spec (about) 2.3: what the app is built on. A project's name is never translated; what describes a network is. */
export type Credit = { href: string } & ({ name: string } | { key: MessageKey })

export const CREDITS: readonly Credit[] = [
  { name: 'KataGo', href: 'https://github.com/lightvector/KataGo' },
  { key: 'about.credits.networks', href: 'https://katagotraining.org' },
  { key: 'about.credits.human', href: 'https://github.com/lightvector/KataGo/releases/tag/v1.15.0' },
  { name: 'Shudan', href: 'https://github.com/SabakiHQ/Shudan' },
  { name: 'go-board', href: 'https://github.com/SabakiHQ/go-board' },
  { name: 'FSRS (ts-fsrs)', href: 'https://github.com/open-spaced-repetition/ts-fsrs' },
  { name: 'Preact', href: 'https://preactjs.com' },
  { name: 'Inter', href: 'https://rsms.me/inter/' },
  { name: 'Lucide', href: 'https://lucide.dev' },
  { name: 'Electron', href: 'https://www.electronjs.org' },
]

export const creditText = (c: Credit, t: Translate): string => ('name' in c ? c.name : t(c.key))

const SETUP: Record<AboutInfo['katago']['setup'], MessageKey> = {
  cpu: 'about.engine.cpu',
  gpu: 'about.engine.gpu',
  manual: 'about.engine.manual',
  missing: 'about.engine.missing',
}

/** Spec (about) 2.3: the engine block's lines; no networks while KataGo is missing. */
export function engineLines(k: AboutInfo['katago'], t: Translate): { versions: string; setup: string; networks: string[] } {
  return {
    versions:
      k.runningVersion === null
        ? t('about.engine.versionsNotRunning', { locked: k.lockedVersion })
        : t('about.engine.versions', { locked: k.lockedVersion, running: k.runningVersion }),
    setup: t(SETUP[k.setup]),
    networks: k.setup === 'missing' ? [] : [k.mainModel, k.humanModel],
  }
}
