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
 * Boundary decomposition for Image Trace. Bitmaps are written as pictures — rows
 * of '#' and '.' — and every case also runs `checkInvariants`, which asserts the
 * things the rest of the tracer relies on: unit steps, corners inside the image,
 * outer and hole windings opposite, and the signed areas summing to the number
 * of filled pixels.
 */
import { describe, it, expect } from 'vitest'
import { decompose, type TurnPolicy } from '@/trace/decompose'
import { countFilled } from '@/trace/bitmap'
import type { Bitmap, PixelPath } from '@/trace/types'

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

/** `width` x `height` with `fill(x, y)` deciding each pixel. */
function generate(width: number, height: number, fill: (x: number, y: number) => boolean): Bitmap {
  const rows: string[] = []
  for (let y = 0; y < height; y++) {
    let row = ''
    for (let x = 0; x < width; x++) row += fill(x, y) ? '#' : '.'
    rows.push(row)
  }
  return bitmap(rows)
}

/** A path's corners as [x, y] pairs. */
function corners(path: PixelPath): number[][] {
  const out: number[][] = []
  for (let i = 0; i < path.points.length; i += 2) out.push([path.points[i], path.points[i + 1]])
  return out
}

/** Signed area by the shoelace formula, over the corner list as given. */
function shoelace(path: PixelPath): number {
  const pts = corners(path)
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum / 2
}

/**
 * Everything that has to hold for every decomposition, whatever the picture:
 * closed cycles of unit steps, corners on the pixel grid of the image, |area|
 * matching the shoelace, holes wound against their outers, and — the one that
 * catches a boundary followed the wrong way round — the signed areas adding up
 * to the number of filled pixels, since an outer counts its holes in and each
 * hole takes itself back out.
 */
function checkInvariants(paths: PixelPath[], bm: Bitmap): void {
  let total = 0
  for (const path of paths) {
    const pts = corners(path)
    expect(pts.length).toBeGreaterThanOrEqual(4)
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i]
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(bm.width)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(bm.height)
      // Implicitly closed: the step from the last corner to the first counts.
      const [nx, ny] = pts[(i + 1) % pts.length]
      expect(Math.abs(nx - x) + Math.abs(ny - y)).toBe(1)
    }
    expect(path.area).toBe(Math.abs(shoelace(path)))
    expect(Number.isInteger(path.area)).toBe(true)
    expect(path.area).toBeGreaterThan(0)
    // y grows downward, so an outer boundary's shoelace is negative.
    expect(Math.sign(shoelace(path))).toBe(path.sign === 1 ? -1 : 1)
    total += path.sign * path.area
  }
  expect(total).toBe(countFilled(bm))
}

/** Decompose keeping everything, and assert the invariants while we are here. */
function traced(bm: Bitmap, turdSize = 1, policy?: TurnPolicy): PixelPath[] {
  const paths = decompose(bm, turdSize, policy)
  if (turdSize <= 1) checkInvariants(paths, bm)
  return paths
}

