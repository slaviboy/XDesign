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
 * Image Trace, whole.
 *
 * The stages have their own suites; these are the questions that only the
 * assembled pipeline can answer — does a disc come out round, does a hole stay
 * a hole, do the two Method settings differ in the way the panel promises, and
 * does a slider labelled Noise actually remove noise.
 */

import { describe, it, expect } from 'vitest'
import { traceImage, traceParameters, TRACE_MAX_PIXELS } from '@/trace/trace'
import { DEFAULT_TRACE_OPTIONS, TRACE_PRESETS, matchingPreset, presetById } from '@/trace/presets'
import type { RasterData, TraceOptions, TracedPath } from '@/trace/types'

type Rgb = [number, number, number]
const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

function raster(width: number, height: number, paint: (x: number, y: number) => Rgb): RasterData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

const options = (patch: Partial<TraceOptions> = {}): TraceOptions => ({ ...DEFAULT_TRACE_OPTIONS, ...patch })

// ---------------------------------------------------------------------------
// Reading the paths back
// ---------------------------------------------------------------------------

/** Every subpath of an M/L/C/Z string, flattened to a polygon. */
function polygons(d: string): Array<Array<[number, number]>> {
  const tokens = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/g) ?? []
  const rings: Array<Array<[number, number]>> = []
  let ring: Array<[number, number]> = []
  let cursor: [number, number] = [0, 0]
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i++]!
    const number = () => Number(tokens[i++]!)
    if (token === 'M') {
      if (ring.length) rings.push(ring)
      cursor = [number(), number()]
      ring = [cursor]
    } else if (token === 'L') {
      cursor = [number(), number()]
      ring.push(cursor)
    } else if (token === 'C') {
      const [c1x, c1y, c2x, c2y, ex, ey] = [number(), number(), number(), number(), number(), number()]
      const [x0, y0] = cursor
      for (let t = 0.05; t <= 1.0001; t += 0.05) {
        const u = 1 - t
        ring.push([
          u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
          u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
        ])
      }
      cursor = [ex, ey]
    }
  }
  if (ring.length) rings.push(ring)
  return rings
}

/** Signed area of a ring, by the shoelace formula. */
function ringArea(ring: Array<[number, number]>): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j]![0] + ring[i]![0]) * (ring[j]![1] - ring[i]![1])
  }
  return sum / 2
}

/** Area a path encloses, holes subtracted. */
function pathArea(d: string): number {
  return Math.abs(polygons(d).reduce((total, ring) => total + ringArea(ring), 0))
}

