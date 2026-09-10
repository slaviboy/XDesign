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
 * Colour, bounds, shape geometry, path points and snapping. Pure functions,
 * plain node — no DOM anywhere.
 */
import { describe, it, expect } from 'vitest'
import { parseHex, toHex, parseCssColor, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb, hsvToHsl, hslToHsv, toCss, luminance, mixRgba } from '@/document/color'
import { boundsFromPoints, contains, intersects, transformBounds, union, roundOut, fitInto, inflate, containsPoint } from '@/geometry/Bounds'
import { rotation, translation, compose } from '@/geometry/Matrix'
import { rectPath, ellipsePath, polygonStarPath, simplifyPoints, smoothPolylineToPath } from '@/geometry/ShapeGeometry'
import { pathBounds, pathRenderBounds, strokeInflate, pathLength, pointAtLength, reversePath, splitSubpaths, toCubicSegments, distanceToPath, pathOverlapsBounds } from '@/geometry/PathUtils'
import { pathToSubpaths, subpathsToPath, insertPointAt, deletePoint, togglePointType, isSmooth, closestSegment, corner, clearHandle, segmentPoint } from '@/geometry/PathPoints'
import { computeSnap, candidatesFromBounds, snapToGrid, snapValue } from '@/geometry/Snapping'

describe('colour', () => {
  it('parses every hex form', () => {
    expect(parseHex('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseHex('ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseHex('#ff000080')!.a).toBeCloseTo(0.502, 2)
    expect(parseHex('nope')).toBeNull()
  })

  it('serializes hex, with alpha only when needed', () => {
    expect(toHex({ r: 255, g: 87, b: 34, a: 1 })).toBe('#ff5722')
    expect(toHex({ r: 0, g: 0, b: 0, a: 0.5 }, true)).toBe('#00000080')
    expect(toHex({ r: 0, g: 0, b: 0, a: 1 }, true)).toBe('#000000')
  })

  it('parses css colour functions and keywords', () => {
    expect(parseCssColor('rgb(10 20 30)')).toMatchObject({ r: 10, g: 20, b: 30 })
    expect(parseCssColor('rgba(10,20,30,0.5)')!.a).toBeCloseTo(0.5, 3)
    expect(parseCssColor('hsl(120, 100%, 50%)')).toMatchObject({ r: 0, g: 255, b: 0 })
    expect(parseCssColor('red')).toMatchObject({ r: 255, g: 0, b: 0 })
    expect(parseCssColor('none')).toBeNull()
  })

  it('round-trips through HSV and HSL', () => {
    for (const c of [
      { r: 255, g: 87, b: 34, a: 1 },
      { r: 20, g: 200, b: 120, a: 1 },
      { r: 0, g: 0, b: 0, a: 1 },
      { r: 255, g: 255, b: 255, a: 1 },
    ]) {
      const hsv = rgbToHsv(c)
      const backV = hsvToRgb(hsv.h, hsv.s, hsv.v, 1)
      expect(backV.r).toBeCloseTo(c.r, 0)
      expect(backV.g).toBeCloseTo(c.g, 0)
      expect(backV.b).toBeCloseTo(c.b, 0)

      const hsl = rgbToHsl(c)
      const backL = hslToRgb(hsl.h, hsl.s, hsl.l)
      expect(backL.r).toBeCloseTo(c.r, 0)
    }
  })

  it('converts between HSV and HSL exactly, without a trip through RGB', () => {
    // Routing between the two models through 8-bit RGB quantises every value and
    // collapses the hue at the extremes, which makes the hue slider jump while
    // lightness is dragged to zero.
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        const hsl = hsvToHsl(210, s, v)
        const back = hslToHsv(hsl.h, hsl.s, hsl.l)
        expect(back.v).toBeCloseTo(v, 9)
        // Saturation is undefined at v = 0, where every colour is black.
        if (v > 0) expect(back.s).toBeCloseTo(s, 9)
        expect(hsl.h).toBe(210)
      }
    }
  })

  it('agrees with the RGB round trip it replaces', () => {
    for (const [h, s, v] of [[0, 1, 1], [120, 0.5, 0.8], [280, 0.2, 0.35]] as const) {
      const direct = hsvToHsl(h, s, v)
      const viaRgb = rgbToHsl(hsvToRgb(h, s, v))
      expect(direct.s).toBeCloseTo(viaRgb.s, 2)
      expect(direct.l).toBeCloseTo(viaRgb.l, 2)
    }
  })

  it('formats css and computes luminance', () => {
    expect(toCss({ r: 1, g: 2, b: 3, a: 1 })).toBe('rgb(1 2 3)')
    expect(toCss({ r: 1, g: 2, b: 3, a: 0.25 })).toContain('rgba')
    expect(luminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 3)
    expect(luminance({ r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(0, 3)
    expect(mixRgba({ r: 0, g: 0, b: 0, a: 0 }, { r: 100, g: 100, b: 100, a: 1 }, 0.5)).toMatchObject({ r: 50, a: 0.5 })
  })
})

describe('bounds', () => {
  it('unions, intersects and contains', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    const b = { x: 5, y: 5, width: 10, height: 10 }
    expect(union(a, b)).toEqual({ x: 0, y: 0, width: 15, height: 15 })
    expect(intersects(a, b)).toBe(true)
    expect(intersects(a, { x: 100, y: 100, width: 1, height: 1 })).toBe(false)
    expect(contains(union(a, b), a)).toBe(true)
    expect(containsPoint(a, { x: 5, y: 5 })).toBe(true)
    expect(containsPoint(a, { x: 11, y: 5 })).toBe(false)
    expect(containsPoint(a, { x: 11, y: 5 }, 2)).toBe(true)
  })

  it('bounds a rotated box by its corners, not its axis-aligned box', () => {
    const box = { x: 0, y: 0, width: 10, height: 10 }
    const m = compose(translation(-5, -5), rotation(45), translation(5, 5))
    const out = transformBounds(box, m)
    // A square rotated 45 degrees has a wider AABB: 10*sqrt(2).
    expect(out.width).toBeCloseTo(10 * Math.SQRT2, 5)
    expect(out.height).toBeCloseTo(10 * Math.SQRT2, 5)
  })

  it('rounds outward so a fractional bound never clips', () => {
    expect(roundOut({ x: 0.2, y: 0.7, width: 10.1, height: 10.1 })).toEqual({ x: 0, y: 0, width: 11, height: 11 })
  })

  it('fits content into a frame', () => {
    const fit = fitInto({ x: 0, y: 0, width: 200, height: 100 }, { x: 0, y: 0, width: 100, height: 100 }, 0)
    expect(fit.scale).toBeCloseTo(0.5, 6)
  })

  it('inflates symmetrically', () => {
    expect(inflate({ x: 10, y: 10, width: 10, height: 10 }, 2)).toEqual({ x: 8, y: 8, width: 14, height: 14 })
  })

  it('bounds a point cloud', () => {
    expect(boundsFromPoints([{ x: 1, y: 5 }, { x: 9, y: 2 }])).toEqual({ x: 1, y: 2, width: 8, height: 3 })
  })
})

describe('shape geometry', () => {
  it('produces a rect of the right size', () => {
    expect(pathBounds(rectPath(100, 50))).toEqual({ x: 0, y: 0, width: 100, height: 50 })
  })

  it('clamps overlapping corner radii instead of self-intersecting', () => {
    // Radii summing past the side length must be scaled down proportionally.
    const b = pathBounds(rectPath(40, 40, [50, 50, 50, 50]))
    expect(b.width).toBeCloseTo(40, 1)
    expect(b.height).toBeCloseTo(40, 1)
  })

  it('produces an ellipse inscribed in its box', () => {
    const b = pathBounds(ellipsePath(100, 60))
    expect(b.width).toBeCloseTo(100, 1)
    expect(b.height).toBeCloseTo(60, 1)
  })

  it('fills its bounding box exactly, for every corner count', () => {
    // A regular n-gon inscribed in a circle only touches that circle at its
    // vertices, so generating straight into the box left dead margin between the
    // shape and its own selection frame for every n not divisible by 4 — a
    // hexagon reached 86.6% of the width, a pentagon 90.5% of the height.
    for (let n = 3; n <= 12; n++) {
      const b = pathBounds(polygonStarPath(100, 100, n))
      expect([n, b.x, b.y, b.width, b.height].map((v) => Math.round(v * 1e4) / 1e4))
        .toEqual([n, 0, 0, 100, 100])
    }
  })

  it('a star fills the same box as its polygon, at every ratio', () => {
    // The bounds come from the OUTER ring alone, which is what stops the frame
    // jumping while the Star Ratio handle is dragged.
    for (const ratio of [1, 0.8, 0.5, 0.2, 0.01]) {
      const b = pathBounds(polygonStarPath(100, 100, 5, ratio))
      expect([ratio, b.x, b.y, b.width, b.height].map((v) => Math.round(v * 1e4) / 1e4))
        .toEqual([ratio, 0, 0, 100, 100])
    }
  })

  it('a full star ratio is the plain polygon, not a 2n-gon', () => {
    // Ratio 1 puts every inner vertex on an edge midpoint, so the outline is
    // identical and the collinear vertices are dropped.
    expect(polygonStarPath(100, 100, 5, 1)).toBe(polygonStarPath(100, 100, 5))
  })

  it('produces polygons and stars with the right vertex counts', () => {
    expect(toCubicSegments(polygonStarPath(100, 100, 6)).filter((s) => s[0] === 'L')).toHaveLength(5)
    expect(toCubicSegments(polygonStarPath(100, 100, 5, 0.5)).filter((s) => s[0] === 'L')).toHaveLength(9)
    // Three corners IS the triangle, and it still fills its box exactly.
    expect(pathBounds(polygonStarPath(80, 60, 3))).toEqual({ x: 0, y: 0, width: 80, height: 60 })
  })

  it('simplifies a noisy trail', () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ x: i, y: Math.sin(i / 40) * 2 }))
    const simplified = simplifyPoints(pts, 1)
    expect(simplified.length).toBeLessThan(pts.length / 4)
    expect(simplified[0]).toEqual(pts[0])
    expect(simplified[simplified.length - 1]).toEqual(pts[pts.length - 1])
  })

  it('smooths a polyline into cubics', () => {
    const d = smoothPolylineToPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }])
    expect(d).toContain('C')
  })
})

