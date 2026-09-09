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
 * Colour-layer bitmaps for Image Trace. Inputs and expectations are written as
 * little pictures — rows of palette digits, rows of '#' and '.' — so a failure
 * shows the shape that went wrong rather than a byte offset.
 */
import { describe, it, expect } from 'vitest'
import {
  bitmapGet,
  cloneBitmap,
  countFilled,
  layerBitmap,
  subtractBitmap,
  unionLayers,
} from '@/trace/bitmap'
import type { Bitmap, Quantized } from '@/trace/types'

/** A Quantized from rows of single-digit palette indices, e.g. ['0011', '0211']. */
function quantized(rows: string[]): Quantized {
  const height = rows.length
  const width = height ? rows[0].length : 0
  const indices = new Uint8Array(width * height)
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) indices[y * width + x] = Number(row[x])
  })
  const count = indices.length ? Math.max(...indices) + 1 : 0
  const palette = Array.from({ length: count }, (_, i) => ({ r: i, g: i, b: i, a: 1 }))
  return { palette, indices, width, height }
}

/** A Bitmap from rows of '#' (filled) and '.' (empty). */
function bitmap(rows: string[]): Bitmap {
  const height = rows.length
  const width = height ? rows[0].length : 0
  const data = new Uint8Array(width * height)
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) data[y * width + x] = row[x] === '#' ? 1 : 0
  })
  return { width, height, data }
}

/** The inverse of `bitmap`, so assertions compare pictures. */
function draw(bm: Bitmap): string[] {
  const rows: string[] = []
  for (let y = 0; y < bm.height; y++) {
    let row = ''
    for (let x = 0; x < bm.width; x++) row += bm.data[y * bm.width + x] ? '#' : '.'
    rows.push(row)
  }
  return rows
}

const Q = quantized([
  '0011',
  '0211',
  '2221',
])

describe('layerBitmap', () => {
  it('keeps exactly the pixels with that index', () => {
    expect(draw(layerBitmap(Q, 0))).toEqual(['##..', '#...', '....'])
    expect(draw(layerBitmap(Q, 1))).toEqual(['..##', '..##', '...#'])
    expect(draw(layerBitmap(Q, 2))).toEqual(['....', '.#..', '###.'])
  })

  it('carries the image dimensions and one byte per pixel', () => {
    const bm = layerBitmap(Q, 1)
    expect(bm.width).toBe(4)
    expect(bm.height).toBe(3)
    expect(bm.data.length).toBe(12)
    expect(bm.data).toBeInstanceOf(Uint8Array)
  })

  it('is empty for an index no pixel uses', () => {
    expect(countFilled(layerBitmap(Q, 3))).toBe(0)
    expect(countFilled(layerBitmap(Q, -1))).toBe(0)
    expect(countFilled(layerBitmap(Q, 255))).toBe(0)
  })

  it('handles a 0x0 image', () => {
    const bm = layerBitmap(quantized([]), 0)
    expect(bm).toEqual({ width: 0, height: 0, data: new Uint8Array(0) })
  })

  it('does not write into the quantized indices', () => {
    const before = Array.from(Q.indices)
    layerBitmap(Q, 1)
    expect(Array.from(Q.indices)).toEqual(before)
  })
})

