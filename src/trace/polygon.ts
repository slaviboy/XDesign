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
 * Image Trace, stage 3: the optimal polygon.
 *
 * decompose hands over a boundary that follows the pixel grid exactly — one
 * point per pixel edge, every turn a right angle. Fitting curves to that
 * directly would faithfully reproduce the staircase, because the jaggedness is
 * in the data. This stage throws the grid away: it replaces the boundary with
 * the FEWEST straight segments that still pass within half a pixel of every
 * point they drop. Half a pixel is the resolution at which the raster quantised
 * the shape in the first place, so anything below it is an artefact of
 * sampling and anything above it is something the artwork actually did.
 *
 * Three steps, all from potrace (Selinger, "Potrace: a polygon-based tracing
 * algorithm", 2003, sections 2.2-2.3):
 *
 *   calc_lon        For each point i the furthest point lon[i] such that the
 *                   whole run i..lon[i] is straight, i.e. one line passes
 *                   within half a pixel of all of it. Straightness is decided
 *                   with integer cross products alone: each point the run
 *                   swallows narrows a pair of constraint directions, and the
 *                   run ends at the first point no admissible direction can
 *                   still reach. Because the arithmetic is over the corners of
 *                   the pixel square, the half pixel is measured on the grid:
 *                   for an axis-aligned or 45° run, which is nearly every run
 *                   on a real boundary, it is half a pixel exactly, and in the
 *                   worst case — an uneven oblique staircase — half a pixel's
 *                   diagonal. Two rules are carried over verbatim. A run
 *                   also ends the moment the boundary has used all four axis
 *                   directions — a path that goes right, down, left AND up has
 *                   turned back on itself, and no straight line approximates
 *                   that however short the steps are. And the constraints are
 *                   only ever tested at direction changes, hopping through the
 *                   `nc` table from one corner to the next, which is what makes
 *                   this quadratic rather than cubic in the point count.
 *
 *   bestpolygon     A dynamic programme that picks the vertex subset: first the
 *                   minimum NUMBER of segments, then, among the polygons with
 *                   that many, the least summed penalty. The penalty of one
 *                   segment is read off cumulative sums of x, y, x², xy and y²,
 *                   so a candidate costs O(1) however many points it spans.
 *                   Fewest-segments-first is why a traced rectangle comes out
 *                   with four anchors and not four-ish.
 *
 *   adjust_vertices A polygon vertex is still an integer pixel corner, and a
 *                   pixel corner is a poor guess at where the real edge ran —
 *                   it is where the staircase turned, up to half a pixel away.
 *                   Each segment gets the least-squares line through the points
 *                   it covers (the same cumulative sums, as a quadratic form),
 *                   and each vertex moves to the point that minimises the
 *                   distance to the two lines meeting there. Near-parallel
 *                   lines put that minimum arbitrarily far away, so the search
 *                   is confined to the unit square around the original corner —
 *                   interior first, then the four edges, then the four corners
 *                   of the square. A vertex therefore never travels more than
 *                   half a pixel in either axis, whatever the input.
 *
 * The path is a cycle, so indices are taken modulo n with potrace's `mod` and
 * `cyclic` helpers rather than with JS `%`, which is not the remainder for
 * negative operands. The dynamic programme itself is potrace's non-cyclic one:
 * it assumes point 0 is a polygon vertex and optimises the open run 0..n. That
 * costs nothing here, because decompose starts every path at the top-left
 * corner of its topmost-leftmost pixel, which is a corner of the shape and
 * belongs in the polygon anyway, and a genuinely cyclic programme would have to
 * run the whole thing once per candidate start.
 *
 * DOM-free and allocation-light: every working array is a typed array sized
 * from the path, since a photograph trace runs this over tens of thousands of
 * paths inside one worker call.
 */

import type { PixelPath, Polygon, Vec2 } from './types'

/** potrace's INFTY — stands in for "no upper bound found yet" in integer code. */
const INFTY = 10000000

/** Positive remainder. JS `%` keeps the sign of the dividend, which breaks the wrap. */
function mod(a: number, n: number): number {
  return a >= n ? a % n : a >= 0 ? a : n - 1 - ((-1 - a) % n)
}

/** Division rounding towards minus infinity, matching potrace's floordiv. */
function floorDiv(a: number, n: number): number {
  return a >= 0 ? Math.floor(a / n) : -1 - Math.floor((-1 - a) / n)
}

/** True when `a <= b < c` in the cyclic order — the range test used everywhere below. */
function cyclic(a: number, b: number, c: number): boolean {
  return a <= c ? a <= b && b < c : a <= b || b < c
}

function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0
}

