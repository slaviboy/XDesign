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
 * Shadows, blurs and Outline Stroke, at the level below the DOM.
 *
 * The stroke outliner is checked against shapes whose exact answer is known —
 * a stroked horizontal line IS a rectangle — rather than against a snapshot of
 * whatever it happened to produce, so a regression in the geometry fails here
 * instead of quietly changing the picture.
 */

import { describe, it, expect } from 'vitest'
import { outlineStroke } from '../../src/geometry/StrokeOutline'
import { pathBounds, pointInPath } from '../../src/geometry/PathUtils'
import {
  activeBlur,
  activeShadow,
  backgroundBlurPrimitives,
  blurStdDeviation,
  effectFilter,
} from '../../src/canvas/effects'
import {
  DEFAULT_BLUR,
  DEFAULT_SHADOW,
  DEFAULT_STYLE,
  isMaskGroup,
  type Style,
} from '../../src/document/types'
import { createDocument, createGroup, createRect } from '../../src/document/NodeFactory'
import { addNode } from '../../src/document/DocumentModel'
import { deserializeDocument, serializeDocument } from '../../src/persistence/FileFormat'

const BOX = { width: 100, height: 60 }
const CENTER = {
  width: 10,
  cap: 'butt' as const,
  join: 'miter' as const,
  miterLimit: 4,
  align: 'center' as const,
}

const styleWith = (patch: Partial<Style>): Style => ({ ...DEFAULT_STYLE, ...patch })

// ------------------------------------------------------------------ filters --

describe('effect filters', () => {
  it('a shape with no effects needs no filter', () => {
    expect(effectFilter('n1', DEFAULT_STYLE, BOX)).toBeNull()
  })

  it('an unchecked effect is off but not forgotten', () => {
    const style = styleWith({ shadow: { ...DEFAULT_SHADOW, visible: false } })
    expect(activeShadow(style)).toBeNull()
    expect(effectFilter('n1', style, BOX)).toBeNull()
    // The settings are still there to come back to — that is the whole point of
    // a checkbox rather than a delete.
    expect(style.shadow?.blur).toBe(DEFAULT_SHADOW.blur)
  })

  it('a drop shadow is one feDropShadow, at half the blur', () => {
    const style = styleWith({ shadow: { ...DEFAULT_SHADOW, x: 3, y: -5, blur: 12 } })
    const filter = effectFilter('n1', style, BOX)!
    expect(filter.primitives).toContain('<feDropShadow')
    expect(filter.primitives).toContain('dx="3"')
    expect(filter.primitives).toContain('dy="-5"')
    // Adobe's blur is a radius; SVG wants a standard deviation, which is half.
    expect(filter.primitives).toContain('stdDeviation="6"')
    expect(blurStdDeviation(12)).toBe(6)
  })

  it('an inner shadow subtracts a shifted copy of the shape from itself', () => {
    const style = styleWith({ shadow: { ...DEFAULT_SHADOW, kind: 'inner' } })
    const p = effectFilter('n1', style, BOX)!.primitives
    expect(p).not.toContain('feDropShadow')
    // The rim, flooded and drawn back over the shape.
    expect(p).toContain('<feOffset')
    expect(p).toContain('operator="out"')
    expect(p).toContain('<feFlood')
    expect(p).toContain('operator="over"')
  })

  it('a blurred shape casts a shadow of its blurred self', () => {
    const style = styleWith({
      shadow: { ...DEFAULT_SHADOW },
      blur: { ...DEFAULT_BLUR, kind: 'object', amount: 8 },
    })
    const p = effectFilter('n1', style, BOX)!.primitives
    // Threaded, not two primitives both reading SourceGraphic — one of which
    // would win and the other would vanish.
    expect(p).toContain('result="fx-blur"')
    expect(p).toContain('in="fx-blur"')
  })

  it('the filter region is in user space, so a flat shape still gets one', () => {
    const style = styleWith({ shadow: { ...DEFAULT_SHADOW, x: 40, y: 40, blur: 20 } })
    // A horizontal line: zero height, which a percentage-based region collapses.
    const filter = effectFilter('n1', style, { width: 200, height: 0 })!
    expect(filter.height).toBeGreaterThan(100)
    // Wide enough for the offset AND the blur, or the shadow is clipped square.
    expect(filter.width).toBeGreaterThan(200 + 40 + 20)
  })

  it('background blur is not an object filter, and object blur is not a backdrop', () => {
    const background = styleWith({ blur: { ...DEFAULT_BLUR, kind: 'background' } })
    expect(effectFilter('n1', background, BOX)).toBeNull()
    expect(activeBlur(background, 'object')).toBeNull()
    expect(activeBlur(background, 'background')).not.toBeNull()

    const object = styleWith({ blur: { ...DEFAULT_BLUR, kind: 'object' } })
    expect(effectFilter('n1', object, BOX)).not.toBeNull()
    expect(activeBlur(object, 'background')).toBeNull()
  })

  it('brightness rides on a linear transfer, black at -50 and double at +50', () => {
    expect(backgroundBlurPrimitives({ ...DEFAULT_BLUR, brightness: 0 })).not.toContain('feFunc')
    expect(backgroundBlurPrimitives({ ...DEFAULT_BLUR, brightness: -50 })).toContain('slope="0"')
    expect(backgroundBlurPrimitives({ ...DEFAULT_BLUR, brightness: 50 })).toContain('slope="2"')
  })
})

