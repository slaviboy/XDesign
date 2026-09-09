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
 * Centreline extraction: thin features become strokes instead of fills.
 *
 * Tracing a 1-px line as a fill produces a long, thin polygon — twice the
 * anchors it needs, and impossible to restyle as a line afterwards. This module
 * is Illustrator's "Strokes" option: it finds the parts of a colour layer that
 * are thinner than the stroke-width limit and emits each as one open path with
 * a width, leaving everything else for the fill tracer.
 *
 *   1. Distance transform. Every filled pixel learns how far its centre is from
 *      the centre of the nearest empty pixel; the image border counts as empty,
 *      so a shape cut off by the edge of the picture is still measured rather
 *      than reported as infinitely wide. The transform is the exact Euclidean
 *      one of Felzenszwalb & Huttenlocher — a lower envelope of parabolas
 *      computed along columns, then along rows, O(n) with no approximation —
 *      rather than a 5-7-11 chamfer. The value doubles as the stroke width the
 *      user sees, and a chamfer is off by up to 2% along diagonals, which is
 *      visible on a wide brush stroke.
 *
 *   2. Classification. `dist − ½` is the distance from a pixel's centre to the
 *      edge of the background, i.e. the local half-width, so a pixel is thin
 *      when `2·(dist − ½) ≤ maxWidth + 1`. The +1 is deliberate slack: a
 *      digital stroke's width is only known to the nearest pixel, and the
 *      user's limit is a soft one. Components are taken 8-connected, because
 *      the commonest stroke of all — a 1-px diagonal line — is not 4-connected.
 *      A component becomes a stroke candidate only when EVERY pixel in it is
 *      thin and it has at least four pixels. One thick pixel keeps the whole
 *      component a fill: a blob with a thin tail is a blob with a tail, not a
 *      stroke with a lump, and splitting it would leave a seam.
 *
 *   3. Thinning. Zhang–Suen reduces each candidate to a 1-px, 8-connected
 *      skeleton. Zhang–Suen is not quite idempotent — it leaves 4-connected
 *      corner pixels and the occasional 2-px diagonal staircase, both of which
 *      would register as junctions in the walk below — so a sequential pass
 *      then deletes every pixel that is 8-simple (Yokoi crossing number 1) and
 *      is not an endpoint. Thinning also grows short spurs at the corners of a
 *      thick stroke, about half the stroke width long; a spur no longer than
 *      the local width is cut, and the walk repeated, because a corner is a
 *      bend in one stroke, not a junction of three.
 *
 *   4. Graph walk. Skeleton pixels with one neighbour are endpoints, with
 *      three or more are junctions; the runs of two-neighbour pixels between
 *      them are the chains, each becoming one stroke. A ring with no endpoints
 *      or junctions is a single closed chain and is emitted as a closed curve,
 *      so the joins render as joins rather than as two caps meeting.
 *
 *   5. Curve fitting. Each chain is a polyline of pixel centres, simplified
 *      with Douglas–Peucker at `tolerance`, then turned into cubic Beziers by
 *      the uniform Catmull–Rom construction (tension ½): the tangent at each
 *      kept point is half the vector between its neighbours, and a Bezier
 *      control point sits a third of the way along the tangent. That gives a
 *      C¹ curve through every kept point without a fitting step; potrace's
 *      corner analysis would be wrong here because a skeleton has no corners
 *      to find, only the pixel staircase the simplification already removed.
 *      Two-point chains become a single line.
 *
 *   The stroke width is twice the mean half-width along the chain's skeleton
 *   pixels. A skeleton pixel in an even-width stroke is necessarily off-centre
 *   by half a pixel, so its distance to the nearer edge under-reads by ½; that
 *   case is recognisable — some filled neighbour that is NOT on the skeleton
 *   is at least as far from the background as the pixel itself — and corrected,
 *   so a 2-px line reports 2, not 1.
 *
 * Coordinates are pixel CENTRES (x + ½, y + ½): a centreline runs through the
 * middle of its pixels, unlike a fill boundary, which runs along their edges.
 * The input bitmap is never written to; `remaining` is a fresh copy.
 */

import type { Bitmap, Curve, Segment, Vec2 } from './types'

