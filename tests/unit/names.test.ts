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
 * A layer's name is the user's, and it survives every way out of the app and
 * back in: saved and reopened, and exported as SVG and imported again. A group
 * called "header" is still "header" on the other side, and so is everything
 * in it.
 */

// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import {
  createArtboard, createDocument, createEllipse, createImage, createLine, createPath, createPolygon,
  createRect, createRepeatGrid, createText,
} from '@/document/NodeFactory'
import { addNode, groupNodes } from '@/document/DocumentModel'
import { deserializeDocument, serializeDocument } from '@/persistence/FileFormat'
import { exportNodesToSvg } from '@/svg/SvgExporter'
import { importSvg } from '@/svg/SvgImporter'
import type { DesignDocument, DesignNode, ImageAsset } from '@/document/types'

const ASSET: ImageAsset = {
  id: 'asset-n',
  name: 'Photo',
  mimeType: 'image/png',
  width: 40,
  height: 20,
  byteSize: 70,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
}

/** Every kind of object, each with a name nobody would guess, some nested. */
function scene(): { doc: DesignDocument; board: string; names: string[] } {
  const doc = createDocument('Names', false)
  doc.assets[ASSET.id] = ASSET
  const board = createArtboard('Landing Page', { x: 0, y: 0, width: 800, height: 600 })
  addNode(doc, board, doc.rootId)
  const add = <T extends DesignNode>(node: T, name: string, parent = board.id): T => {
    node.name = name
    addNode(doc, node, parent)
    return node
  }

  const background = add(createRect({ x: 0, y: 0, width: 800, height: 80 }), 'header background')
  const logo = add(createEllipse({ x: 20, y: 20, width: 40, height: 40 }), 'logo mark')
  const title = add(createText('Acme', { x: 70, y: 28, width: 60, height: 24 }), 'site title')
  const header = groupNodes(doc, [background.id, logo.id, title.id])!
  doc.nodes[header]!.name = 'header'

  const star = add(createPolygon({ x: 20, y: 120, width: 60, height: 60 }, {}, 5, 0.5), 'rating star')
  const divider = add(createLine({ x: 20, y: 200, width: 300, height: 0 }), 'divider')
  const wave = add(createPath('M0 0 C20 -20 40 20 60 0', { x: 20, y: 240, width: 60, height: 20 }), 'wave')
  const photo = add(createImage(ASSET.id, 'hero photo', { x: 400, y: 120, width: 200, height: 100 }), 'hero photo')
  const cropped = add(createImage(ASSET.id, 'cropped photo', { x: 400, y: 260, width: 100, height: 100 }), 'cropped photo')
  cropped.crop = { x: 0.25, y: 0, width: 0.5, height: 1 }
  cropped.style.stroke = { ...cropped.style.stroke, paint: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }, width: 2 }

  const body = groupNodes(doc, [star.id, divider.id, wave.id])!
  doc.nodes[body]!.name = 'body'
  const content = groupNodes(doc, [body, photo.id, cropped.id])!
  doc.nodes[content]!.name = 'content'

  const shape = add(createEllipse({ x: 620, y: 400, width: 120, height: 120 }), 'avatar mask')
  const face = add(createRect({ x: 600, y: 380, width: 160, height: 160 }), 'avatar picture')
  const masked = groupNodes(doc, [face.id, shape.id])!
  const maskGroup = doc.nodes[masked]!
  maskGroup.name = 'avatar'
  if (maskGroup.type === 'group') maskGroup.maskId = shape.id

  const cell = add(createRect({ x: 20, y: 420, width: 40, height: 40 }), 'tile')
  const grid = createRepeatGrid([cell.id], { width: 40, height: 40 }, { x: 20, y: 420, width: 100, height: 40 })
  grid.columns = 2
  grid.name = 'tile grid'
  doc.nodes[grid.id] = grid
  const boardNode = doc.nodes[board.id]!
  if ('children' in boardNode) {
    boardNode.children.splice(boardNode.children.indexOf(cell.id), 1, grid.id)
  }
  grid.parentId = board.id
  cell.parentId = grid.id

  const names = [
    'Landing Page', 'header', 'header background', 'logo mark', 'site title', 'content', 'body',
    'rating star', 'divider', 'wave', 'hero photo', 'cropped photo', 'avatar', 'avatar mask',
    'avatar picture', 'tile grid', 'tile',
  ]
  return { doc, board: board.id, names }
}

const namesIn = (nodes: Record<string, DesignNode>) => new Set(Object.values(nodes).map((n) => n.name))

describe('layer names', () => {
  it('survive saving and reopening, every one', () => {
    const { doc, names } = scene()
    const back = deserializeDocument(serializeDocument(doc))
    const found = namesIn(back.nodes)
    expect(names.filter((n) => !found.has(n))).toEqual([])
    // And on the same objects, not just somewhere in the file.
    for (const node of Object.values(doc.nodes)) expect(back.nodes[node.id]?.name).toBe(node.name)
  })

  it('survive an SVG export and import, every one', async () => {
    const { doc, board, names } = scene()
    const { svg } = await exportNodesToSvg(doc, [board], { bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const result = importSvg(svg, 'landing.svg')
    const found = namesIn(result.nodes)
    expect(names.filter((n) => !found.has(n))).toEqual([])
  })

  it('come back on objects of the same kind', async () => {
    const { doc, board } = scene()
    const { svg } = await exportNodesToSvg(doc, [board], { bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const byName = new Map(Object.values(importSvg(svg).nodes).map((n) => [n.name, n.type]))
    expect(byName.get('header')).toBe('group')
    expect(byName.get('site title')).toBe('text')
    expect(byName.get('logo mark')).toBe('ellipse')
    expect(byName.get('header background')).toBe('rect')
    expect(byName.get('hero photo')).toBe('image')
    // Lines are imported as paths on purpose — see importLine — but by name.
    expect(byName.has('divider')).toBe(true)
  })

  it('keep a bordered image and its border together, both named', async () => {
    const { doc, board } = scene()
    const { svg } = await exportNodesToSvg(doc, [board], { bounds: { x: 0, y: 0, width: 800, height: 600 } })
    // One group carries the place; the picture and its border are inside it,
    // so the border moves with the picture instead of staying at the origin.
    expect(svg).toMatch(/<g [^>]*data-name="cropped photo"[^>]*transform="matrix\([^"]+\)"[^>]*><image data-name="cropped photo"[^>]*\/><path data-name="Border"/)
    const nodes = Object.values(importSvg(svg).nodes)
    const photo = nodes.find((n) => n.type === 'image' && n.name === 'cropped photo')
    expect(photo).toBeDefined()
  })
})
