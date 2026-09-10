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
 * The maths of 3D Transforms.
 *
 * An object tilted in 3D is still flat: every point of it stays in one plane.
 * Seeing a plane through a camera is a HOMOGRAPHY — a 3x3 matrix applied to
 * (x, y, 1), followed by a divide by the third coordinate. Everything the
 * feature does comes down to that one map: where the artwork is drawn, what a
 * click lands on, how big the selection frame is, where a handle sits.
 *
 * Conventions are CSS's, because they are also XD's: y points down, z points
 * at the viewer, rotateX(+) tips the top edge away, rotateY(+) turns the right
 * edge away, and perspective(d) puts the eye d units in front of the plane.
 *
 * SVG cannot draw a homography — its transforms are affine, and CSS 3D on an
 * SVG element is flattened to one — so perspectiveMesh approximates the map
 * with triangles, each drawn with the one affine map that agrees with the
 * homography at its three corners. See the README for why that, and why the
 * triangles are cut out with masks rather than clip paths.
 *
 * DOM-free like the rest of src/geometry; see eslint.config.js.
 */

import type { Mat2D, Vec2 } from './Matrix'
import type { Bounds } from './Bounds'
import { pathToPolylines } from './PathUtils'

/** Row-major 4x4 acting on column vectors (x, y, z, 1): `m[row * 4 + col]`. */
export type Mat4 = readonly number[]

/** Row-major 3x3 homography acting on (x, y, 1). */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number]

export const MAT4_IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
export const MAT3_IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/**
 * The closest a point may come to the eye before it is cut away, as the
 * homogeneous w it projects with — 1 at the pivot's depth, 0 at the eye.
 *
 * A point at w projects magnified by 1/w, so this caps the magnification at
 * twenty times. Anything nearer is behind the camera or so close that a
 * rounding error becomes a triangle the size of the screen, and is not drawn.
 */
export const NEAR_W = 0.05

const DEG = Math.PI / 180

// ---------------------------------------------------------------------------
// 4x4
// ---------------------------------------------------------------------------

/** `a · b` — applies b first, then a. */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4]! * b[c]! +
        a[r * 4 + 1]! * b[4 + c]! +
        a[r * 4 + 2]! * b[8 + c]! +
        a[r * 4 + 3]! * b[12 + c]!
    }
  }
  return out
}

/** Left-to-right composition: `mat4Compose(a, b, c)` applies a, then b, then c. */
export function mat4Compose(...mats: Mat4[]): Mat4 {
  let out: Mat4 = MAT4_IDENTITY
  for (const m of mats) out = mat4Multiply(m, out)
  return out
}

/** A 2D affine map lifted into 3D: it moves x and y and leaves depth alone. */
export function mat4FromMat2D(m: Mat2D): Mat4 {
  const [a, b, c, d, e, f] = m
  return [a, c, 0, e, b, d, 0, f, 0, 0, 1, 0, 0, 0, 0, 1]
}

export function mat4Translate(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]
}

/** CSS rotateX: positive tips the top edge away from the viewer. */
export function mat4RotateX(deg: number): Mat4 {
  const c = Math.cos(deg * DEG)
  const s = Math.sin(deg * DEG)
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]
}

/** CSS rotateY: positive turns the right edge away from the viewer. */
export function mat4RotateY(deg: number): Mat4 {
  const c = Math.cos(deg * DEG)
  const s = Math.sin(deg * DEG)
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]
}

/** CSS perspective(d): the eye `distance` units in front of the z = 0 plane. */
export function mat4Perspective(distance: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1 / distance, 1]
}

export function mat4ApplyPoint(
  m: Mat4,
  x: number,
  y: number,
  z = 0,
): { x: number; y: number; z: number; w: number } {
  return {
    x: m[0]! * x + m[1]! * y + m[2]! * z + m[3]!,
    y: m[4]! * x + m[5]! * y + m[6]! * z + m[7]!,
    z: m[8]! * x + m[9]! * y + m[10]! * z + m[11]!,
    w: m[12]! * x + m[13]! * y + m[14]! * z + m[15]!,
  }
}

/**
 * The homography a 4x4 induces on the z = 0 plane.
 *
 * A flat object's points all have z = 0 in its own space, so the third column
 * never contributes, and projecting drops the resulting z. What is left is the
 * 3x3 that takes the object's (x, y) straight to the screen's.
 */
export function homographyOfPlane(m: Mat4): Mat3 {
  return [m[0]!, m[1]!, m[3]!, m[4]!, m[5]!, m[7]!, m[12]!, m[13]!, m[15]!]
}

