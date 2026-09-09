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
 * Image Trace: a colour layer's bitmap to closed boundaries on the pixel grid.
 *
 * This is potrace's path decomposition (`bm_to_pathlist`), the stage that turns
 * "which pixels are filled" into "where the edges between filled and empty
 * run". Every later stage — the optimal polygon, the corner analysis — assumes
 * its input is a closed cycle of unit steps along pixel edges, so the boundary
 * is followed edge by edge rather than recovered from a marching-squares grid
 * or from component labelling: those give a set of segments that then has to be
 * stitched, and the stitching is exactly the ambiguity handled below.
 *
 * The loop is: find the first filled pixel in scan order, walk the boundary
 * that starts at its top-left corner, then REMOVE the region that walk enclosed
 * from a working copy by flipping every pixel inside it, and go round again
 * until nothing is left.
 *
 * The flip is potrace's trick and it is worth spelling out, because it does two
 * jobs at once. It stops the same boundary being found twice, which any
 * visited-edge marking would also do; but it also produces the holes. Flip the
 * interior of a filled ring and the ring vanishes while the white middle
 * becomes an island, so the very next scan finds that island and walks the
 * hole's boundary with the same code. An island inside that hole comes back
 * filled again on the next flip, so nesting to any depth falls out of repeating
 * one rule, with no containment tests and no tree to build. What the flip costs
 * is a copy of the bitmap and one row-segment flip per vertical boundary edge.
 *
 * Because a hole is walked as though it were solid, `sign` cannot be read from
 * the working copy — by then it says "filled" for what the picture calls white.
 * It is read from the ORIGINAL bitmap at the starting pixel: +1 when that pixel
 * really is filled (an outer boundary), −1 when it is a hole the flips exposed.
 *
 * Winding follows from where the walk starts. The starting pixel is the first
 * in row-major order, so everything above it and to its left in its row is
 * empty; leaving its top-left corner downwards therefore puts filled pixels on
 * the left of travel, and the whole walk keeps them there. Outer boundaries
 * come out counterclockwise on screen (y grows downward, so their signed area
 * is negative). A hole walked on flipped content keeps ITS filled side on the
 * left too, which means it comes out turning the same way as the outer it sits
 * in — and two paths with the same winding would fill the hole in under the
 * nonzero rule. Potrace reverses negative paths after the polygon stage; we
 * reverse the point list here instead, where the sign is known, so a PixelPath
 * is self-describing: hand any renderer the outer path and its holes and the
 * nonzero rule does the right thing.
 *
 * The one genuinely ambiguous configuration is the diagonal: two filled pixels
 * meeting at a single corner, with the other two empty. Either they are one
 * region pinched at that corner or two regions touching, and no local rule is
 * more correct than the other — it is the turn policy, and the default
 * ('minority') is potrace's: turn toward whichever colour is in the minority
 * around the corner, which keeps a thin diagonal line joined up on a light
 * background instead of dissolving it into a chain of separate diamonds.
 *
 * DOM-free, like the rest of the tracer, and it never writes to the bitmap it
 * is given.
 */

import { bitmapGet, cloneBitmap } from './bitmap'
import type { Bitmap, PixelPath } from './types'

/**
 * How the walk resolves the diagonal: two filled pixels touching at one corner
 * with the other two empty.
 *
 *   minority — turn toward the colour that is rarer around the corner (potrace's
 *              default: keeps thin diagonal features of either colour connected).
 *   majority — turn toward the commoner colour.
 *   black    — always connect the filled pixels, splitting the empty ones.
 *   white    — always connect the empty pixels, splitting the filled ones.
 *   left     — always turn left, right — always turn right (screen directions,
 *              y downward). Content-independent, and mostly useful for tests.
 */
export type TurnPolicy = 'minority' | 'majority' | 'black' | 'white' | 'left' | 'right'

/**
 * Every closed boundary in `bitmap`, outer boundaries and holes alike, in the
 * scan order they are found: a region before the holes inside it, and a region
 * before any region below or to the right of it.
 *
 * Paths enclosing fewer than `turdSize` pixels are dropped — the panel's Noise
 * control, which reads as a minimum region size, so `turdSize` 3 keeps a
 * 3-pixel speck and drops a 2-pixel one. Dropping happens after the region has
 * been flipped away, so removing a speck never disturbs the rest of the trace.
 *
 * The input is not modified.
 */
