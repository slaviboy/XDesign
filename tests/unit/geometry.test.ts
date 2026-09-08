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

import { describe, it, expect } from 'vitest'
import { pathBounds, toCubicSegments, pointInPath, transformPath, pathToPolylines } from '@/geometry/PathUtils'
import { compose, rotation, translation, decompose, invert, multiply, applyToXY, IDENTITY, matEquals, parseSvgTransform } from '@/geometry/Matrix'

describe('svgpath integration', () => {
  it('normalizes to cubics', () => {
    expect(toCubicSegments('M0 0 H10 V10 Z')).toEqual([['M',0,0],['L',10,0],['L',10,10],['Z']])
  })
  it('converts quadratic exactly', () => {
    const segs = toCubicSegments('M0 0 Q 50 100 100 0')
    expect(segs[1]![0]).toBe('C')
    const got = segs[1]!.slice(1) as number[]
    for (const [i, want] of [100/3, 200/3, 200/3, 200/3, 100, 0].entries()) {
      expect(got[i]).toBeCloseTo(want, 9)
    }
  })
  it('unarcs', () => {
    const segs = toCubicSegments('M0 0 A 50 50 0 0 1 100 0')
    expect(segs.every((s: unknown[]) => ['M','C','L','Z'].includes(s[0] as string))).toBe(true)
  })
  it('bounds a rect', () => {
    expect(pathBounds('M10 20 H110 V70 H10 Z')).toEqual({ x:10, y:20, width:100, height:50 })
  })
  it('bounds a curve past its control points', () => {
    // Peak of this symmetric cubic is at y=75, not the control point's y=100.
    const b = pathBounds('M0 0 C 0 100 100 100 100 0')
    expect(b.y).toBeCloseTo(0, 6)
    expect(b.height).toBeCloseTo(75, 6)
  })
  it('bounds a full circle path', () => {
    const b = pathBounds('M50 0 A 50 50 0 1 1 49.99 0 Z')
    expect(b.width).toBeCloseTo(100, 0)
    expect(b.height).toBeCloseTo(100, 0)
  })
  it('transforms paths losslessly for arcs', () => {
    const out = transformPath('M0 0 A 50 25 0 0 1 100 0', translation(10, 20))
    expect(out).toContain('A')
    expect(pathBounds(out).x).toBeCloseTo(10, 3)
  })
  it('point-in-path nonzero vs evenodd', () => {
    // Square with a reversed inner square: nonzero -> hole, evenodd -> hole too
    const d = 'M0 0 H100 V100 H0 Z M25 25 V75 H75 V25 Z'
    expect(pointInPath(d, { x: 5, y: 50 })).toBe(true)
    expect(pointInPath(d, { x: 50, y: 50 }, 'evenodd')).toBe(false)
  })
  it('flattens', () => {
    const polys = pathToPolylines('M0 0 C 0 100 100 100 100 0')
    expect(polys.length).toBe(1)
    expect(polys[0]!.points.length).toBeGreaterThan(4)
  })
})

describe('matrix', () => {
  it('round-trips decompose/recompose through rotation', () => {
    const m = compose(rotation(30), translation(5, 7))
    const d = decompose(m)
    expect(d.rotation).toBeCloseTo(30, 6)
    expect(d.scaleX).toBeCloseTo(1, 6)
    expect(d.skewX).toBeCloseTo(0, 6)
  })
  it('inverts', () => {
    const m = compose(rotation(37), translation(11, -4))
    expect(matEquals(multiply(m, invert(m)), IDENTITY)).toBe(true)
  })
  it('round-trips a point through invert', () => {
    const m = compose(rotation(37), translation(11, -4))
    const p = applyToXY(m, 3, 9)
    const back = applyToXY(invert(m), p.x, p.y)
    expect(back.x).toBeCloseTo(3, 9)
    expect(back.y).toBeCloseTo(9, 9)
  })
  it('parses svg transform lists in order', () => {
    const m = parseSvgTransform('translate(10,20) rotate(90)')
    const p = applyToXY(m, 1, 0)
    expect(p.x).toBeCloseTo(10, 9)
    expect(p.y).toBeCloseTo(21, 9)
  })
})