// ---------------------------------------------------------------------------
// 3x3
// ---------------------------------------------------------------------------

export function mat3FromMat2D(m: Mat2D): Mat3 {
  const [a, b, c, d, e, f] = m
  return [a, c, e, b, d, f, 0, 0, 1]
}

/** `a · b` — applies b first, then a. */
export function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ]
}

export function mat3Determinant(h: Mat3): number {
  return (
    h[0] * (h[4] * h[8] - h[5] * h[7]) -
    h[1] * (h[3] * h[8] - h[5] * h[6]) +
    h[2] * (h[3] * h[7] - h[4] * h[6])
  )
}

/** Inverse, or null for a map that folds the plane onto a line. */
export function invertMat3(h: Mat3): Mat3 | null {
  const det = mat3Determinant(h)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null
  const k = 1 / det
  return [
    (h[4] * h[8] - h[5] * h[7]) * k,
    (h[2] * h[7] - h[1] * h[8]) * k,
    (h[1] * h[5] - h[2] * h[4]) * k,
    (h[5] * h[6] - h[3] * h[8]) * k,
    (h[0] * h[8] - h[2] * h[6]) * k,
    (h[2] * h[3] - h[0] * h[5]) * k,
    (h[3] * h[7] - h[4] * h[6]) * k,
    (h[1] * h[6] - h[0] * h[7]) * k,
    (h[0] * h[4] - h[1] * h[3]) * k,
  ]
}

/** The homogeneous w a point projects with. Positive in front of the eye. */
export function homographyW(h: Mat3, x: number, y: number): number {
  return h[6] * x + h[7] * y + h[8]
}

/** Project a point. `w` comes back too, so a caller can tell front from behind. */
export function applyMat3(h: Mat3, x: number, y: number): { x: number; y: number; w: number } {
  const w = h[6] * x + h[7] * y + h[8]
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
    w,
  }
}

/**
 * Project a point, or null when it is behind the camera or too near to draw.
 *
 * Every map built by Scene3D keeps w normalised — 1 at the depth of the pivot
 * the camera looks at — so NEAR_W can be compared against directly. Only a
 * forward map may be tested this way; an inverse has no such normalisation.
 */
export function mapPoint(h: Mat3, x: number, y: number): Vec2 | null {
  const p = applyMat3(h, x, y)
  return p.w >= NEAR_W && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null
}

/** True when the map has no perspective left in it — a plain 2D affine map. */
export function isAffineMat3(h: Mat3): boolean {
  const scale = Math.abs(h[8]) || 1
  return Math.abs(h[6]) < 1e-12 * scale && Math.abs(h[7]) < 1e-12 * scale
}

/** An affine homography as the Mat2D SVG can draw. Only meaningful when isAffineMat3. */
export function mat3ToMat2D(h: Mat3): Mat2D {
  const k = h[8] || 1
  return [h[0] / k, h[3] / k, h[1] / k, h[4] / k, h[2] / k, h[5] / k]
}

/**
 * How much the map magnifies around a point, as a length ratio.
 *
 * The Jacobian determinant of a plane homography is det(H) / w³, which is
 * what turns a screen-space tolerance into one in the object's own units, the
 * way meanScale does for an affine matrix.
 */
export function mat3ScaleAt(h: Mat3, x: number, y: number): number {
  const w = homographyW(h, x, y)
  if (Math.abs(w) < 1e-12) return 1
  const s = Math.sqrt(Math.abs(mat3Determinant(h) / (w * w * w)))
  return Number.isFinite(s) && s > 0 ? s : 1
}

/**
 * A homography as CSS `matrix3d()`.
 *
 * HTML elements, unlike SVG ones, do get real perspective from CSS — which is
 * how the text editor's textarea lies on a tilted text box while you type.
 * CSS takes the 4x4 column by column, with z passed straight through.
 */
export function toCssMatrix3d(h: Mat3): string {
  const v = [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]]
  return `matrix3d(${v.map((n) => (Number.isFinite(n) ? n : 0)).join(',')})`
}

// ---------------------------------------------------------------------------
// Clipping to what the camera can see
// ---------------------------------------------------------------------------

/**
 * Where an edge crosses the near limit.
 *
 * Computed from the two endpoints in a fixed order, whichever way round the
 * caller walks the edge. Two neighbouring mesh cells share the edge but walk
 * it in opposite directions, and they must arrive at the SAME floating-point
 * point or the triangles either side of it will not meet exactly.
 */
