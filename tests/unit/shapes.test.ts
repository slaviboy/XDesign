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
import {
  roundedPolygonPath, roundedPolygonBounds, maxPolygonRadius, polygonBoxForOutline, polygonOutlineBounds,
  polygonStarPoints, polygonStarPath, rectPath,
} from '@/geometry/ShapeGeometry'
import { geometryBounds } from '@/document/SceneGraph'
import { pathBounds, pointInPath, pathLength, distanceToPath } from '@/geometry/PathUtils'
import { cornerGeometry, radiusHandlePosition } from '@/tools/RadiusSession'
import {
  cornerRadiusOf,
  hasScalarCornerRadius,
  supportsCornerRadius,
} from '@/document/types'
import {
  createDocument,
  createEllipse,
  createPolygon,
  createRect,
} from '@/document/NodeFactory'
import { addNode } from '@/document/DocumentModel'
import { deserializeDocument, serializeDocument } from '@/persistence/FileFormat'

describe('roundedPolygonPath', () => {
  const square = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]

  it('keeps the bounding box for a rounded square', () => {
    const b = pathBounds(roundedPolygonPath(square, 20))
    expect(b.x).toBeCloseTo(0, 3); expect(b.y).toBeCloseTo(0, 3)
    expect(b.width).toBeCloseTo(100, 3); expect(b.height).toBeCloseTo(100, 3)
  })

  it('rounds outward, not inward (corner is cut, centre intact)', () => {
    const d = roundedPolygonPath(square, 30)
    expect(pointInPath(d, {x:50,y:50})).toBe(true)   // centre still filled
    expect(pointInPath(d, {x:2,y:2})).toBe(false)    // corner removed
    expect(pointInPath(d, {x:50,y:2})).toBe(true)    // mid-edge intact
  })

  it('shortens the perimeter (a rounded corner is shorter than a sharp one)', () => {
    const sharp = pathLength(roundedPolygonPath(square, 0))
    const round = pathLength(roundedPolygonPath(square, 25))
    expect(round).toBeLessThan(sharp)
    expect(round).toBeGreaterThan(sharp * 0.8)
  })

  it('clamps an over-large radius instead of self-intersecting', () => {
    const b = pathBounds(roundedPolygonPath(square, 9999))
    expect(b.width).toBeCloseTo(100, 1)
    expect(b.height).toBeCloseTo(100, 1)
    expect(pointInPath(roundedPolygonPath(square, 9999), {x:50,y:50})).toBe(true)
  })

  it('reports a sane max radius', () => {
    expect(maxPolygonRadius(square)).toBeCloseTo(50, 3)
    expect(maxPolygonRadius(polygonStarPoints(100,100,6))).toBeGreaterThan(0)
  })

  it('rounds a star, including its reflex inner points', () => {
    const verts = polygonStarPoints(100, 100, 5, 0.5)
    const sharp = pathBounds(roundedPolygonPath(verts, 0))
    const d = roundedPolygonPath(verts, 4)
    const b = pathBounds(d)

    // A rounded tip is cut back, so the outline draws INSIDE the sharp one.
    // The node's own width/height are unchanged; only the drawing insets.
    expect(b.width).toBeLessThan(sharp.width)
    expect(b.x).toBeGreaterThanOrEqual(sharp.x - 0.01)
    expect(b.x + b.width).toBeLessThanOrEqual(sharp.x + sharp.width + 0.01)
    expect(pointInPath(d, {x:50,y:50})).toBe(true)
    expect(pointInPath(d, {x:50,y:0.5})).toBe(false)
  })

  it('rounds a triangle symmetrically about its centre', () => {
    const sharp = pathBounds(roundedPolygonPath(polygonStarPoints(80,60,3), 0))
    const b = pathBounds(roundedPolygonPath(polygonStarPoints(80,60,3), 8))
    expect(b.width).toBeLessThan(sharp.width)
    // Symmetric: the inset is the same on both sides.
    const left = b.x - sharp.x
    const right = (sharp.x + sharp.width) - (b.x + b.width)
    expect(left).toBeCloseTo(right, 4)
    expect(left).toBeGreaterThan(0)
  })

  it('emits valid path data when a vertex sits on a zero-length edge', () => {
    // The duplicated first vertex is skipped, so the opening command must still
    // be M. Keying it off the loop index produced a path starting with L, which
    // is not valid path data and renders as nothing at all.
    const dup = [{x:0,y:0},{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]
    const d = roundedPolygonPath(dup, 15)
    expect(d.startsWith('M')).toBe(true)
    const b = pathBounds(d)
    expect(b.width).toBeCloseTo(100, 3)
    expect(b.height).toBeCloseTo(100, 3)
  })

  it('falls back to a sharp outline when every vertex is degenerate', () => {
    const d = roundedPolygonPath([{x:5,y:5},{x:5,y:5},{x:5,y:5}], 10)
    expect(d.startsWith('M')).toBe(true)
    expect(d.trim()).not.toBe('Z')
  })

  it('ignores a straight-through vertex when reporting the maximum radius', () => {
    // tan(pi/2) is ~1.6e16, so a single collinear vertex used to report a
    // "limit" of ~4e17 instead of being skipped the way the path builder skips it.
    // Splitting the top edge halves the shortest edge at the two upper corners,
    // so the honest limit is 25 - not the 4e17 the collinear vertex reported.
    const withCollinear = [{x:0,y:0},{x:50,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]
    expect(maxPolygonRadius(withCollinear)).toBeCloseTo(25, 3)
    expect(maxPolygonRadius([{x:0,y:0},{x:50,y:0},{x:100,y:0}])).toBe(0)
  })

  it('shape helpers pass the radius through', () => {
    expect(polygonStarPath(80,60,3,1,0)).not.toContain('A')
    expect(polygonStarPath(80,60,3,1,8)).toContain('A')
    expect(polygonStarPath(100,100,6,1,6)).toContain('A')
    expect(polygonStarPath(100,100,5,0.5,4)).toContain('A')
  })
})

describe('a rounded polygon is framed by its outline', () => {
  const cases: Array<[number, number, number, number, number]> = []
  for (const [w, h] of [[200, 140], [80, 160]]) {
    for (const sides of [3, 5, 6, 8]) {
      for (const ratio of [1, 0.5]) {
        for (const radius of [4, 12, 40, 9999]) cases.push([w, h, sides, ratio, radius])
      }
    }
  }

  it('measures exactly the outline it draws', () => {
    // Computed from the arcs rather than from the path, so it is checked against
    // the path: the drawn outline and the framed one must be the same outline.
    // To pathBounds' precision, which measures an arc as the cubics it converts
    // it to — and those bulge past the true circle by up to ~3e-4 of its radius.
    for (const [w, h, sides, ratio, radius] of cases) {
      const drawn = pathBounds(polygonStarPath(w, h, sides, ratio, radius))
      const framed = polygonOutlineBounds(w, h, sides, ratio, radius)
      const label = `${sides} sides, ratio ${ratio}, r ${radius}, ${w}x${h}`
      // Per side; a width or height has two sides to be out by.
      const side = 3e-4 * Math.min(radius, Math.max(w, h)) + 2e-3
      for (const k of ['x', 'y', 'width', 'height'] as const) {
        const tolerance = k === 'width' || k === 'height' ? 2 * side : side
        expect(Math.abs(framed[k] - drawn[k]), `${label}: ${k}`).toBeLessThan(tolerance)
      }
      expect(roundedPolygonBounds(polygonStarPoints(w, h, sides, ratio), radius)).toEqual(framed)
    }
  })

  it('finds a corner furthest out in the middle of its arc, exactly', () => {
    // A diamond: each corner is square and points along an axis, so its arc
    // reaches furthest at its midpoint — r·(√2 − 1) in from the vertex — and
    // not at either end, where only the tangent points are.
    const diamond = [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }]
    const r = 12
    const inset = r * (Math.SQRT2 - 1)
    const b = roundedPolygonBounds(diamond, r)
    expect(b.x).toBeCloseTo(inset, 9)
    expect(b.y).toBeCloseTo(inset, 9)
    expect(b.width).toBeCloseTo(100 - 2 * inset, 9)
    expect(b.height).toBeCloseTo(100 - 2 * inset, 9)
  })

  it('a triangle rounded hard stands well inside its box, most of all at its tip', () => {
    const b = polygonOutlineBounds(200, 200, 3, 1, 30)
    expect(b.y).toBeGreaterThan(20)
    expect(b.x).toBeGreaterThan(0)
    expect(b.y + b.height).toBeCloseTo(200, 6)
  })

  it('a sharp polygon or star still fills its box exactly', () => {
    for (const sides of [3, 5, 7]) {
      for (const ratio of [1, 0.4]) {
        expect(polygonOutlineBounds(120, 90, sides, ratio, 0)).toEqual({ x: 0, y: 0, width: 120, height: 90 })
      }
    }
  })

  it('solves the box whose outline a resize asks for', () => {
    for (const [w, h, sides, ratio, radius] of cases) {
      for (const target of [{ width: 300, height: 90 }, { width: 40, height: 260 }, { width: 1, height: 1 }]) {
        const fit = polygonBoxForOutline(target, sides, ratio, radius, { width: w, height: h })
        const got = polygonOutlineBounds(fit.width, fit.height, sides, ratio, radius)
        expect(got.width).toBeCloseTo(target.width, 5)
        expect(got.height).toBeCloseTo(target.height, 5)
        expect(fit.outline).toEqual(got)
      }
    }
  })

  it('measures a rounded polygon in the document by its outline', () => {
    const doc = createDocument('Outline', false)
    const tri = createPolygon({ x: 100, y: 50, width: 200, height: 200 }, {}, 3, 1)
    tri.cornerRadius = 30
    addNode(doc, tri, doc.rootId)
    const outline = polygonOutlineBounds(200, 200, 3, 1, 30)
    const b = geometryBounds(doc, tri.id)
    expect(b.x).toBeCloseTo(100 + outline.x, 6)
    expect(b.y).toBeCloseTo(50 + outline.y, 6)
    expect(b.width).toBeCloseTo(outline.width, 6)
    expect(b.height).toBeCloseTo(outline.height, 6)
  })
})

