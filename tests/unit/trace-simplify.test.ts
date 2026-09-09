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
 * Removing redundant points from a fitted curve.
 *
 * The rule is narrow on purpose: a point goes only when both of its neighbours
 * are straight and it lies on the line between them. Anything that changes the
 * shape, however slightly, has to stay — so the tests are as much about what
 * survives as about what is dropped.
 */

import { describe, it, expect } from 'vitest'
import { simplifyCurve } from '@/trace/simplify'
import { curveToPathData } from '@/trace/render'
import type { Curve, Vec2 } from '@/trace/types'

const p = (x: number, y: number): Vec2 => ({ x, y })

/** A closed path through the given points, every edge straight. */
function polyline(points: Vec2[], closed = true): Curve {
  return {
    start: points[0]!,
    segments: points.slice(1).map((end) => ({ kind: 'line' as const, end })),
    closed,
  }
}

describe('simplifyCurve', () => {
  it('drops a point that sits on the line between its neighbours', () => {
    const curve = polyline([p(0, 0), p(5, 0), p(10, 0), p(10, 10)], false)
    const out = simplifyCurve(curve)
    expect(out.segments).toHaveLength(2)
    expect(curveToPathData(out)).toBe('M 0 0 L 10 0 L 10 10')
  })

  it('keeps a point that is off the line, however slightly', () => {
    // A tenth of a pixel is ten times the tolerance and a real bend.
    const curve = polyline([p(0, 0), p(5, 0.1), p(10, 0)], false)
    expect(simplifyCurve(curve).segments).toHaveLength(2)
  })

  it('keeps a point where the path doubles back on itself', () => {
    // (10,0) is on the infinite line through (0,0) and (5,0), but not between
    // them: dropping it would erase the spur entirely.
    const curve = polyline([p(0, 0), p(10, 0), p(5, 0)], false)
    expect(simplifyCurve(curve).segments).toHaveLength(2)
  })

  it('turns potrace’s eight-point square into a four-point one', () => {
    // What the tracer actually emits for a rectangle: the polygon corners with
    // the midpoint of every edge between them.
    const square: Curve = {
      start: p(30, 10),
      segments: [
        { kind: 'corner', c: p(10, 10), end: p(10, 30) },
        { kind: 'corner', c: p(10, 50), end: p(30, 50) },
        { kind: 'corner', c: p(50, 50), end: p(50, 30) },
        { kind: 'corner', c: p(50, 10), end: p(30, 10) },
      ],
      closed: true,
    }
    const out = simplifyCurve(square)
    // Four sides, and the closing point that Z needs.
    expect(out.segments).toHaveLength(4)
    expect(out.segments.every((s) => s.kind === 'line')).toBe(true)
    expect(curveToPathData(out)).toBe('M 50 10 L 10 10 L 10 50 L 50 50 L 50 10 Z')
  })

  it('never touches a curve, or a point where a curve meets a line', () => {
    const curve: Curve = {
      start: p(0, 0),
      segments: [
        { kind: 'line', end: p(10, 0) },
        { kind: 'curve', c1: p(15, 0), c2: p(20, 5), end: p(20, 10) },
        { kind: 'line', end: p(20, 20) },
      ],
      closed: false,
    }
    expect(simplifyCurve(curve)).toEqual(curve)
  })

  it('leaves a triangle alone — every point is a corner', () => {
    const triangle = polyline([p(0, 0), p(10, 0), p(5, 8), p(0, 0)])
    expect(simplifyCurve(triangle).segments).toHaveLength(3)
  })

  it('refuses to collapse a path into nothing', () => {
    // Three collinear points closed on themselves: a degenerate sliver with no
    // area. Simplifying it away would leave a path with no shape at all.
    const sliver = polyline([p(0, 0), p(5, 0), p(10, 0), p(0, 0)])
    const out = simplifyCurve(sliver)
    expect(out.segments.length).toBeGreaterThanOrEqual(2)
  })

  it('returns the original object when there is nothing to remove', () => {
    const triangle = polyline([p(0, 0), p(10, 0), p(5, 8), p(0, 0)])
    expect(simplifyCurve(triangle)).toBe(triangle)
  })

  it('does not modify its input', () => {
    const curve = polyline([p(0, 0), p(5, 0), p(10, 0), p(10, 10)], false)
    const before = JSON.stringify(curve)
    simplifyCurve(curve)
    expect(JSON.stringify(curve)).toBe(before)
  })

  it('collapses a long straight run to its two ends', () => {
    const points = Array.from({ length: 20 }, (_, i) => p(i, 0))
    const out = simplifyCurve(polyline(points, false))
    expect(out.segments).toHaveLength(1)
    expect(out.segments[0]!.end).toEqual(p(19, 0))
  })
})