export interface CenterlineResult {
  /**
   * One curve per stroke; coordinates are pixel-CENTRE based (x+0.5, y+0.5).
   * Open (`closed: false`) except for a skeleton that was a closed ring.
   */
  strokes: Array<{ curve: Curve; width: number }>
  /** The input bitmap with every pixel that became part of a stroke cleared. */
  remaining: Bitmap
}

/** Components with fewer pixels than this are never strokes — too small to have a direction. */
const MIN_STROKE_PIXELS = 4

/** Spur pruning exposes new spurs only when a junction loses all but one arm; a few rounds settle it. */
const MAX_PRUNE_ROUNDS = 4

/** Stands in for infinity in the distance transform; a real Infinity makes ∞ − ∞ NaN. */
const INF = 1e20

interface Component {
  count: number
  thick: boolean
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** A stroke candidate's skeleton on its own grid, padded by one empty pixel on every side. */
interface Skeleton {
  grid: Uint8Array
  width: number
  height: number
  /** Image-space coordinates of grid cell (0, 0). */
  originX: number
  originY: number
}

/** A run of skeleton pixels between two nodes, as grid indices. Closed chains omit the repeated start. */
interface Chain {
  pixels: number[]
  closed: boolean
}

export function extractCenterlines(bitmap: Bitmap, maxWidth: number, tolerance: number): CenterlineResult {
  const { width, height } = bitmap
  const remaining: Bitmap = { width, height, data: new Uint8Array(bitmap.data) }
  const strokes: CenterlineResult['strokes'] = []
  if (width === 0 || height === 0) return { strokes, remaining }

  const edt = distanceTransform(bitmap)
  // 2·(dist − ½) ≤ maxWidth + 1  ⇔  dist ≤ (maxWidth + 2) / 2
  const thinLimit = (maxWidth + 2) / 2
  const { labels, components } = labelComponents(bitmap, edt, thinLimit)

  for (let c = 0; c < components.length; c++) {
    const component = components[c]!
    if (component.thick || component.count < MIN_STROKE_PIXELS) continue

    const skeleton = skeletonize(labels, c + 1, width, component)
    const halfWidthAt = (i: number) => halfWidth(skeleton, i, edt, width, height)
    let walk = walkSkeleton(skeleton)
    for (let round = 0; round < MAX_PRUNE_ROUNDS; round++) {
      if (!pruneSpurs(skeleton, walk.chains, walk.degree, halfWidthAt)) break
      removeSimplePoints(skeleton)
      walk = walkSkeleton(skeleton)
    }

    const produced: CenterlineResult['strokes'] = []
    for (const chain of walk.chains) {
      const stroke = chainToStroke(skeleton, chain, walk.degree, halfWidthAt, tolerance)
      if (stroke) produced.push(stroke)
    }
    // A candidate whose skeleton collapsed to nothing usable (Zhang–Suen erases
    // an isolated 2×2 block outright) is left for the fill tracer rather than
    // dropped: losing pixels is worse than tracing a dot as a tiny fill.
    if (produced.length === 0) continue

    for (const stroke of produced) strokes.push(stroke)
    clearComponent(remaining, labels, c + 1, component)
  }

  return { strokes, remaining }
}

// ---------------------------------------------------------------------------
// Distance transform
// ---------------------------------------------------------------------------

/**
 * Exact Euclidean distance from each filled pixel's centre to the nearest empty
 * pixel's centre, with the outside of the image treated as empty. 0 for empty
 * pixels, so `edt[i] > 0` doubles as "filled".
 */
function distanceTransform(bitmap: Bitmap): Float32Array {
  const { width: w, height: h, data } = bitmap
  // One empty pixel of padding on every side is what makes the border empty:
  // every column and row then has a zero at both ends.
  const pw = w + 2
  const ph = h + 2
  const grid = new Float64Array(pw * ph)
  for (let y = 0; y < h; y++) {
    const row = y * w
    const prow = (y + 1) * pw + 1
    for (let x = 0; x < w; x++) if (data[row + x]) grid[prow + x] = INF
  }

  const n = Math.max(pw, ph)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)

