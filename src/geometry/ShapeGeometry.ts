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
 * Parametric shapes → SVG path data.
 *
 * Every shape is authored in *local* space spanning (0,0) to (width,height).
 * Position, rotation, scale and flip all live in the node's transform matrix, so
 * resizing or rotating a star never rewrites its geometry — the parameters
 * (points, inner radius) stay editable forever. This is what makes
 * "rotate a group, ungroup, everything is still correct" hold.
 */

import type { Vec2 } from './Matrix'

/** Per-corner radii, clockwise from top-left. */
export type CornerRadii = readonly [tl: number, tr: number, br: number, bl: number]

export function normalizeCornerRadius(r: number | CornerRadii | undefined): CornerRadii {
  if (r === undefined) return [0, 0, 0, 0]
  if (typeof r === 'number') return [r, r, r, r]
  return r
}

/**
 * Rounded rectangle.
 *
 * Radii are clamped proportionally when neighbours on a side would overlap,
 * matching the CSS/SVG rule — otherwise a radius larger than half the side
 * produces self-intersecting garbage.
 */
export function rectPath(
  width: number,
  height: number,
  radius: number | CornerRadii = 0,
): string {
  const w = Math.max(0, width)
  const h = Math.max(0, height)
  if (w === 0 || h === 0) return `M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`

  let [tl, tr, br, bl] = normalizeCornerRadius(radius).map((v) => Math.max(0, v)) as unknown as [
    number, number, number, number,
  ]

  // Proportional clamp, same rule CSS uses for border-radius.
  const scale = Math.min(
    tl + tr > 0 ? w / (tl + tr) : Infinity,
    br + bl > 0 ? w / (br + bl) : Infinity,
    tl + bl > 0 ? h / (tl + bl) : Infinity,
    tr + br > 0 ? h / (tr + br) : Infinity,
    1,
  )
  if (scale < 1) {
    tl *= scale
    tr *= scale
    br *= scale
    bl *= scale
  }

  if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
    return `M0 0 L${r(w)} 0 L${r(w)} ${r(h)} L0 ${r(h)} Z`
  }

  const parts: string[] = [`M${r(tl)} 0`]
  parts.push(`L${r(w - tr)} 0`)
  if (tr > 0) parts.push(`A${r(tr)} ${r(tr)} 0 0 1 ${r(w)} ${r(tr)}`)
  parts.push(`L${r(w)} ${r(h - br)}`)
  if (br > 0) parts.push(`A${r(br)} ${r(br)} 0 0 1 ${r(w - br)} ${r(h)}`)
  parts.push(`L${r(bl)} ${r(h)}`)
  if (bl > 0) parts.push(`A${r(bl)} ${r(bl)} 0 0 1 0 ${r(h - bl)}`)
  parts.push(`L0 ${r(tl)}`)
  if (tl > 0) parts.push(`A${r(tl)} ${r(tl)} 0 0 1 ${r(tl)} 0`)
  parts.push('Z')
  return parts.join(' ')
}

/** Ellipse inscribed in the local box, as two half arcs (stays a true ellipse). */
export function ellipsePath(width: number, height: number): string {
  const rx = Math.max(0, width) / 2
  const ry = Math.max(0, height) / 2
  const cy = ry
  if (rx === 0 || ry === 0) return `M0 ${r(cy)} L${r(width)} ${r(cy)} Z`
  return `M0 ${r(cy)} A${r(rx)} ${r(ry)} 0 1 0 ${r(width)} ${r(cy)} A${r(rx)} ${r(ry)} 0 1 0 0 ${r(cy)} Z`
}


/**
 * Round every vertex of a closed polygon by `radius`.
 *
 * At each vertex the two edge directions are walked back by the tangent length
 * `r / tan(theta/2)`, and an arc joins the two resulting points. The tangent
 * length is clamped to half of the shorter adjacent edge, and the radius is then
 * recomputed from the clamped tangent — without that, a radius larger than an
 * edge can carry produces overlapping arcs and a self-intersecting outline.
 *
 * Reflex vertices need no special case: the sweep flag follows the sign of the
 * cross product, so a star's inner points round inward exactly as its outer
 * points round outward.
 */
