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
 * SVG path geometry: parsing, transforming, exact bounds, flattening and hit testing.
 *
 * DOM-free. In particular we never call SVGPathElement.getBBox(): jsdom does not
 * implement it, and happy-dom's implementation is literally `return new DOMRect()`
 * — always 0,0,0,0. Bounds here are solved analytically instead, which is both
 * testable in node and more accurate than the browser's own answer.
 *
 * `svgpath` was chosen over the newer svg-path-commander for one specific reason:
 * it transforms elliptical arcs *losslessly*, by transforming the underlying
 * ellipse and recomputing rx/ry/x-rotation, where the alternative degrades arcs
 * to cubics as soon as a skew is involved. Imported artwork keeps its arcs.
 */

import svgpath from 'svgpath'
import { boundsFromPoints, EMPTY_BOUNDS, union, type Bounds } from './Bounds'
import { type Mat2D, type Vec2 } from './Matrix'

/** One absolute path command. Numbers follow the SVG argument order. */
export type PathSegment = [string, ...number[]]

export type FillRule = 'nonzero' | 'evenodd'
export type LineCap = 'butt' | 'round' | 'square'
export type LineJoin = 'miter' | 'round' | 'bevel'

/** Default flattening tolerance in local units. Roughly sub-pixel at 1:1 zoom. */
export const FLATTEN_TOLERANCE = 0.25

// ---------------------------------------------------------------------------
// Parsing / normalizing
// ---------------------------------------------------------------------------

export function isValidPath(d: string | null | undefined): boolean {
  if (!d || !d.trim()) return false
  try {
    const p = svgpath(d)
    return !(p as unknown as { err?: string }).err
  } catch {
    return false
  }
}

/** Absolute segments with every command preserved (arcs stay arcs). */
export function toAbsoluteSegments(d: string): PathSegment[] {
  const out: PathSegment[] = []
  try {
    svgpath(d)
      .abs()
      .iterate((seg) => {
        out.push(seg.slice() as PathSegment)
      })
  } catch {
    return []
  }
  return out
}

/**
 * Reduce a path to only M / L / C / Z so downstream analysis has one case to
 * handle. Arcs become cubics and shorthands are expanded; quadratics are lifted
 * to cubics here rather than carried through every consumer.
 *
 * Used for bounds, flattening and hit testing — never for storage. The document
 * always keeps the author's original command set.
 */
export function toCubicSegments(d: string): PathSegment[] {
  const raw: PathSegment[] = []
  try {
    svgpath(d)
      .abs()
      .unarc()
      .unshort()
      .iterate((seg) => {
        raw.push(seg.slice() as PathSegment)
      })
  } catch {
    return []
  }

  const out: PathSegment[] = []
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0

  for (const seg of raw) {
    const cmd = seg[0]
    switch (cmd) {
      case 'M':
        cx = seg[1]!
        cy = seg[2]!
        sx = cx
        sy = cy
        out.push(['M', cx, cy])
        break
      case 'L':
        cx = seg[1]!
        cy = seg[2]!
        out.push(['L', cx, cy])
        break
      case 'H':
        cx = seg[1]!
        out.push(['L', cx, cy])
        break
      case 'V':
        cy = seg[1]!
        out.push(['L', cx, cy])
        break
      case 'C':
        out.push(['C', seg[1]!, seg[2]!, seg[3]!, seg[4]!, seg[5]!, seg[6]!])
        cx = seg[5]!
        cy = seg[6]!
        break
      case 'Q': {
        // Exact degree elevation: a quadratic is the cubic whose controls sit
        // two-thirds of the way from each endpoint toward the quadratic control.
        const qx = seg[1]!
        const qy = seg[2]!
        const ex = seg[3]!
        const ey = seg[4]!
        out.push([
          'C',
          cx + (2 / 3) * (qx - cx),
          cy + (2 / 3) * (qy - cy),
          ex + (2 / 3) * (qx - ex),
          ey + (2 / 3) * (qy - ey),
          ex,
          ey,
        ])
        cx = ex
        cy = ey
        break
      }
      case 'Z':
      case 'z':
        out.push(['Z'])
        cx = sx
        cy = sy
        break
      default:
        break
    }
  }
  return out
}