// ---------------------------------------------------------- outline stroke --

describe('outlineStroke', () => {
  it('a stroked line is exactly a rectangle', () => {
    const d = outlineStroke('M0 50L100 50', CENTER)
    expect(pathBounds(d)).toEqual({ x: 0, y: 45, width: 100, height: 10 })
    expect(pointInPath(d, { x: 50, y: 50 })).toBe(true)
    expect(pointInPath(d, { x: 50, y: 39 })).toBe(false)
  })

  it('a stroked closed shape is a ring, with a hole in it', () => {
    const d = outlineStroke('M0 0L100 0L100 60L0 60Z', CENTER)
    expect(pathBounds(d)).toEqual({ x: -5, y: -5, width: 110, height: 70 })
    // On the edge is solid; the middle is not, or the fill would be a slab.
    expect(pointInPath(d, { x: 50, y: 0 })).toBe(true)
    expect(pointInPath(d, { x: 50, y: 30 })).toBe(false)
  })

  it('caps add their own length, and a round cap reaches as far as a square one', () => {
    const butt = pathBounds(outlineStroke('M0 50L100 50', CENTER))
    const square = pathBounds(outlineStroke('M0 50L100 50', { ...CENTER, cap: 'square' }))
    const round = pathBounds(outlineStroke('M0 50L100 50', { ...CENTER, cap: 'round' }))
    expect(butt.width).toBe(100)
    expect(square.width).toBeCloseTo(110, 1)
    // The half-disc has to bulge PAST the end, not back into the stroke.
    expect(round.width).toBeCloseTo(110, 1)
    expect(round.x).toBeCloseTo(-5, 1)
  })

  it('inside and outside put the whole width on one side', () => {
    const shape = 'M0 0L100 0L100 60L0 60Z'
    expect(pathBounds(outlineStroke(shape, { ...CENTER, align: 'inner' })))
      .toEqual({ x: 0, y: 0, width: 100, height: 60 })
    expect(pathBounds(outlineStroke(shape, { ...CENTER, align: 'outer' })))
      .toEqual({ x: -10, y: -10, width: 120, height: 80 })
  })

  it('which way is out does not depend on how the path was wound', () => {
    const clockwise = 'M0 0L100 0L100 60L0 60Z'
    const counter = 'M0 0L0 60L100 60L100 0Z'
    for (const align of ['inner', 'outer'] as const) {
      expect(pathBounds(outlineStroke(counter, { ...CENTER, align })))
        .toEqual(pathBounds(outlineStroke(clockwise, { ...CENTER, align })))
    }
  })

  it('there is nothing to outline at zero width', () => {
    expect(outlineStroke('M0 0L100 0', { ...CENTER, width: 0 })).toBe('')
  })

  it('a miter past the limit falls back to a bevel instead of growing a spike', () => {
    // A very sharp turn: an unlimited miter runs away from the shape entirely.
    const spike = 'M0 100L50 0L100 100'
    const limited = pathBounds(outlineStroke(spike, { ...CENTER, miterLimit: 1 }))
    const generous = pathBounds(outlineStroke(spike, { ...CENTER, miterLimit: 20 }))
    expect(limited.height).toBeLessThan(generous.height)
  })
})

// -------------------------------------------------------------- persistence --

describe('effects and masks in the file', () => {
  it('a shadow, a blur and a mask all survive a save and a load', () => {
    const doc = createDocument('Effects', false)
    const rect = createRect({ width: 80, height: 40 })
    rect.style.shadow = { kind: 'inner', x: -3, y: 7, blur: 21, color: { r: 9, g: 8, b: 7, a: 0.4 }, visible: true }
    rect.style.blur = { kind: 'background', amount: 33, brightness: -12, fillOpacity: 0.75, visible: false }
    addNode(doc, rect, doc.rootId)

    const mask = createRect({ width: 40, height: 40 })
    addNode(doc, mask, doc.rootId)
    const group = createGroup()
    addNode(doc, group, doc.rootId)
    group.maskId = mask.id

    const back = deserializeDocument(serializeDocument(doc))
    const loaded = back.nodes[rect.id]!
    // toEqual, not toMatchObject: every field is part of the saved contract,
    // and an effect that loads back at a different strength is a silent
    // corruption of someone's document.
    expect('style' in loaded && loaded.style.shadow).toEqual(rect.style.shadow)
    expect('style' in loaded && loaded.style.blur).toEqual(rect.style.blur)
    // An unchecked effect is still saved — the checkbox is a setting, not a delete.
    expect('style' in loaded && loaded.style.blur?.visible).toBe(false)

    expect(isMaskGroup(back.nodes[group.id])).toBe(true)
    expect(back.nodes[group.id] as { maskId?: string }).toMatchObject({ maskId: mask.id })
  })

  it('a shape with no effects saves no effect fields at all', () => {
    const doc = createDocument('Plain', false)
    const rect = createRect({ width: 10, height: 10 })
    addNode(doc, rect, doc.rootId)
    const json = new TextDecoder().decode(serializeDocument(doc, { plainJson: true }))
    // Optional, so an untouched document does not grow, and a file written
    // before effects existed still loads unchanged.
    expect(json).not.toContain('"shadow"')
    expect(json).not.toContain('"blur"')
    expect(json).not.toContain('"maskId"')
  })
})