export function roundedPolygonPath(points: readonly Vec2[], radius: number): string {
  const n = points.length
  if (n < 3) return pointsToClosedPath(points)
  if (radius <= 0) return pointsToClosedPath(points)

  const parts: string[] = []
  // Which command opens the subpath is decided by what has actually been
  // emitted, not by the loop index: a degenerate first vertex is skipped, and
  // keying off `i === 0` then produced a path starting with `L`, which is not
  // valid path data and renders as nothing at all.
  const move = () => (parts.length === 0 ? 'M' : 'L')

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!
    const cur = points[i]!
    const next = points[(i + 1) % n]!

    const toPrev = { x: prev.x - cur.x, y: prev.y - cur.y }
    const toNext = { x: next.x - cur.x, y: next.y - cur.y }
    const lenPrev = Math.hypot(toPrev.x, toPrev.y)
    const lenNext = Math.hypot(toNext.x, toNext.y)
    if (lenPrev < 1e-9 || lenNext < 1e-9) continue

    const u1 = { x: toPrev.x / lenPrev, y: toPrev.y / lenPrev }
    const u2 = { x: toNext.x / lenNext, y: toNext.y / lenNext }

    const cosTheta = Math.min(1, Math.max(-1, u1.x * u2.x + u1.y * u2.y))
    const theta = Math.acos(cosTheta)
    // A straight-through vertex has nothing to round.
    if (theta < 1e-6 || Math.abs(Math.PI - theta) < 1e-6) {
      parts.push(`${move()}${r(cur.x)} ${r(cur.y)}`)
      continue
    }

    const halfTan = Math.tan(theta / 2)
    let tangent = radius / halfTan
    tangent = Math.min(tangent, lenPrev / 2, lenNext / 2)
    const effective = tangent * halfTan

    const a = { x: cur.x + u1.x * tangent, y: cur.y + u1.y * tangent }
    const b = { x: cur.x + u2.x * tangent, y: cur.y + u2.y * tangent }

    // Cross product sign gives the turn direction, which is the arc's sweep.
    const cross = u1.x * u2.y - u1.y * u2.x
    const sweep = cross < 0 ? 1 : 0

    parts.push(`${move()}${r(a.x)} ${r(a.y)}`)
    parts.push(`A${r(effective)} ${r(effective)} 0 0 ${sweep} ${r(b.x)} ${r(b.y)}`)
  }

  // Every vertex was degenerate; fall back rather than emit a lone `Z`.
  if (parts.length === 0) return pointsToClosedPath(points)

  parts.push('Z')
  return parts.join(' ')
}

/**
 * Largest radius a polygon can take before its arcs start overlapping.
 * Used to clamp the corner-radius handle and the inspector field.
 */
export function maxPolygonRadius(points: readonly Vec2[]): number {
  const n = points.length
  if (n < 3) return 0
  let limit = Infinity
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!
    const cur = points[i]!
    const next = points[(i + 1) % n]!
    const lenPrev = Math.hypot(prev.x - cur.x, prev.y - cur.y)
    const lenNext = Math.hypot(next.x - cur.x, next.y - cur.y)
    const u1 = { x: (prev.x - cur.x) / (lenPrev || 1), y: (prev.y - cur.y) / (lenPrev || 1) }
    const u2 = { x: (next.x - cur.x) / (lenNext || 1), y: (next.y - cur.y) / (lenNext || 1) }
    const theta = Math.acos(Math.min(1, Math.max(-1, u1.x * u2.x + u1.y * u2.y)))
    // Skip both degenerate turns, matching roundedPolygonPath: a doubled-back
    // vertex (theta ~ 0) and a straight-through one (theta ~ pi). The latter
    // matters because tan(pi/2) is ~1.6e16, so a single collinear vertex
    // otherwise reports a "limit" of ~4e17 instead of being ignored.
    if (theta < 1e-6 || Math.abs(Math.PI - theta) < 1e-6) continue
    limit = Math.min(limit, (Math.min(lenPrev, lenNext) / 2) * Math.tan(theta / 2))
  }
  return Number.isFinite(limit) ? Math.max(0, limit) : 0
}