export function segmentsToString(segs: readonly PathSegment[], precision = 4): string {
  const f = (n: number) => {
    const r = Number(n.toFixed(precision))
    return Object.is(r, -0) ? 0 : r
  }
  return segs
    .map((s) => (s.length === 1 ? s[0] : `${s[0]}${(s.slice(1) as number[]).map(f).join(' ')}`))
    .join(' ')
    .trim()
}

/** Apply an affine matrix to path data, keeping arcs as arcs. */
export function transformPath(d: string, m: Mat2D): string {
  if (!d) return d
  try {
    return svgpath(d)
      .matrix([m[0], m[1], m[2], m[3], m[4], m[5]])
      .round(6)
      .toString()
  } catch {
    return d
  }
}

export function roundPath(d: string, precision = 4): string {
  try {
    return svgpath(d).round(precision).toString()
  } catch {
    return d
  }
}

/** Reverse path direction — used by boolean subtract and "reverse path direction". */
export function reversePath(d: string): string {
  const segs = toCubicSegments(d)
  const subpaths = splitSubpaths(segs)
  const out: PathSegment[] = []
  for (const sp of subpaths) {
    const pts: PathSegment[] = sp.segments
    if (pts.length === 0) continue
    const reversed: PathSegment[] = []
    let endX = 0
    let endY = 0
    for (const s of pts) {
      if (s[0] === 'M') {
        endX = s[1]!
        endY = s[2]!
      } else if (s[0] === 'L') {
        endX = s[1]!
        endY = s[2]!
      } else if (s[0] === 'C') {
        endX = s[5]!
        endY = s[6]!
      }
    }
    reversed.push(['M', endX, endY])
    for (let i = pts.length - 1; i >= 1; i--) {
      const s = pts[i]!
      const prev = pts[i - 1]!
      const prevEnd: [number, number] =
        prev[0] === 'C' ? [prev[5]!, prev[6]!] : [prev[1]!, prev[2]!]
      if (s[0] === 'L') reversed.push(['L', prevEnd[0], prevEnd[1]])
      else if (s[0] === 'C') reversed.push(['C', s[3]!, s[4]!, s[1]!, s[2]!, prevEnd[0], prevEnd[1]])
    }
    if (sp.closed) reversed.push(['Z'])
    out.push(...reversed)
  }
  return segmentsToString(out)
}

export interface SubPath {
  segments: PathSegment[]
  closed: boolean
}

export function splitSubpaths(segs: readonly PathSegment[]): SubPath[] {
  const out: SubPath[] = []
  let cur: PathSegment[] = []
  for (const s of segs) {
    if (s[0] === 'M') {
      if (cur.length) out.push({ segments: cur, closed: false })
      cur = [s]
    } else if (s[0] === 'Z') {
      if (cur.length) {
        out.push({ segments: cur, closed: true })
        cur = []
      }
    } else {
      cur.push(s)
    }
  }
  if (cur.length) out.push({ segments: cur, closed: false })
  return out
}

// ---------------------------------------------------------------------------
// Exact bounds
// ---------------------------------------------------------------------------

/**
 * Extrema of one cubic coordinate on [0,1].
 *
 * B'(t) = 3[(−p0+3p1−3p2+p3)t² + 2(p0−2p1+p2)t + (p1−p0)], so the turning points
 * are the roots of that quadratic clamped to the open interval. Endpoints are
 * added by the caller.
 */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3
  const b = 2 * (p0 - 2 * p1 + p2)
  const c = p1 - p0
  const ts: number[] = []

  if (Math.abs(a) < 1e-12) {
    // Degenerates to linear.
    if (Math.abs(b) > 1e-12) {
      const t = -c / b
      if (t > 0 && t < 1) ts.push(t)
    }
    return ts
  }

  const disc = b * b - 4 * a * c
  if (disc < 0) return ts
  const sq = Math.sqrt(disc)
  const t1 = (-b + sq) / (2 * a)
  const t2 = (-b - sq) / (2 * a)
  if (t1 > 0 && t1 < 1) ts.push(t1)
  if (t2 > 0 && t2 < 1) ts.push(t2)
  return ts
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}

