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
 * Image Trace corner analysis and curve optimisation. The interesting claims
 * are geometric — where a control point lands, how far an optimised curve
 * strays from the polygon it replaced — so the assertions measure the curve
 * rather than compare it to a recorded snapshot.
 */
import { describe, it, expect } from 'vitest'
import { curveAnchorCount, smoothPolygon, type SmoothOptions } from '@/trace/smooth'
import type { Curve, Segment, Vec2 } from '@/trace/types'

const DEFAULTS: SmoothOptions = { alphaMax: 1, optTolerance: 0.2, snapToLines: 0 }

function opts(overrides: Partial<SmoothOptions> = {}): SmoothOptions {
  return { ...DEFAULTS, ...overrides }
}

/** An axis-aligned square of the given side, clockwise from the origin. */
function square(side: number): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: side, y: 0 },
    { x: side, y: side },
    { x: 0, y: side },
  ]
}

/** A regular n-gon of radius r about the origin. */
function regularPolygon(n: number, r: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n
    return { x: r * Math.cos(a), y: r * Math.sin(a) }
  })
}

function kinds(curve: Curve): string[] {
  return curve.segments.map((s) => s.kind)
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
}

function cubic(t: number, p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): Vec2 {
  const s = 1 - t
  const a = s * s * s
  const b = 3 * s * s * t
  const c = 3 * t * t * s
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/** Every point of a segment at t = 0, 0.05 ... 1, in curve order. */
function sampleSegment(from: Vec2, segment: Segment, steps = 20): Vec2[] {
  const at = (t: number): Vec2 => {
    switch (segment.kind) {
      case 'curve':
        return cubic(t, from, segment.c1, segment.c2, segment.end)
      case 'line':
        return lerp(from, segment.end, t)
      case 'corner':
        return t < 0.5 ? lerp(from, segment.c, t * 2) : lerp(segment.c, segment.end, t * 2 - 1)
    }
  }
  return Array.from({ length: steps + 1 }, (_, i) => at(i / steps))
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Distance from p to the nearest edge of the closed polygon. */
function distanceToPolygon(p: Vec2, polygon: Vec2[]): number {
  let best = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const d = distanceToSegment(p, polygon[i], polygon[(i + 1) % polygon.length])
    if (d < best) best = d
  }
  return best
}

/** How far the whole curve wanders from the polygon it was built from. */
function maxDeviation(curve: Curve, polygon: Vec2[]): number {
  let worst = 0
  let from = curve.start
  for (const segment of curve.segments) {
    for (const p of sampleSegment(from, segment)) {
      worst = Math.max(worst, distanceToPolygon(p, polygon))
    }
    from = segment.end
  }
  return worst
}

function everyPoint(curve: Curve): Vec2[] {
  const points = [curve.start]
  for (const segment of curve.segments) {
    if (segment.kind === 'curve') points.push(segment.c1, segment.c2)
    if (segment.kind === 'corner') points.push(segment.c)
    points.push(segment.end)
  }
  return points
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function expectPointClose(actual: Vec2, expected: Vec2, digits = 10): void {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
}

describe('corner analysis', () => {
  it('gives one segment per polygon vertex', () => {
    for (const n of [3, 4, 7, 24]) {
      const curve = smoothPolygon(regularPolygon(n, 10), opts({ optTolerance: 0 }))
      expect(curve.segments).toHaveLength(n)
    }
  })

  it('makes every vertex a corner at alphaMax 0', () => {
    const curve = smoothPolygon(regularPolygon(24, 10), opts({ alphaMax: 0, optTolerance: 0 }))
    expect(kinds(curve)).toEqual(new Array(24).fill('corner'))
    expect(kinds(smoothPolygon(square(10), opts({ alphaMax: 0 })))).toEqual([
      'corner',
      'corner',
      'corner',
      'corner',
    ])
  })

  it('makes no vertex a corner at alphaMax 1.3334', () => {
    // 4/3 is the alpha of a vertex whose neighbours coincide, the largest there
    // is, so a threshold above it can never be reached.
    for (const vertices of [square(10), square(100), regularPolygon(24, 10)]) {
      const curve = smoothPolygon(vertices, opts({ alphaMax: 1.3334, optTolerance: 0 }))
      expect(kinds(curve).every((k) => k === 'curve')).toBe(true)
    }
  })

  it('keeps a square sharp only once its edges are long enough', () => {
    // alpha = (1 - 2/side) / 0.75 for a right angle between edges of that
    // length, so at alphaMax 1 the corner survives from side 8 upwards. A
    // right angle is not by itself a corner: a 1-px staircase is all right
    // angles and has to round away.
    expect(kinds(smoothPolygon(square(8), opts({ optTolerance: 0 })))).toEqual([
      'corner',
      'corner',
      'corner',
      'corner',
    ])
    expect(kinds(smoothPolygon(square(7), opts({ optTolerance: 0 })))).toEqual([
      'curve',
      'curve',
      'curve',
      'curve',
    ])
    expect(kinds(smoothPolygon(square(1), opts({ optTolerance: 0 })))).toEqual([
      'curve',
      'curve',
      'curve',
      'curve',
    ])
  })

  it('runs each segment from one edge midpoint to the next, through its vertex', () => {
    const vertices = square(10)
    const curve = smoothPolygon(vertices, opts({ alphaMax: 0 }))
    // The first segment belongs to vertex 0, so it starts on the closing edge.
    expectPointClose(curve.start, midpoint(vertices[3], vertices[0]))
    curve.segments.forEach((segment, i) => {
      expect(segment.kind).toBe('corner')
      if (segment.kind !== 'corner') return
      expectPointClose(segment.c, vertices[i])
      expectPointClose(segment.end, midpoint(vertices[i], vertices[(i + 1) % 4]))
    })
  })

  it('places a curve’s control points between the midpoints and the vertex', () => {
    // potrace: interval(0.5 + 0.5*alpha, previous vertex, this vertex), which
    // for the flattest possible vertex is 0.775 of the way along the edge.
    const vertices = square(1)
    const curve = smoothPolygon(vertices, opts({ optTolerance: 0 }))
    const second = curve.segments[1]
    expect(second.kind).toBe('curve')
    if (second.kind !== 'curve') return
    expectPointClose(second.c1, { x: 0.775, y: 0 })
    expectPointClose(second.c2, { x: 1, y: 0.225 })
    expectPointClose(second.end, { x: 1, y: 0.5 })
  })

  it('keeps every control point on the segment from its end toward the vertex', () => {
    const vertices = regularPolygon(24, 10)
    const curve = smoothPolygon(vertices, opts({ optTolerance: 0 }))
    let from = curve.start
    curve.segments.forEach((segment, i) => {
      if (segment.kind !== 'curve') throw new Error('expected a curve')
      const vertex = vertices[i]
      for (const [control, anchor] of [
        [segment.c1, from],
        [segment.c2, segment.end],
      ] as Array<[Vec2, Vec2]>) {
        const along = { x: vertex.x - anchor.x, y: vertex.y - anchor.y }
        const offset = { x: control.x - anchor.x, y: control.y - anchor.y }
        expect(Math.abs(along.x * offset.y - along.y * offset.x)).toBeLessThan(1e-9)
        expect(offset.x * along.x + offset.y * along.y).toBeGreaterThan(0)
        expect(Math.hypot(offset.x, offset.y)).toBeLessThanOrEqual(Math.hypot(along.x, along.y))
      }
      from = segment.end
    })
  })

  it('does not modify the vertices it was given, nor share points with them', () => {
    const vertices = regularPolygon(9, 10)
    const before = JSON.stringify(vertices)
    const curve = smoothPolygon(vertices, opts({ snapToLines: 0.35 }))
    expect(JSON.stringify(vertices)).toBe(before)
    for (const p of everyPoint(curve)) expect(vertices.includes(p)).toBe(false)
  })
})

describe('curve optimisation', () => {
  const polygon = regularPolygon(24, 10)

  it('merges the segments of a 24-gon into far fewer', () => {
    const plain = smoothPolygon(polygon, opts({ optTolerance: 0 }))
    const optimised = smoothPolygon(polygon, opts({ optTolerance: 0.2 }))
    expect(plain.segments).toHaveLength(24)
    expect(optimised.segments.length).toBeLessThan(24)
    expect(optimised.segments.length).toBeGreaterThan(0)
    expect(kinds(optimised).every((k) => k === 'curve')).toBe(true)
  })

  it('keeps the optimised curve within 0.3 px of the polygon', () => {
    const optimised = smoothPolygon(polygon, opts({ optTolerance: 0.2 }))
    expect(maxDeviation(optimised, polygon)).toBeLessThan(0.3)
    // The unoptimised curve is the baseline: optimisation must not make the
    // fit dramatically worse than smoothing already was.
    expect(maxDeviation(smoothPolygon(polygon, opts({ optTolerance: 0 })), polygon)).toBeLessThan(0.3)
  })

  it('stays closed: the last segment ends where the curve starts', () => {
    for (const tolerance of [0, 0.05, 0.2, 1]) {
      const curve = smoothPolygon(polygon, opts({ optTolerance: tolerance }))
      const last = curve.segments[curve.segments.length - 1]
      expectPointClose(last.end, curve.start)
    }
  })

  it('is disabled by optTolerance 0', () => {
    expect(smoothPolygon(polygon, opts({ optTolerance: 0 })).segments).toHaveLength(24)
  })

  it('cannot swallow a corner', () => {
    // Corners are where the shape is not smooth, so a merged segment may never
    // cross one: a polygon of nothing but corners survives untouched.
    const curve = smoothPolygon(polygon, opts({ alphaMax: 0, optTolerance: 1 }))
    expect(curve.segments).toHaveLength(24)
    expect(kinds(curve).every((k) => k === 'corner')).toBe(true)
  })

  it('leaves a shape with corners and curves with both', () => {
    // A stadium: two long straight sides, two rows of short steps at the ends.
    const vertices: Vec2[] = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 43, y: 1 },
      { x: 44, y: 4 },
      { x: 43, y: 7 },
      { x: 40, y: 8 },
      { x: 0, y: 8 },
      { x: -3, y: 7 },
      { x: -4, y: 4 },
      { x: -3, y: 1 },
    ]
    const curve = smoothPolygon(vertices, opts())
    expect(kinds(curve)).toContain('curve')
    expect(maxDeviation(curve, vertices)).toBeLessThan(1)
  })
})