describe('unionLayers', () => {
  it('fills the pixels of any listed index', () => {
    expect(draw(unionLayers(Q, [0, 2]))).toEqual(['##..', '##..', '###.'])
    expect(draw(unionLayers(Q, [1, 2]))).toEqual(['..##', '.###', '####'])
  })

  it('agrees with layerBitmap for a single index', () => {
    for (let index = 0; index < 3; index++) {
      expect(draw(unionLayers(Q, [index]))).toEqual(draw(layerBitmap(Q, index)))
    }
  })

  it('is the whole image for every index and empty for none', () => {
    expect(draw(unionLayers(Q, [0, 1, 2]))).toEqual(['####', '####', '####'])
    expect(countFilled(unionLayers(Q, []))).toBe(0)
    expect(unionLayers(Q, []).width).toBe(4)
    expect(unionLayers(Q, []).height).toBe(3)
  })

  it('ignores duplicates and indices no byte can hold', () => {
    const noisy = unionLayers(Q, [1, 1, -1, 256, 300, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    expect(draw(noisy)).toEqual(draw(layerBitmap(Q, 1)))
  })

  it('handles a 0x0 image', () => {
    const bm = unionLayers(quantized([]), [0, 1])
    expect(bm).toEqual({ width: 0, height: 0, data: new Uint8Array(0) })
  })
})

describe('bitmapGet', () => {
  const bm = bitmap([
    '#..',
    '.#.',
    '..#',
  ])

  it('reads filled and empty pixels', () => {
    expect(bitmapGet(bm, 0, 0)).toBe(1)
    expect(bitmapGet(bm, 1, 1)).toBe(1)
    expect(bitmapGet(bm, 2, 2)).toBe(1)
    expect(bitmapGet(bm, 1, 0)).toBe(0)
    expect(bitmapGet(bm, 0, 2)).toBe(0)
  })

  it('is 0 everywhere outside the image and 1 everywhere inside a full one', () => {
    const full = bitmap(['####', '####', '####'])
    for (let y = -3; y <= full.height + 2; y++) {
      for (let x = -3; x <= full.width + 2; x++) {
        const inside = x >= 0 && y >= 0 && x < full.width && y < full.height
        expect(bitmapGet(full, x, y)).toBe(inside ? 1 : 0)
      }
    }
  })

  it('does not wrap a coordinate past the row end into the next row', () => {
    // (3, 0) would alias (0, 1) in a flat index; the bounds check must catch it.
    const wide = bitmap(['...', '#..'])
    expect(bitmapGet(wide, 3, 0)).toBe(0)
    expect(bitmapGet(wide, -1, 2)).toBe(0)
    expect(bitmapGet(wide, 0, 1)).toBe(1)
  })

  it('is 0 far outside and on a 0x0 bitmap', () => {
    expect(bitmapGet(bm, 1_000_000, 0)).toBe(0)
    expect(bitmapGet(bm, 0, -1_000_000)).toBe(0)
    const empty: Bitmap = { width: 0, height: 0, data: new Uint8Array(0) }
    expect(bitmapGet(empty, 0, 0)).toBe(0)
  })

  it('treats any nonzero byte as filled', () => {
    const odd: Bitmap = { width: 2, height: 1, data: Uint8Array.of(255, 0) }
    expect(bitmapGet(odd, 0, 0)).toBe(1)
    expect(bitmapGet(odd, 1, 0)).toBe(0)
  })
})

describe('cloneBitmap', () => {
  it('copies the content and dimensions', () => {
    const src = bitmap(['#.#', '.#.'])
    const copy = cloneBitmap(src)
    expect(copy).toEqual(src)
    expect(copy).not.toBe(src)
  })

  it('does not share storage in either direction', () => {
    const src = bitmap(['#.#', '.#.'])
    const copy = cloneBitmap(src)
    copy.data[0] = 0
    expect(draw(src)).toEqual(['#.#', '.#.'])
    src.data[1] = 1
    expect(draw(copy)).toEqual(['..#', '.#.'])
  })
})

describe('countFilled', () => {
  it('counts filled pixels', () => {
    expect(countFilled(bitmap([]))).toBe(0)
    expect(countFilled(bitmap(['...', '...']))).toBe(0)
    expect(countFilled(bitmap(['###', '###']))).toBe(6)
    expect(countFilled(bitmap(['#.#', '.#.', '#.#']))).toBe(5)
  })

  it('agrees with bitmapGet summed over the image', () => {
    const bm = layerBitmap(Q, 1)
    let sum = 0
    for (let y = 0; y < bm.height; y++) for (let x = 0; x < bm.width; x++) sum += bitmapGet(bm, x, y)
    expect(countFilled(bm)).toBe(sum)
    expect(countFilled(bm)).toBe(5)
  })
})

describe('subtractBitmap', () => {
  it('clears the pixels filled in remove, in place', () => {
    const target = bitmap(['###', '###', '###'])
    const remove = bitmap(['#..', '.#.', '..#'])
    subtractBitmap(target, remove)
    expect(draw(target)).toEqual(['.##', '#.#', '##.'])
  })

  it('leaves remove untouched', () => {
    const target = bitmap(['###', '###'])
    const remove = bitmap(['#.#', '.#.'])
    subtractBitmap(target, remove)
    expect(draw(remove)).toEqual(['#.#', '.#.'])
  })

  it('is a no-op when remove has nothing in common with target', () => {
    const target = bitmap(['#.#', '.#.'])
    subtractBitmap(target, bitmap(['.#.', '#.#']))
    expect(draw(target)).toEqual(['#.#', '.#.'])
    subtractBitmap(target, bitmap(['...', '...']))
    expect(draw(target)).toEqual(['#.#', '.#.'])
  })

  it('empties a bitmap subtracted from itself', () => {
    const target = bitmap(['#.#', '.#.'])
    subtractBitmap(target, target)
    expect(countFilled(target)).toBe(0)
  })

  it('separates the stroke pixels from a layer the way the pipeline does', () => {
    const layer = layerBitmap(Q, 1)
    const strokes = bitmap(['...#', '...#', '...#'])
    const fills = cloneBitmap(layer)
    subtractBitmap(fills, strokes)
    expect(draw(fills)).toEqual(['..#.', '..#.', '....'])
    expect(draw(layer)).toEqual(['..##', '..##', '...#'])
    expect(countFilled(fills) + countFilled(strokes)).toBe(countFilled(layer))
  })

  it('aligns bitmaps of different sizes at the top-left and touches only the shared region', () => {
    // remove is wider and shorter than target: its rows must not be re-flowed
    // into target's rows, and target's third row lies outside remove entirely.
    const target = bitmap(['###', '###', '###'])
    const remove = bitmap(['#..#', '.#.#'])
    subtractBitmap(target, remove)
    expect(draw(target)).toEqual(['.##', '#.#', '###'])

    const small = bitmap(['##', '##'])
    subtractBitmap(small, bitmap(['#..', '...', '..#']))
    expect(draw(small)).toEqual(['.#', '##'])
  })
})