  // Columns first: afterwards every value is finite (each column has zeros at
  // its ends), then rows combine them into the 2D squared distance.
  for (let x = 1; x <= w; x++) {
    for (let y = 0; y < ph; y++) f[y] = grid[y * pw + x]!
    squaredDistance1D(f, ph, d, v, z)
    for (let y = 0; y < ph; y++) grid[y * pw + x] = d[y]!
  }
  for (let y = 1; y <= h; y++) {
    const base = y * pw
    for (let x = 0; x < pw; x++) f[x] = grid[base + x]!
    squaredDistance1D(f, pw, d, v, z)
    for (let x = 0; x < pw; x++) grid[base + x] = d[x]!
  }

  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    const prow = (y + 1) * pw + 1
    for (let x = 0; x < w; x++) {
      if (data[row + x]) out[row + x] = Math.sqrt(grid[prow + x]!)
    }
  }
  return out
}

/**
 * Felzenszwalb–Huttenlocher one-dimensional squared distance transform:
 * `d[q] = min_p (q − p)² + f[p]`. Each sample is a parabola; `v` holds the
 * parabolas on the lower envelope and `z` the boundaries between them.
 */
function squaredDistance1D(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = intersection(f, q, v[k]!)
    while (s <= z[k]!) {
      k--
      s = intersection(f, q, v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    const dq = q - v[k]!
    d[q] = dq * dq + f[v[k]!]!
  }
}

/** Where the parabolas rooted at samples q and p (q > p) cross. */
function intersection(f: Float64Array, q: number, p: number): number {
  return (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p)
}

// ---------------------------------------------------------------------------
// Connected components
// ---------------------------------------------------------------------------

/**
 * Label the 8-connected components of the filled pixels. Labels start at 1 and
 * index `components` at label − 1; each component records whether any of its
 * pixels is thicker than `thinLimit`, which is all the classifier needs.
 */
function labelComponents(
  bitmap: Bitmap,
  edt: Float32Array,
  thinLimit: number,
): { labels: Int32Array; components: Component[] } {
  const { width: w, height: h, data } = bitmap
  const n = w * h
  const labels = new Int32Array(n)
  const components: Component[] = []
  // Every pixel is labelled as it is pushed, so it is pushed at most once and
  // the stack never needs more than n slots.
  const stack = new Int32Array(n)

  for (let start = 0; start < n; start++) {
    if (!data[start] || labels[start]) continue
    const id = components.length + 1
    const component: Component = { count: 0, thick: false, minX: w, minY: h, maxX: -1, maxY: -1 }
    let top = 0
    stack[top++] = start
    labels[start] = id

    while (top > 0) {
      const p = stack[--top]!
      const x = p % w
      const y = (p - x) / w
      component.count++
      if (edt[p]! > thinLimit) component.thick = true
      if (x < component.minX) component.minX = x
      if (x > component.maxX) component.maxX = x
      if (y < component.minY) component.minY = y
      if (y > component.maxY) component.maxY = y

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const q = ny * w + nx
          if (data[q] && !labels[q]) {
            labels[q] = id
            stack[top++] = q
          }
        }
      }
    }
    components.push(component)
  }
  return { labels, components }
}

function clearComponent(target: Bitmap, labels: Int32Array, id: number, component: Component): void {
  for (let y = component.minY; y <= component.maxY; y++) {
    const row = y * target.width
    for (let x = component.minX; x <= component.maxX; x++) {
      if (labels[row + x] === id) target.data[row + x] = 0
    }
  }
}

// ---------------------------------------------------------------------------
// Thinning
// ---------------------------------------------------------------------------

/** Copy one component onto a padded grid of its own and thin it to a skeleton. */
function skeletonize(labels: Int32Array, id: number, imageWidth: number, component: Component): Skeleton {
  const width = component.maxX - component.minX + 3
  const height = component.maxY - component.minY + 3
  const originX = component.minX - 1
  const originY = component.minY - 1
  const grid = new Uint8Array(width * height)
  for (let y = component.minY; y <= component.maxY; y++) {
    const row = y * imageWidth
    const grow = (y - originY) * width - originX
    for (let x = component.minX; x <= component.maxX; x++) {
      if (labels[row + x] === id) grid[grow + x] = 1
    }
  }
  const skeleton: Skeleton = { grid, width, height, originX, originY }
  zhangSuen(skeleton)
  removeSimplePoints(skeleton)
  return skeleton
}

