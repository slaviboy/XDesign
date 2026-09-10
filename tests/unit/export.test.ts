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
 * What the Export dialog remembers, and what an export is called and painted on.
 *
 * The remembered settings come back out of localStorage, which a person can
 * edit and a newer build can have written — so most of this is about a stored
 * value being wrong in one place and costing only that place.
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_EXPORT_SETTINGS, LAST_EXPORT_STORAGE_KEY, REMEMBER_EXPORT_STORAGE_KEY,
  initialExportSettings, isRememberingExportSettings, rememberExportSettings,
  sanitizeExportSettings, setRememberExportSettings, type ExportSettings,
} from '@/export/ExportSettings'
import { defaultExportName, exportFileSuffix, runExport } from '@/export/ExportPipeline'
import {
  applyPreferences, collectPreferences, sectionsInFile, type PreferencesFile,
} from '@/persistence/Preferences'
import { createDocument, createRect } from '@/document/NodeFactory'
import { addNode } from '@/document/DocumentModel'
import { getDoc, replaceDocument, transaction } from '@/state/DocumentStore'
import type { NodeId } from '@/document/types'

const RED = { r: 255, g: 0, b: 0, a: 1 }

const custom: ExportSettings = {
  format: 'jpeg',
  scale: 2,
  useCustomScale: false,
  customScale: 1,
  quality: 45,
  background: { enabled: true, color: RED },
  imageHandling: 'link',
  textHandling: 'reference',
  preview: true,
}

beforeEach(() => {
  localStorage.clear()
})

describe('remembering export settings', () => {
  it('is on until someone turns it off', () => {
    expect(isRememberingExportSettings()).toBe(true)
    setRememberExportSettings(false)
    expect(isRememberingExportSettings()).toBe(false)
    expect(localStorage.getItem(REMEMBER_EXPORT_STORAGE_KEY)).toBe('false')
  })

  it('opens with the defaults when nothing has been exported yet', () => {
    expect(initialExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS)
  })

  it('opens with exactly what was last chosen', () => {
    rememberExportSettings(custom)
    expect(initialExportSettings()).toEqual(custom)
  })

  it('neither uses nor updates the record while switched off', () => {
    rememberExportSettings(custom)
    setRememberExportSettings(false)
    expect(initialExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS)

    rememberExportSettings({ ...custom, format: 'svg' })
    // Switched back on, what comes back is what was remembered while it was on.
    setRememberExportSettings(true)
    expect(initialExportSettings().format).toBe('jpeg')
  })

  it('survives a record that is not JSON at all', () => {
    localStorage.setItem(LAST_EXPORT_STORAGE_KEY, '{nope')
    expect(initialExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS)
  })

  it('lets one bad field cost only itself', () => {
    const settings = sanitizeExportSettings({
      ...custom,
      format: 'bmp',
      scale: 7,
      quality: 'high',
      background: { enabled: 'yes', color: RED },
    })
    expect(settings.format).toBe(DEFAULT_EXPORT_SETTINGS.format)
    expect(settings.scale).toBe(DEFAULT_EXPORT_SETTINGS.scale)
    expect(settings.quality).toBe(DEFAULT_EXPORT_SETTINGS.quality)
    expect(settings.background).toEqual({ enabled: DEFAULT_EXPORT_SETTINGS.background.enabled, color: RED })
    // Everything that was fine is kept.
    expect(settings.imageHandling).toBe('link')
    expect(settings.textHandling).toBe('reference')
    expect(settings.preview).toBe(true)
  })

  it('pulls numbers back into what the controls can show', () => {
    const settings = sanitizeExportSettings({
      quality: 101,
      customScale: 500,
      background: { enabled: true, color: { r: 300, g: -4, b: 12.6, a: 3 } },
    })
    expect(settings.quality).toBe(100)
    expect(settings.customScale).toBe(10)
    expect(settings.background.color).toEqual({ r: 255, g: 0, b: 13, a: 1 })
    expect(sanitizeExportSettings({ quality: 43 }).quality).toBe(45)
  })

  it('travels in a preferences file as the switch, not the record', () => {
    rememberExportSettings(custom)
    setRememberExportSettings(false)
    const file = collectPreferences('2026-09-10T00:00:00.000Z')
    expect(file.rememberExport).toBe(false)
    expect(sectionsInFile(file)).toContain('rememberExport')
    expect(JSON.stringify(file)).not.toContain('textHandling')
    expect(JSON.stringify(file)).not.toContain('quality')

    setRememberExportSettings(true)
    const summary = applyPreferences({ format: 'xdesign-preferences', version: 1, rememberExport: false } as PreferencesFile)
    expect(isRememberingExportSettings()).toBe(false)
    expect(summary.applied).toEqual(['export settings'])
  })
})