/** Corner count limits, matching XD's Polygon tool. */
export const MIN_SIDES = 3
export const MAX_SIDES = 100

function clampSides(sides: number): number {
  return Math.min(MAX_SIDES, Math.max(MIN_SIDES, Math.round(sides)))
}

function clampStarRatio(ratio: number): number {
  return Math.min(1, Math.max(0.01, ratio))
}

/**
 * Maps the unit circle the vertices are generated on onto the local box.
 *
 * The map is measured from the OUTER ring alone, and deliberately not from the
 * unit circle: a regular n-gon inscribed in a circle only touches the circle at
 * its vertices, so generating straight into the box left dead margin between the
 * shape and its own frame for every n not divisible by 4 (a hexagon reached only
 * 86.6% of the width, a pentagon 95.1% across and 90.5% down). The selection
 * frame, align/distribute, the W/H readout and the export crop all read that
 * frame, so the shape has to fill it.
 *
 * Measuring the outer ring only is what keeps the frame still while the star
 * ratio is dragged: inner vertices are always inside the outer hull, so they
 * never contribute to the bounds.
 */
function unitToBox(width: number, height: number, sides: number): (p: Vec2) => Vec2 {
  const n = clampSides(sides)
  const w = Math.max(0, width)
  const h = Math.max(0, height)

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const x = Math.cos(a)
    const y = Math.sin(a)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const spanX = maxX - minX
  const spanY = maxY - minY

  return (p) => ({
    x: spanX > 0 ? ((p.x - minX) / spanX) * w : w / 2,
    y: spanY > 0 ? ((p.y - minY) / spanY) * h : h / 2,
  })
}

/**
 * Vertices of a polygon or star, scaled to fill the local box exactly.
 *
 * `starRatio` is a fraction of the APOTHEM, not of the circumradius. That is
 * what makes 100% a plain polygon rather than a special case: at ratio 1 every
 * inner vertex lands exactly on the midpoint of the edge it sits under, so the
 * outline is identical to the polygon's and dropping the now-collinear inner
 * vertices changes nothing. Measuring against the circumradius instead would
 * push inner vertices outside the outer hull for any ratio above cos(pi/n) — a
 * pentagon past 0.809 — and the frame would jump mid-drag.
 *
 * `sides = 3` reproduces the isosceles triangle exactly: the raw bbox
 * x in [-0.866, 0.866], y in [-1, 0.5] maps to (w/2, 0), (w, h), (0, h).
 */
export function polygonStarPoints(
  width: number,
  height: number,
  sides: number,
  starRatio = 1,
): Vec2[] {
  const n = clampSides(sides)
  const ratio = clampStarRatio(starRatio)
  const map = unitToBox(width, height, n)

  if (ratio >= 1) {
    const pts: Vec2[] = []
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
      pts.push(map({ x: Math.cos(a), y: Math.sin(a) }))
    }
    return pts
  }

  const inner = ratio * Math.cos(Math.PI / n)
  const pts: Vec2[] = []
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n
    const f = i % 2 === 0 ? 1 : inner
    pts.push(map({ x: f * Math.cos(a), y: f * Math.sin(a) }))
  }
  return pts
}

export function polygonStarPath(
  width: number,
  height: number,
  sides: number,
  starRatio = 1,
  radius = 0,
): string {
  const points = polygonStarPoints(width, height, sides, starRatio)
  return radius > 0 ? roundedPolygonPath(points, radius) : pointsToClosedPath(points)
}

/** Centre the polygon is generated about, in local space. */
export function polygonCentre(width: number, height: number, sides: number): Vec2 {
  return unitToBox(width, height, sides)({ x: 0, y: 0 })
}

/**
 * Where the on-canvas Star Ratio handle sits: the first inner vertex.
 *
 * At ratio 1 that is the midpoint of the first edge, which is how the gesture
 * announces itself on a shape that is not yet a star.
 */
