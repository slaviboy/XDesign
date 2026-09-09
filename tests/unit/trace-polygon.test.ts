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
 * The optimal-polygon stage of Image Trace. Boundaries are built here rather
 * than taken from decompose, so a failure is a failure of this stage alone: the
 * smallest ones are literal corner lists and the rest come from a boundary
 * walker written in this file, itself checked against those literals.
 *
 * Every fixture goes through `expectWithinHalfPixel`, the promise the whole
 * stage rests on: for each polygon segment there is a straight line passing
 * within half a pixel of every boundary point that segment covers.
 */
import { describe, it, expect } from 'vitest'
import { adjustVertices, optimalPolygon } from '@/trace/polygon'
import type { PixelPath, Polygon, Vec2 } from '@/trace/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A closed pixel boundary from a flat corner list, with its shoelace area. */
function pixelPath(points: number[]): PixelPath {
  const n = points.length / 2
  let twice = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    twice += points[i * 2] * points[j * 2 + 1] - points[j * 2] * points[i * 2 + 1]
  }
  return { points: Int32Array.from(points), sign: twice >= 0 ? 1 : -1, area: Math.abs(twice) / 2 }
}

function point(path: PixelPath, i: number): Vec2 {
  return { x: path.points[i * 2], y: path.points[i * 2 + 1] }
}

/**
 * The outer boundary of a filled region the way decompose produces it: pixel
 * corners, starting at the top-left corner of the topmost-leftmost filled
 * pixel, keeping the filled side to the right of travel. At each corner the
 * walk turns right when the pixel ahead-right is empty, left when the pixel
 * ahead-left is filled, and otherwise carries straight on — the two diagonal
 * pixels case is the ambiguous one decompose settles with a turn policy, and
 * none of the fixtures below contain it.
 */
function outline(width: number, height: number, filled: (x: number, y: number) => boolean): PixelPath {
  const at = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && filled(x, y)

  let sx = -1
  let sy = -1
  for (let y = 0; y < height && sx < 0; y++) {
    for (let x = 0; x < width && sx < 0; x++) {
      if (at(x, y)) {
        sx = x
        sy = y
      }
    }
  }
  if (sx < 0) return pixelPath([])

  /** The pixel touching corner (x, y) in quadrant (qx, qy), each of them ±1. */
  const quadrant = (x: number, y: number, qx: number, qy: number): boolean =>
    at(x + (qx - 1) / 2, y + (qy - 1) / 2)

  const points: number[] = []
  let x = sx
  let y = sy
  let dx = 1
  let dy = 0
  do {
    points.push(x, y)
    x += dx
    y += dy
    const rx = -dy
    const ry = dx
    const lx = dy
    const ly = -dx
    if (!quadrant(x, y, dx + rx, dy + ry)) {
      dx = rx
      dy = ry
    } else if (quadrant(x, y, dx + lx, dy + ly)) {
      dx = lx
      dy = ly
    }
  } while (x !== sx || y !== sy)

  return pixelPath(points)
}

/** The four corners of pixel (3, 5), clockwise from its top-left. */
const singlePixel = pixelPath([3, 5, 4, 5, 4, 6, 3, 6])

const rect10x3 = outline(10, 3, () => true)

/** A right triangle: 20 unit steps down a 45° line, and one long side each way. */
const staircase20 = outline(20, 20, (x, y) => y <= x)

/** Arms three pixels wide, so no two perpendicular edges can merge into one. */
const plus = outline(9, 9, (x, y) => (x >= 3 && x <= 5) || (y >= 3 && y <= 5))

/** A digitised disk of radius 12 — the "how many anchors does a circle need" case. */
const circle12 = outline(24, 24, (x, y) => (x + 0.5 - 12) ** 2 + (y + 0.5 - 12) ** 2 <= 144)

const fixtures: Array<{ name: string; path: PixelPath }> = [
  { name: 'single pixel', path: singlePixel },
  { name: '10x3 rectangle', path: rect10x3 },
  { name: '20-step staircase', path: staircase20 },
  { name: 'plus sign', path: plus },
  { name: 'circle r=12', path: circle12 },
]

// ---------------------------------------------------------------------------
// The half-pixel invariant
// ---------------------------------------------------------------------------

/**
 * Half-width of the narrowest band containing the points: the smallest d for
 * which SOME straight line passes within d of all of them.
 *
 * That line is deliberately not the chord between the segment's endpoints —
 * the chord is neither what potrace promises nor what the next stage draws. A
 * 45° staircase makes the difference plain: its corners sit 0.707 px from the
 * chord but 0.354 px from the line running down the middle of the steps, and
 * the middle line is the one adjustVertices fits. The narrowest band of a point
 * set always has a convex-hull edge flush with one side, so the best over the
 * directions of all point pairs finds it exactly.
 */
