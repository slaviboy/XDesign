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
 * Moving your settings to another machine.
 *
 * A preferences file is read on a computer that is not the one that wrote it,
 * possibly by a different version of the app, possibly after somebody edited
 * it in a text editor. So the tests that matter are the ones about surviving
 * that: an older file, a newer file, a corrupt field, a field this build has
 * never heard of.
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyPreferences, collectPreferences, parsePreferences, serializePreferences,
  PreferencesFormatError, PREFERENCES_VERSION, type PreferencesFile,
} from '@/persistence/Preferences'
import { createDocument } from '@/document/NodeFactory'
import { getDoc, replaceDocument } from '@/state/DocumentStore'
import { editorStore, setMarqueeMode, readDefaultGrid, saveDefaultGrid } from '@/state/EditorStore'
import { getThemePreference, setThemePreference } from '@/state/theme'
import { getLanguage, setLanguage } from '@/i18n'
import { isSpellCheckEnabled, setSpellCheckEnabled } from '@/text/spellcheck'
import { chordFor, keymapOverrides, resetAllBindings, setBinding } from '@/shortcuts/keymap'
import { updateSettings } from '@/history/Commands'

const NOW = '2026-09-09T10:00:00.000Z'

/** A complete SquareGrid, since the stored default is the whole object. */
const grid = (size: number) => ({
  type: 'square' as const,
  visible: true,
  size,
  color: { r: 0, g: 0, b: 0, a: 0.1 },
})

beforeEach(() => {
  localStorage.clear()
  replaceDocument(createDocument('Prefs', false))
  resetAllBindings()
  setThemePreference('system')
  setLanguage('en')
  setMarqueeMode('touch')
  setSpellCheckEnabled(true)
})

describe('collecting', () => {
  it('writes a file that names its format and version', () => {
    const file = collectPreferences(NOW)
    expect(file.format).toBe('xdesign-preferences')
    expect(file.version).toBe(PREFERENCES_VERSION)
    expect(file.exported).toBe(NOW)
  })

  it('carries everything the Preferences dialog shows', () => {
    setThemePreference('dark')
    setLanguage('de')
    setMarqueeMode('enclose')
    setSpellCheckEnabled(false)
    saveDefaultGrid(grid(12))
    setBinding('file.save', 'Mod+K')
    updateSettings({ gridSize: 24, snapToGrid: true })

    const file = collectPreferences(NOW)
    expect(file.theme).toBe('dark')
    expect(file.language).toBe('de')
    expect(file.marqueeMode).toBe('enclose')
    expect(file.spellCheck).toBe(false)
    expect(file.defaultGrid).toEqual(grid(12))
    expect(file.shortcuts).toEqual({ 'file.save': 'Mod+K' })
    expect(file.canvas?.gridSize).toBe(24)
    expect(file.canvas?.snapToGrid).toBe(true)
  })

  it('stores chords platform-neutrally, so a Mac keymap survives the trip', () => {
    setBinding('file.save', 'Mod+K')
    const text = serializePreferences(collectPreferences(NOW))
    expect(text).toContain('Mod+K')
    expect(text).not.toContain('⌘')
  })

  it('is readable JSON, because somebody will open it', () => {
    const text = serializePreferences(collectPreferences(NOW))
    expect(text).toContain('\n  "format"')
    expect(text.endsWith('\n')).toBe(true)
    expect(() => JSON.parse(text)).not.toThrow()
  })
})

describe('parsing', () => {
  it('accepts what it wrote', () => {
    const file = collectPreferences(NOW)
    expect(parsePreferences(serializePreferences(file))).toEqual(file)
  })

  it('refuses something that is not a preferences file', () => {
    expect(() => parsePreferences('not json at all')).toThrow(PreferencesFormatError)
    expect(() => parsePreferences('{"hello":true}')).toThrow(PreferencesFormatError)
    expect(() => parsePreferences('null')).toThrow(PreferencesFormatError)
  })

  it('refuses a file from a newer version rather than guessing at it', () => {
    const text = JSON.stringify({ format: 'xdesign-preferences', version: PREFERENCES_VERSION + 1 })
    expect(() => parsePreferences(text)).toThrow(/newer version/)
  })

  it('accepts a file with almost nothing in it', () => {
    const file = parsePreferences('{"format":"xdesign-preferences","version":1}')
    expect(file.language).toBeUndefined()
  })
})