describe('snap to lines', () => {
  // A rectangle with an extra, all-but-collinear vertex in the middle of each
  // long side: smoothing turns those into curves that are visually straight.
  const flat: Vec2[] = [
    { x: 0, y: 0 },
    { x: 50, y: 0.01 },
    { x: 100, y: 0 },
    { x: 100, y: 10 },
    { x: 50, y: 10 },
    { x: 0, y: 10 },
  ]

  it('replaces a barely bent curve with a line', () => {
    const snapped = smoothPolygon(flat, opts({ optTolerance: 0, snapToLines: 0.35 }))
    const plain = smoothPolygon(flat, opts({ optTolerance: 0, snapToLines: 0 }))
    expect(kinds(plain)).not.toContain('line')
    expect(kinds(snapped).filter((k) => k === 'line')).toHaveLength(2)
    // Only the flat vertices change; the four true corners are untouched.
    expect(kinds(snapped).filter((k) => k === 'corner')).toHaveLength(4)
    expect(snapped.segments).toHaveLength(plain.segments.length)
  })

  it('is disabled by snapToLines 0', () => {
    expect(kinds(smoothPolygon(flat, opts({ snapToLines: 0 })))).not.toContain('line')
  })

  it('never straightens a curve that bends more than the tolerance', () => {
    const curve = smoothPolygon(regularPolygon(24, 10), opts({ snapToLines: 0.35 }))
    expect(kinds(curve)).not.toContain('line')
  })

  it('keeps the line within the tolerance of the curve it replaced', () => {
    const snapped = smoothPolygon(flat, opts({ optTolerance: 0, snapToLines: 0.35 }))
    const plain = smoothPolygon(flat, opts({ optTolerance: 0, snapToLines: 0 }))
    let from = plain.start
    plain.segments.forEach((segment, i) => {
      if (snapped.segments[i].kind === 'line' && segment.kind === 'curve') {
        for (const p of sampleSegment(from, segment)) {
          expect(distanceToSegment(p, from, segment.end)).toBeLessThanOrEqual(0.35)
        }
      }
      from = segment.end
    })
  })
})

