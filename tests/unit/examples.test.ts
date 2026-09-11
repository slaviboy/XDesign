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