describe('applying', () => {
  const file = (patch: Partial<PreferencesFile>): PreferencesFile => ({
    format: 'xdesign-preferences',
    version: PREFERENCES_VERSION,
    ...patch,
  })

  it('applies every section and names what it did', () => {
    const summary = applyPreferences(file({
      language: 'fr',
      theme: 'dark',
      spellCheck: false,
      marqueeMode: 'enclose',
      defaultGrid: grid(16),
      shortcuts: { 'file.save': 'Mod+K' },
      canvas: { gridSize: 32, snapToObjects: false },
    }))

    expect(getLanguage()).toBe('fr')
    expect(getThemePreference()).toBe('dark')
    expect(isSpellCheckEnabled()).toBe(false)
    expect(editorStore.getState().marqueeMode).toBe('enclose')
    expect(readDefaultGrid()).toEqual(grid(16))
    expect(chordFor('file.save')).toBe('Mod+K')
    expect(getDoc().settings.gridSize).toBe(32)

    expect(summary.applied).toContain('language')
    expect(summary.applied).toContain('shortcuts')
    expect(summary.changedDocument).toBe(true)
  })

  it('touches the document only when the file carries canvas settings', () => {
    const summary = applyPreferences(file({ theme: 'dark' }))
    expect(summary.changedDocument).toBe(false)
    expect(summary.applied).toEqual(['theme'])
  })

  it('replaces the keymap rather than merging into it', () => {
    // An imported keymap is a complete answer to "what are my shortcuts",
    // and merging would leave the importing machine's own edits behind.
    setBinding('file.open', 'Mod+J')
    applyPreferences(file({ shortcuts: { 'file.save': 'Mod+K' } }))
    expect(keymapOverrides()).toEqual({ 'file.save': 'Mod+K' })
    expect(chordFor('file.open')).toBe('Mod+O')
  })

  it('skips a bad value without losing the good ones next to it', () => {
    const summary = applyPreferences(file({
      language: 'klingon' as never,
      theme: 'neon' as never,
      marqueeMode: 'enclose',
      defaultGrid: { ...grid(-4) },
      canvas: { gridSize: 0, guideColor: { r: 1 } as never, snapToGrid: true },
    }))

    expect(getLanguage()).toBe('en')
    expect(getThemePreference()).toBe('system')
    expect(readDefaultGrid()).toBeNull()
    expect(editorStore.getState().marqueeMode).toBe('enclose')
    // The one good canvas field applied; the malformed two did not.
    expect(getDoc().settings.gridSize).not.toBe(0)
    expect(getDoc().settings.snapToGrid).toBe(true)
    expect(summary.applied).toContain('marquee mode')
    expect(summary.applied).not.toContain('language')
  })

  it('ignores a section it has never heard of', () => {
    const summary = applyPreferences(file({ theme: 'dark', somethingNew: 42 } as never))
    expect(summary.applied).toEqual(['theme'])
  })

  it('reports having done nothing, rather than claiming success', () => {
    expect(applyPreferences(file({})).applied).toEqual([])
  })

  it('round-trips a whole machine’s settings', () => {
    setThemePreference('dark')
    setLanguage('ja')
    setMarqueeMode('enclose')
    setBinding('arrange.group', 'Mod+Shift+K')
    updateSettings({ gridSize: 20 })
    const exported = serializePreferences(collectPreferences(NOW))

    // Now become a different machine.
    localStorage.clear()
    resetAllBindings()
    setThemePreference('light')
    setLanguage('en')
    setMarqueeMode('touch')
    replaceDocument(createDocument('Elsewhere', false))

    applyPreferences(parsePreferences(exported))
    expect(getThemePreference()).toBe('dark')
    expect(getLanguage()).toBe('ja')
    expect(editorStore.getState().marqueeMode).toBe('enclose')
    expect(chordFor('arrange.group')).toBe('Mod+Shift+K')
    expect(getDoc().settings.gridSize).toBe(20)
  })
})