function bounds(d: string) {
  const points = polygons(d).flat()
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

const isClean = (path: TracedPath) => !/NaN|Infinity|undefined/.test(path.d)

// ---------------------------------------------------------------------------

describe('tracing shapes', () => {
  const disc = raster(80, 80, (x, y) => ((x - 40) ** 2 + (y - 40) ** 2 <= 900 ? BLACK : WHITE))

  it('traces a disc to one path of the right area', () => {
    const result = traceImage(disc, options({ ignoreWhite: true }))

    expect(result.paths).toHaveLength(1)
    expect(result.colorCount).toBe(1)
    expect(result.paths[0]!.fill).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(result.paths[0]!.stroke).toBeNull()
    // Within 3% of pi*r^2 = 2827.
    expect(pathArea(result.paths[0]!.d)).toBeGreaterThan(2827 * 0.97)
    expect(pathArea(result.paths[0]!.d)).toBeLessThan(2827 * 1.03)
  })

  it('spends few anchors on a circle', () => {
    // The point of fitting curves at all: a circle is a handful of anchors, not
    // one per boundary pixel.
    const result = traceImage(disc, options({ ignoreWhite: true }))
    expect(result.anchorCount).toBeLessThanOrEqual(12)
    expect(result.anchorCount).toBeGreaterThanOrEqual(3)
  })

  it('keeps the white background as its own path unless told not to', () => {
    const result = traceImage(disc, options())
    expect(result.paths).toHaveLength(2)
    expect(result.colorCount).toBe(2)
    // Background first, so the disc lands on top of it.
    expect(result.paths[0]!.fill).toEqual({ r: 255, g: 255, b: 255, a: 1 })
  })

  it('traces a square to four anchors', () => {
    const square = raster(60, 60, (x, y) => (x >= 10 && x < 50 && y >= 10 && y < 50 ? BLACK : WHITE))
    const result = traceImage(square, options({ corners: 100, ignoreWhite: true }))

    expect(result.paths).toHaveLength(1)
    expect(result.anchorCount).toBe(4)
    const b = bounds(result.paths[0]!.d)
    expect(b.minX).toBeCloseTo(10, 1)
    expect(b.minY).toBeCloseTo(10, 1)
    expect(b.maxX).toBeCloseTo(50, 1)
    expect(b.maxY).toBeCloseTo(50, 1)
  })

  it('keeps a hole as a subpath of the shape around it', () => {
    const ring = raster(80, 80, (x, y) => {
      const d = Math.hypot(x - 40, y - 40)
      return d >= 18 && d < 30 ? BLACK : WHITE
    })
    const result = traceImage(ring, options({ ignoreWhite: true }))

    expect(result.paths).toHaveLength(1)
    // Two subpaths: the outside, and the hole wound the other way.
    expect((result.paths[0]!.d.match(/M/g) ?? [])).toHaveLength(2)
    // pi*(30^2 - 18^2) = 1810, and the hole must be subtracted rather than added.
    expect(pathArea(result.paths[0]!.d)).toBeGreaterThan(1810 * 0.95)
    expect(pathArea(result.paths[0]!.d)).toBeLessThan(1810 * 1.05)
  })
})

describe('colour', () => {
  const flag = raster(120, 40, (x) => (x < 40 ? [255, 0, 0] : x < 80 ? [0, 200, 0] : [0, 0, 255]))

  it('finds the three colours of a three-colour image', () => {
    const result = traceImage(flag, options({ mode: 'color', palette: 'limited', colors: 3 }))

    expect(result.colorCount).toBe(3)
    const fills = result.paths.map((p) => p.fill!).sort((a, b) => a.r - b.r || a.g - b.g)
    expect(fills).toHaveLength(3)
    // Within a few counts of the originals; quantisation averages the block.
    const near = (a: number, b: number) => Math.abs(a - b) <= 3
    expect(fills.some((c) => near(c.r, 255) && near(c.g, 0) && near(c.b, 0))).toBe(true)
    expect(fills.some((c) => near(c.r, 0) && near(c.g, 200) && near(c.b, 0))).toBe(true)
    expect(fills.some((c) => near(c.r, 0) && near(c.g, 0) && near(c.b, 255))).toBe(true)
  })

  it('abutting traces each band exactly, overlapping extends them underneath', () => {
    const abutting = traceImage(flag, options({ mode: 'color', palette: 'limited', colors: 3, method: 'abutting' }))
    const overlapping = traceImage(flag, options({ mode: 'color', palette: 'limited', colors: 3, method: 'overlapping' }))

    const widths = (paths: TracedPath[]) =>
      paths.map((p) => Math.round(bounds(p.d).maxX - bounds(p.d).minX)).sort((a, b) => b - a)

    // Every abutting region is one band wide, and none is wider.
    expect(widths(abutting.paths)).toEqual([40, 40, 40])
    // The first overlapping region spans the whole image: it is drawn first and
    // everything else is painted over it.
    expect(widths(overlapping.paths)[0]).toBe(120)
  })

  it('greyscale keeps tones apart without inventing colour', () => {
    const ramp = raster(120, 20, (x) => {
      const v = Math.round((x / 119) * 255)
      return [v, v, v]
    })
    const result = traceImage(ramp, options({ mode: 'grayscale', palette: 'limited', colors: 4 }))
    expect(result.colorCount).toBeGreaterThan(1)
    for (const path of result.paths) {
      const { r, g, b } = path.fill!
      expect(r).toBe(g)
      expect(g).toBe(b)
    }
  })
})

describe('the panel’s controls', () => {
  const speck = raster(60, 60, (x, y) =>
    (x >= 20 && x < 40 && y >= 20 && y < 40) || (x === 5 && y === 5) || (x === 55 && y === 55)
      ? BLACK
      : WHITE)

  it('Noise removes specks smaller than it', () => {
    const kept = traceImage(speck, options({ noise: 1, ignoreWhite: true }))
    const gone = traceImage(speck, options({ noise: 5, ignoreWhite: true }))
    expect(kept.paths.length).toBe(3)
    expect(gone.paths.length).toBe(1)
  })

  it('Ignore White drops the background, and only the background', () => {
    const withWhite = traceImage(speck, options({ noise: 5 }))
    const without = traceImage(speck, options({ noise: 5, ignoreWhite: true }))
    expect(withWhite.colorCount).toBe(2)
    expect(without.colorCount).toBe(1)
    expect(without.paths.every((p) => p.fill!.r === 0)).toBe(true)
  })

  it('Strokes turns a thin line into a stroked path rather than an outline', () => {
    const line = raster(60, 30, (x, y) => (y === 15 && x >= 5 && x < 55 ? BLACK : WHITE))
    const result = traceImage(line, options({ strokes: true, strokeWidth: 6, ignoreWhite: true }))

    expect(result.paths).toHaveLength(1)
    const stroke = result.paths[0]!
    expect(stroke.stroke).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(stroke.fill).toBeNull()
    expect(stroke.strokeWidth).toBeGreaterThan(0)
    // An open path: a centreline has no inside.
    expect(stroke.d).not.toContain('Z')
  })

  it('maps its sliders onto the algorithm’s parameters', () => {
    expect(traceParameters(options({ corners: 75 })).alphaMax).toBeCloseTo(1, 4)
    expect(traceParameters(options({ corners: 0 })).alphaMax).toBeCloseTo(1.3334, 4)
    expect(traceParameters(options({ corners: 100 })).alphaMax).toBeCloseTo(0, 4)

    expect(traceParameters(options({ paths: 50 })).optTolerance).toBeCloseTo(0.2, 4)
    expect(traceParameters(options({ paths: 100 })).optTolerance).toBeCloseTo(0, 4)
    expect(traceParameters(options({ paths: 0 })).optTolerance).toBeCloseTo(1, 4)

    expect(traceParameters(options({ snapToLines: false })).snapToLines).toBe(0)
    expect(traceParameters(options({ noise: 42 })).turdSize).toBe(42)
  })

  it('survives nonsense in the options rather than producing nonsense', () => {
    const wild = traceImage(
      raster(20, 20, () => BLACK),
      options({ corners: NaN, paths: 1e9, noise: -5, colors: 0, threshold: 999 }),
    )
    expect(wild.paths.every(isClean)).toBe(true)
  })
})

describe('large images and cancellation', () => {
  it('reduces an image too big to trace, and reports source coordinates', () => {
    const wide = raster(3000, 1000, (x, y) => (x > 500 && x < 2500 && y > 200 && y < 800 ? BLACK : WHITE))
    expect(wide.width * wide.height).toBeGreaterThan(TRACE_MAX_PIXELS)

    const result = traceImage(wide, options({ ignoreWhite: true }))
    expect(result.width).toBe(3000)
    expect(result.height).toBe(1000)

    // The rectangle comes back at its original scale, not the reduced one.
    const b = bounds(result.paths[0]!.d)
    expect(b.minX).toBeGreaterThan(480)
    expect(b.minX).toBeLessThan(520)
    expect(b.maxX).toBeGreaterThan(2480)
    expect(b.maxX).toBeLessThan(2520)
  })

  it('stops when it is told to, and returns what it had', () => {
    const disc = raster(80, 80, (x, y) => ((x - 40) ** 2 + (y - 40) ** 2 <= 900 ? BLACK : WHITE))
    const result = traceImage(disc, options(), () => true)
    expect(result.paths).toHaveLength(0)
    expect(result.width).toBe(80)
  })

  it('has nothing to say about an empty image', () => {
    const result = traceImage({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, options())
    expect(result.paths).toHaveLength(0)
    expect(result.anchorCount).toBe(0)
  })
})

describe('results and presets', () => {
  const disc = raster(60, 60, (x, y) => ((x - 30) ** 2 + (y - 30) ** 2 <= 400 ? BLACK : WHITE))

  it('gives the same answer twice', () => {
    expect(JSON.stringify(traceImage(disc, options()))).toBe(JSON.stringify(traceImage(disc, options())))
  })

  it('produces something a worker can post back', () => {
    // Plain data only: no typed arrays, no class instances, nothing with a
    // prototype the structured clone algorithm would refuse.
    expect(() => structuredClone(traceImage(disc, options()))).not.toThrow()
  })

  it('counts the anchors it actually emitted', () => {
    const result = traceImage(disc, options())
    expect(result.anchorCount).toBe(result.paths.reduce((n, p) => n + p.anchors, 0))
  })

  it('every preset is recognised as itself', () => {
    expect(TRACE_PRESETS.length).toBeGreaterThanOrEqual(11)
    for (const preset of TRACE_PRESETS) {
      expect(matchingPreset(preset.options), preset.id).toBe(preset.id)
      expect(presetById(preset.id)).toBe(preset)
    }
    // Ids are unique, or the dropdown would show the same thing twice.
    expect(new Set(TRACE_PRESETS.map((p) => p.id)).size).toBe(TRACE_PRESETS.length)
  })

  it('adjusting a preset lands on Custom', () => {
    expect(matchingPreset(options({ noise: 37 }))).toBeNull()
    expect(matchingPreset(DEFAULT_TRACE_OPTIONS)).toBe('default')
  })

  it('every preset actually traces something', () => {
    // A blob AND a hairline, because the presets disagree about what artwork
    // is: Line Art creates no fills at all, and would rightly find nothing in a
    // solid disc.
    const mixed = raster(80, 80, (x, y) =>
      (x - 25) ** 2 + (y - 25) ** 2 <= 225 || (y === 60 && x >= 8 && x < 72) ? BLACK : WHITE)

    for (const preset of TRACE_PRESETS) {
      const result = traceImage(mixed, preset.options)
      expect(result.paths.length, preset.id).toBeGreaterThan(0)
      expect(result.paths.every(isClean), preset.id).toBe(true)
      expect(result.anchorCount, preset.id).toBeGreaterThan(0)
    }
  })
})