describe('stroke bounds', () => {
  it('expands by more than half-width for a miter join', () => {
    // A sharp corner reaches miterlimit * width/2, not width/2. Using the
    // latter is what slices strokes off the edge of an export.
    expect(strokeInflate(10, 'miter', 'butt', 4)).toBe(20)
    expect(strokeInflate(10, 'round', 'butt', 4)).toBe(5)
    expect(strokeInflate(10, 'bevel', 'square', 4)).toBeCloseTo(10 * Math.SQRT2 / 2, 6)
    expect(strokeInflate(0)).toBe(0)
  })

  it('render bounds exceed geometry bounds when stroked', () => {
    const d = 'M0 0 L100 0 L100 100 Z'
    const geo = pathBounds(d)
    const render = pathRenderBounds(d, 8, 'miter', 'butt', 4)
    expect(render.width).toBeGreaterThan(geo.width)
    expect(render.x).toBeLessThan(geo.x)
  })
})

describe('path utilities', () => {
  it('measures length and samples a point along it', () => {
    expect(pathLength('M0 0 L100 0')).toBeCloseTo(100, 1)
    const at = pointAtLength('M0 0 L100 0', 25)
    expect(at!.point.x).toBeCloseTo(25, 3)
    expect(at!.tangent.x).toBeCloseTo(1, 3)
  })

  it('measures distance to a path', () => {
    expect(distanceToPath('M0 0 L100 0', { x: 50, y: 10 })).toBeCloseTo(10, 3)
  })

  it('splits subpaths', () => {
    const subs = splitSubpaths(toCubicSegments('M0 0 L10 0 Z M20 0 L30 0'))
    expect(subs).toHaveLength(2)
    expect(subs[0]!.closed).toBe(true)
    expect(subs[1]!.closed).toBe(false)
  })

  it('reverses a path, preserving its extent', () => {
    const d = 'M0 0 C 10 20, 30 20, 40 0 Z'
    const before = pathBounds(d)
    const after = pathBounds(reversePath(d))
    expect(after.width).toBeCloseTo(before.width, 3)
    expect(after.height).toBeCloseTo(before.height, 3)
  })
})