describe('curveAnchorCount', () => {
  const at = (x: number, y: number): Vec2 => ({ x, y })

  it('counts a corner as two anchors and a curve or line as one', () => {
    const curve: Curve = {
      start: at(0, 0),
      segments: [
        { kind: 'corner', c: at(1, 0), end: at(2, 0) },
        { kind: 'curve', c1: at(3, 0), c2: at(4, 1), end: at(4, 2) },
        { kind: 'line', end: at(0, 0) },
      ],
    }
    expect(curveAnchorCount(curve)).toBe(4)
    expect(curveAnchorCount({ ...curve, closed: true })).toBe(4)
  })

  it('counts the start of an open curve, which no segment ends on', () => {
    const open: Curve = {
      start: at(0, 0),
      segments: [{ kind: 'line', end: at(1, 0) }],
      closed: false,
    }
    expect(curveAnchorCount(open)).toBe(2)
  })

  it('agrees with the segments a smoothed polygon actually has', () => {
    const corners = smoothPolygon(square(20), opts({ alphaMax: 0 }))
    expect(curveAnchorCount(corners)).toBe(8)
    const curves = smoothPolygon(regularPolygon(24, 10), opts({ optTolerance: 0 }))
    expect(curveAnchorCount(curves)).toBe(24)
  })
})

