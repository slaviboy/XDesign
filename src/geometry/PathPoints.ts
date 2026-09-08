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
 * Editable anchor-point representation of a path.
 *
 * Path data is the source of truth in the document (real SVG commands, arcs and
 * all). This module converts to and from a point/handle view for the pen tool
 * and direct node editing, then converts straight back — so editing a path never
 * silently degrades it into something else.
 *
 * Handles are stored in ABSOLUTE coordinates, which is what a direct-manipulation
 * UI actually drags; the serializer converts to SVG's control-point form.
 */

import { toCubicSegments } from './PathUtils'
import type { Vec2 } from './Matrix'

export interface PenPoint {
  x: number
  y: number
  /** Incoming control point, absolute. null for a corner. */
  inX: number | null
  inY: number | null
  /** Outgoing control point, absolute. null for a corner. */
  outX: number | null
  outY: number | null
}

export interface PenSubpath {
  points: PenPoint[]
  closed: boolean
}

export function corner(x: number, y: number): PenPoint {
  return { x, y, inX: null, inY: null, outX: null, outY: null }
}

export function isSmooth(p: PenPoint): boolean {
  return p.inX !== null || p.outX !== null
}

/**
 * True when the two handles are collinear with the anchor — the point is a
 * genuine smooth joint rather than two independent tangents.
 */
export function isMirrored(p: PenPoint, tolerance = 0.5): boolean {
  if (p.inX === null || p.outX === null || p.inY === null || p.outY === null) return false
  const dx = p.x - p.inX - (p.outX - p.x)
  const dy = p.y - p.inY - (p.outY - p.y)
  return Math.hypot(dx, dy) <= tolerance
}

// ---------------------------------------------------------------------------
// d -> points
// ---------------------------------------------------------------------------

export function pathToSubpaths(d: string): PenSubpath[] {
  const segs = toCubicSegments(d)
  const out: PenSubpath[] = []
  let current: PenSubpath | null = null

  for (const seg of segs) {
    switch (seg[0]) {
      case 'M': {
        if (current && current.points.length) out.push(current)
        current = { points: [corner(seg[1]!, seg[2]!)], closed: false }
        break
      }
      case 'L': {
        if (!current) break
        current.points.push(corner(seg[1]!, seg[2]!))
        break
      }
      case 'C': {
        if (!current) break
        const [, c1x, c1y, c2x, c2y, ex, ey] = seg as [string, number, number, number, number, number, number]
        const prev = current.points[current.points.length - 1]
        if (prev) {
          prev.outX = c1x
          prev.outY = c1y
        }
        current.points.push({ x: ex, y: ey, inX: c2x, inY: c2y, outX: null, outY: null })
        break
      }
      case 'Z': {
        if (!current) break
        current.closed = true
        // A closing curve leaves a duplicate of the start point; fold its
        // incoming handle onto the real start point instead of keeping both.
        const pts = current.points
        if (pts.length > 1) {
          const last = pts[pts.length - 1]!
          const first = pts[0]!
          if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-6) {
            first.inX = last.inX
            first.inY = last.inY
            pts.pop()
          }
        }
        out.push(current)
        current = null
        break
      }
      default:
        break
    }
  }
  if (current && current.points.length) out.push(current)
  return out
}

// ---------------------------------------------------------------------------
// points -> d
// ---------------------------------------------------------------------------

function n(v: number): number {
  const r = Math.round(v * 10000) / 10000
  return Object.is(r, -0) ? 0 : r
}