function bandHalfWidth(points: Vec2[]): number {
  if (points.length < 3) return 0
  let best = Infinity
  for (const a of points) {
    for (const b of points) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (len === 0) continue
      let lo = Infinity
      let hi = -Infinity
      for (const p of points) {
        const t = (-dy * (p.x - a.x) + dx * (p.y - a.y)) / len
        lo = Math.min(lo, t)
        hi = Math.max(hi, t)
      }
      best = Math.min(best, (hi - lo) / 2)
    }
  }
  return Number.isFinite(best) ? best : 0
}

/** The worst band half-width over every segment of the polygon. */
function worstSegmentBand(path: PixelPath, poly: Polygon): number {
  const n = path.points.length / 2
  let worst = 0
  for (let i = 0; i < poly.length; i++) {
    const from = poly[i]
    const to = poly[(i + 1) % poly.length]
    const run: Vec2[] = []
    for (let k = from; ; k = (k + 1) % n) {
      run.push(point(path, k))
      if (k === to) break
    }
    worst = Math.max(worst, bandHalfWidth(run))
  }
  return worst
}

/** Every point a segment covers lies within half a pixel of one straight line. */
function expectWithinHalfPixel(path: PixelPath, poly: Polygon): void {
  expect(worstSegmentBand(path, poly)).toBeLessThanOrEqual(0.5 + 1e-9)
}

/**
 * The bound potrace's straightness test guarantees on ANY boundary: half a
 * pixel measured along the diagonal.
 *
 * The test is integer arithmetic on the corners of the pixel square, so what it
 * really pins down is how far the line may stray on the pixel grid rather than
 * in Euclidean distance. For an axis-aligned or 45° run — every edge of the
 * fixtures above, and the overwhelming majority of a real trace — the two
 * agree at half a pixel exactly. An uneven oblique staircase, two pixels across
 * every five say, is the case where they part company, and even there the band
 * never opens past this.
 */
const BAND_LIMIT = Math.SQRT1_2

/** Signed area of a vertex ring, for comparing an adjusted polygon to the shape. */
function polygonArea(vertices: Vec2[]): number {
  let twice = 0
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    twice += a.x * b.y - b.x * a.y
  }
  return Math.abs(twice) / 2
}

// ---------------------------------------------------------------------------
// The boundary walker itself
// ---------------------------------------------------------------------------

describe('outline (test fixture builder)', () => {
  it('agrees with the hand-written corner list for one pixel', () => {
    expect(Array.from(outline(1, 1, () => true).points)).toEqual([0, 0, 1, 0, 1, 1, 0, 1])
  })

  it('walks a 2x1 rectangle corner by corner', () => {
    expect(Array.from(outline(2, 1, () => true).points)).toEqual([0, 0, 1, 0, 2, 0, 2, 1, 1, 1, 0, 1])
  })

  it('produces closed unit-step boundaries wound the same way as decompose', () => {
    for (const { name, path } of fixtures) {
      const n = path.points.length / 2
      expect(n, name).toBeGreaterThanOrEqual(4)
      expect(path.sign, name).toBe(1)
      for (let i = 0; i < n; i++) {
        const a = point(path, i)
        const b = point(path, (i + 1) % n)
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), `${name} step ${i}`).toBe(1)
      }
    }
  })

  it('measures the areas the shapes were drawn with', () => {
    expect(rect10x3.area).toBe(30)
    expect(staircase20.area).toBe(210) // 20 + 19 + ... + 1
    expect(plus.area).toBe(45) // 9 + 9 + 9 + 3 + 3 + 3 + 3 + 3 + 3
  })
})

// ---------------------------------------------------------------------------
// optimalPolygon
// ---------------------------------------------------------------------------