/** Cross product of two integer vectors; its sign is which side of p1 that p2 is on. */
function xprod(p1x: number, p1y: number, p2x: number, p2y: number): number {
  return p1x * p2y - p1y * p2x
}

/**
 * Cumulative sums of x, y, x², xy and y² over the path, each with a leading
 * zero so the totals for points i..j are one subtraction apart. They are taken
 * relative to point 0 to keep the squares small — an unshifted x² over a large
 * image loses precision in the differences long before the coordinates do.
 */
interface Sums {
  x: Float64Array
  y: Float64Array
  x2: Float64Array
  xy: Float64Array
  y2: Float64Array
}

function calcSums(pt: Int32Array, n: number): Sums {
  const sums: Sums = {
    x: new Float64Array(n + 1),
    y: new Float64Array(n + 1),
    x2: new Float64Array(n + 1),
    xy: new Float64Array(n + 1),
    y2: new Float64Array(n + 1),
  }
  const x0 = pt[0]
  const y0 = pt[1]
  for (let i = 0; i < n; i++) {
    const x = pt[i << 1] - x0
    const y = pt[(i << 1) + 1] - y0
    sums.x[i + 1] = sums.x[i] + x
    sums.y[i + 1] = sums.y[i] + y
    sums.x2[i + 1] = sums.x2[i] + x * x
    sums.xy[i + 1] = sums.xy[i] + x * y
    sums.y2[i + 1] = sums.y2[i] + y * y
  }
  return sums
}

/**
 * For each i, the furthest j such that the run i..j is straight (potrace's
 * calc_lon). Both ends are point indices into the path.
 *
 * The walk is over "corners" only: `nc[i]` is the last point still reachable
 * from i along a single horizontal or vertical run, so the loop below advances
 * a whole run at a time and tests the constraints once per direction change.
 * `pivk[i]` is first computed as the furthest point i can reach on its own;
 * the final pass then makes lon monotone in the cyclic order, which is what
 * turns a per-point answer into one usable by the segment search.
 */