export function cubicPoint(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number, t: number,
): Vec2 {
  return { x: cubicAt(x0, x1, x2, x3, t), y: cubicAt(y0, y1, y2, y3, t) }
}

/**
 * Exact geometry bounds of a path — the fill outline, ignoring stroke.
 * Solved analytically rather than by sampling, so a shallow curve's true extreme
 * is never missed.
 */
export function pathBounds(d: string): Bounds {
  const segs = toCubicSegments(d)
  if (segs.length === 0) return EMPTY_BOUNDS

  const pts: Vec2[] = []
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0

  for (const s of segs) {
    switch (s[0]) {
      case 'M':
        cx = s[1]!
        cy = s[2]!
        sx = cx
        sy = cy
        pts.push({ x: cx, y: cy })
        break
      case 'L':
        cx = s[1]!
        cy = s[2]!
        pts.push({ x: cx, y: cy })
        break
      case 'C': {
        const [, x1, y1, x2, y2, x3, y3] = s as [string, number, number, number, number, number, number]
        pts.push({ x: cx, y: cy }, { x: x3, y: y3 })
        for (const t of cubicExtrema(cx, x1, x2, x3)) {
          pts.push({ x: cubicAt(cx, x1, x2, x3, t), y: cubicAt(cy, y1, y2, y3, t) })
        }
        for (const t of cubicExtrema(cy, y1, y2, y3)) {
          pts.push({ x: cubicAt(cx, x1, x2, x3, t), y: cubicAt(cy, y1, y2, y3, t) })
        }
        cx = x3
        cy = y3
        break
      }
      case 'Z':
        cx = sx
        cy = sy
        break
      default:
        break
    }
  }
  return boundsFromPoints(pts)
}

/**
 * How far a stroke extends past the fill outline.
 *
 * Not simply strokeWidth/2. A miter join on a sharp corner reaches
 * `miterlimit * strokeWidth / 2` from the vertex, and `linecap: square` adds
 * half a width past each open end. Underestimating this is what clips strokes
 * off the edge of an export.
 */
export function strokeInflate(
  strokeWidth: number,
  join: LineJoin = 'miter',
  cap: LineCap = 'butt',
  miterLimit = 4,
): number {
  if (!strokeWidth || strokeWidth <= 0) return 0
  const half = strokeWidth / 2
  const joinExtra = join === 'miter' ? half * Math.max(1, miterLimit) : half
  const capExtra = cap === 'square' ? half * Math.SQRT2 : half
  return Math.max(joinExtra, capExtra)
}

/**
 * Bounds including stroke. Note the order: inflate in the path's own space and
 * *then* let the caller transform, because `AABB(M·box) != M·AABB(box)`.
 */
export function pathRenderBounds(
  d: string,
  strokeWidth = 0,
  join: LineJoin = 'miter',
  cap: LineCap = 'butt',
  miterLimit = 4,
): Bounds {
  const geo = pathBounds(d)
  const pad = strokeInflate(strokeWidth, join, cap, miterLimit)
  if (pad <= 0) return geo
  return { x: geo.x - pad, y: geo.y - pad, width: geo.width + pad * 2, height: geo.height + pad * 2 }
}

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