describe('path points', () => {
  it('round-trips path data through the point model', () => {
    const d = 'M0 0 C 10 20 30 20 40 0 L60 0 Z'
    const subs = pathToSubpaths(d)
    expect(subs).toHaveLength(1)
    expect(subs[0]!.closed).toBe(true)
    const back = subpathsToPath(subs)
    const a = pathBounds(d)
    const b = pathBounds(back)
    expect(b.x).toBeCloseTo(a.x, 4)
    expect(b.width).toBeCloseTo(a.width, 4)
    expect(b.height).toBeCloseTo(a.height, 4)
  })

  it('splits a curve without changing its shape', () => {
    const d = 'M0 0 C 10 40 30 40 40 0'
    const subs = pathToSubpaths(d)
    const before = pathBounds(subpathsToPath(subs))
    insertPointAt(subs[0]!, 0, 0.5)
    expect(subs[0]!.points).toHaveLength(3)
    const after = pathBounds(subpathsToPath(subs))
    // de Casteljau split is exact: the outline must not move at all.
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    expect(after.width).toBeCloseTo(before.width, 6)
    expect(after.height).toBeCloseTo(before.height, 6)
  })

  it('splits a straight segment into two straight segments', () => {
    // De Casteljau is exact here too — its control points land on the line — but
    // it emits two curves, and a line wearing handles bends the moment either
    // neighbour is dragged. Cutting a line in half leaves two lines.
    const subs = pathToSubpaths('M0 0 L100 0 L100 100')
    expect(insertPointAt(subs[0]!, 0, 0.5)).toBe(1)
    const points = subs[0]!.points
    expect(points).toHaveLength(4)
    expect(points[1]).toMatchObject({ x: 50, y: 0, inX: null, inY: null, outX: null, outY: null })
    // Neither neighbour picked up a handle either.
    expect(points[0]!.outX).toBeNull()
    expect(points[2]!.inX).toBeNull()
    expect(subpathsToPath(subs)).not.toContain('C')
  })

  it('cuts a straight segment exactly where the preview marks it, not only at the middle', () => {
    // The click is measured by closestSegment and drawn by segmentPoint; the cut
    // has to land on that same spot. It used to take t as a plain fraction of the
    // line, which only matches the cubic the other two walk at the halfway point.
    for (const along of [0.1, 0.25, 0.5, 0.8]) {
      const subs = pathToSubpaths('M0 0 L240 120')
      const click = { x: 240 * along, y: 120 * along + 3 }
      const near = closestSegment(subs, click)!
      const preview = segmentPoint(subs[0]!, near.index, near.t)!
      insertPointAt(subs[0]!, near.index, near.t)
      const cut = subs[0]!.points[1]!
      expect(cut.x, `at ${along}`).toBeCloseTo(preview.x, 6)
      expect(cut.y, `at ${along}`).toBeCloseTo(preview.y, 6)
      // Which is the foot of the perpendicular from the click: 3 units off a
      // line of slope 1/2 lands 1.2 further along and 0.6 further across.
      expect(cut.x, `at ${along}`).toBeCloseTo(240 * along + 1.2, 3)
      expect(cut.y, `at ${along}`).toBeCloseTo(120 * along + 0.6, 3)
      expect(cut.inX).toBeNull()
    }
  })

  it('still splits a curve as a curve', () => {
    const subs = pathToSubpaths('M0 0 C 10 40 30 40 40 0 L60 0')
    insertPointAt(subs[0]!, 0, 0.5)
    expect(subpathsToPath(subs)).toContain('C')
  })

  it('toggles a point between corner and smooth', () => {
    const subs = pathToSubpaths('M0 0 L10 10 L20 0')
    expect(isSmooth(subs[0]!.points[1]!)).toBe(false)
    togglePointType(subs[0]!, 1)
    expect(isSmooth(subs[0]!.points[1]!)).toBe(true)
    togglePointType(subs[0]!, 1)
    expect(isSmooth(subs[0]!.points[1]!)).toBe(false)
  })

  it('deletes a point', () => {
    const subs = pathToSubpaths('M0 0 L10 10 L20 0')
    expect(deletePoint(subs[0]!, 1)).toBe(true)
    expect(subs[0]!.points).toHaveLength(2)
  })

  it('finds the nearest segment for click-to-insert', () => {
    const subs = pathToSubpaths('M0 0 L100 0')
    const near = closestSegment(subs, { x: 50, y: 3 })
    expect(near).toBeTruthy()
    expect(near!.distance).toBeCloseTo(3, 1)
    expect(near!.t).toBeCloseTo(0.5, 1)
  })

  it('builds a subpath from bare corners', () => {
    const d = subpathsToPath([{ points: [corner(0, 0), corner(10, 0)], closed: false }])
    expect(d).toBe('M0 0 L10 0')
  })

  it('clearHandle drops one side and leaves the other', () => {
    const subs = pathToSubpaths('M0 0 C 10 20 30 20 40 0 L60 0')
    const sub = subs[0]!
    expect(sub.points[1]!.inX).not.toBeNull()
    expect(sub.points[1]!.outX).toBeNull()

    const withOut = pathToSubpaths('M0 0 C 10 20 30 20 40 0 C 50 -20 70 -20 80 0')[0]!
    expect(withOut.points[1]!.inX).not.toBeNull()
    expect(withOut.points[1]!.outX).not.toBeNull()
    clearHandle(withOut, 1, 'out')
    // The incoming curve is untouched; only the next segment straightens.
    expect(withOut.points[1]!.outX).toBeNull()
    expect(withOut.points[1]!.inX).not.toBeNull()
  })
})