function calcLon(pt: Int32Array, n: number): Int32Array {
  const ptx = (i: number): number => pt[i << 1]
  const pty = (i: number): number => pt[(i << 1) + 1]

  const pivk = new Int32Array(n)
  const nc = new Int32Array(n)
  const lon = new Int32Array(n)
  // A typed array so a direction index that somehow left 0..3 — only possible
  // for a path whose steps are not unit axis steps — is dropped, not aliased.
  const ct = new Int32Array(4)

  // Next corner: from each point, the furthest later point joined to it by one
  // horizontal or vertical segment. Point 0 is always a direction change (a
  // path starts at the top-left corner of a pixel), so the scan can start there.
  let k = 0
  for (let i = n - 1; i >= 0; i--) {
    if (ptx(i) !== ptx(k) && pty(i) !== pty(k)) k = i + 1
    nc[i] = k
  }

  for (let i = n - 1; i >= 0; i--) {
    ct[0] = 0
    ct[1] = 0
    ct[2] = 0
    ct[3] = 0

    // Which of the four axis directions the step out of i takes. The four
    // directions map onto 0..3 by (3 + 3dx + dy) / 2, which is exact for unit
    // axis steps: (-1,0) -> 0, (0,-1) -> 1, (0,1) -> 2, (1,0) -> 3.
    const next = mod(i + 1, n)
    ct[(3 + 3 * sign(ptx(next) - ptx(i)) + sign(pty(next) - pty(i))) >> 1]++

    // The admissible directions, as the two extreme ones seen so far: a
    // candidate must be left of constraint[0] and right of constraint[1].
    let c0x = 0
    let c0y = 0
    let c1x = 0
    let c1y = 0

    let k1 = i
    k = nc[i]
    let foundk = false
    for (;;) {
      ct[(3 + 3 * sign(ptx(k) - ptx(k1)) + sign(pty(k) - pty(k1))) >> 1]++

      // All four directions used: the run has doubled back and cannot be
      // straight past the previous corner, however short its steps are.
      if (ct[0] && ct[1] && ct[2] && ct[3]) {
        pivk[i] = k1
        foundk = true
        break
      }

      const curx = ptx(k) - ptx(i)
      const cury = pty(k) - pty(i)

      // Outside the admissible cone: k is the first corner that fails.
      if (xprod(c0x, c0y, curx, cury) < 0 || xprod(c1x, c1y, curx, cury) > 0) break

      // A step of at most one pixel constrains nothing — every direction still
      // passes within half a pixel of it.
      if (Math.abs(curx) > 1 || Math.abs(cury) > 1) {
        // Tighten each side towards the corner of the unit square around cur
        // that the line may still graze.
        let offx = curx + (cury >= 0 && (cury > 0 || curx < 0) ? 1 : -1)
        let offy = cury + (curx <= 0 && (curx < 0 || cury < 0) ? 1 : -1)
        if (xprod(c0x, c0y, offx, offy) >= 0) {
          c0x = offx
          c0y = offy
        }
        offx = curx + (cury <= 0 && (cury < 0 || curx < 0) ? 1 : -1)
        offy = cury + (curx >= 0 && (curx > 0 || cury < 0) ? 1 : -1)
        if (xprod(c1x, c1y, offx, offy) <= 0) {
          c1x = offx
          c1y = offy
        }
      }

      k1 = k
      k = nc[k1]
      // Once the corner walk wraps past i the whole cycle is straight; stop
      // before it laps itself.
      if (!cyclic(k, i, k1)) break
    }

    if (foundk) continue

    // k1 is the last corner that satisfied the constraints and k the first that
    // does not, so the answer lies on the run between them: the largest j with
    // both cross products still on the right side of zero. Both are linear in
    // j, so integer division settles it without walking the run.
    const dkx = sign(ptx(k) - ptx(k1))
    const dky = sign(pty(k) - pty(k1))
    const curx = ptx(k1) - ptx(i)
    const cury = pty(k1) - pty(i)
    const a = xprod(c0x, c0y, curx, cury)
    const b = xprod(c0x, c0y, dkx, dky)
    const c = xprod(c1x, c1y, curx, cury)
    const d = xprod(c1x, c1y, dkx, dky)
    let j = INFTY
    if (b < 0) j = floorDiv(a, -b)
    if (d > 0) j = Math.min(j, floorDiv(-c, d))
    pivk[i] = mod(k1 + j, n)
  }

  // lon[i] is the largest k such that every i' in i..k has i' < k <= pivk[i'],
  // i.e. the per-point answers made monotone around the cycle.
  let j = pivk[n - 1]
  lon[n - 1] = j
  for (let i = n - 2; i >= 0; i--) {
    if (cyclic(i + 1, pivk[i], j)) j = pivk[i]
    lon[i] = j
  }
  // The wrap-around fixup. potrace lets this run off the front of the array,
  // relying on the condition failing at i = 0; the bound is here so a malformed
  // path cannot walk backwards out of the buffer.
  for (let i = n - 1; i >= 0 && cyclic(mod(i + 1, n), j, lon[i]); i--) lon[i] = j

  return lon
}

/**
 * The cost of replacing the run i..j by the straight segment between its ends:
 * the root of the summed squared distance from the covered points to that line,
 * evaluated from the cumulative sums so it does not depend on the run length.
 * `j` may exceed n by up to one lap, which is how a segment spans the wrap.
 */
