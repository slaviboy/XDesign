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
 * Image Trace render stage: Curve → SVG path data. Every expectation here is an
 * exact string — the output format is the contract with the rest of the editor.
 */
import { describe, it, expect } from 'vitest'
import { curveToPathData, curvesToPathData } from '@/trace/render'
import type { Curve, Vec2 } from '@/trace/types'

/**
 * A 4×4 square the way smooth.ts emits it with every vertex a corner: the
 * start is the midpoint of the first edge and each corner segment goes through
 * the vertex to the next edge midpoint.
 */
const SQUARE: Curve = {
  start: { x: 2, y: 0 },
  segments: [
    { kind: 'corner', c: { x: 4, y: 0 }, end: { x: 4, y: 2 } },
    { kind: 'corner', c: { x: 4, y: 4 }, end: { x: 2, y: 4 } },
    { kind: 'corner', c: { x: 0, y: 4 }, end: { x: 0, y: 2 } },
    { kind: 'corner', c: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
  ],
}

/** Two cubics forming a lens, closed implicitly. */
const LENS: Curve = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'curve', c1: { x: 1, y: 2 }, c2: { x: 3, y: 2 }, end: { x: 4, y: 0 } },
    { kind: 'curve', c1: { x: 3, y: -2 }, c2: { x: 1, y: -2 }, end: { x: 0, y: 0 } },
  ],
}

/** A curve whose only job is to carry one coordinate through the formatter. */
function single(x: number, y = 0): Curve {
  return { start: { x, y }, segments: [], closed: false }
}

describe('curveToPathData', () => {
  it('emits a square of corners as two L commands per corner', () => {
    expect(curveToPathData(SQUARE)).toBe(
      'M 2 0 L 4 0 L 4 2 L 4 4 L 2 4 L 0 4 L 0 2 L 0 0 L 2 0 Z',
    )
  })

  it('emits a two-segment curve as two C commands', () => {
    expect(curveToPathData(LENS)).toBe('M 0 0 C 1 2 3 2 4 0 C 3 -2 1 -2 0 0 Z')
  })

  it('emits a line segment as one L command', () => {
    const curve: Curve = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', end: { x: 10, y: 0 } },
        { kind: 'line', end: { x: 10, y: 5 } },
      ],
    }
    expect(curveToPathData(curve)).toBe('M 0 0 L 10 0 L 10 5 Z')
  })

  it('mixes segment kinds in order', () => {
    const curve: Curve = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', end: { x: 5, y: 0 } },
        { kind: 'curve', c1: { x: 6, y: 1 }, c2: { x: 6, y: 4 }, end: { x: 5, y: 5 } },
        { kind: 'corner', c: { x: 0, y: 5 }, end: { x: 0, y: 2 } },
      ],
    }
    expect(curveToPathData(curve)).toBe('M 0 0 L 5 0 C 6 1 6 4 5 5 L 0 5 L 0 2 Z')
  })

  it('closes unless closed is explicitly false', () => {
    const open: Curve = { ...LENS, closed: false }
    const closed: Curve = { ...LENS, closed: true }
    expect(curveToPathData(open)).toBe('M 0 0 C 1 2 3 2 4 0 C 3 -2 1 -2 0 0')
    expect(curveToPathData(closed)).toBe('M 0 0 C 1 2 3 2 4 0 C 3 -2 1 -2 0 0 Z')
    expect(curveToPathData(LENS).endsWith(' Z')).toBe(true)
  })

  it('renders a curve with no segments as a bare move', () => {
    expect(curveToPathData({ start: { x: 1, y: 2 }, segments: [] })).toBe('M 1 2 Z')
    expect(curveToPathData(single(1, 2))).toBe('M 1 2')
  })
})

