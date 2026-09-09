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
 * Image Trace: the whole pipeline, from pixels to paths.
 *
 * The stages each live in their own module and each is a pure function; this
 * is the file that decides what to feed them and in what order, which is where
 * the panel's settings actually become decisions:
 *
 *   1. reduce  — an image too large to trace interactively is box-filtered
 *                down, and every coordinate is scaled back up at the end, so
 *                the caller always gets source-pixel coordinates.
 *   2. quantize— the palette, and one index per pixel.
 *   3. layers  — one bitmap per palette entry, in paint order.
 *   4. strokes — thin runs lifted out as centrelines before anything else
 *                sees them, so a pen line becomes one stroked path instead of
 *                a long thin outline drawn around it.
 *   5. fills   — decompose, optimal polygon, adjusted vertices, smoothed
 *                curves, one path per region with its holes as subpaths.
 *
 * Paint order is by area, largest first. It is not a cosmetic choice: the
 * biggest region is nearly always the background, and painting it first means
 * everything else lands on top of it in the group the commit builds — which is
 * also what makes `overlapping` work, since a region drawn earlier is the one
 * that gets extended underneath its neighbours.
 */

import { quantize } from './quantize'
import { layerBitmap, unionLayers, countFilled } from './bitmap'
import { decompose } from './decompose'
import { optimalPolygon, adjustVertices } from './polygon'
import { smoothPolygon, curveAnchorCount } from './smooth'
import { extractCenterlines } from './centerline'
import { curveToPathData, curvesToPathData } from './render'
import { simplifyCurve } from './simplify'
import { isNearWhite } from './quantize'
import type {
  Curve, PixelPath, RasterData, TraceOptions, TraceResult, TracedPath, Vec2,
} from './types'
import type { RGBA } from '../document/types'

/**
 * The most pixels the tracer will look at.
 *
 * Above this an image is reduced first. Two megapixels is already more detail
 * than any trace can use — the shapes it finds are bounded by the palette, not
 * by the resolution — and it is the point past which a single trace stops
 * being fast enough to sit behind a slider.
 */
export const TRACE_MAX_PIXELS = 2_000_000

/** How often the cancellation flag is consulted inside the fill loop. */
const CANCEL_CHECK_INTERVAL = 32

// ---------------------------------------------------------------------------
// The panel's sliders, as the algorithm's parameters
// ---------------------------------------------------------------------------

export interface TraceParameters {
  alphaMax: number
  optTolerance: number
  snapToLines: number
  turdSize: number
}

/**
 * Corners and Paths are percentages in the panel and thresholds in potrace, and
 * the mapping between them is where "75 feels right" is encoded.
 *
 * Corners runs 0..100 onto alphamax 1.3334..0, but not linearly: potrace's
 * useful range is 0.6..1.34 and its own default is 1.0, so 0..75 covers the
 * whole gentle end and lands exactly on 1.0 at the panel's default, while
 * 75..100 continues down to 0, where every vertex becomes a corner and the
 * result is the polygon itself.
 *
 * Paths runs the other way: 100 is maximum fidelity, which means NO curve
 * optimisation at all (tolerance 0), and 50 is potrace's own default of 0.2.
 * Below 50 the tolerance grows to 1.0, merging long runs of curves into single
 * segments — fewer anchors, looser fit.
 */