describe('decompose', () => {
  it('traces a single pixel as the four corners of its square', () => {
    const paths = traced(bitmap([
      '...',
      '.#.',
      '...',
    ]))
    expect(paths).toHaveLength(1)
    expect(paths[0].sign).toBe(1)
    expect(paths[0].area).toBe(1)
    expect(paths[0].points).toBeInstanceOf(Int32Array)
    // Starts at the pixel's top-left corner and leaves it downwards.
    expect(corners(paths[0])).toEqual([[1, 1], [1, 2], [2, 2], [2, 1]])
  })

  it('traces a 3x3 square as 12 corners enclosing 9 pixels', () => {
    const paths = traced(bitmap([
      '.....',
      '.###.',
      '.###.',
      '.###.',
      '.....',
    ]))
    expect(paths).toHaveLength(1)
    expect(paths[0].area).toBe(9)
    expect(corners(paths[0])).toHaveLength(12)
    expect(corners(paths[0])[0]).toEqual([1, 1])
    // Every corner is on the perimeter of the square, none inside it.
    for (const [x, y] of corners(paths[0])) {
      expect(x === 1 || x === 4 || y === 1 || y === 4).toBe(true)
    }
  })

  it('keeps the corners of a region touching the border inside the image', () => {
    const bm = bitmap([
      '####',
      '####',
      '####',
    ])
    const paths = traced(bm)
    expect(paths).toHaveLength(1)
    expect(paths[0].area).toBe(12)
    expect(corners(paths[0])).toHaveLength(14)
    expect(new Set(corners(paths[0]).map(p => p.join(',')))).toContain('4,3')
  })

  it('traces two separate pixels as two paths, in scan order', () => {
    const paths = traced(bitmap([
      '..#.',
      '....',
      '.#..',
    ]))
    expect(paths).toHaveLength(2)
    expect(paths.map(p => p.sign)).toEqual([1, 1])
    expect(paths.map(p => p.area)).toEqual([1, 1])
    expect(corners(paths[0])[0]).toEqual([2, 0])
    expect(corners(paths[1])[0]).toEqual([1, 2])
  })

  it('traces a hole as a second path of the opposite sign and winding', () => {
    const bm = bitmap([
      '#####',
      '#####',
      '##.##',
      '#####',
      '#####',
    ])
    const paths = traced(bm)
    expect(paths).toHaveLength(2)
    expect(paths.map(p => p.sign)).toEqual([1, -1])
    // The outer encloses the whole square, holes and all; the hole one pixel.
    expect(paths.map(p => p.area)).toEqual([25, 1])
    expect(Math.sign(shoelace(paths[0]))).toBe(-1)
    expect(Math.sign(shoelace(paths[1]))).toBe(1)
    expect(corners(paths[1])).toHaveLength(4)
  })

  it('alternates the sign through nested rings', () => {
    // A ring, a ring inside its hole, and a pixel inside that one's hole.
    const bm = bitmap([
      '#######',
      '#.....#',
      '#.###.#',
      '#.#.#.#',
      '#.###.#',
      '#.....#',
      '#######',
    ])
    const paths = traced(bm)
    expect(paths.map(p => p.sign)).toEqual([1, -1, 1, -1])
    expect(paths.map(p => p.area)).toEqual([49, 25, 9, 1])
    expect(paths.map(p => Math.sign(shoelace(p)))).toEqual([-1, 1, -1, 1])
  })

  it('traces a one-pixel-wide diagonal staircase as a single region', () => {
    // Two pixels per row, stepping right: consecutive rows share a column, so
    // this is one 4-connected region whatever the turn policy says.
    const bm = generate(8, 8, (x, y) => x === y || x === y + 1)
    expect(countFilled(bm)).toBe(15)

    for (const policy of ['minority', 'majority', 'black', 'white'] as const) {
      const paths = traced(bm, 1, policy)
      expect(paths).toHaveLength(1)
      expect(paths[0].area).toBe(15)
      expect(corners(paths[0])).toHaveLength(32)
    }
  })

  it('returns nothing for an empty bitmap', () => {
    expect(decompose(bitmap([]), 1)).toEqual([])
    expect(decompose(bitmap(['...', '...']), 1)).toEqual([])
    expect(decompose({ width: 0, height: 0, data: new Uint8Array(0) }, 1)).toEqual([])
    expect(decompose({ width: 4, height: 0, data: new Uint8Array(0) }, 1)).toEqual([])
  })

  it('never writes to the bitmap it is given', () => {
    const bm = bitmap([
      '.###.',
      '.#.#.',
      '.###.',
    ])
    const before = Array.from(bm.data)
    expect(decompose(bm, 1)).toHaveLength(2)
    expect(Array.from(bm.data)).toEqual(before)
  })

  it('reads any nonzero byte as filled and still terminates', () => {
    // bitmapGet treats 255 as filled, so decompose must not assume 0/1 input.
    const bm: Bitmap = { width: 3, height: 2, data: Uint8Array.of(0, 7, 0, 0, 255, 0) }
    const paths = traced(bm)
    expect(paths).toHaveLength(1)
    expect(paths[0].area).toBe(2)
    // A 1x2 domino: six corners, and the flip that removes it has to leave
    // zeroes behind, not 7 ^ 1 and 255 ^ 1, which would still read as filled.
    expect(corners(paths[0])).toEqual([[1, 0], [1, 1], [1, 2], [2, 2], [2, 1], [2, 0]])
  })
})