describe('optimalPolygon', () => {
  it('keeps all four corners of a single pixel', () => {
    const poly = optimalPolygon(singlePixel)
    expect(Array.from(poly)).toEqual([0, 1, 2, 3])
  })

  it('reduces a 10x3 rectangle to exactly its four corners', () => {
    const poly = optimalPolygon(rect10x3)
    expect(poly.length).toBe(4)
    expect(Array.from(poly).map((i) => point(rect10x3, i))).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 0, y: 3 },
    ])
  })

  it('collapses a 20-step staircase into one segment', () => {
    const poly = optimalPolygon(staircase20)
    expect(poly.length).toBeLessThanOrEqual(6)
    // The staircase runs from index 40, the corner (20, 20), to the last point.
    // No vertex may fall inside it: the whole 45° run is a single segment.
    const inside = Array.from(poly).filter((i) => i > 40 && i < staircase20.points.length / 2 - 1)
    expect(inside).toEqual([])
  })

  it('cannot merge a segment that uses all four directions', () => {
    // Every edge of the plus is three pixels long, so a segment spanning one of
    // its inner corners would leave a point 1.5 px from any line through it.
    const poly = optimalPolygon(plus)
    expect(poly.length).toBe(12)
    expect(Array.from(poly)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33])
  })

  it('describes a radius-12 circle with between 8 and 24 vertices', () => {
    const poly = optimalPolygon(circle12)
    expect(circle12.points.length / 2).toBe(96)
    expect(poly.length).toBeGreaterThanOrEqual(8)
    expect(poly.length).toBeLessThanOrEqual(24)
  })

  it('returns ascending in-range indices starting at 0', () => {
    for (const { name, path } of fixtures) {
      const poly = optimalPolygon(path)
      expect(poly, name).toBeInstanceOf(Int32Array)
      expect(poly.length, name).toBeGreaterThanOrEqual(3)
      expect(poly[0], name).toBe(0)
      for (let i = 1; i < poly.length; i++) {
        expect(poly[i], `${name} vertex ${i}`).toBeGreaterThan(poly[i - 1])
      }
      expect(poly[poly.length - 1], name).toBeLessThan(path.points.length / 2)
    }
  })

  it('passes back a path too short to simplify', () => {
    expect(Array.from(optimalPolygon(pixelPath([])))).toEqual([])
    expect(Array.from(optimalPolygon(pixelPath([2, 2])))).toEqual([0])
    expect(Array.from(optimalPolygon(pixelPath([2, 2, 3, 2])))).toEqual([0, 1])
  })
})

describe('the half-pixel invariant', () => {
  for (const { name, path } of fixtures) {
    it(`holds for every segment of the ${name}`, () => {
      expectWithinHalfPixel(path, optimalPolygon(path))
    })
  }

  it('is exactly what the staircase and the circle spend', () => {
    // A 45° staircase is half of the diagonal of a unit square away from its
    // own middle line, and the circle uses the whole allowance somewhere.
    expect(worstSegmentBand(staircase20, optimalPolygon(staircase20))).toBeCloseTo(Math.SQRT1_2 / 2, 12)
    expect(worstSegmentBand(circle12, optimalPolygon(circle12))).toBeLessThanOrEqual(0.5 + 1e-9)
  })

  it('spends at most a diagonal half pixel on an uneven oblique staircase', () => {
    // A bar whose top edge climbs two pixels every five. The steps are uneven,
    // so the narrowest band around a run potrace calls straight is wider than
    // half a pixel here — and still inside the diagonal bound.
    const bar = outline(62, 27, (x, y) => x < 60 && y <= 1 + (x * 2) / 5)
    const band = worstSegmentBand(bar, optimalPolygon(bar))
    expect(band).toBeGreaterThan(0.5)
    expect(band).toBeLessThanOrEqual(BAND_LIMIT + 1e-9)
  })

  it('would catch a polygon that cut the corners', () => {
    // Four vertices spread evenly round the circle: the helper must reject it,
    // otherwise the assertions above would prove nothing.
    const coarse = Int32Array.from([0, 24, 48, 72])
    expect(worstSegmentBand(circle12, coarse)).toBeGreaterThan(0.5)
  })
})

// ---------------------------------------------------------------------------
// adjustVertices
// ---------------------------------------------------------------------------