function penalty3(pt: Int32Array, n: number, sums: Sums, i: number, j: number): number {
  let r = 0
  if (j >= n) {
    j -= n
    r = 1
  }

  const x = sums.x[j + 1] - sums.x[i] + r * sums.x[n]
  const y = sums.y[j + 1] - sums.y[i] + r * sums.y[n]
  const x2 = sums.x2[j + 1] - sums.x2[i] + r * sums.x2[n]
  const xy = sums.xy[j + 1] - sums.xy[i] + r * sums.xy[n]
  const y2 = sums.y2[j + 1] - sums.y2[i] + r * sums.y2[n]
  const k = j + 1 - i + r * n

  // Midpoint of the segment and its normal, both relative to point 0 like the sums.
  const px = (pt[i << 1] + pt[j << 1]) / 2 - pt[0]
  const py = (pt[(i << 1) + 1] + pt[(j << 1) + 1]) / 2 - pt[1]
  const ey = pt[j << 1] - pt[i << 1]
  const ex = -(pt[(j << 1) + 1] - pt[(i << 1) + 1])

  const a = (x2 - 2 * x * px) / k + px * px
  const b = (xy - x * py - y * px) / k + px * py
  const c = (y2 - 2 * y * py) / k + py * py

  return Math.sqrt(ex * ex * a + 2 * ex * ey * b + ey * ey * c)
}

/**
 * potrace's bestpolygon: the vertex indices of the polygon with the fewest
 * segments, and the smallest penalty among those.
 *
 * `clip0[i]` is the furthest vertex an edge starting at i may reach — one short
 * of lon[i-1], so the segment stays straight even counting the point before it,
 * which is the slack adjustVertices later spends moving the vertex. `clip1` is
 * its inverse, `seg0`/`seg1` the earliest and latest point reachable with a
 * given number of segments; between them they bound the search so the two outer
 * loops together run at most n times.
 */
function bestPolygon(pt: Int32Array, n: number, lon: Int32Array, sums: Sums): Int32Array {
  const pen = new Float64Array(n + 1)
  const prev = new Int32Array(n + 1)
  const clip0 = new Int32Array(n)
  const clip1 = new Int32Array(n + 1)
  const seg0 = new Int32Array(n + 1)
  const seg1 = new Int32Array(n + 1)

  for (let i = 0; i < n; i++) {
    let c = mod(lon[mod(i - 1, n)] - 1, n)
    // An edge must advance by at least one point even where nothing is straight.
    if (c === i) c = mod(i + 1, n)
    clip0[i] = c < i ? n : c
  }

  // j <= clip0[i] exactly when clip1[j] <= i.
  let j = 1
  for (let i = 0; i < n; i++) {
    while (j <= clip0[i]) {
      clip1[j] = i
      j++
    }
  }

  // The greedy longest-edge walk from 0 gives both the segment count m and, per
  // segment, the furthest point reachable with that many edges.
  let i = 0
  for (j = 0; i < n; j++) {
    seg0[j] = i
    i = clip0[i]
  }
  seg0[j] = n
  const m = j

  i = n
  for (j = m; j > 0; j--) {
    seg1[j] = i
    i = clip1[i]
  }
  seg1[0] = 0

  // Shortest path with exactly m segments.
  pen[0] = 0
  for (j = 1; j <= m; j++) {
    for (i = seg1[j]; i <= seg0[j]; i++) {
      let best = -1
      for (let k = seg0[j - 1]; k >= clip1[i]; k--) {
        const thispen = penalty3(pt, n, sums, k, i) + pen[k]
        if (best < 0 || thispen < best) {
          prev[i] = k
          best = thispen
        }
      }
      pen[i] = best
    }
  }

  const po = new Int32Array(m)
  for (i = n, j = m - 1; i > 0; j--) {
    i = prev[i]
    po[j] = i
  }
  return po
}

/**
 * The optimal polygon of a pixel path: indices into `path.points`, ascending,
 * starting at 0. Every dropped point lies within half a pixel of a line through
 * the segment that replaced it.
 */
export function optimalPolygon(path: PixelPath): Polygon {
  const pt = path.points
  const n = pt.length >> 1
  // Nothing to choose: with fewer than three points there is no interior point
  // to drop, and calc_lon's corner walk has no direction change to start from.
  if (n < 3) return Int32Array.from({ length: n }, (_, i) => i)
  return bestPolygon(pt, n, calcLon(pt, n), calcSums(pt, n))
}

