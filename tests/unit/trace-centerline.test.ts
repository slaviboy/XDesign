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
 * Lifting thin runs out of a bitmap as centrelines.
 *
 * This is what makes Strokes different from Fills. A pencil line traced as a
 * region becomes a long thin outline drawn AROUND the line — twice the anchors
 * and impossible to restyle as a stroke. Traced as a centreline it becomes one
 * open path with a width, which is what it always was.
 */

import { describe, it, expect } from 'vitest'
import { extractCenterlines } from '@/trace/centerline'
import { countFilled } from '@/trace/bitmap'
import type { Bitmap, Curve, Vec2 } from '@/trace/types'

function bitmap(width: number, height: number, ink: (x: number, y: number) => boolean): Bitmap {
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (ink(x, y)) data[y * width + x] = 1
  }
  return { width, height, data }
}

/** Every point a curve passes through, corners and control points included. */
function points(curve: Curve): Vec2[] {
  const out: Vec2[] = [curve.start]
  for (const segment of curve.segments) {
    if (segment.kind === 'corner') out.push(segment.c)
    out.push(segment.end)
  }
  return out
}

function allFinite(curve: Curve): boolean {
  return points(curve).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
}

describe('extractCenterlines', () => {
  it('turns a one-pixel line into one stroke along its middle', () => {
    const line = bitmap(30, 10, (x, y) => y === 4 && x >= 3 && x < 23)
    const { strokes, remaining } = extractCenterlines(line, 5, 0.5)

    expect(strokes).toHaveLength(1)
    expect(strokes[0]!.width).toBeCloseTo(1, 1)
    // Pixel centres, so the run from x=3 to x=22 spans 3.5 to 22.5 — in either
    // direction, since which end the walk starts from is not meaningful.
    const ends = [points(strokes[0]!.curve)[0]!, points(strokes[0]!.curve).at(-1)!]
    const xs = ends.map((p) => p.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(3.5, 1)
    expect(xs[1]).toBeCloseTo(22.5, 1)
    for (const end of ends) expect(end.y).toBeCloseTo(4.5, 1)
    // Everything it claimed is gone from what the fill tracer will see.
    expect(countFilled(remaining)).toBe(0)
  })

  it('leaves a solid shape alone — it is a fill, not a stroke', () => {
    const square = bitmap(30, 30, (x, y) => x >= 4 && x < 24 && y >= 4 && y < 24)
    const before = countFilled(square)
    const { strokes, remaining } = extractCenterlines(square, 3, 0.5)

    expect(strokes).toHaveLength(0)
    expect(countFilled(remaining)).toBe(before)
  })

  it('measures the width of a thick stroke', () => {
    const bent = bitmap(30, 30, (x, y) =>
      (y >= 5 && y < 8 && x >= 5 && x < 22) || (x >= 5 && x < 8 && y >= 5 && y < 24))
    const { strokes } = extractCenterlines(bent, 5, 0.5)

    expect(strokes.length).toBeGreaterThanOrEqual(1)
    for (const stroke of strokes) expect(stroke.width).toBeGreaterThan(2)
    for (const stroke of strokes) expect(stroke.width).toBeLessThan(4.5)
  })

  it('gives a crossing four arms, not a pile of fragments', () => {
    // The regression this exists for. Eight-connectivity makes the centre of a
    // plus sign a five-pixel clique, and treating each of those as its own
    // junction produced eight two-pixel strokes inside the crossing on top of
    // the four real arms.
    const plus = bitmap(21, 21, (x, y) =>
      (y === 10 && x >= 2 && x < 19) || (x === 10 && y >= 2 && y < 19))
    const { strokes } = extractCenterlines(plus, 5, 0.5)

    expect(strokes).toHaveLength(4)
    for (const stroke of strokes) expect(stroke.width).toBeCloseTo(1, 1)
    // And the arms meet: every one of them has an end at the crossing.
    for (const stroke of strokes) {
      const ends = [points(stroke.curve)[0]!, points(stroke.curve).at(-1)!]
      expect(ends.some((p) => Math.hypot(p.x - 10.5, p.y - 10.5) < 1.5)).toBe(true)
    }
  })

  it('walks a ring as one closed stroke', () => {
    const ring = bitmap(40, 40, (x, y) => {
      const d = Math.hypot(x - 20, y - 20)
      return d >= 12 && d < 14
    })
    const { strokes } = extractCenterlines(ring, 5, 0.5)

    expect(strokes).toHaveLength(1)
    expect(strokes[0]!.curve.closed).toBe(true)
    expect(strokes[0]!.width).toBeGreaterThan(1.5)
  })

  it('never modifies the bitmap it was given', () => {
    const line = bitmap(30, 10, (x, y) => y === 4 && x >= 3 && x < 23)
    const before = new Uint8Array(line.data)
    extractCenterlines(line, 5, 0.5)
    expect(Array.from(line.data)).toEqual(Array.from(before))
  })

  it('has nothing to say about degenerate input', () => {
    for (const b of [
      bitmap(0, 0, () => false),
      bitmap(1, 1, () => true),
      bitmap(20, 20, () => false),
      bitmap(20, 20, (x, y) => x === 5 && y === 5),
    ]) {
      const { strokes } = extractCenterlines(b, 5, 0.5)
      expect(strokes).toHaveLength(0)
    }
  })

  it('keeps every coordinate finite and inside the image', () => {
    const tangle = bitmap(40, 40, (x, y) => (x + y) % 7 === 0 && x > 3 && x < 36 && y > 3 && y < 36)
    const { strokes } = extractCenterlines(tangle, 4, 0.5)
    for (const stroke of strokes) {
      expect(allFinite(stroke.curve)).toBe(true)
      for (const p of points(stroke.curve)) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(40)
        expect(p.y).toBeLessThanOrEqual(40)
      }
    }
  })

  it('keeps up with a big image full of thin strokes', () => {
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const starts = Array.from({ length: 60 }, () =>
      [Math.floor(random() * 900), Math.floor(random() * 500)] as const)
    const big = bitmap(1000, 600, (x, y) =>
      starts.some(([sx, sy]) => y - sy === x - sx && x >= sx && x < sx + 80))

    const started = Date.now()
    const { strokes } = extractCenterlines(big, 4, 0.5)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(strokes.length).toBeGreaterThan(50)
  })
})
