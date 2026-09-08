/**
 * The message catalogues.
 *
 * The shape tests are the point: a translation that has drifted from English —
 * a missing key, an extra one, a placeholder renamed — is invisible until
 * someone switches language and finds a raw id or an empty slot in a sentence.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import en from '../../src/i18n/locales/en.json'
import bg from '../../src/i18n/locales/bg.json'
import de from '../../src/i18n/locales/de.json'
import es from '../../src/i18n/locales/es.json'
import fr from '../../src/i18n/locales/fr.json'
import ja from '../../src/i18n/locales/ja.json'
import pt from '../../src/i18n/locales/pt.json'
import zh from '../../src/i18n/locales/zh.json'
import { LANGUAGES, getLanguage, setLanguage, t } from '../../src/i18n'

const CATALOGUES = { bg, de, es, fr, ja, pt, zh } as Record<string, Record<string, string>>
const english = en as Record<string, string>
const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort()

describe('catalogues', () => {
  it('every language covers every key, and adds none of its own', () => {
    const expected = Object.keys(english).sort()
    for (const [code, messages] of Object.entries(CATALOGUES)) {
      expect(Object.keys(messages).sort(), code).toEqual(expected)
    }
  })

  it('placeholders survive translation', () => {
    for (const [code, messages] of Object.entries(CATALOGUES)) {
      for (const key of Object.keys(english)) {
        // Word order changes between languages; the set of named holes must not.
        expect(placeholders(messages[key]!), `${code} ${key}`).toEqual(
          placeholders(english[key]!),
        )
      }
    }
  })

  it('nothing is left untranslated by accident', () => {
    // A handful of strings are legitimately identical across languages — proper
    // nouns and symbols. Everything else differing from English is the signal
    // that a translation was actually done.
    for (const [code, messages] of Object.entries(CATALOGUES)) {
      const same = Object.keys(english).filter((k) => messages[k] === english[k])
      expect(same.length, `${code}: ${same.join(', ')}`).toBeLessThan(12)
    }
  })

  it('every language in the menu has a catalogue, named in itself', () => {
    for (const { code, label } of LANGUAGES) {
      expect(code === 'en' || code in CATALOGUES, code).toBe(true)
      expect(label.length).toBeGreaterThan(0)
    }
    expect(LANGUAGES).toHaveLength(8)
  })
})

describe('t', () => {
  beforeEach(() => setLanguage('en'))

  it('substitutes named placeholders', () => {
    expect(t('drop.release', { name: 'Artboard 1' })).toBe('Release to add it to Artboard 1')
  })

  it('leaves a placeholder alone when nothing was supplied for it', () => {
    // Better a visible {name} than the word silently vanishing from the sentence.
    expect(t('drop.release')).toContain('{name}')
  })

  it('switches language, and remembers which', () => {
    setLanguage('de')
    expect(getLanguage()).toBe('de')
    expect(t('menu.copy')).toBe('Kopieren')
    setLanguage('ja')
    expect(t('menu.copy')).toBe('コピー')
  })

  it('ignores a language it has no catalogue for', () => {
    setLanguage('de')
    setLanguage('xx' as 'de')
    expect(getLanguage()).toBe('de')
  })
})
