/**
 * Gradient sampling, the angular approximation, and the unit-space maths the
 * on-canvas editor is built on.
 *
 * Plain node — none of this touches the DOM.
 */
import { describe, it, expect } from 'vitest'
import {
  ANGULAR_TILE, ANGULAR_WEDGES, angularWedges, sampleGradientAt, sortedStops,
} from '@/canvas/paint'
import {
  ANGULAR_RING, localToUnit, offsetAlongAxis, stopPointOnAxis, unitToLocal,
} from '@/tools/GradientSession'
import { createStop } from '@/document/NodeFactory'
import { clonePaint } from '@/document/NodeFactory'
import type { GradientStop } from '@/document/types'

const RED = { r: 255, g: 0, b: 0, a: 1 }
const BLUE = { r: 0, g: 0, b: 255, a: 1 }
const ramp = (): GradientStop[] => [createStop(0, RED), createStop(1, BLUE)]

describe('sampleGradientAt', () => {
  it('is exact at each stop and interpolates between them', () => {
    const stops = ramp()
    expect(sampleGradientAt(stops, 0)).toEqual(RED)
    expect(sampleGradientAt(stops, 1)).toEqual(BLUE)
    expect(sampleGradientAt(stops, 0.5)).toMatchObject({ r: 128, g: 0, b: 128 })
  })

  it('clamps past both ends rather than extrapolating', () => {
    const stops = ramp()
    expect(sampleGradientAt(stops, -3)).toEqual(RED)
    expect(sampleGradientAt(stops, 9)).toEqual(BLUE)
  })

  it('interpolates alpha too', () => {
    const stops = [createStop(0, { ...RED, a: 0 }), createStop(1, { ...RED, a: 1 })]
    expect(sampleGradientAt(stops, 0.5).a).toBeCloseTo(0.5, 6)
  })

  it('sorts its input, so an appended out-of-order stop still works', () => {
    const stops = [createStop(1, BLUE), createStop(0, RED), createStop(0.5, { r: 0, g: 255, b: 0, a: 1 })]
    expect(sampleGradientAt(stops, 0.5)).toMatchObject({ g: 255 })
    expect(sortedStops(stops).map((s) => s.offset)).toEqual([0, 0.5, 1])
  })

  it('treats coincident stops as a hard edge, not a divide by zero', () => {
    const stops = [createStop(0, RED), createStop(0.5, RED), createStop(0.5, BLUE), createStop(1, BLUE)]
    const at = sampleGradientAt(stops, 0.5)
    expect(Number.isFinite(at.r)).toBe(true)
    expect(at).toEqual(BLUE)
  })

  it('survives an empty ramp', () => {
    expect(sampleGradientAt([], 0.5)).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })
})

describe('angular wedges', () => {
  it('covers the whole sweep with no gaps', () => {
    const wedges = angularWedges(0.5, 0.5, 0, ramp())
    expect(wedges.length).toBeGreaterThanOrEqual(ANGULAR_WEDGES)
    expect(wedges.every((w) => w.d.startsWith('M') && !w.d.includes('NaN'))).toBe(true)
  })

  it('puts a wedge boundary on every stop, so a hard edge stays hard', () => {
    // Two stops a hundredth apart is a deliberate hard edge. A uniform fan would
    // smear it across whichever two-degree slice it landed in.
    const stops = [createStop(0, RED), createStop(0.3, RED), createStop(0.31, BLUE), createStop(1, BLUE)]
    const wedges = angularWedges(0.5, 0.5, 0, stops)
    // One extra wedge per interior stop that is not already on the grid.
    expect(wedges.length).toBeGreaterThan(ANGULAR_WEDGES)
    // The colours either side of the edge are the pure endpoint colours.
    expect(wedges.some((w) => w.color.r === 255 && w.color.b === 0)).toBe(true)
    expect(wedges.some((w) => w.color.b === 255 && w.color.r === 0)).toBe(true)
  })

  it('rotation moves the seam without changing the colours', () => {
    const a = angularWedges(0.5, 0.5, 0, ramp())
    const b = angularWedges(0.5, 0.5, 90, ramp())
    expect(b.map((w) => w.color)).toEqual(a.map((w) => w.color))
    expect(b[0]!.d).not.toBe(a[0]!.d)
  })

  it('reaches past the pattern tile, so an angular stroke is covered too', () => {
    // The tile is twice the box; every wedge has to clear its far corner.
    const wedges = angularWedges(0.5, 0.5, 0, ramp())
    const far = Math.max(
      ...wedges.flatMap((w) =>
        [...w.d.matchAll(/L(-?[\d.]+) (-?[\d.]+)/g)].map((m) =>
          Math.hypot(Number(m[1]) - 0.5, Number(m[2]) - 0.5),
        ),
      ),
    )
    const tileCorner = Math.hypot(ANGULAR_TILE.x + ANGULAR_TILE.width - 0.5, ANGULAR_TILE.y + ANGULAR_TILE.height - 0.5)
    expect(far).toBeGreaterThan(tileCorner)
  })
})

