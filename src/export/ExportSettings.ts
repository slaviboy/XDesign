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
 * The choices an export is made with, and remembering them for the next one.
 *
 * Kept per machine, in localStorage beside the theme and the marquee mode, and
 * not in the document: how you like your PNGs is a habit of yours rather than
 * a property of the artwork, and opening someone else's file should not change
 * how you export.
 *
 * Only HOW to export is remembered. WHAT to export — the area, the artboard,
 * the file name — belongs to that one export, and answering it from the last
 * one would write the wrong thing under the wrong name.
 *
 * Written as the controls change, not only when a file is exported: a format
 * and scale chosen and then left, with the dialog cancelled, are still the ones
 * someone wants to find next time, and making them export something to keep a
 * setting would be a chore the preference exists to spare them.
 */

import { SCALE_PRESETS, clampScale, type ExportFormat } from './ExportPipeline'
import type { ImageHandling, TextHandling } from '../svg/SvgExporter'
import type { RGBA } from '../document/types'

export interface ExportBackground {
  /** Off means transparent, for every format that has transparency. */
  enabled: boolean
  /** Kept while the background is off, so turning it back on restores it. */
  color: RGBA
}

export interface ExportSettings {
  format: ExportFormat
  /** The preset picked from the Scale menu. */
  scale: number
  /** Whether Custom… is chosen, and the value typed beside it. */
  useCustomScale: boolean
  customScale: number
  /** JPEG and WebP quality, in percent — one value, kept across the two. */
  quality: number
  background: ExportBackground
  imageHandling: ImageHandling
  textHandling: TextHandling
  preview: boolean
}

export const EXPORT_FORMATS: readonly ExportFormat[] = ['png', 'jpeg', 'svg', 'heif', 'webp']

export const QUALITY_MIN = 20
export const QUALITY_MAX = 100
export const QUALITY_STEP = 5

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'png',
  scale: 1,
  useCustomScale: false,
  customScale: 1,
  quality: 80,
  background: { enabled: false, color: { r: 255, g: 255, b: 255, a: 1 } },
  imageHandling: 'embed',
  textHandling: 'embed-font',
  preview: false,
}

export const REMEMBER_EXPORT_STORAGE_KEY = 'xdesign.rememberExportSettings'
export const LAST_EXPORT_STORAGE_KEY = 'xdesign.lastExportSettings'

/** On unless it has been turned off: remembering is what most people expect. */
export function isRememberingExportSettings(): boolean {
  try {
    return localStorage.getItem(REMEMBER_EXPORT_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

/**
 * Turning it off does not forget what was remembered. It stops the dialog
 * using it and stops it being updated — an accidental untick should not cost
 * the settings someone had built up.
 */
export function setRememberExportSettings(on: boolean): void {
  try {
    localStorage.setItem(REMEMBER_EXPORT_STORAGE_KEY, String(on))
  } catch {
    // Storage blocked: the choice cannot outlive the tab, and nothing reads it
    // within one either — the dialog asks each time it opens.
  }
}

/** What the Export dialog opens with. */
export function initialExportSettings(): ExportSettings {
  if (!isRememberingExportSettings()) return DEFAULT_EXPORT_SETTINGS
  try {
    const raw = localStorage.getItem(LAST_EXPORT_STORAGE_KEY)
    return raw ? sanitizeExportSettings(JSON.parse(raw)) : DEFAULT_EXPORT_SETTINGS
  } catch {
    return DEFAULT_EXPORT_SETTINGS
  }
}

/** Called whenever the dialog's settings change. */
export function rememberExportSettings(settings: ExportSettings): void {
  if (!isRememberingExportSettings()) return
  try {
    localStorage.setItem(LAST_EXPORT_STORAGE_KEY, JSON.stringify(sanitizeExportSettings(settings)))
  } catch {
    // Storage blocked or full: the export itself has already happened.
  }
}

/**
 * Every field checked on its own, falling back to the default for that field
 * alone — so a value from a newer build, or one edited by hand, costs only
 * itself rather than the whole remembered set.
 */
export function sanitizeExportSettings(value: unknown): ExportSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof ExportSettings, unknown>>
  const d = DEFAULT_EXPORT_SETTINGS
  const bg = (v.background && typeof v.background === 'object' ? v.background : {}) as Partial<
    Record<keyof ExportBackground, unknown>
  >
  return {
    format: EXPORT_FORMATS.includes(v.format as ExportFormat) ? (v.format as ExportFormat) : d.format,
    scale: (SCALE_PRESETS as readonly number[]).includes(v.scale as number) ? (v.scale as number) : d.scale,
    useCustomScale: typeof v.useCustomScale === 'boolean' ? v.useCustomScale : d.useCustomScale,
    customScale: isFiniteNumber(v.customScale) ? clampScale(v.customScale) : d.customScale,
    quality: isFiniteNumber(v.quality) ? clampQuality(v.quality) : d.quality,
    background: {
      enabled: typeof bg.enabled === 'boolean' ? bg.enabled : d.background.enabled,
      color: sanitizeColor(bg.color) ?? d.background.color,
    },
    imageHandling: v.imageHandling === 'embed' || v.imageHandling === 'link' ? v.imageHandling : d.imageHandling,
    textHandling:
      v.textHandling === 'embed-font' || v.textHandling === 'reference' ? v.textHandling : d.textHandling,
    preview: typeof v.preview === 'boolean' ? v.preview : d.preview,
  }
}

/** Snapped to the slider's own steps, so a stored value is one it can show. */
export function clampQuality(quality: number): number {
  const stepped = Math.round(quality / QUALITY_STEP) * QUALITY_STEP
  return Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, stepped))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sanitizeColor(value: unknown): RGBA | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Partial<RGBA>
  if (![c.r, c.g, c.b, c.a].every(isFiniteNumber)) return null
  const channel = (n: number) => Math.min(255, Math.max(0, Math.round(n)))
  return { r: channel(c.r!), g: channel(c.g!), b: channel(c.b!), a: Math.min(1, Math.max(0, c.a!)) }
}