function nearCrossing(h: Mat3, a: Vec2, b: Vec2, limit: number): Vec2 {
  const [p, q] = a.x < b.x || (a.x === b.x && a.y <= b.y) ? [a, b] : [b, a]
  const wp = homographyW(h, p.x, p.y)
  const wq = homographyW(h, q.x, q.y)
  const t = (limit - wp) / (wq - wp)
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
}

/**
 * The part of a convex polygon, in the object's own space, that is in front
 * of the camera. Sutherland–Hodgman against the single half-plane w ≥ NEAR_W.
 */
export function clipToFront(h: Mat3, polygon: readonly Vec2[]): Vec2[] {
  const limit = NEAR_W
  const out: Vec2[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const inA = homographyW(h, a.x, a.y) >= limit
    const inB = homographyW(h, b.x, b.y) >= limit
    if (inA) out.push(a)
    if (inA !== inB) out.push(nearCrossing(h, a, b, limit))
  }
  return out
}

function rectPolygon(b: Bounds): Vec2[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ]
}

/**
 * Where a box lands: the corners of the part of it the camera can see,
 * projected. Lines project to lines, so for a convex shape the projection of
 * its outline is the outline of its projection — four corners are the whole
 * answer for a box, however it is tilted. Null when all of it is behind the eye.
 */
export function projectBox(h: Mat3, box: Bounds): Vec2[] | null {
  const visible = clipToFront(h, rectPolygon(box))
  if (visible.length < 3) return null
  const out: Vec2[] = []
  for (const p of visible) {
    const q = applyMat3(h, p.x, p.y)
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return null
    out.push({ x: q.x, y: q.y })
  }
  return out
}