/**
 * Zhang & Suen (1984). Two sub-iterations per pass, each marking then deleting
 * boundary pixels that have 2..6 neighbours, exactly one 0→1 transition around
 * the ring (so deleting them cannot split the shape) and lie on the south-east
 * (first pass) or north-west (second) side, until nothing changes. The
 * alternating sides are what keep the skeleton centred.
 */
function zhangSuen(skeleton: Skeleton): void {
  const { grid, width: w, height: h } = skeleton
  const marks: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let pass = 0; pass < 2; pass++) {
      marks.length = 0
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          if (!grid[i]) continue
          // P2..P9 clockwise from north, as in the paper.
          const p2 = grid[i - w]!
          const p3 = grid[i - w + 1]!
          const p4 = grid[i + 1]!
          const p5 = grid[i + w + 1]!
          const p6 = grid[i + w]!
          const p7 = grid[i + w - 1]!
          const p8 = grid[i - 1]!
          const p9 = grid[i - w - 1]!
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          const a =
            (p2 === 0 && p3 === 1 ? 1 : 0) +
            (p3 === 0 && p4 === 1 ? 1 : 0) +
            (p4 === 0 && p5 === 1 ? 1 : 0) +
            (p5 === 0 && p6 === 1 ? 1 : 0) +
            (p6 === 0 && p7 === 1 ? 1 : 0) +
            (p7 === 0 && p8 === 1 ? 1 : 0) +
            (p8 === 0 && p9 === 1 ? 1 : 0) +
            (p9 === 0 && p2 === 1 ? 1 : 0)
          if (a !== 1) continue
          if (pass === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) {
            continue
          }
          marks.push(i)
        }
      }
      if (marks.length > 0) {
        changed = true
        for (const i of marks) grid[i] = 0
      }
    }
  }
}

/**
 * Delete, one at a time and with immediate effect, every pixel whose removal
 * leaves the skeleton's topology intact and which is not an endpoint. This
 * strips the 4-connected corners and 2-px staircases Zhang–Suen leaves behind
 * so that every remaining two-neighbour pixel has neighbours that are not
 * adjacent to each other — the property the graph walk relies on.
 */
function removeSimplePoints(skeleton: Skeleton): void {
  const { grid, width: w, height: h } = skeleton
  let changed = true
  while (changed) {
    changed = false
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (!grid[i] || neighbourCount(grid, w, i) < 2 || crossingNumber(grid, w, i) !== 1) continue
        grid[i] = 0
        changed = true
      }
    }
  }
}

function neighbourCount(grid: Uint8Array, w: number, i: number): number {
  return (
    grid[i - w - 1]! + grid[i - w]! + grid[i - w + 1]! +
    grid[i - 1]! + grid[i + 1]! +
    grid[i + w - 1]! + grid[i + w]! + grid[i + w + 1]!
  )
}

/**
 * Yokoi's connectivity number for (8, 4) connectivity: the number of distinct
 * 8-connected foreground pieces that meet at the pixel. 1 means the pixel is
 * simple (removable without merging, splitting or perforating anything); 0 is
 * an interior or isolated pixel; ≥ 2 is a bridge or a junction. Indices run
 * counter-clockwise from east over the complemented neighbourhood.
 */
function crossingNumber(grid: Uint8Array, w: number, i: number): number {
  const e = 1 - grid[i + 1]!
  const ne = 1 - grid[i - w + 1]!
  const n = 1 - grid[i - w]!
  const nw = 1 - grid[i - w - 1]!
  const wv = 1 - grid[i - 1]!
  const sw = 1 - grid[i + w - 1]!
  const s = 1 - grid[i + w]!
  const se = 1 - grid[i + w + 1]!
  return (e - e * ne * n) + (n - n * nw * wv) + (wv - wv * sw * s) + (s - s * se * e)
}

// ---------------------------------------------------------------------------
// Graph walk
// ---------------------------------------------------------------------------

function neighbourOffsets(w: number): number[] {
  return [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]
}