describe('number formatting', () => {
  it('rounds to two decimals by default', () => {
    expect(curveToPathData(single(1.23456, 9.87654))).toBe('M 1.23 9.88')
    expect(curveToPathData(single(0.125))).toBe('M 0.13 0')
  })

  it('honours an explicit precision', () => {
    expect(curveToPathData(single(1.23456, 9.87654), undefined, 0)).toBe('M 1 10')
    expect(curveToPathData(single(1.23456, 9.87654), undefined, 1)).toBe('M 1.2 9.9')
    expect(curveToPathData(single(1.23456, 9.87654), undefined, 4)).toBe('M 1.2346 9.8765')
  })

  it('strips trailing zeros and a trailing dot', () => {
    expect(curveToPathData(single(1.5, 2))).toBe('M 1.5 2')
    expect(curveToPathData(single(2.1, 10))).toBe('M 2.1 10')
    expect(curveToPathData(single(100.5, 100), undefined, 4)).toBe('M 100.5 100')
  })

  it('leaves integers alone at precision 0', () => {
    // No dot means nothing to strip: 100 must not lose its zeros.
    expect(curveToPathData(single(100, 2000), undefined, 0)).toBe('M 100 2000')
  })

  it('never writes negative zero', () => {
    expect(curveToPathData(single(-0, 0))).toBe('M 0 0')
    expect(curveToPathData(single(-0.004, -0.0001))).toBe('M 0 0')
    expect(curveToPathData(single(-0.4), undefined, 0)).toBe('M 0 0')
  })

  it('keeps genuine negatives', () => {
    expect(curveToPathData(single(-1.5, -0.25))).toBe('M -1.5 -0.25')
    expect(curveToPathData(single(-0.005, 0), undefined, 2)).toBe('M -0.01 0')
  })

  it('never uses exponent notation', () => {
    expect(curveToPathData(single(1e-7, -1e-7))).toBe('M 0 0')
    expect(curveToPathData(single(123456789.125, 1e15))).toBe('M 123456789.13 1000000000000000')
    expect(curveToPathData(single(0.0000001), undefined, 6)).toBe('M 0 0')
  })

  it('writes non-finite coordinates as 0 rather than poisoning the path', () => {
    expect(curveToPathData(single(Number.NaN, Number.POSITIVE_INFINITY))).toBe('M 0 0')
    expect(curveToPathData(single(Number.NEGATIVE_INFINITY))).toBe('M 0 0')
  })
})

describe('transform', () => {
  const scaleAndShift = (p: Vec2): Vec2 => ({ x: p.x * 2 + 10, y: p.y * 2 + 20 })

  it('is applied to the start and to every control and end point', () => {
    expect(curveToPathData(SQUARE, scaleAndShift)).toBe(
      'M 14 20 L 18 20 L 18 24 L 18 28 L 14 28 L 10 28 L 10 24 L 10 20 L 14 20 Z',
    )
    expect(curveToPathData(LENS, scaleAndShift)).toBe(
      'M 10 20 C 12 24 16 24 18 20 C 16 16 12 16 10 20 Z',
    )
    const line: Curve = { start: { x: 0, y: 0 }, segments: [{ kind: 'line', end: { x: 1, y: 1 } }] }
    expect(curveToPathData(line, scaleAndShift)).toBe('M 10 20 L 12 22 Z')
  })

  it('runs before rounding, so a scale does not amplify rounding error', () => {
    // 0.333 * 3 = 0.999 → "1" — rounding first would have given 0.33 * 3 = 0.99.
    const triple = (p: Vec2): Vec2 => ({ x: p.x * 3, y: p.y * 3 })
    expect(curveToPathData(single(0.333, 0), triple)).toBe('M 1 0')
  })

  it('does not mutate the curve it is given', () => {
    const before = JSON.stringify(SQUARE)
    curveToPathData(SQUARE, scaleAndShift)
    expect(JSON.stringify(SQUARE)).toBe(before)
  })
})

describe('curvesToPathData', () => {
  it('joins subpaths with a single space', () => {
    const hole: Curve = {
      start: { x: 1, y: 1 },
      segments: [
        { kind: 'line', end: { x: 1, y: 3 } },
        { kind: 'line', end: { x: 3, y: 3 } },
        { kind: 'line', end: { x: 3, y: 1 } },
      ],
    }
    expect(curvesToPathData([SQUARE, hole])).toBe(
      'M 2 0 L 4 0 L 4 2 L 4 4 L 2 4 L 0 4 L 0 2 L 0 0 L 2 0 Z M 1 1 L 1 3 L 3 3 L 3 1 Z',
    )
  })

  it('renders one curve identically to curveToPathData', () => {
    expect(curvesToPathData([LENS])).toBe(curveToPathData(LENS))
  })

  it('returns an empty string for no curves', () => {
    expect(curvesToPathData([])).toBe('')
  })

  it('passes transform and precision through to every subpath', () => {
    const shift = (p: Vec2): Vec2 => ({ x: p.x + 0.125, y: p.y })
    expect(curvesToPathData([single(0), single(1)], shift, 3)).toBe('M 0.125 0 M 1.125 0')
    expect(curvesToPathData([single(0), single(1)], shift, 1)).toBe('M 0.1 0 M 1.1 0')
  })

  it('keeps open and closed subpaths distinct', () => {
    expect(curvesToPathData([{ ...LENS, closed: false }, SQUARE])).toBe(
      'M 0 0 C 1 2 3 2 4 0 C 3 -2 1 -2 0 0 M 2 0 L 4 0 L 4 2 L 4 4 L 2 4 L 0 4 L 0 2 L 0 0 L 2 0 Z',
    )
  })
})