export function starRatioHandlePoint(
  width: number,
  height: number,
  sides: number,
  starRatio: number,
): Vec2 {
  const n = clampSides(sides)
  const a = -Math.PI / 2 + Math.PI / n
  const f = clampStarRatio(starRatio) * Math.cos(Math.PI / n)
  return unitToBox(width, height, n)({ x: f * Math.cos(a), y: f * Math.sin(a) })
}

/**
 * Star ratio implied by a point, for the handle drag.
 *
 * The pointer is projected onto the handle's own axis, so sliding sideways along
 * the edge does not change the ratio — the same rule the corner-radius handle
 * follows.
 */
export function starRatioFromPoint(
  width: number,
  height: number,
  sides: number,
  local: Vec2,
): number {
  const centre = polygonCentre(width, height, sides)
  const full = starRatioHandlePoint(width, height, sides, 1)
  const dx = full.x - centre.x
  const dy = full.y - centre.y
  const len2 = dx * dx + dy * dy
  if (len2 <= 0) return 1
  const t = ((local.x - centre.x) * dx + (local.y - centre.y) * dy) / len2
  return clampStarRatio(t)
}

/** Line from one local corner to the other; the transform orients it. */
export function linePath(x1: number, y1: number, x2: number, y2: number): string {
  return `M${r(x1)} ${r(y1)} L${r(x2)} ${r(y2)}`
}

export function pointsToClosedPath(pts: readonly Vec2[]): string {
  if (pts.length === 0) return ''
  const head = `M${r(pts[0]!.x)} ${r(pts[0]!.y)}`
  const rest = pts.slice(1).map((p) => `L${r(p.x)} ${r(p.y)}`)
  return `${head} ${rest.join(' ')} Z`
}

export function pointsToOpenPath(pts: readonly Vec2[]): string {
  if (pts.length === 0) return ''
  const head = `M${r(pts[0]!.x)} ${r(pts[0]!.y)}`
  const rest = pts.slice(1).map((p) => `L${r(p.x)} ${r(p.y)}`)
  return `${head} ${rest.join(' ')}`
}

/**
 * Smooth a raw pointer trail into a Catmull-Rom-derived cubic path.
 * Backs the pencil / freehand tool.
 */
export function smoothPolylineToPath(pts: readonly Vec2[], tension = 0.5): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${r(pts[0]!.x)} ${r(pts[0]!.y)}`
  if (pts.length === 2) return linePath(pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y)

  const out: string[] = [`M${r(pts[0]!.x)} ${r(pts[0]!.y)}`]
  const k = tension / 3
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    out.push(
      `C${r(p1.x + (p2.x - p0.x) * k)} ${r(p1.y + (p2.y - p0.y) * k)} ` +
        `${r(p2.x - (p3.x - p1.x) * k)} ${r(p2.y - (p3.y - p1.y) * k)} ` +
        `${r(p2.x)} ${r(p2.y)}`,
    )
  }
  return out.join(' ')
}

/**
 * Douglas-Peucker simplification. The pencil tool captures far more points than
 * it needs; without this, a single stroke can carry hundreds of nodes.
 */
export function simplifyPoints(pts: readonly Vec2[], tolerance = 1): Vec2[] {
  if (pts.length <= 2) return [...pts]
  const sqTol = tolerance * tolerance
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1

  const stack: Array<[number, number]> = [[0, pts.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let maxSq = 0
    let index = -1
    const a = pts[first]!
    const b = pts[last]!
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(pts[i]!, a, b)
      if (sq > maxSq) {
        maxSq = sq
        index = i
      }
    }
    if (maxSq > sqTol && index > 0) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return pts.filter((_, i) => keep[i] === 1)
}

function sqSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  let x = a.x
  let y = a.y
  let dx = b.x - x
  let dy = b.y - y
  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) {
      x = b.x
      y = b.y
    } else if (t > 0) {
      x += dx * t
      y += dy * t
    }
  }
  dx = p.x - x
  dy = p.y - y
  return dx * dx + dy * dy
}

function r(n: number): number {
  const v = Math.round(n * 10000) / 10000
  return Object.is(v, -0) ? 0 : v
}
