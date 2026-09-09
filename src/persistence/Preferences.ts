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
 * Exporting and importing everything this machine knows about you.
 *
 * A preferences file is what makes a second computer feel like the first one.
 * It carries the choices that are about the person rather than the artwork:
 * the interface language, the theme, spell check, how a marquee selects, the
 * default artboard grid, and the whole keymap.
 *
 * It also carries the canvas settings the Preferences dialog shows — grid size,
 * snapping, the guide colour. Those live in the DOCUMENT rather than in
 * localStorage, because they are properties of the artwork and travel inside
 * the .xdesign file. Leaving them out would make an export quietly incomplete
 * against the dialog it claims to represent, so they are included and applied
 * to whatever document is open, as one undoable step the notification names.
 *
 * Two rules make the format survivable:
 *
 *  - Everything is optional on the way in. A file from an older build has
 *    fewer keys; one from a newer build has keys this version has never heard
 *    of. Both import, applying what they can, rather than being rejected whole.
 *  - Nothing is trusted. Every value is shape-checked before it is applied,
 *    because this is a JSON file a person can edit and mail to themselves.
 *
 * Chords are stored platform-neutrally (`Mod+S`, never `⌘S`), which is what
 * lets a Mac's keymap arrive intact on a Windows machine.
 */

import { getThemePreference, setThemePreference, type ThemePreference } from '../state/theme'
import { getLanguage, setLanguage, LANGUAGES, type LanguageCode } from '../i18n'
import { isSpellCheckEnabled, setSpellCheckEnabled } from '../text/spellcheck'
import {
  editorStore, readDefaultGrid, saveDefaultGrid, setMarqueeMode, setToolHighlight,
  type MarqueeMode, type ToolHighlight,
} from '../state/EditorStore'
import { applyKeymapOverrides, keymapOverrides, type KeymapOverrides } from '../shortcuts/keymap'
import { getDoc } from '../state/DocumentStore'
import { updateSettings } from '../history/Commands'
import type { ArtboardGrid, DesignDocument, GuideDragMode, RGBA } from '../document/types'

/** Bumped only for a change that an older reader could get WRONG, not merely miss. */
export const PREFERENCES_VERSION = 1

export const PREFERENCES_EXTENSION = '.xprefs'

export interface CanvasPreferences {
  gridSize?: number
  gridVisible?: boolean
  snapToGrid?: boolean
  snapToObjects?: boolean
  guidesVisible?: boolean
  guideColor?: RGBA
  guideDragMode?: GuideDragMode
}

export interface PreferencesFile {
  format: 'xdesign-preferences'
  version: number
  /** ISO date, for the human reading the file. Never used on import. */
  exported?: string
  language?: LanguageCode
  theme?: ThemePreference
  spellCheck?: boolean
  marqueeMode?: MarqueeMode
  toolHighlight?: ToolHighlight
  defaultGrid?: ArtboardGrid | null
  shortcuts?: KeymapOverrides
  canvas?: CanvasPreferences
}

/**
 * The pieces a preferences file is made of.
 *
 * Both dialogs are a list of these with a checkbox each, so this is the one
 * place that decides what "a preference" is. Export writes the ticked ones;
 * import applies the ticked ones, offering only those the file actually
 * contains — a checkbox for something that is not in the file would be a
 * promise nothing can keep.
 */
export type PreferenceSection =
  | 'language'
  | 'theme'
  | 'spellCheck'
  | 'marqueeMode'
  | 'toolHighlight'
  | 'defaultGrid'
  | 'shortcuts'
  | 'canvas'

export const PREFERENCE_SECTIONS: readonly PreferenceSection[] = [
  'language', 'theme', 'spellCheck', 'marqueeMode', 'toolHighlight', 'defaultGrid',
  'shortcuts', 'canvas',
]

/** Which sections a parsed file has something to say about. */
export function sectionsInFile(file: PreferencesFile): PreferenceSection[] {
  const present: PreferenceSection[] = []
  if (isLanguage(file.language)) present.push('language')
  if (isTheme(file.theme)) present.push('theme')
  if (typeof file.spellCheck === 'boolean') present.push('spellCheck')
  if (file.marqueeMode === 'touch' || file.marqueeMode === 'enclose') present.push('marqueeMode')
  if (file.toolHighlight === 'fill' || file.toolHighlight === 'tint') present.push('toolHighlight')
  // A file that deliberately carries "no default grid" is still saying
  // something about the default grid, so null counts as present.
  if (file.defaultGrid === null || isArtboardGrid(file.defaultGrid)) present.push('defaultGrid')
  if (file.shortcuts && typeof file.shortcuts === 'object') present.push('shortcuts')
  if (canvasPatch(file.canvas)) present.push('canvas')
  return present
}