describe('decompose turdSize', () => {
  const bm = bitmap([
    '##...',
    '.....',
    '..###',
    '..###',
    '..###',
  ])

  it('drops a 2-pixel blob at 3 and keeps it at 2', () => {
    expect(decompose(bm, 3).map(p => p.area)).toEqual([9])
    expect(decompose(bm, 2).map(p => p.area)).toEqual([2, 9])
    expect(decompose(bm, 1).map(p => p.area)).toEqual([2, 9])
    expect(decompose(bm, 0).map(p => p.area)).toEqual([2, 9])
  })

  it('drops everything when the threshold is above every region', () => {
    expect(decompose(bm, 10)).toEqual([])
  })

  it('drops a small hole without disturbing the region around it', () => {
    const ring = bitmap([
      '#####',
      '#####',
      '##.##',
      '#####',
      '#####',
    ])
    const paths = decompose(ring, 2)
    expect(paths).toHaveLength(1)
    expect(paths[0].sign).toBe(1)
    expect(paths[0].area).toBe(25)
  })
})

describe('decompose turn policies', () => {
  // Two filled pixels meeting at one corner: one region pinched, or two
  // touching. Nothing local decides it, so the policy does.
  const diagonal = bitmap([
    '....',
    '.#..',
    '..#.',
    '....',
  ])

  const connected = (policy: TurnPolicy): boolean => {
    const paths = traced(diagonal, 1, policy)
    return paths.length === 1
  }

  it('connects the filled pixels for black, right and (here) minority', () => {
    // The ring around the corner is nearly all empty, so filled is the
    // minority and potrace's default keeps the diagonal joined.
    expect(connected('black')).toBe(true)
    expect(connected('right')).toBe(true)
    expect(connected('minority')).toBe(true)
    expect(traced(diagonal, 1, 'black')[0].area).toBe(2)
  })

  it('separates them for white, left and majority', () => {
    expect(connected('white')).toBe(false)
    expect(connected('left')).toBe(false)
    expect(connected('majority')).toBe(false)
    expect(traced(diagonal, 1, 'majority').map(p => p.area)).toEqual([1, 1])
  })

  it('defaults to minority', () => {
    expect(decompose(diagonal, 1)).toEqual(decompose(diagonal, 1, 'minority'))
  })

  it('flips over for a diagonal hole, where filled to the walk means white in the picture', () => {
    // The same diagonal, in white, inside a solid block: 'white' now connects.
    const holes = bitmap([
      '#####',
      '##.##',
      '###.#',
      '#####',
    ])
    expect(traced(holes, 1, 'white')).toHaveLength(2)
    expect(traced(holes, 1, 'black')).toHaveLength(3)
    expect(traced(holes, 1, 'white')[1].area).toBe(2)
  })
})

describe('decompose over generated pictures', () => {
  it('holds the invariants for a disk, a ring and a checkerboard', () => {
    const disk = generate(24, 24, (x, y) => (x + 0.5 - 12) ** 2 + (y + 0.5 - 12) ** 2 <= 100)
    expect(traced(disk)).toHaveLength(1)

    const ring = generate(24, 24, (x, y) => {
      const d = (x + 0.5 - 12) ** 2 + (y + 0.5 - 12) ** 2
      return d <= 100 && d >= 36
    })
    const rings = traced(ring)
    expect(rings.map(p => p.sign)).toEqual([1, -1])

    // Every pixel diagonally touching four others: the worst case for the
    // ambiguous turn, and 288 separate regions under 'majority'.
    const checker = generate(24, 24, (x, y) => (x + y) % 2 === 0)
    expect(traced(checker, 1, 'majority')).toHaveLength(288)
    expect(countFilled(checker)).toBe(288)
  })

  it('holds the invariants over random noise, for every turn policy', () => {
    // Seeded LCG: the same 40 pictures every run.
    let seed = 20260909
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const policies: TurnPolicy[] = ['minority', 'majority', 'black', 'white', 'left', 'right']

    for (let trial = 0; trial < 40; trial++) {
      const density = 0.2 + 0.6 * (trial / 40)
      const bm = generate(17, 13, () => random() < density)
      for (const policy of policies) checkInvariants(decompose(bm, 1, policy), bm)
    }
  })
})
