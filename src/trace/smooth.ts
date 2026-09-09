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
 * Image Trace, stages four and five: the polygon becomes Beziers.
 *
 * The polygon stage leaves a hard turn at every vertex it kept, which is not
 * what the picture looked like — a traced letter O arrives here as thirty short
 * straight runs, and the thing it is meant to be is one smooth loop. This is
 * potrace's corner analysis (Sec. 2.3.3) and curve optimisation (Sec. 2.4),
 * followed by a snap-to-lines pass of our own.
 *
 *   1. Smoothing. Each vertex becomes exactly ONE segment, running from the
 *      midpoint of the edge before it to the midpoint of the edge after it.
 *      Cutting at the midpoints puts every segment join in the middle of a
 *      straight run, where a join is invisible, and leaves each vertex alone
 *      inside its own segment where its sharpness can be judged on its own.
 *
 *      That judgement is `alpha`. It compares the area of the triangle the
 *      vertex makes with its two neighbours against the largest area a vertex
 *      could have while still lying within one pixel of the line through them
 *      (potrace's `ddenom`, an L1 length of that chord). The ratio is
 *      scale-aware in a way a plain angle is not, and that is the whole point:
 *      a right angle between two long edges is a corner the drawing meant,
 *      while the same right angle between two one-pixel edges is a step of a
 *      staircase and has to round away. `alpha >= alphaMax` keeps the vertex as
 *      a corner — two straight lines through it — and anything below becomes a
 *      cubic whose control points sit `0.5 + 0.5*alpha` of the way from the
 *      edge midpoints toward the vertex, so the curve leans into the turn
 *      exactly as far as the turn is sharp. alphaMax is the panel's Corners
 *      slider: 0 keeps every vertex a corner (the output is the polygon), 4/3
 *      and above keeps none.
 *
 *   2. Optimisation. Smoothing emits one segment per vertex, many more than a
 *      shape needs: a dozen segments around a circle where four are
 *      indistinguishable. `opticurve` is a dynamic programme over the segment
 *      boundaries that replaces a run of segments with a single cubic whenever
 *      one exists that stays within `optTolerance` of every polygon edge the
 *      run covers, minimising first the number of segments and then the summed
 *      error. A run stays a candidate only while it is convex, corner-free and
 *      bends less than 179 degrees, which is what keeps the fit from wandering
 *      off across the shape; the cubic chosen is the one enclosing the same
 *      area as the run it replaces. This is the difference between a traced
 *      circle with four anchors and one with thirty.
 *
 *      The penalty function reads the cropped `alpha` of every segment it
 *      swallows, and the reconstruction recomputes `beta` from the fitted
 *      parameters, so the two stages talk through a private structure that
 *      carries alpha/alpha0/beta per segment — potrace's `privcurve_t`. Only
 *      the last step turns it into the public Curve.
 *
 *      Whatever the optimiser cannot express — a fit that comes out
 *      non-finite, a reconstruction that does not walk back to where it
 *      started — is discarded in favour of the unoptimised curve. A slightly
 *      heavier path is a worse result; a NaN in the path data is a shape that
 *      vanishes.
 *
 *   3. Snap to lines. potrace has no straight lines other than corners: a run
 *      that is dead straight still comes out as a cubic, one whose control
 *      points happen to lie on its chord. Users editing the result expect an
 *      `L` there, and so does every path operation downstream. A curve whose
 *      two control points are both within `snapToLines` of the chord becomes a
 *      line; a cubic never strays further from its chord than 3/4 of the
 *      greater control-point offset, so that setting is a true bound on the
 *      error it introduces.
 *
 * Coordinates are whatever the polygon stage produced — pixel-corner units for
 * a fill outline — and are only ever copied and interpolated here.
 */

import type { Curve, Segment, Vec2 } from './types'

export interface SmoothOptions {
  /** potrace alphamax, 0 (every vertex a corner) .. 1.3334 (never a corner). */
  alphaMax: number
  /** potrace opttolerance, 0 disables curve optimisation. Default 0.2. */
  optTolerance: number
  /** Replace curves that deviate from their chord by less than this many px with lines. 0 disables. */
  snapToLines: number
}

/** cos(179 degrees): the sharpest bend a single optimised segment may contain. */
const COS179 = -0.999847695156391

/**
 * potrace's floor and ceiling on the alpha a CURVED vertex is drawn with (not
 * to be confused with the alphaMax option, which is the corner threshold).
 * Below 0.55 the cubic sags away from the polygon; above 1 its control points
 * would pass the vertex and the curve would overshoot it.
 */
const CURVE_ALPHA_MIN = 0.55
const CURVE_ALPHA_MAX = 1

/**
 * The polygon smoothed into Beziers, then optimised, then straightened.
 *
 * `vertices` are the polygon's, in order, and the result is a closed curve
 * whose first segment starts at the midpoint of the edge from the last vertex
 * to the first. The input is never modified and shares no points with the
 * output.
 */
export function smoothPolygon(vertices: Vec2[], options: SmoothOptions): Curve {
  // Two vertices cannot enclose an area and one cannot turn, so there is no
  // corner analysis to do; emit them as they are rather than dividing by a
  // zero-length edge.
  if (vertices.length < 3) return degenerateCurve(vertices)

  const smoothed = smooth(vertices, options.alphaMax)
  const optimised = options.optTolerance > 0 ? opticurve(smoothed, options.optTolerance) : null
  const curve = privToCurve(optimised ?? smoothed)
  return options.snapToLines > 0 ? snapCurvesToLines(curve, options.snapToLines) : curve
}

/**
 * Anchor points in a curve, for the panel's readout and for comparing two sets
 * of settings. A corner is two anchors — the kink is a point the pen tool can
 * grab, which is why render.ts writes it as two `L` commands — and a curve or a
 * line is one. An open curve counts its start as well; a closed one does not,
 * because there the start IS the last segment's end.
 */
export function curveAnchorCount(curve: Curve): number {
  let anchors = curve.closed === false ? 1 : 0
  for (const segment of curve.segments) anchors += segment.kind === 'corner' ? 2 : 1
  return anchors
}

// ---------------------------------------------------------------------------
// potrace's vector primitives, named as in the paper and the C source
// ---------------------------------------------------------------------------

/** Cyclic index, defined for negative `a` as well. */
function mod(a: number, n: number): number {
  return a >= n ? a % n : a >= 0 ? a : n - 1 - ((-1 - a) % n)
}

function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0
}