function flattenCubic(
  out: Vec2[],
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
  tolerance: number, depth: number,
): void {
  if (depth > 18) {
    out.push({ x: x3, y: y3 })
    return
  }
  // Flatness test: distance of both control points from the chord.
  const dx = x3 - x0
  const dy = y3 - y0
  const d1 = Math.abs((x1 - x3) * dy - (y1 - y3) * dx)
  const d2 = Math.abs((x2 - x3) * dy - (y2 - y3) * dx)
  const dd = d1 + d2
  if (dd * dd <= tolerance * (dx * dx + dy * dy)) {
    out.push({ x: x3, y: y3 })
    return
  }
  // de Casteljau split at t = 0.5
  const x01 = (x0 + x1) / 2, y01 = (y0 + y1) / 2
  const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2
  const x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2
  const x012 = (x01 + x12) / 2, y012 = (y01 + y12) / 2
  const x123 = (x12 + x23) / 2, y123 = (y12 + y23) / 2
  const xm = (x012 + x123) / 2, ym = (y012 + y123) / 2
  flattenCubic(out, x0, y0, x01, y01, x012, y012, xm, ym, tolerance, depth + 1)
  flattenCubic(out, xm, ym, x123, y123, x23, y23, x3, y3, tolerance, depth + 1)
}

export interface Polyline {
  points: Vec2[]
  closed: boolean
}