export function subpathToPath(sub: PenSubpath): string {
  const pts = sub.points
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${n(pts[0]!.x)} ${n(pts[0]!.y)}`

  const parts: string[] = [`M${n(pts[0]!.x)} ${n(pts[0]!.y)}`]

  const segment = (a: PenPoint, b: PenPoint): string => {
    const hasOut = a.outX !== null && a.outY !== null
    const hasIn = b.inX !== null && b.inY !== null
    if (!hasOut && !hasIn) return `L${n(b.x)} ${n(b.y)}`
    const c1x = hasOut ? a.outX! : a.x
    const c1y = hasOut ? a.outY! : a.y
    const c2x = hasIn ? b.inX! : b.x
    const c2y = hasIn ? b.inY! : b.y
    return `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(b.x)} ${n(b.y)}`
  }

  for (let i = 1; i < pts.length; i++) parts.push(segment(pts[i - 1]!, pts[i]!))
  if (sub.closed) {
    parts.push(segment(pts[pts.length - 1]!, pts[0]!))
    parts.push('Z')
  }
  return parts.join(' ')
}

export function subpathsToPath(subs: readonly PenSubpath[]): string {
  return subs.map(subpathToPath).filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Editing operations
// ---------------------------------------------------------------------------

/** Make a point smooth by giving it mirrored handles derived from its neighbours. */
export function smoothPoint(sub: PenSubpath, index: number, strength = 0.33): void {
  const pts = sub.points
  const p = pts[index]
  if (!p) return
  const prev = pts[index - 1] ?? (sub.closed ? pts[pts.length - 1] : undefined)
  const next = pts[index + 1] ?? (sub.closed ? pts[0] : undefined)
  if (!prev && !next) return

  const ax = (next?.x ?? p.x) - (prev?.x ?? p.x)
  const ay = (next?.y ?? p.y) - (prev?.y ?? p.y)
  const len = Math.hypot(ax, ay) || 1
  const ux = (ax / len) * len * strength
  const uy = (ay / len) * len * strength

  p.inX = p.x - ux
  p.inY = p.y - uy
  p.outX = p.x + ux
  p.outY = p.y + uy
}

/** Strip a point's handles, turning it into a hard corner. */
export function cornerPoint(sub: PenSubpath, index: number): void {
  const p = sub.points[index]
  if (!p) return
  p.inX = null
  p.inY = null
  p.outX = null
  p.outY = null
}

export function togglePointType(sub: PenSubpath, index: number): void {
  const p = sub.points[index]
  if (!p) return
  if (isSmooth(p)) cornerPoint(sub, index)
  else smoothPoint(sub, index)
}

/** Move an anchor, dragging its handles along with it. */
export function movePoint(sub: PenSubpath, index: number, dx: number, dy: number): void {
  const p = sub.points[index]
  if (!p) return
  p.x += dx
  p.y += dy
  if (p.inX !== null) { p.inX += dx; p.inY = (p.inY ?? 0) + dy }
  if (p.outX !== null) { p.outX += dx; p.outY = (p.outY ?? 0) + dy }
}

/**
 * Move one handle. When `mirror` is set the opposite handle follows, keeping the
 * joint smooth; otherwise the handles become independent, which is how a smooth
 * point is broken into a cusp.
 */
export function moveHandle(
  sub: PenSubpath,
  index: number,
  which: 'in' | 'out',
  to: Vec2,
  mirror: boolean,
): void {
  const p = sub.points[index]
  if (!p) return
  if (which === 'in') {
    p.inX = to.x
    p.inY = to.y
    if (mirror) {
      const len = Math.hypot((p.outX ?? p.x) - p.x, (p.outY ?? p.y) - p.y) || Math.hypot(to.x - p.x, to.y - p.y)
      const dx = p.x - to.x
      const dy = p.y - to.y
      const d = Math.hypot(dx, dy) || 1
      p.outX = p.x + (dx / d) * len
      p.outY = p.y + (dy / d) * len
    }
  } else {
    p.outX = to.x
    p.outY = to.y
    if (mirror) {
      const len = Math.hypot((p.inX ?? p.x) - p.x, (p.inY ?? p.y) - p.y) || Math.hypot(to.x - p.x, to.y - p.y)
      const dx = p.x - to.x
      const dy = p.y - to.y
      const d = Math.hypot(dx, dy) || 1
      p.inX = p.x + (dx / d) * len
      p.inY = p.y + (dy / d) * len
    }
  }
}

/**
 * Drop one side's handle, leaving the other alone.
 *
 * This is what makes "a curve followed by a straight line" possible: retracting
 * an anchor's outgoing handle turns the NEXT segment into a line while the
 * incoming curve keeps its shape. cornerPoint would drop both and flatten the
 * curve you just drew.
 */
export function clearHandle(sub: PenSubpath, index: number, which: 'in' | 'out'): void {
  const p = sub.points[index]
  if (!p) return
  if (which === 'in') {
    p.inX = null
    p.inY = null
  } else {
    p.outX = null
    p.outY = null
  }
}

export function deletePoint(sub: PenSubpath, index: number): boolean {
  if (index < 0 || index >= sub.points.length) return false
  sub.points.splice(index, 1)
  if (sub.points.length < 2) sub.closed = false
  return true
}

/**
 * Insert a point on the segment starting at `index`, splitting the cubic at `t`
 * with de Casteljau so the curve shape is exactly preserved.
 */
export function insertPointAt(sub: PenSubpath, index: number, t: number): number | null {
  const pts = sub.points
  const a = pts[index]
  const b = pts[index + 1] ?? (sub.closed ? pts[0] : undefined)
  if (!a || !b) return null

  const p0 = { x: a.x, y: a.y }
  const p1 = { x: a.outX ?? a.x, y: a.outY ?? a.y }
  const p2 = { x: b.inX ?? b.x, y: b.inY ?? b.y }
  const p3 = { x: b.x, y: b.y }

  const lerp = (u: Vec2, v: Vec2) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t })
  const q0 = lerp(p0, p1)
  const q1 = lerp(p1, p2)
  const q2 = lerp(p2, p3)
  const r0 = lerp(q0, q1)
  const r1 = lerp(q1, q2)
  const s = lerp(r0, r1)

  a.outX = q0.x
  a.outY = q0.y
  b.inX = q2.x
  b.inY = q2.y

  const inserted: PenPoint = { x: s.x, y: s.y, inX: r0.x, inY: r0.y, outX: r1.x, outY: r1.y }
  pts.splice(index + 1, 0, inserted)
  return index + 1
}

/** Nearest point on the path outline, for click-to-insert. */
export function closestSegment(
  subs: readonly PenSubpath[],
  point: Vec2,
  samples = 24,
): { subpath: number; index: number; t: number; distance: number } | null {
  let best: { subpath: number; index: number; t: number; distance: number } | null = null

  subs.forEach((sub, si) => {
    const pts = sub.points
    const count = sub.closed ? pts.length : pts.length - 1
    for (let i = 0; i < count; i++) {
      const a = pts[i]!
      const b = pts[(i + 1) % pts.length]!
      const p0 = { x: a.x, y: a.y }
      const p1 = { x: a.outX ?? a.x, y: a.outY ?? a.y }
      const p2 = { x: b.inX ?? b.x, y: b.inY ?? b.y }
      const p3 = { x: b.x, y: b.y }
      for (let k = 0; k <= samples; k++) {
        const t = k / samples
        const mt = 1 - t
        const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x
        const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
        const dist = Math.hypot(x - point.x, y - point.y)
        if (!best || dist < best.distance) best = { subpath: si, index: i, t, distance: dist }
      }
    }
  })
  return best
}
