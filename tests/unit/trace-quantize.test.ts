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
 * Colour quantisation for Image Trace. Inputs are written as rows of colour
 * keys, so a case reads as the picture it is, and the properties the rest of
 * the pipeline leans on — a palette that is never empty, sorted by pixel count,
 * with every pixel on its nearest entry — are asserted as invariants over each
 * result rather than case by case.
 */
import { describe, it, expect } from 'vitest'
import { isNearWhite, luminance, quantize } from '@/trace/quantize'
import type { Quantized, RasterData, TraceMode, TraceOptions } from '@/trace/types'

type QuantizeOptions = Pick<TraceOptions, 'mode' | 'palette' | 'colors' | 'threshold'>

const OPTIONS: QuantizeOptions = { mode: 'color', palette: 'limited', colors: 8, threshold: 128 }

const options = (overrides: Partial<QuantizeOptions>): QuantizeOptions => ({ ...OPTIONS, ...overrides })

/** Colours by key: [r, g, b] or [r, g, b, a]. */
type Swatches = Record<string, number[]>

/** A RasterData from rows of single-character colour keys, e.g. ['rrgg', 'rrgg']. */
function raster(rows: string[], swatches: Swatches): RasterData {
  const height = rows.length
  const width = height ? rows[0].length : 0
  const data = new Uint8ClampedArray(width * height * 4)
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = swatches[row[x]]
      const d = (y * width + x) * 4
      data[d] = r
      data[d + 1] = g
      data[d + 2] = b
      data[d + 3] = a
    }
  })
  return { width, height, data }
}

/** A one-row raster of the given colours, one pixel each. */
function strip(colors: number[][]): RasterData {
  const data = new Uint8ClampedArray(colors.length * 4)
  colors.forEach(([r, g, b, a = 255], i) => {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = a
  })
  return { width: colors.length, height: 1, data }
}

const colorAt = (q: Quantized, x: number, y: number) => q.palette[q.indices[y * q.width + x]]

const rgbOf = (color: { r: number; g: number; b: number }) => [color.r, color.g, color.b]

/** The pixel count of each palette entry, in palette order. */
function histogram(q: Quantized): number[] {
  const counts = new Array<number>(q.palette.length).fill(0)
  for (const index of q.indices) counts[index]++
  return counts
}

/** Deterministic pixel noise — a plain LCG, because the module promises no Math.random. */
function noise(width: number, height: number, seed: number): RasterData {
  const data = new Uint8ClampedArray(width * height * 4)
  let state = seed
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state >>> 24
  }
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = next()
    data[i * 4 + 1] = next()
    data[i * 4 + 2] = next()
    data[i * 4 + 3] = 255
  }
  return { width, height, data }
}

/**
 * The invariants every result must satisfy: sized to the image, indices inside
 * the palette, palette sorted by pixel count descending and never empty.
 */
function expectWellFormed(q: Quantized, source: RasterData): void {
  expect(q.width).toBe(source.width)
  expect(q.height).toBe(source.height)
  expect(q.indices).toBeInstanceOf(Uint8Array)
  expect(q.indices.length).toBe(source.width * source.height)
  expect(q.palette.length).toBeGreaterThan(0)
  expect(q.palette.length).toBeLessThanOrEqual(256)
  for (const index of q.indices) expect(index).toBeLessThan(q.palette.length)
  for (const entry of q.palette) {
    expect(entry.a).toBe(1)
    for (const channel of rgbOf(entry)) {
      expect(Number.isInteger(channel)).toBe(true)
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(255)
    }
  }
  const counts = histogram(q)
  for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1])
}