describe('adjustVertices', () => {
  it('places one finite vertex per polygon vertex, in the same order', () => {
    for (const { name, path } of fixtures) {
      const poly = optimalPolygon(path)
      const vertices = adjustVertices(path, poly)
      expect(vertices.length, name).toBe(poly.length)
      for (const v of vertices) {
        expect(Number.isFinite(v.x) && Number.isFinite(v.y), `${name} ${JSON.stringify(v)}`).toBe(true)
      }
    }
  })

  it('never moves a vertex more than half a pixel from its corner', () => {
    for (const { name, path } of fixtures) {
      const poly = optimalPolygon(path)
      const vertices = adjustVertices(path, poly)
      vertices.forEach((v, i) => {
        const corner = point(path, poly[i])
        expect(Math.abs(v.x - corner.x), `${name} vertex ${i} x`).toBeLessThanOrEqual(0.5 + 1e-9)
        expect(Math.abs(v.y - corner.y), `${name} vertex ${i} y`).toBeLessThanOrEqual(0.5 + 1e-9)
      })
    }
  })

  it('leaves a single pixel on its own corners', () => {
    const vertices = adjustVertices(singlePixel, optimalPolygon(singlePixel))
    expect(vertices).toEqual([
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 3, y: 6 },
    ])
  })

  it('reproduces an axis-aligned rectangle exactly', () => {
    const vertices = adjustVertices(rect10x3, optimalPolygon(rect10x3))
    expect(vertices.length).toBe(4)
    const expected = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 0, y: 3 },
    ]
    vertices.forEach((v, i) => {
      expect(v.x).toBeCloseTo(expected[i].x, 9)
      expect(v.y).toBeCloseTo(expected[i].y, 9)
    })
  })

  it('puts the staircase vertices on the line through the middle of the steps', () => {
    // The steps alternate between y = x and y = x + 1, so the fitted line is
    // y = x + 0.5 and both ends of that segment must sit on it.
    const poly = optimalPolygon(staircase20)
    const vertices = adjustVertices(staircase20, poly)
    const diagonal = vertices.filter((_, i) => poly[i] >= 40)
    expect(diagonal.length).toBeGreaterThanOrEqual(2)
    for (const v of diagonal) {
      expect(v.y - v.x).toBeCloseTo(0.5, 1)
    }
  })

  it('keeps a traced circle the size the pixels drew it', () => {
    const poly = optimalPolygon(circle12)
    const vertices = adjustVertices(circle12, poly)
    // A polygon inscribed on the pixel boundary cuts the arcs slightly, so it
    // is a little smaller than the disk but never off by more than a few
    // percent, and every vertex sits within half a pixel of the rim.
    expect(polygonArea(vertices)).toBeGreaterThan(0.9 * Math.PI * 144)
    expect(polygonArea(vertices)).toBeLessThan(1.1 * Math.PI * 144)
    for (const v of vertices) {
      expect(Math.hypot(v.x - 12, v.y - 12)).toBeGreaterThan(11.4)
      expect(Math.hypot(v.x - 12, v.y - 12)).toBeLessThan(12.6)
    }
  })

  it('has nothing to place for an empty path or an empty polygon', () => {
    expect(adjustVertices(pixelPath([]), new Int32Array(0))).toEqual([])
    expect(adjustVertices(rect10x3, new Int32Array(0))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Fuzz: irregular boundaries are where the cyclic arithmetic goes wrong
// ---------------------------------------------------------------------------

/** Seeded so a failure is reproducible; Math.random would not be. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** A 4-connected blob grown by a bounded random walk, then outlined. */
function randomBlob(rand: () => number, size: number, steps: number): PixelPath {
  const grid = new Uint8Array(size * size)
  let x = size >> 1
  let y = size >> 1
  grid[y * size + x] = 1
  for (let i = 0; i < steps; i++) {
    const dir = Math.floor(rand() * 4)
    if (dir === 0) x = Math.min(size - 2, x + 1)
    else if (dir === 1) x = Math.max(1, x - 1)
    else if (dir === 2) y = Math.min(size - 2, y + 1)
    else y = Math.max(1, y - 1)
    grid[y * size + x] = 1
  }
  return outline(size, size, (px, py) => grid[py * size + px] === 1)
}

describe('fuzz over random blobs', () => {
  it('stays inside the straightness bound on 60 irregular boundaries', () => {
    const rand = lcg(20260909)
    for (let trial = 0; trial < 60; trial++) {
      const path = randomBlob(rand, 20, 150)
      const n = path.points.length / 2
      const poly = optimalPolygon(path)
      const vertices = adjustVertices(path, poly)

      expect(poly.length, `trial ${trial}`).toBeGreaterThanOrEqual(3)
      expect(vertices.length, `trial ${trial}`).toBe(poly.length)
      expect(poly[0], `trial ${trial}`).toBe(0)
      for (let i = 1; i < poly.length; i++) {
        expect(poly[i], `trial ${trial} vertex ${i}`).toBeGreaterThan(poly[i - 1])
      }
      expect(poly[poly.length - 1], `trial ${trial}`).toBeLessThan(n)
      expect(worstSegmentBand(path, poly), `trial ${trial}`).toBeLessThanOrEqual(BAND_LIMIT + 1e-9)
      vertices.forEach((v, i) => {
        const corner = point(path, poly[i])
        expect(Math.abs(v.x - corner.x), `trial ${trial} vertex ${i} x`).toBeLessThanOrEqual(0.5 + 1e-9)
        expect(Math.abs(v.y - corner.y), `trial ${trial} vertex ${i} y`).toBeLessThanOrEqual(0.5 + 1e-9)
      })
    }
  })
})
