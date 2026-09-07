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

/** Isosceles triangle: apex centered on the top edge, base along the bottom. */
export function trianglePath(width: number, height: number): string {
  const w = Math.max(0, width)
  const h = Math.max(0, height)
  return `M${r(w / 2)} 0 L${r(w)} ${r(h)} L0 ${r(h)} Z`
}

/** Vertices of a regular n-gon inscribed in the local box, first point at top. */
export function polygonPoints(width: number, height: number, sides: number): Vec2[] {
  const n = Math.max(3, Math.round(sides))
  const rx = Math.max(0, width) / 2
  const ry = Math.max(0, height) / 2
  const pts: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    pts.push({ x: rx + rx * Math.cos(a), y: ry + ry * Math.sin(a) })
  }
  return pts
}

export function polygonPath(width: number, height: number, sides: number): string {
  return pointsToClosedPath(polygonPoints(width, height, sides))
}

/**
 * Star vertices, alternating outer and inner radius.
 * @param innerRatio inner radius as a fraction of outer, 0..1.
 */
export function starPoints(
  width: number,
  height: number,
  points: number,
  innerRatio: number,
): Vec2[] {
  const n = Math.max(3, Math.round(points))
  const ratio = Math.min(1, Math.max(0.01, innerRatio))
  const rx = Math.max(0, width) / 2
  const ry = Math.max(0, height) / 2
  const out: Vec2[] = []
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n
    const f = i % 2 === 0 ? 1 : ratio
    out.push({ x: rx + rx * f * Math.cos(a), y: ry + ry * f * Math.sin(a) })
  }
  return out
}

export function starPath(
  width: number,
  height: number,
  points: number,
  innerRatio: number,
): string {
  return pointsToClosedPath(starPoints(width, height, points, innerRatio))
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