describe('luminance', () => {
  it('is Rec.601 weighted', () => {
    expect(luminance(255, 0, 0)).toBeCloseTo(76.245, 6)
    expect(luminance(0, 255, 0)).toBeCloseTo(149.685, 6)
    expect(luminance(0, 0, 255)).toBeCloseTo(29.07, 6)
  })

  it('leaves a neutral colour at its own value', () => {
    expect(luminance(0, 0, 0)).toBe(0)
    expect(luminance(255, 255, 255)).toBeCloseTo(255, 6)
    expect(luminance(128, 128, 128)).toBeCloseTo(128, 6)
  })

  it('weighs green above red above blue', () => {
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0))
    expect(luminance(255, 0, 0)).toBeGreaterThan(luminance(0, 0, 255))
  })
})

describe('isNearWhite', () => {
  it('accepts white and the greys just below it', () => {
    expect(isNearWhite({ r: 255, g: 255, b: 255, a: 1 })).toBe(true)
    expect(isNearWhite({ r: 250, g: 250, b: 250, a: 1 })).toBe(true)
    // Luminance 245 exactly — the boundary is inclusive.
    expect(isNearWhite({ r: 245, g: 245, b: 245, a: 1 })).toBe(true)
    expect(isNearWhite({ r: 244, g: 244, b: 244, a: 1 })).toBe(false)
  })

  it('rejects a bright colour that is not neutral', () => {
    // Bright enough (252) but 25 apart across channels: a tint, not paper.
    expect(isNearWhite({ r: 255, g: 255, b: 230, a: 1 })).toBe(false)
    // 15 apart and just as bright: still paper.
    expect(isNearWhite({ r: 255, g: 250, b: 240, a: 1 })).toBe(true)
  })

  it('rejects everything darker whatever its hue', () => {
    expect(isNearWhite({ r: 0, g: 0, b: 0, a: 1 })).toBe(false)
    expect(isNearWhite({ r: 255, g: 255, b: 0, a: 1 })).toBe(false)
    expect(isNearWhite({ r: 200, g: 200, b: 200, a: 1 })).toBe(false)
  })

  it('ignores alpha, since palette entries are opaque by then', () => {
    expect(isNearWhite({ r: 255, g: 255, b: 255, a: 0 })).toBe(true)
  })
})

