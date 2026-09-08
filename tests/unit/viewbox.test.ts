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

/** viewBox mapping, against the cases the SVG specification spells out. */
import { describe, it, expect } from 'vitest'
import { applyToPoint } from '@/geometry/Matrix'
import { parsePreserveAspectRatio, viewBoxMatrix, DEFAULT_PRESERVE } from '@/geometry/ViewBox'

const VB = { x: 0, y: 0, width: 100, height: 100 }

describe('parsePreserveAspectRatio', () => {
  it('defaults to xMidYMid meet', () => {
    expect(parsePreserveAspectRatio(null)).toEqual(DEFAULT_PRESERVE)
    expect(parsePreserveAspectRatio('xMidYMid meet')).toEqual(DEFAULT_PRESERVE)
  })

  it('reads none, the alignments and slice', () => {
    expect(parsePreserveAspectRatio('none')).toEqual({ alignX: null, alignY: null, slice: false })
    expect(parsePreserveAspectRatio('xMinYMax slice')).toEqual({ alignX: 0, alignY: 1, slice: true })
    expect(parsePreserveAspectRatio('defer xMaxYMin')).toEqual({ alignX: 1, alignY: 0, slice: false })
  })

  it('falls back rather than throwing on nonsense', () => {
    expect(parsePreserveAspectRatio('wat')).toEqual(DEFAULT_PRESERVE)
  })
})

describe('viewBoxMatrix', () => {
  it('stretches only when align is none', () => {
    const m = viewBoxMatrix(VB, 200, 100, parsePreserveAspectRatio('none'))
    expect(applyToPoint(m, { x: 100, y: 100 })).toEqual({ x: 200, y: 100 })
  })

  it('letterboxes with meet, keeping the artwork square', () => {
    // 100x100 into 200x100: scale 1, centred horizontally with 50 either side.
    const m = viewBoxMatrix(VB, 200, 100)
    expect(applyToPoint(m, { x: 0, y: 0 })).toEqual({ x: 50, y: 0 })
    expect(applyToPoint(m, { x: 100, y: 100 })).toEqual({ x: 150, y: 100 })
  })

  it('fills and overflows with slice', () => {
    const m = viewBoxMatrix(VB, 200, 100, parsePreserveAspectRatio('xMidYMid slice'))
    // Scale 2 covers the box; the vertical overflow is split evenly.
    expect(applyToPoint(m, { x: 0, y: 0 })).toEqual({ x: 0, y: -50 })
    expect(applyToPoint(m, { x: 100, y: 100 })).toEqual({ x: 200, y: 150 })
  })

  it('honours the alignment corner', () => {
    const m = viewBoxMatrix(VB, 200, 100, parsePreserveAspectRatio('xMinYMin meet'))
    expect(applyToPoint(m, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
  })

  it('shifts a non-zero viewBox origin to the corner', () => {
    const m = viewBoxMatrix({ x: 10, y: 20, width: 100, height: 100 }, 100, 100)
    expect(applyToPoint(m, { x: 10, y: 20 })).toEqual({ x: 0, y: 0 })
  })
})