/** What changed, so the notification can be specific rather than "done". */
export interface ImportSummary {
  applied: string[]
  /** Whether the open document was touched, which is the undoable part. */
  changedDocument: boolean
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function collectPreferences(
  now: string,
  sections: readonly PreferenceSection[] = PREFERENCE_SECTIONS,
): PreferencesFile {
  const wanted = new Set(sections)
  const settings = getDoc().settings
  const file: PreferencesFile = {
    format: 'xdesign-preferences',
    version: PREFERENCES_VERSION,
    exported: now,
  }

  // A section left out is ABSENT rather than null: an importer distinguishes
  // "this file has nothing to say about your theme" from "set no theme".
  if (wanted.has('language')) file.language = getLanguage()
  if (wanted.has('theme')) file.theme = getThemePreference()
  if (wanted.has('spellCheck')) file.spellCheck = isSpellCheckEnabled()
  if (wanted.has('marqueeMode')) file.marqueeMode = editorStore.getState().marqueeMode
  if (wanted.has('toolHighlight')) file.toolHighlight = editorStore.getState().toolHighlight
  if (wanted.has('defaultGrid')) file.defaultGrid = readDefaultGrid()
  if (wanted.has('shortcuts')) file.shortcuts = keymapOverrides()
  if (wanted.has('canvas')) {
    file.canvas = {
      gridSize: settings.gridSize,
      gridVisible: settings.gridVisible,
      snapToGrid: settings.snapToGrid,
      snapToObjects: settings.snapToObjects,
      guidesVisible: settings.guidesVisible,
      guideColor: settings.guideColor,
      guideDragMode: settings.guideDragMode,
    }
  }
  return file
}

/** Pretty-printed, because someone will open it in a text editor. */
export function serializePreferences(file: PreferencesFile): string {
  return JSON.stringify(file, null, 2) + '\n'
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export class PreferencesFormatError extends Error {}

export function parsePreferences(text: string): PreferencesFile {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new PreferencesFormatError('That file is not valid JSON.')
  }
  if (!value || typeof value !== 'object') {
    throw new PreferencesFormatError('That file does not contain preferences.')
  }
  const file = value as Partial<PreferencesFile>
  if (file.format !== 'xdesign-preferences') {
    throw new PreferencesFormatError('That is not an XDesign preferences file.')
  }
  if (typeof file.version === 'number' && file.version > PREFERENCES_VERSION) {
    throw new PreferencesFormatError(
      `That file was written by a newer version of XDesign (format ${file.version}).`,
    )
  }
  return file as PreferencesFile
}

/**
 * Apply a parsed file. Each section is independent: one unrecognisable value
 * costs its own setting and nothing else.
 */
export function applyPreferences(
  file: PreferencesFile,
  sections: readonly PreferenceSection[] = PREFERENCE_SECTIONS,
): ImportSummary {
  const wanted = new Set(sections)
  const applied: string[] = []

  if (wanted.has('language') && isLanguage(file.language)) {
    setLanguage(file.language)
    applied.push('language')
  }
  if (wanted.has('theme') && isTheme(file.theme)) {
    setThemePreference(file.theme)
    applied.push('theme')
  }
  if (wanted.has('spellCheck') && typeof file.spellCheck === 'boolean') {
    setSpellCheckEnabled(file.spellCheck)
    applied.push('spell check')
  }
  if (wanted.has('marqueeMode') && (file.marqueeMode === 'touch' || file.marqueeMode === 'enclose')) {
    setMarqueeMode(file.marqueeMode)
    applied.push('marquee mode')
  }
  if (wanted.has('toolHighlight') && (file.toolHighlight === 'fill' || file.toolHighlight === 'tint')) {
    setToolHighlight(file.toolHighlight)
    applied.push('active tool')
  }
  if (wanted.has('defaultGrid') && isArtboardGrid(file.defaultGrid)) {
    saveDefaultGrid(file.defaultGrid)
    applied.push('default grid')
  }
  if (wanted.has('shortcuts') && file.shortcuts && typeof file.shortcuts === 'object') {
    applyKeymapOverrides(file.shortcuts)
    applied.push('shortcuts')
  }

  const canvas = wanted.has('canvas') ? canvasPatch(file.canvas) : null
  let changedDocument = false
  if (canvas) {
    changedDocument = updateSettings(canvas)
    if (changedDocument) applied.push('canvas settings')
  }

  return { applied, changedDocument }
}

// ---------------------------------------------------------------------------
// Shape checks
// ---------------------------------------------------------------------------

function isTheme(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function isLanguage(value: unknown): value is LanguageCode {
  return typeof value === 'string' && LANGUAGES.some((l) => l.code === value)
}

function isArtboardGrid(value: unknown): value is ArtboardGrid {
  if (!value || typeof value !== 'object') return false
  const grid = value as ArtboardGrid
  if (grid.type === 'square') return typeof grid.size === 'number' && grid.size > 0
  if (grid.type === 'layout') return typeof grid.columns === 'number' && grid.columns > 0
  return false
}

function isColor(value: unknown): value is RGBA {
  if (!value || typeof value !== 'object') return false
  const c = value as RGBA
  return [c.r, c.g, c.b, c.a].every((n) => typeof n === 'number' && Number.isFinite(n))
}

/** Only the fields that are present and well-formed. */
function canvasPatch(canvas: CanvasPreferences | undefined): Partial<DesignDocument['settings']> | null {
  if (!canvas || typeof canvas !== 'object') return null
  const patch: Partial<DesignDocument['settings']> = {}

  if (typeof canvas.gridSize === 'number' && canvas.gridSize > 0) patch.gridSize = canvas.gridSize
  for (const key of ['gridVisible', 'snapToGrid', 'snapToObjects', 'guidesVisible'] as const) {
    if (typeof canvas[key] === 'boolean') patch[key] = canvas[key]
  }
  if (isColor(canvas.guideColor)) patch.guideColor = canvas.guideColor
  if (canvas.guideDragMode === 'line' || canvas.guideDragMode === 'handle') {
    patch.guideDragMode = canvas.guideDragMode
  }

  return Object.keys(patch).length > 0 ? patch : null
}