/** The axis-aligned bounds of a projected box, or null when none of it is visible. */
export function projectedBounds(h: Mat3, box: Bounds): Bounds | null {
  const pts = projectBox(h, box)
  if (!pts) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * A closed outline, projected.
 *
 * Curves are flattened first — a Bézier's control points do not map to the
 * projected curve's, since a homography turns polynomials into rational
 * functions — at a tolerance fine enough that the facets are invisible at the
 * sizes a clip outline is seen at. Each ring is cut to what is in front of the
 * camera before it is projected.
 */
export function projectPathData(d: string, h: Mat3, tolerance = 0.25): string {
  let out = ''
  for (const line of pathToPolylines(d, tolerance)) {
    const ring = clipToFront(h, line.points)
    if (ring.length < 3) continue
    ring.forEach((p, i) => {
      const q = applyMat3(h, p.x, p.y)
      out += `${i === 0 ? 'M' : 'L'}${Math.round(q.x * 1e3) / 1e3} ${Math.round(q.y * 1e3) / 1e3}`
    })
    out += 'Z'
  }
  return out
}

// ---------------------------------------------------------------------------
// The mesh
// ---------------------------------------------------------------------------

/**
 * The affine map taking three points onto three others, or null when the
 * source triangle has no area.
 */
export function affineFromTriangles(
  src: readonly [Vec2, Vec2, Vec2],
  dst: readonly [Vec2, Vec2, Vec2],
): Mat2D | null {
  const [s0, s1, s2] = src
  const det = s0.x * (s1.y - s2.y) - s1.x * (s0.y - s2.y) + s2.x * (s0.y - s1.y)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null
  // Cramer's rule, once for the x row of the matrix and once for the y row.
  const solve = (v0: number, v1: number, v2: number): [number, number, number] => [
    (v0 * (s1.y - s2.y) - v1 * (s0.y - s2.y) + v2 * (s0.y - s1.y)) / det,
    (s0.x * (v1 - v2) - s1.x * (v0 - v2) + s2.x * (v0 - v1)) / det,
    (s0.x * (s1.y * v2 - s2.y * v1) - s1.x * (s0.y * v2 - s2.y * v0) + s2.x * (s0.y * v1 - s1.y * v0)) /
      det,
  ]
  const [a, c, e] = solve(dst[0].x, dst[1].x, dst[2].x)
  const [b, d, f] = solve(dst[0].y, dst[1].y, dst[2].y)
  return [a, b, c, d, e, f]
}

export interface WarpTriangle {
  /** Where the triangle lands, in the projected space. */
  points: readonly [Vec2, Vec2, Vec2]
  /** The affine map that carries the flat artwork onto this triangle. */
  matrix: Mat2D
}

export interface MeshOptions {
  /**
   * Screen pixels per unit of the projected space, so that the tolerance is a
   * distance on screen rather than in the document: the same tilt needs more
   * triangles zoomed in than zoomed out.
   */
  pxPerUnit: number
  /** Largest allowed displacement of any point, in screen pixels. */
  tolerance?: number
  /**
   * Hard cap on the count. Past it the mesh stops refining and accepts a
   * larger error, because every triangle costs a mask and a redraw of the
   * whole artwork, and a canvas that cannot pan is worse than a slight wobble.
   */
  maxTriangles?: number
}

export const MESH_TOLERANCE_PX = 0.5
export const MESH_MAX_TRIANGLES = 256

/**
 * Grid lines along one axis, spaced by the perspective rather than evenly.
 *
 * How far a cell's affine approximation strays grows with how much w — the
 * perspective divide — changes across it, relative to w itself, and with how
 * large the cell is on screen, which is also 1/w. Holding the error constant
 * therefore wants cells whose size is proportional to w: small where the plane
 * comes toward the eye and large where it recedes. Since w is linear along a
 * line, that is a geometric progression in w. An even grid fine enough for the
 * near edge wastes most of its triangles on the far one.
 */
function gradedStops(lo: number, hi: number, n: number, wLo: number, wHi: number): number[] {
  const out = new Array<number>(n + 1)
  out[0] = lo
  out[n] = hi
  const a = Math.max(wLo, NEAR_W)
  const b = Math.max(wHi, NEAR_W)
  const even = Math.abs(a - b) < 1e-9 * Math.max(a, b)
  for (let i = 1; i < n; i++) {
    const t = i / n
    if (even) {
      out[i] = lo + (hi - lo) * t
    } else {
      // w at this stop, then back to the coordinate along the (linear) axis.
      const w = a * Math.pow(b / a, t)
      out[i] = lo + ((hi - lo) * (w - a)) / (b - a)
    }
  }
  return out
}

/**
 * How far the linear stand-in strays from the projection, at worst, in
 * screen pixels.
 *
 * Measured at edge midpoints and at the midpoint of the diagonal each cell
 * would be split along — where a linear interpolation between two exact
 * corners is at its furthest from the truth.
 */
function gridError(h: Mat3, xs: readonly number[], ys: readonly number[], px: number): number {
  let worst = 0
  const proj = (x: number, y: number): Vec2 | null => {
    if (homographyW(h, x, y) < NEAR_W) return null
    const p = applyMat3(h, x, y)
    return { x: p.x, y: p.y }
  }
  const off = (x: number, y: number, a: Vec2, b: Vec2): number => {
    const t = proj(x, y)
    if (!t) return 0
    return Math.hypot(t.x - (a.x + b.x) / 2, t.y - (a.y + b.y) / 2) * px
  }

  const pts: Array<Array<Vec2 | null>> = ys.map((y) => xs.map((x) => proj(x, y)))
  for (let j = 0; j < ys.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const p00 = pts[j]![i]
      const p10 = pts[j]![i + 1]
      const p01 = pts[j + 1]![i]
      const p11 = pts[j + 1]![i + 1]
      if (!p00 || !p10 || !p01 || !p11) continue
      const xm = (xs[i]! + xs[i + 1]!) / 2
      const ym = (ys[j]! + ys[j + 1]!) / 2
      // The better of the two diagonals is the one the triangulation will use.
      worst = Math.max(
        worst,
        off(xm, ys[j]!, p00, p10),
        off(xm, ys[j + 1]!, p01, p11),
        off(xs[i]!, ym, p00, p01),
        off(xs[i + 1]!, ym, p10, p11),
        Math.min(off(xm, ym, p00, p11), off(xm, ym, p10, p01)),
      )
    }
  }
  return worst
}

/**
 * The smallest grid — fewest cells — whose error is within the tolerance.
 *
 * A staircase search: as columns are added, the rows needed never go up. So
 * the column count walks upward — every count while it is small, then in
 * steps of an eighth, where one more column changes little — and for each the
 * fewest rows that are enough are found by bisection below the last answer.
 * At the canvas's cap that is well under a hundred evaluations. When nothing
 * within the cap is good enough, the best grid seen is used: the one that
 * wobbles least.
 */
function chooseGrid(
  errorOf: (n: number, m: number) => number,
  tolerance: number,
  maxCells: number,
): { n: number; m: number } {
  if (errorOf(1, 1) <= tolerance) return { n: 1, m: 1 }
  let best: { n: number; m: number } | null = null
  let fallback = { n: 1, m: 1, e: Infinity }
  let upper = maxCells
  for (let n = 1; n <= maxCells; n += Math.max(1, Math.floor(n / 8))) {
    upper = Math.min(upper, Math.floor(maxCells / n))
    if (upper < 1) break
    const e = errorOf(n, upper)
    if (e < fallback.e) fallback = { n, m: upper, e }
    if (e > tolerance) continue
    // The fewest rows in [1, upper] that are still enough.
    let lo = 1
    let hi = upper
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (errorOf(n, mid) <= tolerance) hi = mid
      else lo = mid + 1
    }
    upper = hi
    if (!best || n * hi < best.n * best.m) best = { n, m: hi }
    if (hi === 1) break
  }
  return best ?? { n: fallback.n, m: fallback.m }
}