export function traceParameters(options: TraceOptions): TraceParameters {
  const corners = clamp(options.corners, 0, 100)
  const paths = clamp(options.paths, 0, 100)
  return {
    alphaMax: corners <= 75 ? 1.3334 - 0.3334 * (corners / 75) : (100 - corners) / 25,
    optTolerance: paths >= 50 ? 0.2 * ((100 - paths) / 50) : 0.2 + 0.8 * ((50 - paths) / 50),
    snapToLines: options.snapToLines ? 0.35 : 0,
    turdSize: Math.round(clamp(options.noise, 1, 100)),
  }
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Trace a raster into paths.
 *
 * @param isCancelled polled between layers and every few paths. When it turns
 *   true the trace returns what it has so far rather than throwing: the caller
 *   is a preview that is about to be replaced, and a partial result costs
 *   nothing to discard.
 */
export function traceImage(
  raster: RasterData,
  options: TraceOptions,
  isCancelled?: () => boolean,
): TraceResult {
  const empty: TraceResult = {
    paths: [],
    colorCount: 0,
    anchorCount: 0,
    width: raster.width,
    height: raster.height,
  }
  if (raster.width < 1 || raster.height < 1 || raster.data.length < 4) return empty

  const { source, factor } = reduce(raster)
  const params = traceParameters(options)
  const quantized = quantize(source, options)
  if (quantized.palette.length === 0) return empty

  // Pixel counts decide paint order, and whether a layer is worth tracing.
  const counts = new Array<number>(quantized.palette.length).fill(0)
  for (let i = 0; i < quantized.indices.length; i++) counts[quantized.indices[i]!]!++

  const order: number[] = []
  for (let i = 0; i < quantized.palette.length; i++) {
    if (counts[i]! === 0) continue
    if (options.ignoreWhite && isNearWhite(quantized.palette[i]!)) continue
    order.push(i)
  }
  order.sort((a, b) => counts[b]! - counts[a]!)

  const paths: TracedPath[] = []
  const colors = new Set<string>()
  let anchors = 0

  for (let rank = 0; rank < order.length; rank++) {
    if (isCancelled?.()) break
    const index = order[rank]!
    const color = quantized.palette[index]!

    // Abutting traces each colour exactly; overlapping extends this region
    // under everything painted after it, so no seam can show between them.
    const bitmap =
      options.method === 'overlapping'
        ? unionLayers(quantized, order.slice(rank))
        : layerBitmap(quantized, index)

    let fillSource = bitmap
    if (options.strokes) {
      const centrelines = extractCenterlines(
        bitmap,
        Math.max(1, options.strokeWidth),
        Math.max(0.3, params.optTolerance),
      )
      for (const stroke of centrelines.strokes) {
        const curve = simplifyCurve(stroke.curve)
        const d = curveToPathData(curve, (p) => scalePoint(p, factor))
        if (!d) continue
        const count = curveAnchorCount(curve)
        paths.push({
          d,
          fill: null,
          stroke: { ...color },
          strokeWidth: stroke.width * factor,
          anchors: count,
        })
        anchors += count
        colors.add(colorKey(color))
      }
      fillSource = centrelines.remaining
    }

    if (!options.fills || countFilled(fillSource) === 0) continue

    for (const traced of tracedFills(fillSource, color, params, factor, isCancelled)) {
      paths.push(traced)
      anchors += traced.anchors
      colors.add(colorKey(color))
    }
  }

  return {
    paths,
    colorCount: colors.size,
    anchorCount: anchors,
    width: raster.width,
    height: raster.height,
  }
}

/**
 * One layer's filled regions, each with its holes.
 *
 * A hole is a separate boundary from the decomposition, wound the other way.
 * It is attached as a subpath of the smallest region that contains it, so one
 * path with the nonzero rule renders the hole empty — rather than being emitted
 * as its own shape, which would paint the hole in whatever colour came next.
 */
function tracedFills(
  bitmap: Parameters<typeof decompose>[0],
  color: RGBA,
  params: TraceParameters,
  factor: number,
  isCancelled?: () => boolean,
): TracedPath[] {
  const pixelPaths = decompose(bitmap, params.turdSize)
  if (pixelPaths.length === 0) return []

  const smooth = { alphaMax: params.alphaMax, optTolerance: params.optTolerance, snapToLines: params.snapToLines }
  const curves: Array<{ path: PixelPath; curve: Curve }> = []
  for (let i = 0; i < pixelPaths.length; i++) {
    if (i % CANCEL_CHECK_INTERVAL === 0 && isCancelled?.()) break
    const path = pixelPaths[i]!
    const polygon = optimalPolygon(path)
    if (polygon.length < 3) continue
    // Simplified here rather than inside smoothPolygon: the fitting is
    // potrace's and stays that way; dropping the redundant midpoints it leaves
    // on straight runs is a separate decision about what an editable path
    // should look like. See simplify.ts.
    const fitted = smoothPolygon(adjustVertices(path, polygon), smooth)
    curves.push({ path, curve: simplifyCurve(fitted) })
  }

  // Outers largest first, so a hole finds the SMALLEST container by scanning
  // backwards — which is what nesting three deep requires.
  const outers = curves.filter((c) => c.path.sign === 1).sort((a, b) => b.path.area - a.path.area)
  const holes = curves.filter((c) => c.path.sign === -1)
  if (outers.length === 0) return []

  const subpaths = outers.map((o) => [o.curve])
  for (const hole of holes) {
    const point = firstPoint(hole.path)
    for (let i = outers.length - 1; i >= 0; i--) {
      if (containsPoint(outers[i]!.path, point)) {
        subpaths[i]!.push(hole.curve)
        break
      }
    }
    // A hole with no container cannot happen for a well-formed decomposition,
    // and dropping it is right if it ever does: attaching it to the wrong
    // shape would punch a hole somewhere the picture has none.
  }

  const scale = (p: Vec2) => scalePoint(p, factor)
  const result: TracedPath[] = []
  for (const group of subpaths) {
    const d = curvesToPathData(group, scale)
    if (!d) continue
    result.push({
      d,
      fill: { ...color },
      stroke: null,
      strokeWidth: 0,
      anchors: group.reduce((n, c) => n + curveAnchorCount(c), 0),
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Reduction
// ---------------------------------------------------------------------------

/**
 * Box-filter an oversized image down to something traceable.
 *
 * The factor is an integer so each output pixel is the mean of a whole n×n
 * block: a fractional resample would need interpolation, and interpolation
 * along a colour boundary invents colours that are in neither region — which
 * the quantiser would then faithfully give a palette entry of its own.
 */
function reduce(raster: RasterData): { source: RasterData; factor: number } {
  const pixels = raster.width * raster.height
  if (pixels <= TRACE_MAX_PIXELS) return { source: raster, factor: 1 }

  const factor = Math.ceil(Math.sqrt(pixels / TRACE_MAX_PIXELS))
  const width = Math.max(1, Math.floor(raster.width / factor))
  const height = Math.max(1, Math.floor(raster.height / factor))
  const data = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0
      const y1 = Math.min(raster.height, (y + 1) * factor)
      const x1 = Math.min(raster.width, (x + 1) * factor)
      for (let sy = y * factor; sy < y1; sy++) {
        for (let sx = x * factor; sx < x1; sx++) {
          const i = (sy * raster.width + sx) * 4
          r += raster.data[i]!
          g += raster.data[i + 1]!
          b += raster.data[i + 2]!
          a += raster.data[i + 3]!
          n++
        }
      }
      const o = (y * width + x) * 4
      data[o] = r / n
      data[o + 1] = g / n
      data[o + 2] = b / n
      data[o + 3] = a / n
    }
  }
  return { source: { width, height, data }, factor }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scalePoint(p: Vec2, factor: number): Vec2 {
  return factor === 1 ? p : { x: p.x * factor, y: p.y * factor }
}

function firstPoint(path: PixelPath): Vec2 {
  return { x: path.points[0]!, y: path.points[1]! }
}

/**
 * Is `point` inside this pixel-grid boundary?
 *
 * The crossing-number rule over the boundary's own unit segments. It is exact
 * here in a way it would not be for a general polygon: every vertex is an
 * integer and the point being tested is a vertex of some other boundary, so
 * the half-pixel offset below can never land on an edge.
 */
function containsPoint(path: PixelPath, point: Vec2): boolean {
  const pts = path.points
  const n = pts.length / 2
  const px = point.x + 0.5
  const py = point.y + 0.5
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2]!, yi = pts[i * 2 + 1]!
    const xj = pts[j * 2]!, yj = pts[j * 2 + 1]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function colorKey(c: RGBA): string {
  return `${c.r},${c.g},${c.b},${c.a}`
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo
  return Math.min(hi, Math.max(lo, value))
}
