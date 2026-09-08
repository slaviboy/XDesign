/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Interface language.
 *
 * One JSON file per locale, keyed by a stable resource id. English is the
 * source of truth and the fallback: a key missing from a translation falls back
 * to English rather than showing the raw id, so a half-finished locale degrades
 * to a readable mixture instead of to `menu.file.new`.
 *
 * The files are imported statically rather than fetched, because the app has to
 * work with no network at all — that is the whole premise — and eight small
 * JSON files cost less than the font it renders them in.
 *
 * The choice lives in localStorage beside the theme: it is a preference about
 * the person, not about the document, and it must be readable synchronously
 * before the first render.
 */

import en from './locales/en.json'
import bg from './locales/bg.json'
import de from './locales/de.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import pt from './locales/pt.json'
import zh from './locales/zh.json'

export type LanguageCode = 'en' | 'bg' | 'de' | 'es' | 'fr' | 'ja' | 'pt' | 'zh'

/** Every string the interface can show. English is the shape all others follow. */
export type Messages = typeof en
export type MessageKey = keyof Messages

export const LANGUAGE_STORAGE_KEY = 'xdesign.language'

/**
 * Names written in each language itself.
 *
 * A menu of languages is the one menu that cannot be translated: someone
 * looking for their own language is looking for the word they use for it.
 */
export const LANGUAGES: Array<{ code: LanguageCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'bg', label: 'Български' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
]

const CATALOGUES: Record<LanguageCode, Partial<Messages>> = { en, bg, de, es, fr, ja, pt, zh }

type Listener = (code: LanguageCode) => void
const listeners = new Set<Listener>()
let current: LanguageCode = readStoredLanguage()

function readStoredLanguage(): LanguageCode {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  } catch {
    // Private mode, or storage blocked.
  }
  if (stored && stored in CATALOGUES) return stored as LanguageCode
  // Nothing chosen yet: follow the browser, which is what the user already told
  // their system. Only the primary subtag matters — 'pt-BR' is Portuguese here.
  try {
    const tag = navigator.language?.slice(0, 2).toLowerCase()
    if (tag && tag in CATALOGUES) return tag as LanguageCode
  } catch {
    // No navigator (a test environment, or a worker).
  }
  return 'en'
}

export function getLanguage(): LanguageCode {
  return current
}

export function setLanguage(code: LanguageCode): void {
  if (!(code in CATALOGUES) || code === current) return
  current = code
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
  } catch {
    // The choice still applies for this session.
  }
  for (const fn of listeners) fn(code)
}

export function subscribeLanguage(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Look up a string, substituting `{name}` placeholders.
 *
 * Placeholders are named rather than positional because word order is exactly
 * what changes between languages: "Import to {artboard}" and its German
 * equivalent do not put the artboard in the same place.
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = CATALOGUES[current][key] ?? en[key] ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}