describe('corner geometry for radius handles', () => {
  it('a box corner rides the diagonal', () => {
    const rect = createRect({ x: 0, y: 0, width: 200, height: 100 })
    const geo = cornerGeometry(rect, 'nw')!
    expect(geo.point).toEqual({ x: 0, y: 0 })
    // 45 degrees into the shape.
    expect(geo.inward.x).toBeCloseTo(Math.SQRT1_2, 6)
    expect(geo.inward.y).toBeCloseTo(Math.SQRT1_2, 6)
    // Capped by the shorter side.
    expect(geo.maxRadius).toBeCloseTo(50, 6)
  })

  it('each box corner points inward', () => {
    const rect = createRect({ x: 0, y: 0, width: 100, height: 100 })
    for (const [corner, sx, sy] of [
      ['nw', 1, 1], ['ne', -1, 1], ['se', -1, -1], ['sw', 1, -1],
    ] as const) {
      const geo = cornerGeometry(rect, corner)!
      expect(Math.sign(geo.inward.x)).toBe(sx)
      expect(Math.sign(geo.inward.y)).toBe(sy)
    }
  })

  it('a polygon vertex uses its angle bisector', () => {
    const poly = createPolygon({ x: 0, y: 0, width: 100, height: 100 }, {}, 6, 1)
    const geo = cornerGeometry(poly, 'vertex')!
    // First vertex of a polygon sits at the top, so the bisector points down.
    expect(geo.point.y).toBeCloseTo(0, 4)
    expect(geo.inward.y).toBeGreaterThan(0)
    expect(Math.hypot(geo.inward.x, geo.inward.y)).toBeCloseTo(1, 6)
    expect(geo.sinHalf).toBeGreaterThan(0)
    expect(geo.maxRadius).toBeGreaterThan(0)
  })

  it('a star tip is sharper than a hexagon vertex', () => {
    const star = createPolygon({ x: 0, y: 0, width: 100, height: 100 }, {}, 5, 0.4)
    const poly = createPolygon({ x: 0, y: 0, width: 100, height: 100 }, {}, 6, 1)
    // A sharper vertex has a smaller half-angle, so a given handle distance
    // maps to a smaller radius — which is what sinHalf encodes.
    expect(cornerGeometry(star, 'vertex')!.sinHalf).toBeLessThan(
      cornerGeometry(poly, 'vertex')!.sinHalf,
    )
  })

  it('the handle sits a constant gap inside the corner it rounds', () => {
    const rect = createRect({ x: 0, y: 0, width: 200, height: 200 })
    const inset = 10

    const atZero = radiusHandlePosition(rect, 'nw', 0, inset)!
    // With no radius the handle still stands off the corner so it is grabbable.
    expect(Math.hypot(atZero.x, atZero.y)).toBeCloseTo(inset, 4)

    // At every radius it is the SAME distance in from the drawn outline, and on
    // the inside of it — not on the curve, and not drifting toward the middle.
    // From r = 0 up, because a sharp corner has no arc: there the nearest bit of
    // outline is an edge, so the perpendicular gap is inset * sin(45deg), not
    // inset. That is the stand-off asserted above, measured along the bisector.
    for (const r of [10, 25, 60, 100]) {
      const at = radiusHandlePosition(rect, 'nw', r, inset)!
      const outline = rectPath(200, 200, [r, 0, 0, 0])
      // To half a unit: distanceToPath samples the outline as a polyline, which
      // cuts the corner slightly on a small arc.
      expect(distanceToPath(outline, at), `radius ${r}`).toBeCloseTo(inset, 0)
      expect(pointInPath(outline, at), `radius ${r}`).toBe(true)
    }
  })

  it('tracks the corner rather than the shape centre as the radius grows', () => {
    const rect = createRect({ x: 0, y: 0, width: 200, height: 200 })
    // The arc's centre would be at r * sqrt(2); the handle is r * (sqrt(2) - 1)
    // plus the stand-off, which is a little over a third as far in.
    const at = radiusHandlePosition(rect, 'nw', 60, 0)!
    expect(Math.hypot(at.x, at.y)).toBeCloseTo(60 * (Math.SQRT2 - 1), 4)
  })

  it('returns nothing for a shape with no corners', () => {
    const ellipse = createEllipse({ width: 100, height: 100 })
    expect(cornerGeometry(ellipse, 'vertex')).toBeNull()
  })
})