describe('snapping', () => {
  const target = { x: 100, y: 100, width: 50, height: 50 }

  it('snaps a near edge and reports a guide', () => {
    const moving = { x: 96, y: 200, width: 20, height: 20 }
    const result = computeSnap(moving, candidatesFromBounds(target), 6)
    expect(result.dx).toBeCloseTo(4, 6)
    expect(result.lines.some((l) => l.axis === 'x')).toBe(true)
  })

  it('ignores candidates beyond the threshold', () => {
    const moving = { x: 60, y: 200, width: 20, height: 20 }
    expect(computeSnap(moving, candidatesFromBounds(target), 6)).toMatchObject({ dx: 0, dy: 0 })
  })

  it('snaps centres as well as edges', () => {
    // Moving box centre at 123 should pull to the target centre at 125.
    const moving = { x: 113, y: 300, width: 20, height: 20 }
    const result = computeSnap(moving, candidatesFromBounds(target), 6)
    expect(Math.abs(result.dx)).toBeGreaterThan(0)
  })

  it('snaps to a grid', () => {
    expect(snapToGrid({ x: 17, y: 33, width: 10, height: 10 }, 8, 4)).toMatchObject({ dx: -1, dy: -1 })
    expect(snapToGrid({ x: 20, y: 20, width: 10, height: 10 }, 8, 1)).toMatchObject({ dx: 0, dy: 0 })
  })

  it('snaps a scalar', () => {
    expect(snapValue(103, [100, 200], 5)).toBe(100)
    expect(snapValue(150, [100, 200], 5)).toBe(150)
  })
})