/**
 * Split the skeleton into chains. Nodes are pixels whose neighbour count is not
 * 2; from every node each unvisited two-neighbour pixel next to it is followed
 * until the next node. Two adjacent nodes form a chain of their own (the
 * crossbar of an H one pixel long), deduplicated by pair. Whatever
 * two-neighbour pixels remain unvisited afterwards belong to rings.
 */
function walkSkeleton(skeleton: Skeleton): { chains: Chain[]; degree: Uint8Array } {
  const { grid, width: w, height: h } = skeleton
  const n = w * h
  const offsets = neighbourOffsets(w)
  const degree = new Uint8Array(n)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (grid[i]) degree[i] = neighbourCount(grid, w, i)
    }
  }

  const { cluster, hub } = junctionClusters(grid, degree, w, h, offsets)

  const visited = new Uint8Array(n)
  const nodePairs = new Set<number>()
  const chains: Chain[] = []

  for (let i = 0; i < n; i++) {
    if (!grid[i] || degree[i] === 2 || degree[i] === 0) continue
    for (const offset of offsets) {
      const m = i + offset
      if (!grid[m]) continue
      if (degree[m] !== 2) {
        // Two node pixels of the SAME junction are the inside of that
        // junction, not a stroke between two of them. See junctionClusters.
        if (cluster[i] !== 0 && cluster[i] === cluster[m]) continue
        const key = i < m ? i * n + m : m * n + i
        if (nodePairs.has(key)) continue
        nodePairs.add(key)
        chains.push({ pixels: [i, m], closed: false })
        continue
      }
      if (visited[m]) continue
      const pixels = [i]
      let prev = i
      let cur = m
      while (degree[cur] === 2) {
        visited[cur] = 1
        pixels.push(cur)
        const next = otherNeighbour(grid, offsets, cur, prev)
        if (next < 0) break
        prev = cur
        cur = next
      }
      pixels.push(cur)
      // A loop hanging off a junction comes back to where it started; treat it
      // as the ring it is so the curve is smooth through the junction too.
      if (cur === i && pixels.length >= 4) {
        pixels.pop()
        chains.push({ pixels, closed: true })
      } else {
        chains.push({ pixels, closed: false })
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (!grid[i] || degree[i] !== 2 || visited[i]) continue
    const pixels = [i]
    visited[i] = 1
    let prev = i
    let cur = otherNeighbour(grid, offsets, i, -1)
    while (cur >= 0 && cur !== i && !visited[cur]) {
      visited[cur] = 1
      pixels.push(cur)
      const next = otherNeighbour(grid, offsets, cur, prev)
      prev = cur
      cur = next
    }
    chains.push({ pixels, closed: true })
  }

  // Every arm leaving a junction starts at whichever of its pixels happened to
  // touch that arm, so four arms of a cross would begin at four different
  // pixels and stop a pixel short of meeting. Moving each arm's first (or
  // last) pixel to the junction's hub closes that gap, and the crossing comes
  // out as lines that actually cross.
  for (const chain of chains) {
    if (chain.closed || chain.pixels.length < 2) continue
    const first = chain.pixels[0]!
    const last = chain.pixels[chain.pixels.length - 1]!
    if (cluster[first] !== 0) chain.pixels[0] = hub[cluster[first]]!
    if (cluster[last] !== 0) chain.pixels[chain.pixels.length - 1] = hub[cluster[last]]!
  }

  return { chains, degree }
}

/**
 * Junctions, as clusters rather than as single pixels.
 *
 * Where three or more strokes meet, the skeleton does not leave one pixel with
 * three neighbours. Eight-connectivity makes a small clique: at the centre of a
 * plus sign, the middle pixel and all four of its neighbours have four
 * neighbours each, and the four are diagonally adjacent to one another as well.
 * Treating each of those as its own node produced eight two-pixel "strokes"
 * inside the junction on top of the four real arms — a crossing came out as a
 * dozen fragments, all of which somebody would then have to select and delete.
 *
 * So connected runs of node pixels are one node. `cluster` numbers them from 1
 * (0 meaning "not part of any junction"), and `hub` names one representative
 * pixel per cluster: the one nearest the cluster's centre of mass, which is the
 * point the arms should be taken to meet at.
 */
function junctionClusters(
  grid: Uint8Array,
  degree: Uint8Array,
  w: number,
  h: number,
  offsets: readonly number[],
): { cluster: Int32Array; hub: number[] } {
  const cluster = new Int32Array(w * h)
  // Index 0 is the "no cluster" sentinel and never read.
  const hub: number[] = [0]
  const stack: number[] = []

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const start = y * w + x
      if (!grid[start] || degree[start] < 3 || cluster[start] !== 0) continue

      const id = hub.length
      const members: number[] = []
      cluster[start] = id
      stack.push(start)
      while (stack.length) {
        const i = stack.pop()!
        members.push(i)
        for (const offset of offsets) {
          const m = i + offset
          if (grid[m] && degree[m] >= 3 && cluster[m] === 0) {
            cluster[m] = id
            stack.push(m)
          }
        }
      }

      let sumX = 0
      let sumY = 0
      for (const i of members) {
        sumX += i % w
        sumY += Math.floor(i / w)
      }
      const cx = sumX / members.length
      const cy = sumY / members.length
      let best = members[0]!
      let bestDistance = Infinity
      for (const i of members) {
        const d = (i % w - cx) ** 2 + (Math.floor(i / w) - cy) ** 2
        if (d < bestDistance) {
          bestDistance = d
          best = i
        }
      }
      hub.push(best)
    }
  }

  return { cluster, hub }
}

