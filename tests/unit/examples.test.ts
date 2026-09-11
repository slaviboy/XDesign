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
 * The example documents in examples/ are files people open, so they are held
 * to what opening a file needs: they load with this build's reader, every
 * picture they show is in them, and every font they name ships with the app.
 * A change to the file format that would strand them fails here rather than
 * in someone's File ▸ Open.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deserializeDocument } from '@/persistence/FileFormat'
import { isBundledFont } from '@/text/FontRegistry'
import type { DesignDocument } from '@/document/types'

function load(path: string): DesignDocument {
  return deserializeDocument(new Uint8Array(readFileSync(join(__dirname, '../..', path))))
}

/**
 * Every example, and the least it must be. Each is held to the same promises
 * a document someone opens has to keep; Aura's own checks below go further.
 */
const EXAMPLES = [
  { file: 'examples/shop-app/Aura Shopping App.xdesign', screens: 5, size: [390, 844] },
  { file: 'examples/banking/Nova Bank.xdesign', screens: 20, size: [390, 844] },
  { file: 'examples/music-studio/Riff Studio.xdesign', screens: 20, size: [1194, 834] },
  { file: 'examples/social/Glimpse.xdesign', screens: 12, size: [390, 844] },
  { file: 'examples/messaging/Relay Messenger.xdesign', screens: 12, size: [390, 844] },
] as const

describe.each(EXAMPLES)('$file', ({ file, screens, size }) => {
  const doc = load(file)
  const nodes = Object.values(doc.nodes)
  const root = doc.nodes[doc.rootId]!
  const boards = 'children' in root ? root.children.map((id) => doc.nodes[id]!) : []

  it(`opens as at least ${screens} screens, each one numbered and full size`, () => {
    expect(boards.length).toBeGreaterThanOrEqual(screens)
    for (const [i, board] of boards.entries()) {
      expect(board.type).toBe('artboard')
      expect(board.name, board.name).toMatch(new RegExp(`^${String(i + 1).padStart(2, '0')} `))
      expect([board.transform.width, board.transform.height]).toEqual(size)
    }
  })

  it('carries every picture it shows', () => {
    for (const image of nodes) {
      if (image.type !== 'image') continue
      expect(doc.assets[image.assetId]?.dataUrl, image.name).toMatch(/^data:image\/(png|jpeg);base64,/)
    }
  })

  it('names only fonts the app ships', () => {
    for (const n of nodes) {
      if (n.type === 'text') expect(isBundledFont(n.textStyle.fontFamily), n.textStyle.fontFamily).toBe(true)
    }
  })

  it('is built from named components, and carries its palette', () => {
    const groups = nodes.filter((n) => n.type === 'group')
    expect(groups.length).toBeGreaterThan(boards.length * 3)
    expect(groups.every((g) => g.name && g.name !== 'Group')).toBe(true)
    expect(doc.swatches.length).toBeGreaterThan(2)
  })
})

describe('the Aura shopping app example', () => {
  const doc = load('examples/shop-app/Aura Shopping App.xdesign')
  const nodes = Object.values(doc.nodes)

  it('opens as five phone screens', () => {
    const root = doc.nodes[doc.rootId]!
    const boards = 'children' in root ? root.children.map((id) => doc.nodes[id]!) : []
    expect(boards.map((b) => b.name)).toEqual([
      '01 Welcome', '02 Home', '03 Product', '04 Cart', '05 Order Confirmed',
    ])
    for (const board of boards) {
      expect(board.type).toBe('artboard')
      expect([board.transform.width, board.transform.height]).toEqual([390, 844])
    }
  })

  it('carries every picture it shows', () => {
    const images = nodes.filter((n) => n.type === 'image')
    expect(images.length).toBeGreaterThan(10)
    for (const image of images) {
      const asset = image.type === 'image' ? doc.assets[image.assetId] : undefined
      expect(asset?.dataUrl, image.name).toMatch(/^data:image\/(png|jpeg);base64,/)
    }
  })

  it('names only fonts the app ships, so it looks the same on any machine', () => {
    const families = new Set(nodes.flatMap((n) => (n.type === 'text' ? [n.textStyle.fontFamily] : [])))
    expect([...families].sort()).toEqual(['Inter', 'Poppins'])
    for (const family of families) expect(isBundledFont(family)).toBe(true)
  })

  it('is built from named components, not loose shapes', () => {
    const names = new Set(nodes.filter((n) => n.type === 'group').map((n) => n.name))
    for (const name of ['Status Bar', 'Tab Bar', 'Search Bar', 'Promo Banner', 'Product Card / Air Runner Pro', 'Cart Items']) {
      expect(names.has(name), name).toBe(true)
    }
  })

  it('comes with its palette', () => {
    expect(doc.swatches.length).toBe(8)
  })
})