/** Adaptive subdivision to polylines. One polyline per subpath. */
export function pathToPolylines(d: string, tolerance = FLATTEN_TOLERANCE): Polyline[] {
  const segs = toCubicSegments(d)
  const out: Polyline[] = []
  let cur: Vec2[] = []
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  const tol = Math.max(1e-6, tolerance)

  const flush = (closed: boolean) => {
    if (cur.length > 1) out.push({ points: cur, closed })
    cur = []
  }

  for (const s of segs) {
    switch (s[0]) {
      case 'M':
        flush(false)
        cx = s[1]!
        cy = s[2]!
        sx = cx
        sy = cy
        cur = [{ x: cx, y: cy }]
        break
      case 'L':
        cx = s[1]!
        cy = s[2]!
        cur.push({ x: cx, y: cy })
        break
      case 'C': {
        const [, x1, y1, x2, y2, x3, y3] = s as [string, number, number, number, number, number, number]
        flattenCubic(cur, cx, cy, x1, y1, x2, y2, x3, y3, tol, 0)
        cx = x3
        cy = y3
        break
      }
      case 'Z':
        flush(true)
        cx = sx
        cy = sy
        cur = [{ x: cx, y: cy }]
        break
      default:
        break
    }
  }
  flush(false)
  return out.filter((p) => p.points.length > 1)
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * Point-in-fill test honoring the path's fill-rule.
 *
 * nonzero uses a signed crossing count (winding number); evenodd uses parity.
 * The distinction is visible on any self-intersecting star, so it is not optional.
 */
export function pointInPath(d: string, p: Vec2, fillRule: FillRule = 'nonzero'): boolean {
  const polys = pathToPolylines(d)
  if (polys.length === 0) return false

  let winding = 0
  let crossings = 0

  for (const poly of polys) {
    const pts = poly.points
    const n = pts.length
    for (let i = 0; i < n; i++) {
      // Subpaths are treated as closed for fill purposes, which is what SVG does.
      const a = pts[i]!
      const b = pts[(i + 1) % n]!
      if (a.y <= p.y) {
        if (b.y > p.y) {
          const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
          if (cross > 0) {
            winding++
            crossings++
          }
        }
      } else if (b.y <= p.y) {
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
        if (cross < 0) {
          winding--
          crossings++
        }
      }
    }
  }
  return fillRule === 'evenodd' ? crossings % 2 !== 0 : winding !== 0
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Shortest distance from a point to the path outline. */
export function distanceToPath(d: string, p: Vec2): number {
  const polys = pathToPolylines(d)
  let best = Infinity
  for (const poly of polys) {
    const pts = poly.points
    const n = poly.closed ? pts.length : pts.length - 1
    for (let i = 0; i < n; i++) {
      const dist = distToSegment(p, pts[i]!, pts[(i + 1) % pts.length]!)
      if (dist < best) best = dist
    }
  }
  return best
}

/** Point-on-stroke test. `tolerance` is extra slack in local units. */
export function pointOnStroke(d: string, p: Vec2, strokeWidth: number, tolerance = 0): boolean {
  return distanceToPath(d, p) <= Math.max(strokeWidth, 0) / 2 + tolerance
}

/** True when any part of the path falls inside `box` — used by marquee selection. */
/**
 * Does the region a path covers overlap `box` at all?
 *
 * Three things have to be true for this to answer a crossing selection
 * correctly, and checking only the first — which is what "is any vertex inside
 * the box" amounts to — gets the two common cases wrong:
 *
 *   1. a vertex inside the box (a corner of the shape caught by the marquee);
 *   2. an EDGE crossing the box, even with no vertex in it — dragging a narrow
 *      band across the middle of a rectangle touches two of its sides and none
 *      of its corners;
 *   3. the box entirely INSIDE the shape — the same narrow band, once it is
 *      short enough to fit within the rectangle, meets no edge at all.
 */
export function pathOverlapsBounds(
  d: string,
  box: Bounds,
  fillRule: FillRule = 'nonzero',
): boolean {
  const polys = pathToPolylines(d)
  if (polys.length === 0) return false

  for (const poly of polys) {
    const points = poly.points
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      // A closed subpath's last segment runs back to its first point.
      const b = points[i + 1] ?? (poly.closed ? points[0]! : null)
      if (!b) break
      if (segmentOverlapsBounds(a, b, box)) return true
    }
  }

  // Nothing crossed, so the only way left to overlap is for the box to sit
  // wholly within the shape.
  return pointInPath(d, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, fillRule)
}

/**
 * Segment against an axis-aligned box, by the Liang-Barsky clip.
 *
 * True when any part of the segment lies in the box, a segment entirely inside
 * it included — which is case 2 above, and is why this is not just a bounding
 * box comparison.
 */
function segmentOverlapsBounds(a: Vec2, b: Vec2, box: Bounds): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const p = [-dx, dx, -dy, dy]
  const q = [a.x - box.x, box.x + box.width - a.x, a.y - box.y, box.y + box.height - a.y]

  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      // Parallel to this edge: outside it means outside the box entirely.
      if (q[i]! < 0) return false
      continue
    }
    const r = q[i]! / p[i]!
    if (p[i]! < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Length / point-at
// ---------------------------------------------------------------------------

export function polylineLength(pts: readonly Vec2[], closed = false): number {
  let len = 0
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    len += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return len
}

export function pathLength(d: string): number {
  let total = 0
  for (const poly of pathToPolylines(d, 0.05)) total += polylineLength(poly.points, poly.closed)
  return total
}

/** Point at an absolute distance along the path, plus the unit tangent there. */
export function pointAtLength(d: string, target: number): { point: Vec2; tangent: Vec2 } | null {
  const polys = pathToPolylines(d, 0.05)
  let remaining = Math.max(0, target)
  for (const poly of polys) {
    const pts = poly.points
    const n = poly.closed ? pts.length : pts.length - 1
    for (let i = 0; i < n; i++) {
      const a = pts[i]!
      const b = pts[(i + 1) % pts.length]!
      const segLen = Math.hypot(b.x - a.x, b.y - a.y)
      if (segLen <= 0) continue
      if (remaining <= segLen) {
        const t = remaining / segLen
        return {
          point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
          tangent: { x: (b.x - a.x) / segLen, y: (b.y - a.y) / segLen },
        }
      }
      remaining -= segLen
    }
  }
  return null
}

export function boundsOfPaths(ds: readonly string[]): Bounds {
  let out: Bounds | null = null
  for (const d of ds) {
    const b = pathBounds(d)
    out = out ? union(out, b) : b
  }
  return out ?? EMPTY_BOUNDS
}