describe('quantize, empty input', () => {
  it('returns an empty palette for a 0x0 image', () => {
    const q = quantize({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, OPTIONS)
    expect(q).toEqual({ palette: [], indices: new Uint8Array(0), width: 0, height: 0 })
  })

  it('returns an empty palette for an image with a zero side', () => {
    const q = quantize({ width: 4, height: 0, data: new Uint8ClampedArray(0) }, OPTIONS)
    expect(q.palette).toEqual([])
    expect(q.indices.length).toBe(0)
    expect(q.width).toBe(4)
    expect(q.height).toBe(0)
  })

  it('never returns an empty palette for an image that has pixels', () => {
    const q = quantize(strip([[17, 99, 200]]), options({ palette: 'limited', colors: 12 }))
    expect(q.palette).toEqual([{ r: 17, g: 99, b: 200, a: 1 }])
    expect(Array.from(q.indices)).toEqual([0])
  })
})

describe('quantize, alpha', () => {
  const BLACK_ON_WHITE = options({ mode: 'bw', threshold: 128 })

  it('treats a mostly transparent pixel as white, whatever colour it carried', () => {
    const q = quantize(strip([[0, 0, 0, 0], [0, 0, 0, 127], [255, 0, 0, 10]]), BLACK_ON_WHITE)
    expect(Array.from(q.indices)).toEqual([1, 1, 1])
  })

  it('composites a partly transparent pixel onto white', () => {
    // Black at alpha 128 lands on 127, one below the threshold, so it is ink;
    // raise the bar past it and the same pixel is paper.
    const half = strip([[0, 0, 0, 128]])
    expect(Array.from(quantize(half, options({ mode: 'bw', threshold: 128 })).indices)).toEqual([0])
    expect(Array.from(quantize(half, options({ mode: 'bw', threshold: 126 })).indices)).toEqual([1])
  })

  it('composites colour by alpha, not by a threshold', () => {
    const q = quantize(strip([[255, 0, 0, 128]]), options({ palette: 'limited', colors: 2 }))
    expect(q.palette).toEqual([{ r: 255, g: 127, b: 127, a: 1 }])
  })

  it('leaves an opaque pixel exactly as it came in', () => {
    const q = quantize(strip([[13, 200, 47, 255]]), options({ palette: 'limited', colors: 2 }))
    expect(rgbOf(q.palette[0])).toEqual([13, 200, 47])
  })
})

describe('quantize, black and white', () => {
  const picture = raster([
    'kkww',
    'kgww',
    'gggw',
  ], { k: [0, 0, 0], g: [128, 128, 128], w: [255, 255, 255] })

  it('has a palette of exactly black then white, in that order', () => {
    const q = quantize(picture, options({ mode: 'bw' }))
    expect(q.palette).toEqual([
      { r: 0, g: 0, b: 0, a: 1 },
      { r: 255, g: 255, b: 255, a: 1 },
    ])
  })

  it('is black at or below the threshold and white above it', () => {
    const q = quantize(picture, options({ mode: 'bw', threshold: 128 }))
    expect(rgbOf(colorAt(q, 0, 0))).toEqual([0, 0, 0])
    expect(rgbOf(colorAt(q, 1, 1))).toEqual([0, 0, 0])
    expect(rgbOf(colorAt(q, 3, 0))).toEqual([255, 255, 255])

    // One below and the mid grey flips to paper.
    const tighter = quantize(picture, options({ mode: 'bw', threshold: 127 }))
    expect(rgbOf(colorAt(tighter, 1, 1))).toEqual([255, 255, 255])
    expect(rgbOf(colorAt(tighter, 0, 0))).toEqual([0, 0, 0])
  })

  it('keeps black at index 0 even when the picture is mostly ink', () => {
    const inky = raster(['kkk', 'kkw'], { k: [0, 0, 0], w: [255, 255, 255] })
    const q = quantize(inky, options({ mode: 'bw' }))
    expect(rgbOf(q.palette[0])).toEqual([0, 0, 0])
    expect(Array.from(q.indices)).toEqual([0, 0, 0, 0, 0, 1])
  })

  it('takes the whole picture at the extremes of the threshold', () => {
    const all = quantize(picture, options({ mode: 'bw', threshold: 255 }))
    expect(Array.from(all.indices).every((index) => index === 0)).toBe(true)
    // At 0 only a pixel that is actually black is ink, and a threshold below
    // the documented range clamps to that rather than inverting the picture.
    const floor = quantize(picture, options({ mode: 'bw', threshold: 0 }))
    expect(Array.from(floor.indices)).toEqual([0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1])
    expect(quantize(picture, options({ mode: 'bw', threshold: -40 }))).toEqual(floor)
  })

  it('ignores palette and colors', () => {
    const a = quantize(picture, options({ mode: 'bw', palette: 'limited', colors: 2 }))
    const b = quantize(picture, options({ mode: 'bw', palette: 'full-tone', colors: 100 }))
    const c = quantize(picture, options({ mode: 'bw', palette: 'automatic', colors: 1 }))
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })
})

describe('quantize, grayscale', () => {
  const flag = raster(['rgb'], { r: [255, 0, 0], g: [0, 255, 0], b: [0, 0, 255] })

  it('replaces every colour by its own luminance', () => {
    const q = quantize(flag, options({ mode: 'grayscale', palette: 'limited', colors: 3 }))
    expect(q.palette.length).toBe(3)
    for (const entry of q.palette) {
      expect(entry.r).toBe(entry.g)
      expect(entry.g).toBe(entry.b)
    }
    const values = q.palette.map((entry) => entry.r).sort((a, b) => a - b)
    expect(values).toEqual([29, 76, 150])
  })

  it('collapses colours that share a brightness', () => {
    // Two different hues of the same luminance become one grey.
    const pair = strip([[0, 255, 0], [150, 150, 150], [0, 0, 0]])
    const q = quantize(pair, options({ mode: 'grayscale', palette: 'limited', colors: 3 }))
    expect(q.palette.length).toBe(2)
    expect(q.indices[0]).toBe(q.indices[1])
    expect(rgbOf(q.palette[q.indices[0]])).toEqual([150, 150, 150])
  })
})

describe('quantize, limited palette', () => {
  const cube = [
    [0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255],
    [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 255, 255],
  ]

  it('produces exactly the requested count when the image has more colours', () => {
    for (const colors of [2, 3, 5, 8]) {
      const q = quantize(strip(cube), options({ palette: 'limited', colors }))
      expect(q.palette.length).toBe(colors)
      expectWellFormed(q, strip(cube))
    }
  })

  it('produces fewer only when the image has fewer distinct colours', () => {
    const two = raster(['rrb'], { r: [200, 30, 30], b: [30, 30, 200] })
    const q = quantize(two, options({ palette: 'limited', colors: 20 }))
    expect(q.palette.length).toBe(2)
    expect(rgbOf(q.palette[0])).toEqual([200, 30, 30])
    expect(rgbOf(q.palette[1])).toEqual([30, 30, 200])
  })

  it('clamps the count to 2..30', () => {
    const ramp = strip(Array.from({ length: 256 }, (_, v) => [v, v, v]))
    expect(quantize(ramp, options({ palette: 'limited', colors: 100 })).palette.length).toBe(30)
    expect(quantize(ramp, options({ palette: 'limited', colors: 1 })).palette.length).toBe(2)
    expect(quantize(ramp, options({ palette: 'limited', colors: -5 })).palette.length).toBe(2)
    expect(quantize(ramp, options({ palette: 'limited', colors: 4.4 })).palette.length).toBe(4)
  })
})

describe('quantize, automatic palette', () => {
  it('caps the count by the accuracy formula', () => {
    // Accuracy 50 targets round(2 + 30 * 0.25) = 10 entries.
    const grid: number[][] = []
    for (const r of [0, 127, 255]) {
      for (const g of [0, 127, 255]) {
        for (const b of [0, 127, 255]) grid.push([r, g, b])
      }
    }
    const q = quantize(strip(grid), options({ palette: 'automatic', colors: 50 }))
    expect(q.palette.length).toBeGreaterThan(1)
    expect(q.palette.length).toBeLessThanOrEqual(10)
  })

  it('stops splitting at the number of distinct colours', () => {
    const corners = [
      [0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255],
      [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 255, 255],
    ]
    const q = quantize(strip(corners), options({ palette: 'automatic', colors: 50 }))
    expect(q.palette.length).toBe(8)
  })

  it('merges near-duplicates even at full accuracy', () => {
    // 6 apart is inside the 12 that accuracy 100 still merges.
    const near = strip([[0, 0, 0], [6, 0, 0], [255, 255, 255]])
    const merged = quantize(near, options({ palette: 'automatic', colors: 100 }))
    expect(merged.palette.length).toBe(2)
    expect(rgbOf(merged.palette[0])).toEqual([3, 0, 0])
    expect(rgbOf(merged.palette[1])).toEqual([255, 255, 255])

    // A limited palette of the same size keeps them apart: only automatic merges.
    const kept = quantize(near, options({ palette: 'limited', colors: 3 }))
    expect(kept.palette.length).toBe(3)
  })

  it('merges harder the lower the accuracy', () => {
    const shades = strip([[20, 20, 20], [60, 60, 60], [100, 100, 100], [240, 240, 240]])
    const loose = quantize(shades, options({ palette: 'automatic', colors: 1 }))
    const tight = quantize(shades, options({ palette: 'automatic', colors: 100 }))
    expect(loose.palette.length).toBeLessThan(tight.palette.length)
    expect(tight.palette.length).toBe(4)
  })
})

describe('quantize, full-tone palette', () => {
  const ramp = strip(Array.from({ length: 256 }, (_, v) => [v, v, v]))

  it('reaches the whole index byte at accuracy 100', () => {
    const q = quantize(ramp, options({ palette: 'full-tone', colors: 100 }))
    expect(q.palette.length).toBe(256)
    expect(new Set(q.indices).size).toBe(256)
    expectWellFormed(q, ramp)
  })

  it('follows the accuracy curve below that', () => {
    // round(8 + 248 * 0.5 ** 1.5) = 96.
    expect(quantize(ramp, options({ palette: 'full-tone', colors: 50 })).palette.length).toBe(96)
    expect(quantize(ramp, options({ palette: 'full-tone', colors: 1 })).palette.length).toBe(8)
  })

  it('keeps far more colours than automatic at the same accuracy', () => {
    const tone = quantize(ramp, options({ palette: 'full-tone', colors: 50 }))
    const auto = quantize(ramp, options({ palette: 'automatic', colors: 50 }))
    expect(tone.palette.length).toBeGreaterThan(auto.palette.length)
  })

  it('does not merge, so near-duplicates survive', () => {
    const near = strip([[0, 0, 0], [6, 0, 0], [255, 255, 255]])
    expect(quantize(near, options({ palette: 'full-tone', colors: 100 })).palette.length).toBe(3)
  })
})

describe('quantize, palette order', () => {
  it('puts the most common colour first', () => {
    const picture = raster([
      'rrrr',
      'rrrr',
      'rrgg',
      'rgbr',
    ], { r: [255, 0, 0], g: [0, 255, 0], b: [0, 0, 255] })
    const q = quantize(picture, options({ palette: 'limited', colors: 3 }))
    expect(q.palette.map(rgbOf)).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]])
    expect(histogram(q)).toEqual([12, 3, 1])
  })

  it('leaves no entry with zero pixels behind', () => {
    const q = quantize(noise(64, 64, 7), options({ palette: 'limited', colors: 16 }))
    expect(histogram(q).every((count) => count > 0)).toBe(true)
    expectWellFormed(q, noise(64, 64, 7))
  })
})