export function decompose(bitmap: Bitmap, turdSize: number, turnPolicy: TurnPolicy = 'minority'): PixelPath[] {
  const paths: PixelPath[] = []
  const work = cloneBitmap(bitmap)
  const pixels = Math.min(work.data.length, work.width * work.height)

  // The scan cursor never has to go back. The region a walk flips away lies
  // entirely at or after its starting pixel in row-major order — there are no
  // filled pixels above the starting row at all, and none to its left within
  // its own row — so nothing can reappear behind the cursor.
  let cursor = 0
  for (;;) {
    while (cursor < pixels && !work.data[cursor]) cursor++
    if (cursor >= pixels) break

    const x = cursor % work.width
    const y = (cursor - x) / work.width
    // From the original: after a flip the working copy calls holes filled.
    const sign: 1 | -1 = bitmapGet(bitmap, x, y) ? 1 : -1

    const points = findPath(work, x, y, sign, turnPolicy)
    xorPath(work, points)

    const area = Math.abs(enclosedArea(points))
    if (area >= turdSize) {
      if (sign === -1) reversePoints(points)
      paths.push({ points, sign, area })
    }
  }
  return paths
}

/**
 * Walks the boundary that starts at the top-left corner of pixel (px, py),
 * heading down, and returns its corners as a flat [x0, y0, x1, y1, ...] with
 * the start point once — the closing edge back to it is implied.
 *
 * At each corner the two pixels straight ahead decide the turn. Writing the
 * corner as (x, y) and the direction as (dx, dy), those two are
 *
 *   heading down  (0, 1):  right = (x-1, y  )   left = (x  , y  )
 *   heading right (1, 0):  right = (x  , y  )   left = (x  , y-1)
 *   heading up   (0, -1):  right = (x  , y-1)   left = (x-1, y-1)
 *   heading left (-1, 0):  right = (x-1, y-1)   left = (x-1, y  )
 *
 * which is what the index arithmetic below computes (potrace's `c` and `d`;
 * the numerators are always 0 or −2, so the shift is an exact halving). The
 * walk keeps filled pixels on its left, so: left filled and right empty means
 * carry straight on; right filled means the boundary turns right around it;
 * neither filled means it has run out of material and turns left; and right
 * filled with left empty is the diagonal the turn policy settles.
 *
 * Out-of-image probes read as empty (`bitmapGet`), which is what lets a region
 * that touches the border be walked by the same rule as one in the middle.
 */
function findPath(bm: Bitmap, px: number, py: number, sign: 1 | -1, turnPolicy: TurnPolicy): Int32Array {
  const coords: number[] = []
  let x = px
  let y = py
  let dx = 0
  let dy = 1

  for (;;) {
    coords.push(x, y)
    x += dx
    y += dy
    if (x === px && y === py) break

    const right = bitmapGet(bm, x + ((dx - dy - 1) >> 1), y + ((dx + dy - 1) >> 1))
    const left = bitmapGet(bm, x + ((dx + dy - 1) >> 1), y + ((dy - dx - 1) >> 1))

    // +1 turns right (clockwise on screen), −1 left, 0 carries straight on.
    let turn = 0
    if (right && !left) turn = turnsRight(turnPolicy, sign, bm, x, y) ? 1 : -1
    else if (right) turn = 1
    else if (!left) turn = -1

    if (turn !== 0) {
      const t = dx
      dx = -turn * dy
      dy = turn * t
    }
  }
  return Int32Array.from(coords)
}

/** Resolves the diagonal at corner (x, y) — potrace's turn policies. */
function turnsRight(policy: TurnPolicy, sign: 1 | -1, bm: Bitmap, x: number, y: number): boolean {
  switch (policy) {
    case 'right': return true
    case 'left': return false
    // A right turn keeps the two pixels the walk has filled — the ones matching
    // its sign — in one region, so 'black' wants it on an outer boundary and
    // 'white' on a hole, where the walk's "filled" is the picture's white.
    case 'black': return sign === 1
    case 'white': return sign === -1
    case 'majority': return majority(bm, x, y)
    case 'minority': return !majority(bm, x, y)
  }
}