describe('corner radius typing', () => {
  it('classifies which shapes round, and how', () => {
    expect(supportsCornerRadius(createRect({ width: 10, height: 10 }))).toBe(true)
    expect(supportsCornerRadius(createPolygon({ width: 10, height: 10 }, {}, 5, 0.5))).toBe(true)
    expect(supportsCornerRadius(createEllipse({ width: 10, height: 10 }))).toBe(false)

    // A box has four addressable corners; a polygon has one scalar.
    expect(hasScalarCornerRadius(createRect({ width: 10, height: 10 }))).toBe(false)
    expect(hasScalarCornerRadius(createPolygon({ width: 10, height: 10 }))).toBe(true)
  })

  it('reads a single radius from either representation', () => {
    const rect = createRect({ width: 10, height: 10 })
    rect.cornerRadius = [7, 7, 7, 7]
    expect(cornerRadiusOf(rect)).toBe(7)

    const star = createPolygon({ width: 10, height: 10 }, {}, 5, 0.5)
    star.cornerRadius = 3
    expect(cornerRadiusOf(star)).toBe(3)
    expect(cornerRadiusOf(createEllipse({ width: 10, height: 10 }))).toBe(0)
  })

  it('round-trips a polygon radius through the file format', () => {
    const doc = createDocument('R', false)
    const poly = createPolygon({ width: 100, height: 100 }, {}, 7, 0.4)
    poly.cornerRadius = 9
    addNode(doc, poly, doc.rootId)

    const back = deserializeDocument(serializeDocument(doc))
    const node = back.nodes[poly.id]!
    expect(node.type).toBe('polygon')
    if (node.type === 'polygon') {
      expect(node.cornerRadius).toBe(9)
      expect(node.sides).toBe(7)
      expect(node.starRatio).toBe(0.4)
    }
  })
})
