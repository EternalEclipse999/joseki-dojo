import { en } from './en'
import { ja } from './ja'
import { ko } from './ko'
import type { Language } from './languages'
import type { Message } from './message'
import { ru } from './ru'
import { zhHans } from './zh-Hans'
import { zhHant } from './zh-Hant'

export type MessageKey = keyof typeof ru
/** Spec (languages) 4.1: a dictionary must have every key of `ru` — a missing one fails the typecheck. */
export type Catalog = Record<MessageKey, Message>

export const CATALOGS: Record<Language, Catalog> = { en, ru, 'zh-Hans': zhHans, 'zh-Hant': zhHant, ko, ja }