// --------------------------------------------------- crossing selection --

describe('pathOverlapsBounds', () => {
  const RECT = 'M0 0L100 0L100 100L0 100Z'

  it('a band swept across the middle touches the shape', () => {
    // No vertex of the rectangle is inside the band, and no vertex of the band
    // is a path vertex at all: only the crossed EDGES say these overlap.
    expect(pathOverlapsBounds(RECT, { x: -50, y: 45, width: 200, height: 10 })).toBe(true)
  })

  it('a box wholly inside the shape touches it', () => {
    // Nothing is crossed here either — the box meets no edge at all.
    expect(pathOverlapsBounds(RECT, { x: 40, y: 40, width: 10, height: 10 })).toBe(true)
  })

  it('a box holding one corner touches it', () => {
    expect(pathOverlapsBounds(RECT, { x: -10, y: -10, width: 30, height: 30 })).toBe(true)
  })

  it('a box clear of the shape does not', () => {
    expect(pathOverlapsBounds(RECT, { x: 200, y: 200, width: 50, height: 50 })).toBe(false)
    // Alongside, sharing a span but never overlapping.
    expect(pathOverlapsBounds(RECT, { x: 120, y: 0, width: 40, height: 100 })).toBe(false)
  })

  it('the hole in a donut is not part of the shape', () => {
    const donut = 'M0 0L100 0L100 100L0 100ZM30 30L30 70L70 70L70 30Z'
    expect(pathOverlapsBounds(donut, { x: 45, y: 45, width: 8, height: 8 }, 'evenodd')).toBe(false)
    // The ring itself still is.
    expect(pathOverlapsBounds(donut, { x: 5, y: 45, width: 8, height: 8 }, 'evenodd')).toBe(true)
  })

  it('an open path is touched by a box its line passes through', () => {
    expect(pathOverlapsBounds('M0 0L100 100', { x: 40, y: 40, width: 10, height: 10 })).toBe(true)
    expect(pathOverlapsBounds('M0 0L100 100', { x: 80, y: 10, width: 10, height: 10 })).toBe(false)
  })
})