describe('export file names', () => {
  it('appends the scale for pixels, and never for vectors', () => {
    expect(exportFileSuffix('png', 1)).toBe('.png')
    expect(exportFileSuffix('png', 2)).toBe('@2x.png')
    expect(exportFileSuffix('jpeg', 1.5)).toBe('@1.5x.jpg')
    expect(exportFileSuffix('heif', 3)).toBe('@3x.heic')
    expect(exportFileSuffix('webp', 2)).toBe('@2x.webp')
    expect(exportFileSuffix('svg', 4)).toBe('.svg')
  })

  it('remembers WebP like any other format', () => {
    expect(sanitizeExportSettings({ format: 'webp' }).format).toBe('webp')
  })

  function docWithRect(name: string): NodeId {
    replaceDocument(createDocument('Poster', false))
    const rect = createRect({ x: 10, y: 10, width: 100, height: 50 })
    rect.name = name
    transaction('add', (d) => { addNode(d, rect, d.rootId) })
    return rect.id
  }

  const svgNamed = async (id: NodeId, fileName?: string) =>
    (await runExport(getDoc(), { format: 'svg', area: 'selection', nodeIds: [id], scale: 1, fileName })).fileName

  it('names an export after what is in it, until a name is typed', async () => {
    const id = docWithRect('Hero')
    expect(defaultExportName(getDoc(), { area: 'selection', nodeIds: [id] })).toBe('Hero')
    expect(await svgNamed(id)).toBe('Hero.svg')
    expect(await svgNamed(id, 'Landing banner')).toBe('Landing banner.svg')
    // An emptied field is not a name.
    expect(await svgNamed(id, '   ')).toBe('Hero.svg')
  })

  it('does not double an extension someone typed themselves', async () => {
    const id = docWithRect('Hero')
    expect(await svgNamed(id, 'banner.svg')).toBe('banner.svg')
    expect(await svgNamed(id, 'banner@2x.PNG')).toBe('banner.svg')
    expect(await svgNamed(id, 'banner.webp')).toBe('banner.svg')
  })

  it('keeps a name in any script, and replaces only what a file system refuses', async () => {
    const id = docWithRect('Начало')
    expect(await svgNamed(id)).toBe('Начало.svg')
    expect(await svgNamed(id, 'ポスター')).toBe('ポスター.svg')
    expect(await svgNamed(id, 'a/b:c*d?')).toBe('a-b-c-d-.svg')
    expect(await svgNamed(id, '.hidden')).toBe('hidden.svg')
  })
})

describe('export background', () => {
  const svgOf = async (background: { r: number; g: number; b: number; a: number } | null) => {
    replaceDocument(createDocument('Poster', false))
    const rect = createRect({ x: 0, y: 0, width: 40, height: 20 })
    transaction('add', (d) => { addNode(d, rect, d.rootId) })
    const out = await runExport(getDoc(), {
      format: 'svg', area: 'selection', nodeIds: [rect.id], scale: 1, background,
    })
    return out.blob.text()
  }

  it('paints the chosen colour, translucency included', async () => {
    const svg = await svgOf({ r: 18, g: 52, b: 86, a: 0.5 })
    expect(svg).toMatch(/<rect[^>]*fill="#123456"[^>]*fill-opacity="0.5"/)
  })

  it('paints nothing when the background is off', async () => {
    const svg = await svgOf(null)
    expect(svg).not.toMatch(/<rect[^>]*fill="#ffffff"/i)
  })
})
