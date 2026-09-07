import { describe, it, expect } from 'vitest'
import { roundedPolygonPath, maxPolygonRadius, polygonStarPoints, polygonStarPath } from '@/geometry/ShapeGeometry'
import { pathBounds, pointInPath, pathLength } from '@/geometry/PathUtils'
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

  it('the handle sits on the arc centre, and never closer than the minimum', () => {
    const rect = createRect({ x: 0, y: 0, width: 200, height: 200 })
    const atZero = radiusHandlePosition(rect, 'nw', 0, 10)!
    // With no radius the handle still stands off the corner so it is grabbable.
    expect(Math.hypot(atZero.x, atZero.y)).toBeCloseTo(10, 4)

    const at40 = radiusHandlePosition(rect, 'nw', 40, 10)!
    // r / sin(45deg) = 40 * sqrt(2) along the diagonal, i.e. 40 on each axis.
    expect(at40.x).toBeCloseTo(40, 4)
    expect(at40.y).toBeCloseTo(40, 4)
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