/**
 * Are the pixels around corner (x, y) mostly filled? potrace's `majority`.
 *
 * The four pixels touching the corner are balanced by construction at the point
 * this is asked (two filled, two empty), so the vote starts one ring out, at
 * radius 2, and widens to radius 4 only while the rings keep coming out tied.
 * Each term below walks one side of the ring — a square shell of side 2i
 * centred on the corner — counting +1 for filled and −1 for empty; the shell is
 * symmetric about the corner, so it samples the same pixels whichever way up
 * the image is read. A tie at all three radii answers "not a majority", which
 * under the default 'minority' policy means a right turn — the same answer a
 * mostly empty ring gives, and the one that keeps the two pixels the walk is
 * following joined.
 */
function majority(bm: Bitmap, x: number, y: number): boolean {
  for (let i = 2; i < 5; i++) {
    let ct = 0
    for (let a = -i + 1; a <= i - 1; a++) {
      ct += bitmapGet(bm, x + a, y + i - 1) ? 1 : -1
      ct += bitmapGet(bm, x + i - 1, y + a - 1) ? 1 : -1
      ct += bitmapGet(bm, x + a - 1, y - i) ? 1 : -1
      ct += bitmapGet(bm, x - i, y + a) ? 1 : -1
    }
    if (ct > 0) return true
    if (ct < 0) return false
  }
  return false
}

/**
 * Flips every pixel enclosed by `points`, removing the region just walked from
 * the working bitmap — potrace's `xor_path`.
 *
 * Scanline parity, done incrementally. Each vertical edge of the path borders
 * one pixel row (the lower of the two corner rows it joins); flipping that
 * row's pixels from a fixed reference column up to the edge leaves, once every
 * edge has been processed, exactly the pixels the path encloses flipped. The
 * reference column is arbitrary — the path is closed, so every row is crossed
 * an even number of times and any stretch counted from a common reference is
 * flipped an even number of times or not at all — and taking the path's own
 * first x keeps the flipped stretches near the region instead of running back
 * to column 0 every time.
 *
 * `y1` starts as the LAST point's y so that the closing edge is handled by the
 * first iteration, without a special case.
 */
function xorPath(bm: Bitmap, points: Int32Array): void {
  const n = points.length
  if (n < 4) return

  const xa = points[0]
  let y1 = points[n - 1]
  for (let i = 0; i < n; i += 2) {
    const y = points[i + 1]
    if (y === y1) continue
    flipRow(bm, Math.min(y, y1), Math.min(points[i], xa), Math.max(points[i], xa))
    y1 = y
  }
}

/** Flips pixels [x0, x1) of one row. Writes 0/1, whatever byte was there. */
function flipRow(bm: Bitmap, y: number, x0: number, x1: number): void {
  const row = y * bm.width
  for (let x = x0; x < x1; x++) bm.data[row + x] = bm.data[row + x] ? 0 : 1
}

/**
 * The signed area the closed path encloses, by Green's theorem: the sum of
 * x·dy along the edges. Negative for the counterclockwise-on-screen winding an
 * outer boundary comes out with. Every step moves along one axis only, so x is
 * constant over any step that contributes and the sum is exact in integers —
 * no trapezoid halves, and the result is the enclosed pixel count.
 */
function enclosedArea(points: Int32Array): number {
  const n = points.length
  if (n < 4) return 0

  let area = 0
  let y1 = points[n - 1]
  for (let i = 0; i < n; i += 2) {
    const y = points[i + 1]
    area += points[i] * (y - y1)
    y1 = y
  }
  return area
}

/** Reverses the point order in place, flipping the path's winding. */
function reversePoints(points: Int32Array): void {
  for (let i = 0, j = points.length - 2; i < j; i += 2, j -= 2) {
    const x = points[i]
    const y = points[i + 1]
    points[i] = points[j]
    points[i + 1] = points[j + 1]
    points[j] = x
    points[j + 1] = y
  }
}