/**
 * The triangles that draw a flat rectangle of artwork in perspective.
 *
 * `domain` is the region of the object's own space that holds anything
 * visible; `h` projects it. The result covers the part of the domain in front
 * of the camera, every triangle agrees with `h` exactly at its corners, and
 * between them it strays by at most `tolerance` screen pixels unless the cap
 * was reached first.
 *
 * Neighbouring triangles share their corners bit-for-bit: every grid vertex is
 * projected once, and every cut along the near limit is computed from the
 * shared edge in a fixed order. That exactness is what lets the renderer cut
 * them out with aliased masks that tile the plane with no seam.
 */
export function perspectiveMesh(h: Mat3, domain: Bounds, options: MeshOptions): WarpTriangle[] {
  const tolerance = Math.max(0.05, options.tolerance ?? MESH_TOLERANCE_PX)
  const cap = Math.max(2, options.maxTriangles ?? MESH_MAX_TRIANGLES)
  const px = options.pxPerUnit > 0 && Number.isFinite(options.pxPerUnit) ? options.pxPerUnit : 1
  if (!(domain.width > 0) || !(domain.height > 0)) return []

  const x0 = domain.x
  const y0 = domain.y
  const x1 = domain.x + domain.width
  const y1 = domain.y + domain.height
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2

  const stopsFor = (n: number, m: number) => ({
    xs: gradedStops(x0, x1, n, homographyW(h, x0, cy), homographyW(h, x1, cy)),
    ys: gradedStops(y0, y1, m, homographyW(h, cx, y0), homographyW(h, cx, y1)),
  })
  const errorOf = (n: number, m: number) => {
    const g = stopsFor(n, m)
    return gridError(h, g.xs, g.ys, px)
  }
  const { n, m } = chooseGrid(errorOf, tolerance, Math.floor(cap / 2))
  const { xs, ys } = stopsFor(n, m)
  const limit = NEAR_W
  // Every grid vertex projected exactly once, so shared corners are identical.
  const vertex = new Map<string, Vec2>()
  const project = (p: Vec2): Vec2 => {
    const key = `${p.x},${p.y}`
    let q = vertex.get(key)
    if (!q) {
      const r = applyMat3(h, p.x, p.y)
      q = { x: r.x, y: r.y }
      vertex.set(key, q)
    }
    return q
  }

  const out: WarpTriangle[] = []
  const emit = (a: Vec2, b: Vec2, c: Vec2) => {
    const dst: [Vec2, Vec2, Vec2] = [project(a), project(b), project(c)]
    if (!dst.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return
    const matrix = affineFromTriangles([a, b, c], dst)
    if (matrix) out.push({ points: dst, matrix })
  }

  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      const s00 = { x: xs[i]!, y: ys[j]! }
      const s10 = { x: xs[i + 1]!, y: ys[j]! }
      const s11 = { x: xs[i + 1]!, y: ys[j + 1]! }
      const s01 = { x: xs[i]!, y: ys[j + 1]! }
      const quad = [s00, s10, s11, s01]
      const front = quad.every((p) => homographyW(h, p.x, p.y) >= limit)
      if (front) {
        // Split along whichever diagonal the projection bends least across.
        const mid = { x: (s00.x + s11.x) / 2, y: (s00.y + s11.y) / 2 }
        const t = applyMat3(h, mid.x, mid.y)
        const q00 = project(s00)
        const q10 = project(s10)
        const q11 = project(s11)
        const q01 = project(s01)
        const dA = Math.hypot(t.x - (q00.x + q11.x) / 2, t.y - (q00.y + q11.y) / 2)
        const dB = Math.hypot(t.x - (q10.x + q01.x) / 2, t.y - (q10.y + q01.y) / 2)
        if (dA <= dB) {
          emit(s00, s10, s11)
          emit(s00, s11, s01)
        } else {
          emit(s00, s10, s01)
          emit(s10, s11, s01)
        }
        continue
      }
      const poly = clipToFront(h, quad)
      if (poly.length < 3) continue
      // A convex polygon, so a fan from its first corner covers it.
      for (let k = 1; k < poly.length - 1; k++) emit(poly[0]!, poly[k]!, poly[k + 1]!)
    }
  }
  return out
}