/** The filled neighbour of a two-neighbour pixel that is not `prev`, or −1. */
function otherNeighbour(grid: Uint8Array, offsets: number[], i: number, prev: number): number {
  for (const offset of offsets) {
    const m = i + offset
    if (m !== prev && grid[m]) return m
  }
  return -1
}

/**
 * Cut every endpoint-to-junction chain no longer than the stroke width at its
 * junction. Returns whether anything was cut. The junction pixel itself stays,
 * so the arms that remain still meet.
 */
function pruneSpurs(
  skeleton: Skeleton,
  chains: Chain[],
  degree: Uint8Array,
  halfWidthAt: (i: number) => number,
): boolean {
  let pruned = false
  for (const chain of chains) {
    if (chain.closed) continue
    const first = chain.pixels[0]!
    const last = chain.pixels[chain.pixels.length - 1]!
    let junction: number
    if (degree[first] === 1 && degree[last]! >= 3) junction = last
    else if (degree[last] === 1 && degree[first]! >= 3) junction = first
    else continue
    const limit = Math.max(0, Math.round(2 * halfWidthAt(junction)) - 1)
    if (chain.pixels.length - 1 > limit) continue
    for (const p of chain.pixels) if (p !== junction) skeleton.grid[p] = 0
    pruned = true
  }
  return pruned
}

// ---------------------------------------------------------------------------
// Width
// ---------------------------------------------------------------------------

/**
 * Half the stroke width at a skeleton pixel: its distance to the background,
 * plus the even-width correction described in the file comment.
 */
function halfWidth(skeleton: Skeleton, i: number, edt: Float32Array, imageWidth: number, imageHeight: number): number {
  const gx = i % skeleton.width
  const gy = (i - gx) / skeleton.width
  const x = gx + skeleton.originX
  const y = gy + skeleton.originY
  const here = edt[y * imageWidth + x]!
  const half = here - 0.5
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy
    if (ny < 0 || ny >= imageHeight) continue
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      if (nx < 0 || nx >= imageWidth) continue
      // A filled neighbour off the skeleton that is as deep as we are means
      // the skeleton is running along one side of the true centreline.
      if (edt[ny * imageWidth + nx]! >= here && !skeleton.grid[i + dy * skeleton.width + dx]) {
        return half + 0.5
      }
    }
  }
  return half
}

// ---------------------------------------------------------------------------
// Chain → curve
// ---------------------------------------------------------------------------