function point(p: Vec2): Vec2 {
  return { x: p.x, y: p.y }
}

/** The point `lambda` of the way from a to b. */
function interval(lambda: number, a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + lambda * (b.x - a.x), y: a.y + lambda * (b.y - a.y) }
}

/**
 * A direction 90 degrees from p2-p0, snapped to one of the eight compass
 * points. Snapping is what makes `ddenom` measure the chord in the same units
 * the pixel grid does.
 */
function dorthInfty(p0: Vec2, p2: Vec2): Vec2 {
  return { x: -sign(p2.y - p0.y), y: sign(p2.x - p0.x) }
}

/**
 * The scale that turns a triangle area into potrace's alpha: chosen so that
 * |dpara(p0, p1, p2)| <= ddenom(p0, p2) exactly when the unit square centred on
 * p1 meets the line p0p2 — that is, when p1 is within a pixel of straight.
 */
function ddenom(p0: Vec2, p2: Vec2): number {
  const r = dorthInfty(p0, p2)
  return r.y * (p2.x - p0.x) - r.x * (p2.y - p0.y)
}

/** (p1-p0) x (p2-p0): twice the signed area of the triangle. */
function dpara(p0: Vec2, p1: Vec2, p2: Vec2): number {
  return (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
}

/** (p1-p0) x (p3-p2). */
function cprod(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): number {
  return (p1.x - p0.x) * (p3.y - p2.y) - (p3.x - p2.x) * (p1.y - p0.y)
}

/** (p1-p0) . (p2-p0). */
function iprod(p0: Vec2, p1: Vec2, p2: Vec2): number {
  return (p1.x - p0.x) * (p2.x - p0.x) + (p1.y - p0.y) * (p2.y - p0.y)
}

/** (p1-p0) . (p3-p2). */
function iprod1(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): number {
  return (p1.x - p0.x) * (p3.x - p2.x) + (p1.y - p0.y) * (p3.y - p2.y)
}

function ddist(p: Vec2, q: Vec2): number {
  return Math.hypot(p.x - q.x, p.y - q.y)
}

/** The point at parameter t on the cubic (p0, p1, p2, p3). */
function bezier(t: number, p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): Vec2 {
  const s = 1 - t
  const a = s * s * s
  const b = 3 * s * s * t
  const c = 3 * t * t * s
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/**
 * The t in [0, 1] at which the cubic (p0..p3) runs parallel to q1-q0, or -1
 * when there is none. The optimiser measures its error at exactly that point,
 * because for a convex arc against a straight edge it is where the two are
 * furthest apart.
 */
function tangent(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, q0: Vec2, q1: Vec2): number {
  const A = cprod(p0, p1, q0, q1)
  const B = cprod(p1, p2, q0, q1)
  const C = cprod(p2, p3, q0, q1)

  const a = A - 2 * B + C
  const b = -2 * A + 2 * B
  const c = A
  const d = b * b - 4 * a * c
  if (a === 0 || d < 0) return -1

  const s = Math.sqrt(d)
  const r1 = (-b + s) / (2 * a)
  const r2 = (-b - s) / (2 * a)
  if (r1 >= 0 && r1 <= 1) return r1
  if (r2 >= 0 && r2 <= 1) return r2
  return -1
}

// ---------------------------------------------------------------------------
// Stage 4: smoothing and corner analysis
// ---------------------------------------------------------------------------

type Tag = 'corner' | 'curve'

/**
 * potrace's privcurve_t. Segment i belongs to vertex i and ends at `c[i][2]`,
 * the midpoint of the edge leaving that vertex; `c[i][0]` and `c[i][1]` are its
 * control points, except on a corner, where `c[i][1]` is the vertex itself.
 *
 * `alpha` is the cropped corner measure the curve was actually drawn with,
 * `alpha0` the raw one before cropping, `beta` the position of the vertex along
 * the segment. The optimiser needs all three: the penalty compares against
 * `alpha`, and the reconstruction rebuilds `beta` for the segments it merges.
 */
interface PrivCurve {
  n: number
  tag: Tag[]
  c: Vec2[][]
  vertex: Vec2[]
  alpha: number[]
  alpha0: number[]
  beta: number[]
}

function createPrivCurve(n: number): PrivCurve {
  return {
    n,
    tag: new Array<Tag>(n).fill('curve'),
    c: Array.from({ length: n }, () => [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]),
    vertex: Array.from({ length: n }, () => ({ x: 0, y: 0 })),
    alpha: new Array<number>(n).fill(0),
    alpha0: new Array<number>(n).fill(0),
    beta: new Array<number>(n).fill(0.5),
  }
}

/** potrace's `smooth`: one segment per vertex, corner or cubic by alpha. */
function smooth(vertices: Vec2[], alphaMax: number): PrivCurve {
  const m = vertices.length
  const priv = createPrivCurve(m)
  for (let i = 0; i < m; i++) priv.vertex[i] = point(vertices[i])

  for (let i = 0; i < m; i++) {
    const j = mod(i + 1, m)
    const k = mod(i + 2, m)
    // Where segment j ends: halfway along the edge that leaves vertex j.
    const p4 = interval(0.5, vertices[k], vertices[j])

    const denom = ddenom(vertices[i], vertices[k])
    let alpha: number
    if (denom !== 0) {
      const dd = Math.abs(dpara(vertices[i], vertices[j], vertices[k]) / denom)
      // dd <= 1 means the vertex is within a pixel of the line through its
      // neighbours: nothing to see, draw it as flat as the clamp allows.
      alpha = (dd > 1 ? 1 - 1 / dd : 0) / 0.75
    } else {
      // The neighbours coincide, so there is no line to be off: treat the
      // vertex as maximally round rather than dividing by zero.
      alpha = 4 / 3
    }
    priv.alpha0[j] = alpha

    if (alpha >= alphaMax) {
      priv.tag[j] = 'corner'
      priv.c[j][1] = point(vertices[j])
      priv.c[j][2] = p4
    } else {
      if (alpha < CURVE_ALPHA_MIN) alpha = CURVE_ALPHA_MIN
      else if (alpha > CURVE_ALPHA_MAX) alpha = CURVE_ALPHA_MAX
      priv.tag[j] = 'curve'
      priv.c[j][0] = interval(0.5 + 0.5 * alpha, vertices[i], vertices[j])
      priv.c[j][1] = interval(0.5 + 0.5 * alpha, vertices[k], vertices[j])
      priv.c[j][2] = p4
    }
    priv.alpha[j] = alpha
    priv.beta[j] = 0.5
  }
  return priv
}

// ---------------------------------------------------------------------------
// Stage 5: curve optimisation
// ---------------------------------------------------------------------------

/** One candidate replacement segment: its cubic, its error, and its fit parameters. */
interface Opti {
  pen: number
  c: [Vec2, Vec2]
  t: number
  s: number
  alpha: number
}

/**
 * potrace's `opti_penalty`: the best single cubic from segment boundary i to
 * segment boundary j, or null when no acceptable one exists.
 *
 * The cubic is not least-squares fitted. Its shape is fixed by the two end
 * tangents — which must be the ones the curve already has, or the join would
 * kink — leaving one degree of freedom, and that is set by matching the area
 * the original run encloses (`areac`). What follows is only a check that the
 * result is close enough: at the point where the cubic runs parallel to each
 * polygon edge it must be within `optTolerance` of that edge, and it must not
 * cut inside any corner it passes.
 */
function optiPenalty(
  priv: PrivCurve,
  i: number,
  j: number,
  optTolerance: number,
  convc: Int32Array,
  areac: Float64Array,
): Opti | null {
  const m = priv.n
  const vertex = priv.vertex

  // A full loop can never be a single Bezier.
  if (i === j) return null

  const i1 = mod(i + 1, m)
  let k1 = i1
  // Every vertex inside the run has to turn the same way, and a corner (whose
  // convexity is 0) can never be swallowed: it is there precisely because the
  // shape is not smooth across it.
  const conv = convc[k1]
  if (conv === 0) return null

  const d = ddist(vertex[i], vertex[i1])
  for (let k = k1; k !== j; k = k1) {
    k1 = mod(k + 1, m)
    const k2 = mod(k + 2, m)
    if (convc[k1] !== conv) return null
    if (sign(cprod(vertex[i], vertex[i1], vertex[k1], vertex[k2])) !== conv) return null
    // Total bend under 179 degrees. A run that doubles back has an area a
    // single cubic could match while looking nothing like it.
    if (
      iprod1(vertex[i], vertex[i1], vertex[k1], vertex[k2]) <
      d * ddist(vertex[k1], vertex[k2]) * COS179
    ) {
      return null
    }
  }

  const p0 = priv.c[mod(i, m)][2]
  const p1 = vertex[mod(i + 1, m)]
  const p2 = vertex[mod(j, m)]
  const p3 = priv.c[mod(j, m)][2]

  // Area enclosed between the run and the chord p0p3, from the cumulative sums.
  let area = areac[j] - areac[i]
  area -= dpara(vertex[0], priv.c[i][2], priv.c[j][2]) / 2
  if (i >= j) area += areac[m]

  // o is where the end tangents p0p1 and p3p2 meet; t and s locate it along
  // them, and A is the area of the triangle p0-o-p3 the cubic sits inside.
  const A1 = dpara(p0, p1, p2)
  const A2 = dpara(p0, p1, p3)
  const A3 = dpara(p0, p2, p3)
  const A4 = A1 + A3 - A2
  if (A2 === A1) return null

  const t = A3 / (A3 - A4)
  const s = A2 / (A2 - A1)
  const A = (A2 * t) / 2
  if (A === 0) return null

  // The cubic through p0 and p3 with those tangents and this relative area.
  const alpha = 2 - Math.sqrt(4 - area / A / 0.3)
  // potrace lets a negative radicand or a tangent intersection at infinity
  // produce NaN control points and leans on the comparisons below rejecting
  // them; reject them here instead, where the reason is visible.
  if (!Number.isFinite(alpha) || !Number.isFinite(t) || !Number.isFinite(s)) return null

  const b1 = interval(t * alpha, p0, p1)
  const b2 = interval(s * alpha, p3, p2)
  if (!isFinitePoint(b1) || !isFinitePoint(b2)) return null

  let pen = 0

  // Against each polygon edge the run covers: the cubic must stay within
  // tolerance of it, and must touch it between its endpoints rather than past
  // one of them.
  for (let k = mod(i + 1, m); k !== j; k = k1) {
    k1 = mod(k + 1, m)
    const tk = tangent(p0, b1, b2, p3, vertex[k], vertex[k1])
    if (tk < -0.5) return null
    const pt = bezier(tk, p0, b1, b2, p3)
    const dk = ddist(vertex[k], vertex[k1])
    if (dk === 0) return null
    const d1 = dpara(vertex[k], vertex[k1], pt) / dk
    if (Math.abs(d1) > optTolerance) return null
    if (iprod(vertex[k], vertex[k1], pt) < 0 || iprod(vertex[k1], vertex[k], pt) < 0) return null
    pen += d1 * d1
  }

  // Against each segment chord: the cubic must bulge at least as far as the
  // original curve did, or the shape loses the roundness it was drawn with.
  for (let k = i; k !== j; k = k1) {
    k1 = mod(k + 1, m)
    const tk = tangent(p0, b1, b2, p3, priv.c[k][2], priv.c[k1][2])
    if (tk < -0.5) return null
    const pt = bezier(tk, p0, b1, b2, p3)
    const dk = ddist(priv.c[k][2], priv.c[k1][2])
    if (dk === 0) return null
    let d1 = dpara(priv.c[k][2], priv.c[k1][2], pt) / dk
    let d2 = (dpara(priv.c[k][2], priv.c[k1][2], vertex[k1]) / dk) * 0.75 * priv.alpha[k1]
    if (d2 < 0) {
      d1 = -d1
      d2 = -d2
    }
    if (d1 < d2 - optTolerance) return null
    if (d1 < d2) pen += (d1 - d2) * (d1 - d2)
  }

  return { pen, c: [b1, b2], t, s, alpha }
}

/**
 * potrace's `opticurve`: the fewest segments, then the least error.
 *
 * `pen[j]`, `len[j]` and `pt[j]` are the best penalty, segment count and
 * predecessor for the run from boundary 0 to boundary j; the inner loop walks
 * backwards and stops at the first i that cannot be joined, because if a run
 * cannot be one cubic then no longer run containing it can be either.
 *
 * Returns null when there is nothing to gain or the result cannot be trusted —
 * the caller then keeps the unoptimised curve.
 */
function opticurve(priv: PrivCurve, optTolerance: number): PrivCurve | null {
  const m = priv.n
  if (m < 3) return null

  // Convexity per vertex: +1 and -1 are the two turn directions, 0 a corner.
  const convc = new Int32Array(m)
  for (let i = 0; i < m; i++) {
    convc[i] =
      priv.tag[i] === 'curve'
        ? sign(dpara(priv.vertex[mod(i - 1, m)], priv.vertex[i], priv.vertex[mod(i + 1, m)]))
        : 0
  }

  // Cumulative area up to each segment boundary, measured against vertex 0, so
  // that the area of any run is one subtraction.
  const areac = new Float64Array(m + 1)
  const origin = priv.vertex[0]
  let area = 0
  for (let i = 0; i < m; i++) {
    const i1 = mod(i + 1, m)
    if (priv.tag[i1] === 'curve') {
      const alpha = priv.alpha[i1]
      area += (0.3 * alpha * (4 - alpha) * dpara(priv.c[i][2], priv.vertex[i1], priv.c[i1][2])) / 2
      area += dpara(origin, priv.c[i][2], priv.c[i1][2]) / 2
    }
    areac[i + 1] = area
  }

  const pt = new Int32Array(m + 1)
  const pen = new Float64Array(m + 1)
  const len = new Int32Array(m + 1)
  const opt = new Array<Opti | null>(m + 1).fill(null)
  pt[0] = -1

  for (let j = 1; j <= m; j++) {
    // Taking segment j on its own is always possible and always valid.
    pt[j] = j - 1
    pen[j] = pen[j - 1]
    len[j] = len[j - 1] + 1
    for (let i = j - 2; i >= 0; i--) {
      const o = optiPenalty(priv, i, mod(j, m), optTolerance, convc, areac)
      if (!o) break
      if (len[j] > len[i] + 1 || (len[j] === len[i] + 1 && pen[j] > pen[i] + o.pen)) {
        pt[j] = i
        pen[j] = pen[i] + o.pen
        len[j] = len[i] + 1
        opt[j] = o
      }
    }
  }

  const om = len[m]
  // Nothing merged: hand back the curve as it stands rather than the same
  // segments rotated by one, which is all the reconstruction would produce.
  if (om < 1 || om >= m) return null

  const out = createPrivCurve(om)
  const s = new Float64Array(om)
  const t = new Float64Array(om)
  let j = m
  for (let i = om - 1; i >= 0; i--) {
    // The chain of predecessors must reach 0 in exactly om steps.
    if (j < 1 || j > m) return null
    const jm = mod(j, m)
    if (pt[j] === j - 1) {
      out.tag[i] = priv.tag[jm]
      out.c[i][0] = priv.c[jm][0]
      out.c[i][1] = priv.c[jm][1]
      out.c[i][2] = priv.c[jm][2]
      out.vertex[i] = priv.vertex[jm]
      out.alpha[i] = priv.alpha[jm]
      out.alpha0[i] = priv.alpha0[jm]
      out.beta[i] = priv.beta[jm]
      s[i] = 1
      t[i] = 1
    } else {
      const o = opt[j]
      if (!o) return null
      out.tag[i] = 'curve'
      out.c[i][0] = o.c[0]
      out.c[i][1] = o.c[1]
      out.c[i][2] = priv.c[jm][2]
      // The merged segment's notional vertex, where its tangents cross.
      out.vertex[i] = interval(o.s, priv.c[jm][2], priv.vertex[jm])
      out.alpha[i] = o.alpha
      out.alpha0[i] = o.alpha
      s[i] = o.s
      t[i] = o.t
    }
    j = pt[j]
  }
  if (j !== 0) return null

  for (let i = 0; i < om; i++) {
    const denom = s[i] + t[mod(i + 1, om)]
    out.beta[i] = denom !== 0 ? s[i] / denom : 0.5
  }
  return isFinitePrivCurve(out) ? out : null
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function isFinitePoint(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

function isFinitePrivCurve(priv: PrivCurve): boolean {
  for (let i = 0; i < priv.n; i++) {
    if (!isFinitePoint(priv.vertex[i])) return false
    for (const p of priv.c[i]) if (!isFinitePoint(p)) return false
  }
  return true
}

/**
 * The private curve as the public one. Segment i starts where segment i-1
 * ended, so the closed curve starts at the last segment's endpoint. Points are
 * copied: nothing downstream should be able to reach back into the working
 * structure or into the caller's vertices.
 */
function privToCurve(priv: PrivCurve): Curve {
  const segments: Segment[] = []
  for (let i = 0; i < priv.n; i++) {
    segments.push(
      priv.tag[i] === 'corner'
        ? { kind: 'corner', c: point(priv.c[i][1]), end: point(priv.c[i][2]) }
        : {
            kind: 'curve',
            c1: point(priv.c[i][0]),
            c2: point(priv.c[i][1]),
            end: point(priv.c[i][2]),
          },
    )
  }
  return { start: point(priv.c[priv.n - 1][2]), segments }
}

/** Fewer than three vertices: a point, or a degenerate two-point loop. */
function degenerateCurve(vertices: Vec2[]): Curve {
  if (vertices.length === 0) return { start: { x: 0, y: 0 }, segments: [] }
  const segments: Segment[] = []
  for (let i = 1; i < vertices.length; i++) segments.push({ kind: 'line', end: point(vertices[i]) })
  return { start: point(vertices[0]), segments }
}

/** Distance from p to the segment ab, or to a when the segment has no length. */
function distanceToChord(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  // Clamped, not the infinite line: a control point that overshoots an end is
  // pulling the curve past it, however close to the line it happens to be.
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Curves whose control points hug their chord become lines. */
function snapCurvesToLines(curve: Curve, tolerance: number): Curve {
  const segments: Segment[] = []
  let from = curve.start
  for (const segment of curve.segments) {
    if (
      segment.kind === 'curve' &&
      distanceToChord(segment.c1, from, segment.end) <= tolerance &&
      distanceToChord(segment.c2, from, segment.end) <= tolerance
    ) {
      segments.push({ kind: 'line', end: segment.end })
    } else {
      segments.push(segment)
    }
    from = segment.end
  }
  return { ...curve, segments }
}