describe('quantize, assignment', () => {
  /** The colour the palette search sees: composited onto white, then flattened in grayscale mode. */
  function quantised(source: RasterData, i: number, mode: TraceMode): number[] {
    const alpha = source.data[i * 4 + 3]
    const f = alpha < 128 ? 0 : alpha / 255
    const rgb = [0, 1, 2].map((c) => Math.round(source.data[i * 4 + c] * f + 255 * (1 - f)))
    if (mode !== 'grayscale') return rgb
    const y = Math.round(luminance(rgb[0], rgb[1], rgb[2]))
    return [y, y, y]
  }

  /** Every pixel must sit on a nearest palette entry, ties allowed. */
  function expectNearestAssignment(q: Quantized, source: RasterData, mode: TraceMode): void {
    for (let i = 0; i < q.indices.length; i++) {
      const [r, g, b] = quantised(source, i, mode)
      const distance = (entry: { r: number; g: number; b: number }) =>
        (entry.r - r) ** 2 + (entry.g - g) ** 2 + (entry.b - b) ** 2
      const best = Math.min(...q.palette.map(distance))
      expect(distance(q.palette[q.indices[i]])).toBe(best)
    }
  }

  it('assigns every pixel to its nearest entry', () => {
    const source = noise(48, 48, 21)
    for (const preset of [
      options({ palette: 'limited', colors: 4 }),
      options({ palette: 'limited', colors: 17 }),
      options({ palette: 'automatic', colors: 80 }),
      options({ palette: 'full-tone', colors: 60 }),
      options({ mode: 'grayscale', palette: 'limited', colors: 6 }),
    ]) {
      const q = quantize(source, preset)
      expectWellFormed(q, source)
      expectNearestAssignment(q, source, preset.mode)
    }
  })

  it('assigns a half-transparent pixel by its composited colour', () => {
    const fading = strip([[255, 0, 0, 255], [255, 0, 0, 128], [255, 0, 0, 0]])
    const q = quantize(fading, options({ palette: 'limited', colors: 3 }))
    expect(q.palette.map(rgbOf)).toEqual([[255, 0, 0], [255, 127, 127], [255, 255, 255]])
    expectNearestAssignment(q, fading, 'color')
  })

  it('assigns every pixel of an image too big to sample whole', () => {
    // 280000 pixels, past the 262144 sampling limit, with a small third region
    // that must still survive the stride.
    const width = 700
    const height = 400
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const d = (y * width + x) * 4
        const red = x < width / 2
        data[d] = red ? 255 : 0
        data[d + 1] = red ? 0 : 255
        data[d + 2] = 0
        data[d + 3] = 255
        if (x >= 300 && x < 340 && y >= 100 && y < 140) {
          data[d] = 0
          data[d + 1] = 0
          data[d + 2] = 255
        }
      }
    }
    const source: RasterData = { width, height, data }
    const q = quantize(source, options({ palette: 'limited', colors: 3 }))
    expectWellFormed(q, source)
    // The blue block is cut out of the red half, which leaves green in front.
    expect(q.palette.map(rgbOf)).toEqual([[0, 255, 0], [255, 0, 0], [0, 0, 255]])
    expect(rgbOf(colorAt(q, 320, 120))).toEqual([0, 0, 255])
    expect(rgbOf(colorAt(q, 0, 0))).toEqual([255, 0, 0])
    expect(rgbOf(colorAt(q, 699, 399))).toEqual([0, 255, 0])
    expect(histogram(q)[2]).toBe(40 * 40)
  })
})