function chainToStroke(
  skeleton: Skeleton,
  chain: Chain,
  degree: Uint8Array,
  halfWidthAt: (i: number) => number,
  tolerance: number,
): { curve: Curve; width: number } | null {
  const { pixels, closed } = chain
  if (pixels.length < 2) return null

  const points: Vec2[] = new Array(pixels.length)
  let halfSum = 0
  let halfCount = 0
  for (let k = 0; k < pixels.length; k++) {
    const i = pixels[k]!
    const gx = i % skeleton.width
    const gy = (i - gx) / skeleton.width
    points[k] = { x: gx + skeleton.originX + 0.5, y: gy + skeleton.originY + 0.5 }
    // Junction pixels sit where several strokes overlap and read deeper than
    // any one of them; leave them out of the mean when there is anything else.
    if (degree[i]! < 3 || pixels.length <= 2) {
      halfSum += halfWidthAt(i)
      halfCount++
    }
  }
  if (halfCount === 0) {
    for (const i of pixels) halfSum += halfWidthAt(i)
    halfCount = pixels.length
  }
  const width = Math.max(1, (2 * halfSum) / halfCount)

  const kept = closed ? simplifyClosed(points, tolerance) : simplifyOpen(points, tolerance)
  if (kept.length < 2) return null
  if (closed && kept.length >= 3) return { curve: catmullRomCurve(kept, true), width }
  return { curve: catmullRomCurve(kept, false), width }
}

/** Douglas–Peucker on an open polyline; both ends are always kept. */
function simplifyOpen(points: Vec2[], tolerance: number): Vec2[] {
  const keep = new Uint8Array(points.length)
  simplifyRange(points, 0, points.length - 1, tolerance, keep)
  return points.filter((_, i) => keep[i] === 1)
}

/**
 * Douglas–Peucker on a ring. The ring is cut at its first point and at the
 * point farthest from it, and the two halves simplified as open polylines, so
 * the anchors it always keeps are the two ends of the ring's longest axis.
 */
function simplifyClosed(points: Vec2[], tolerance: number): Vec2[] {
  const n = points.length
  let far = 0
  let farDist = -1
  for (let i = 1; i < n; i++) {
    const dx = points[i]!.x - points[0]!.x
    const dy = points[i]!.y - points[0]!.y
    const d = dx * dx + dy * dy
    if (d > farDist) {
      farDist = d
      far = i
    }
  }
  if (far === 0) return [points[0]!]
  const ring = points.concat([points[0]!])
  const keep = new Uint8Array(ring.length)
  simplifyRange(ring, 0, far, tolerance, keep)
  simplifyRange(ring, far, n, tolerance, keep)
  return points.filter((_, i) => keep[i] === 1)
}

/** Iterative Douglas–Peucker over `points[first..last]`, setting `keep` for survivors. */
function simplifyRange(points: Vec2[], first: number, last: number, tolerance: number, keep: Uint8Array): void {
  keep[first] = 1
  keep[last] = 1
  const stack: number[] = [first, last]
  while (stack.length > 0) {
    const b = stack.pop()!
    const a = stack.pop()!
    if (b - a < 2) continue
    let farthest = -1
    let maxDist = -1
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentDistance(points[i]!, points[a]!, points[b]!)
      if (d > maxDist) {
        maxDist = d
        farthest = i
      }
    }
    if (maxDist > tolerance) {
      keep[farthest] = 1
      stack.push(a, farthest, farthest, b)
    }
  }
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = 0
  if (len2 > 0) t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  const ex = p.x - (a.x + t * dx)
  const ey = p.y - (a.y + t * dy)
  return Math.sqrt(ex * ex + ey * ey)
}

/**
 * Uniform Catmull–Rom through every point, as cubic Beziers. With tension ½
 * the tangent at Pᵢ is (Pᵢ₊₁ − Pᵢ₋₁)/2 and the Bezier control lies a third of
 * the way along it, hence the /6. Open curves repeat their end points as the
 * missing neighbours; closed ones wrap around.
 */
function catmullRomCurve(points: Vec2[], closed: boolean): Curve {
  const n = points.length
  if (n === 2) {
    return { start: points[0]!, segments: [{ kind: 'line', end: points[1]! }], closed: false }
  }
  const at = (i: number): Vec2 => (closed ? points[((i % n) + n) % n]! : points[Math.min(n - 1, Math.max(0, i))]!)
  const segments: Segment[] = []
  const count = closed ? n : n - 1
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    segments.push({
      kind: 'curve',
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      end: p2,
    })
  }
  return { start: points[0]!, segments, closed }
}