/**
 * Centre and direction of the least-squares line through the points i..j, from
 * the cumulative sums. The direction is the eigenvector of the covariance
 * matrix for the larger eigenvalue — the axis the points spread along. `i` and
 * `j` may sit outside 0..n-1 by up to one lap, which is how a segment that
 * crosses the path start is asked for.
 */
function pointSlope(n: number, sums: Sums, i: number, j: number): { ctr: Vec2; dir: Vec2 } {
  let r = 0
  while (j >= n) {
    j -= n
    r += 1
  }
  while (i >= n) {
    i -= n
    r -= 1
  }
  while (j < 0) {
    j += n
    r -= 1
  }
  while (i < 0) {
    i += n
    r += 1
  }

  const x = sums.x[j + 1] - sums.x[i] + r * sums.x[n]
  const y = sums.y[j + 1] - sums.y[i] + r * sums.y[n]
  const x2 = sums.x2[j + 1] - sums.x2[i] + r * sums.x2[n]
  const xy = sums.xy[j + 1] - sums.xy[i] + r * sums.xy[n]
  const y2 = sums.y2[j + 1] - sums.y2[i] + r * sums.y2[n]
  const k = j + 1 - i + r * n

  const ctr: Vec2 = { x: x / k, y: y / k }

  let a = (x2 - (x * x) / k) / k
  const b = (xy - (x * y) / k) / k
  let c = (y2 - (y * y) / k) / k

  const lambda2 = (a + c + Math.sqrt((a - c) * (a - c) + 4 * b * b)) / 2
  a -= lambda2
  c -= lambda2

  // Take the better conditioned of the two rows; both give the same eigenvector
  // in exact arithmetic, and a zero length means the eigenvalues coincided (a
  // run with no direction at all, e.g. the four points of a single pixel).
  const dir: Vec2 = { x: 0, y: 0 }
  if (Math.abs(a) >= Math.abs(c)) {
    const l = Math.sqrt(a * a + b * b)
    if (l !== 0) {
      dir.x = -b / l
      dir.y = a / l
    }
  } else {
    const l = Math.sqrt(c * c + b * b)
    if (l !== 0) {
      dir.x = -c / l
      dir.y = b / l
    }
  }
  return { ctr, dir }
}

/**
 * The point where the quadratic form is smallest: where the two lines meeting
 * at a vertex come closest to crossing.
 *
 * Parallel lines make the form singular and their minimum is a whole line, so
 * an axis orthogonal to it through the original corner is folded into `q` and
 * the solve retried. That both picks the nearest point on that line and leaves
 * `q` with a unique minimum for the boundary search afterwards; two rounds are
 * always enough, since each one adds a rank.
 */
function minimizeQuadform(q: Float64Array, sx: number, sy: number): Vec2 {
  for (;;) {
    const det = q[0] * q[4] - q[1] * q[3]
    if (det !== 0) {
      return {
        x: (-q[2] * q[4] + q[5] * q[1]) / det,
        y: (q[2] * q[3] - q[5] * q[0]) / det,
      }
    }

    let v0: number
    let v1: number
    if (q[0] > q[4]) {
      v0 = -q[1]
      v1 = q[0]
    } else if (q[4] !== 0) {
      v0 = -q[4]
      v1 = q[3]
    } else {
      v0 = 1
      v1 = 0
    }
    const d = v0 * v0 + v1 * v1
    const v = [v0, v1, -v1 * sy - v0 * sx]
    for (let l = 0; l < 3; l++) {
      for (let k = 0; k < 3; k++) q[l * 3 + k] += (v[l] * v[k]) / d
    }
  }
}

/** (x, y, 1) Q (x, y, 1)ᵀ — the squared distance to the line(s) Q was built from. */
function quadform(q: Float64Array, wx: number, wy: number): number {
  const v = [wx, wy, 1]
  let sum = 0
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) sum += v[i] * q[i * 3 + j] * v[j]
  }
  return sum
}