describe('degenerate input', () => {
  it('returns an empty curve for no vertices', () => {
    const curve = smoothPolygon([], opts())
    expect(curve.segments).toHaveLength(0)
    expect(curve.start).toEqual({ x: 0, y: 0 })
  })

  it('returns a bare point for one vertex and a line for two', () => {
    expect(smoothPolygon([{ x: 3, y: 4 }], opts()).start).toEqual({ x: 3, y: 4 })
    const two = smoothPolygon(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
      opts(),
    )
    expect(kinds(two)).toEqual(['line'])
  })

  it('survives repeated and collinear vertices', () => {
    const repeated: Vec2[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const collinear: Vec2[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ]
    const identical: Vec2[] = [
      { x: 2, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 2 },
    ]
    for (const vertices of [repeated, collinear, identical]) {
      const curve = smoothPolygon(vertices, opts({ snapToLines: 0.35 }))
      for (const p of everyPoint(curve)) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
      }
    }
  })
})

describe('fuzz', () => {
  /** Numerical Recipes' LCG: a fixed seed keeps a failure reproducible. */
  function makeRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 4294967296
    }
  }

  it('stays finite over 200 random-walk polygons', () => {
    const random = makeRandom(20260909)
    for (let trial = 0; trial < 200; trial++) {
      const n = 3 + Math.floor(random() * 30)
      const vertices: Vec2[] = []
      let x = 0
      let y = 0
      for (let i = 0; i < n; i++) {
        // One step in ten repeats the previous vertex, which is the case that
        // divides by a zero-length edge if anything is going to.
        if (random() >= 0.1) {
          x += Math.round((random() - 0.5) * 20) / 2
          y += Math.round((random() - 0.5) * 20) / 2
        }
        vertices.push({ x, y })
      }
      const options = opts({
        alphaMax: random() * 1.3334,
        optTolerance: random() < 0.2 ? 0 : random(),
        snapToLines: random() < 0.5 ? 0 : random() * 0.5,
      })

      const curve = smoothPolygon(vertices, options)
      expect(curve.segments.length).toBeGreaterThan(0)
      expect(curve.segments.length).toBeLessThanOrEqual(n)
      for (const p of everyPoint(curve)) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          throw new Error(`non-finite point in trial ${trial}: ${JSON.stringify(vertices)}`)
        }
      }
      expect(curveAnchorCount(curve)).toBeGreaterThan(0)
    }
  })

  it('never strays far from the polygon, whatever the settings', () => {
    const random = makeRandom(4242)
    for (let trial = 0; trial < 50; trial++) {
      const n = 6 + Math.floor(random() * 20)
      const radius = 5 + random() * 40
      // A star-shaped random polygon: no self-intersections, so "distance to
      // the polygon" is a meaningful measure of the fit.
      const vertices = Array.from({ length: n }, (_, i) => {
        const a = (2 * Math.PI * i) / n
        const r = radius * (0.7 + 0.3 * random())
        return { x: r * Math.cos(a), y: r * Math.sin(a) }
      })
      const tolerance = random() * 0.5
      const curve = smoothPolygon(vertices, opts({ optTolerance: tolerance }))
      expect(maxDeviation(curve, vertices)).toBeLessThan(radius / 4)
    }
  })
})