describe('the unit-space trap', () => {
  it('scales unit coordinates by the box, separately per axis', () => {
    // objectBoundingBox units mean the unit square is stretched by (w, h), so a
    // 45-degree gradient is NOT a 45-degree line on a non-square node.
    expect(unitToLocal({ x: 1, y: 1 }, 200, 100)).toEqual({ x: 200, y: 100 })
    const angle = (Math.atan2(100, 200) * 180) / Math.PI
    expect(angle).toBeCloseTo(26.565, 3)
    expect(angle).not.toBeCloseTo(45, 1)
  })

  it('round-trips through local space', () => {
    const u = { x: 0.35, y: 0.8 }
    expect(localToUnit(unitToLocal(u, 240, 90), 240, 90)).toEqual(u)
  })

  it('a zero-sized box does not produce NaN', () => {
    expect(localToUnit({ x: 5, y: 5 }, 0, 0)).toEqual({ x: 0, y: 0 })
  })
})

describe('where a stop sits on each kind of axis', () => {
  const linear = { type: 'linear' as const, x1: 0, y1: 0, x2: 1, y2: 0, stops: ramp() }
  const radial = { type: 'radial' as const, cx: 0.5, cy: 0.5, r: 0.5, stops: ramp() }
  const angular = { type: 'angular' as const, cx: 0.5, cy: 0.5, rotation: 0, stops: ramp() }

  it('linear projects onto the segment', () => {
    expect(offsetAlongAxis(linear, { x: 0.25, y: 0.9 })).toBeCloseTo(0.25, 6)
    expect(stopPointOnAxis(linear, 0.25)).toEqual({ x: 0.25, y: 0 })
  })

  it('radial measures outward from the centre', () => {
    expect(offsetAlongAxis(radial, { x: 0.75, y: 0.5 })).toBeCloseTo(0.5, 6)
  })

  it('angular measures AROUND the sweep, not outward', () => {
    // A quarter turn from the start angle is offset 0.25, whatever the distance.
    expect(offsetAlongAxis(angular, { x: 0.5, y: 0.9 })).toBeCloseTo(0.25, 6)
    expect(offsetAlongAxis(angular, { x: 0.5, y: 0.55 })).toBeCloseTo(0.25, 6)
    expect(offsetAlongAxis(angular, { x: 0.9, y: 0.5 })).toBeCloseTo(0, 6)
    // ...and its stops sit on the ring, not strung along a line.
    const p = stopPointOnAxis(angular, 0.25)
    expect(Math.hypot(p.x - 0.5, p.y - 0.5)).toBeCloseTo(ANGULAR_RING, 6)
  })

  it('rotation shifts where offset 0 falls', () => {
    const turned = { ...angular, rotation: 90 }
    expect(offsetAlongAxis(turned, { x: 0.5, y: 0.9 })).toBeCloseTo(0, 6)
  })
})

describe('cloning', () => {
  it('deep-copies an angular gradient, stops included', () => {
    const paint = { type: 'angular' as const, cx: 0.5, cy: 0.5, rotation: 0, stops: ramp() }
    const copy = clonePaint(paint)
    expect(copy).toEqual(paint)
    if (copy.type !== 'angular') throw new Error('wrong type')
    // Aliasing here meant duplicating a shape and editing one copy's gradient
    // silently edited the other's.
    expect(copy.stops).not.toBe(paint.stops)
    expect(copy.stops[0]).not.toBe(paint.stops[0])
    expect(copy.stops[0]!.color).not.toBe(paint.stops[0]!.color)
  })
})