/**
 * Real-valued positions for the polygon vertices (potrace's adjust_vertices),
 * in the same pixel-corner coordinates as the path, one per polygon vertex and
 * in the same order.
 *
 * Each segment becomes a singular quadratic form whose value at a point is the
 * squared distance to that segment's least-squares line; adding the forms of
 * the two segments meeting at a vertex gives a paraboloid whose minimum is the
 * ideal corner. The minimum is taken over the unit square around the original
 * pixel corner, so a vertex moves by at most half a pixel in each axis even
 * when the two lines are nearly parallel and their true intersection is far
 * outside the shape.
 */
export function adjustVertices(path: PixelPath, poly: Polygon): Vec2[] {
  const pt = path.points
  const n = pt.length >> 1
  const m = poly.length
  if (n === 0 || m === 0) return []

  const sums = calcSums(pt, n)
  const x0 = pt[0]
  const y0 = pt[1]

  // One point-slope line per segment, then the same line as a quadratic form.
  const q = new Float64Array(m * 9)
  for (let i = 0; i < m; i++) {
    // The segment runs from poly[i] to poly[i+1], the second index unwrapped so
    // it is never less than the first.
    const end = mod(poly[mod(i + 1, m)] - poly[i], n) + poly[i]
    const { ctr, dir } = pointSlope(n, sums, poly[i], end)
    const d = dir.x * dir.x + dir.y * dir.y
    if (d === 0) continue // a directionless run leaves an all-zero form
    const v0 = dir.y
    const v1 = -dir.x
    const v2 = -v1 * ctr.y - v0 * ctr.x
    const v = [v0, v1, v2]
    for (let l = 0; l < 3; l++) {
      for (let k = 0; k < 3; k++) q[i * 9 + l * 3 + k] = (v[l] * v[k]) / d
    }
  }

  const vertices: Vec2[] = []
  const bigQ = new Float64Array(9)
  for (let i = 0; i < m; i++) {
    // The vertex, relative to the origin the sums use.
    const sx = pt[poly[i] << 1] - x0
    const sy = pt[(poly[i] << 1) + 1] - y0

    const j = mod(i - 1, m)
    for (let l = 0; l < 9; l++) bigQ[l] = q[j * 9 + l] + q[i * 9 + l]

    const w = minimizeQuadform(bigQ, sx, sy)
    if (Math.abs(w.x - sx) <= 0.5 && Math.abs(w.y - sy) <= 0.5) {
      vertices.push({ x: w.x + x0, y: w.y + y0 })
      continue
    }

    // The minimum fell outside the unit square, so take the best point on the
    // square instead: the corner itself, then where each edge line meets the
    // paraboloid's gradient, then the four corners of the square.
    let min = quadform(bigQ, sx, sy)
    let xmin = sx
    let ymin = sy

    if (bigQ[0] !== 0) {
      for (let z = 0; z < 2; z++) {
        const y = sy - 0.5 + z
        const x = -(bigQ[1] * y + bigQ[2]) / bigQ[0]
        const cand = quadform(bigQ, x, y)
        if (Math.abs(x - sx) <= 0.5 && cand < min) {
          min = cand
          xmin = x
          ymin = y
        }
      }
    }
    if (bigQ[4] !== 0) {
      for (let z = 0; z < 2; z++) {
        const x = sx - 0.5 + z
        const y = -(bigQ[3] * x + bigQ[5]) / bigQ[4]
        const cand = quadform(bigQ, x, y)
        if (Math.abs(y - sy) <= 0.5 && cand < min) {
          min = cand
          xmin = x
          ymin = y
        }
      }
    }
    for (let l = 0; l < 2; l++) {
      for (let k = 0; k < 2; k++) {
        const x = sx - 0.5 + l
        const y = sy - 0.5 + k
        const cand = quadform(bigQ, x, y)
        if (cand < min) {
          min = cand
          xmin = x
          ymin = y
        }
      }
    }

    vertices.push({ x: xmin + x0, y: ymin + y0 })
  }

  return vertices
}