describe('quantize, determinism', () => {
  it('gives the same palette and indices for the same input', () => {
    const source = noise(70, 30, 99)
    for (const preset of [
      options({ palette: 'limited', colors: 9 }),
      options({ palette: 'automatic', colors: 35 }),
      options({ palette: 'full-tone', colors: 100 }),
      options({ mode: 'bw', threshold: 100 }),
      options({ mode: 'grayscale', palette: 'limited', colors: 5 }),
    ]) {
      const first = quantize(source, preset)
      const second = quantize(source, preset)
      expect(second.palette).toEqual(first.palette)
      expect(Array.from(second.indices)).toEqual(Array.from(first.indices))
    }
  })

  it('does not depend on the raster object, only on its pixels', () => {
    const source = noise(32, 32, 5)
    const copy: RasterData = {
      width: source.width,
      height: source.height,
      data: new Uint8ClampedArray(source.data),
    }
    const preset = options({ palette: 'automatic', colors: 70 })
    expect(quantize(copy, preset)).toEqual(quantize(source, preset))
  })

  it('does not write into the raster it was given', () => {
    const source = noise(24, 24, 3)
    const before = Array.from(source.data)
    quantize(source, options({ mode: 'grayscale', palette: 'limited', colors: 6 }))
    quantize(source, options({ mode: 'bw' }))
    quantize(source, options({ palette: 'full-tone', colors: 90 }))
    expect(Array.from(source.data)).toEqual(before)
  })
})

describe('quantize, malformed options', () => {
  const picture = raster(['rg', 'bw'], {
    r: [255, 0, 0], g: [0, 255, 0], b: [0, 0, 255], w: [255, 255, 255],
  })

  it('falls back rather than throwing on a non-finite count', () => {
    for (const palette of ['limited', 'automatic', 'full-tone'] as const) {
      const q = quantize(picture, options({ palette, colors: Number.NaN }))
      expectWellFormed(q, picture)
    }
  })

  it('survives a short pixel buffer by treating the missing tail as white', () => {
    const short: RasterData = { width: 2, height: 2, data: new Uint8ClampedArray(8) }
    short.data.set([0, 0, 0, 255, 0, 0, 0, 255])
    const q = quantize(short, options({ mode: 'bw' }))
    expect(Array.from(q.indices)).toEqual([0, 0, 1, 1])
  })
})
