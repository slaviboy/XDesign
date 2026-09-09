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
 * Image Trace, first stage: reduce the picture to a few flat colours.
 *
 * Every later stage traces regions, and a region only exists once neighbouring
 * pixels share an exact colour. A photograph has none: a smooth gradient is a
 * hundred thousand distinct colours and would trace to a hundred thousand
 * single-pixel shapes. So the tracer starts by choosing a small palette and
 * snapping every pixel to it. The size of that palette is the single biggest
 * influence on the result — it is the number of layers the tracer will produce.
 *
 * Alpha goes first. A traced path has one flat fill and no notion of partial
 * coverage, so translucency has to be resolved into a colour before anything
 * else looks at a pixel, and it is resolved against white because white is what
 * the rest of the panel assumes (the black-and-white threshold, Ignore White,
 * the page the artwork lands on). A pixel that is more transparent than not is
 * taken as white outright rather than composited: the anti-aliased fringe of a
 * cut-out would otherwise become a pale colour layer of its own, a halo traced
 * around every shape.
 *
 * The palette is built by median cut and then refined once by k-means.
 *
 *   Median cut treats the sampled pixels as one box in RGB space and repeatedly
 *   splits the box with the widest channel, at the MEDIAN of that channel. The
 *   median is what makes it worth using over a uniform grid: each split halves
 *   the pixels rather than the volume, so a colour covering half the picture
 *   earns palette entries and a bright speck does not. Splitting stops at the
 *   target count or when no box holds more than one colour, which is why an
 *   image with three colours yields three entries no matter what was asked for.
 *
 *   The box means that fall out of median cut are a decent palette but not a
 *   local optimum — a pixel near a box edge is often closer to the neighbouring
 *   box's mean. One k-means pass (reassign every sample to its nearest entry,
 *   recompute each entry as the mean of what it got) fixes most of that for one
 *   extra scan. Further passes move the entries very little on real images and
 *   cost a full scan each, so there is exactly one.
 *
 * Determinism is a requirement, not a nicety: the panel re-traces on every
 * slider drag, and a palette that reshuffled between two identical runs would
 * make the preview flicker and the layer order jump. Nothing here uses
 * Math.random — the sample is a fixed stride, and every tie (which box to
 * split, where to split it, which of two equidistant entries a pixel joins)
 * resolves to the lowest index.
 *
 * The finished palette is sorted by pixel count, most common first. The
 * orchestrator paints layers in that order — the biggest region first, at the
 * bottom — and reads entry 0 as the background.
 *
 * Black-and-white mode is the one exception to all of the above: its palette is
 * fixed at black then white, unsorted, so callers can rely on index 0 being the
 * ink and index 1 the paper.
 */

import type { RGBA } from '../document/types'
import type { Quantized, RasterData, TraceOptions } from './types'

/** Only the controls that shape the palette; the rest of TraceOptions is for later stages. */
type QuantizeOptions = Pick<TraceOptions, 'mode' | 'palette' | 'colors' | 'threshold'>

/** Ignore White's test: this bright and this close to neutral. */
const NEAR_WHITE_LUMINANCE = 245
const NEAR_WHITE_SPREAD = 20

/** Palette indices are bytes — Quantized.indices is a Uint8Array. */
const MAX_PALETTE = 256

/**
 * Pixels the palette is built from. A quarter of a megapixel is far more than
 * median cut needs to find the colours of an image, and it bounds the cost of
 * the k-means pass on a photograph. Every pixel is still assigned an index.
 */
const MAX_SAMPLE = 262144

/** At or below this alpha a pixel is white outright rather than composited. */
const MOSTLY_TRANSPARENT = 128

/** Rec.601 luma. Perceived brightness, which is what the bw threshold means. */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Is this colour white enough for Ignore White to drop it? Bright AND close to
 * neutral: a paper-grey scan background counts, a pale yellow highlight does
 * not — dropping that one would punch a hole through the artwork. Alpha is not
 * consulted; palette entries are opaque by the time anything asks.
 */
export function isNearWhite(color: RGBA): boolean {
  if (luminance(color.r, color.g, color.b) < NEAR_WHITE_LUMINANCE) return false
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) <= NEAR_WHITE_SPREAD
}

/**
 * The palette and the per-pixel index map for one raster.
 *
 * `mode` decides what is quantised (the colours, their luminance, or nothing at
 * all in bw), `palette` and `colors` decide how many entries come out, and
 * `threshold` applies to bw only.
 */
export function quantize(raster: RasterData, options: QuantizeOptions): Quantized {
  const { width, height } = raster
  const count = width * height
  // An image with no pixels has no colours. Every other input gets at least one
  // palette entry, so downstream code can treat an empty palette as "nothing to
  // trace" rather than as a failure.
  if (!(count > 0)) return { palette: [], indices: new Uint8Array(0), width, height }

  const rgb = compositeOnWhite(raster, count)
  if (options.mode === 'grayscale') flattenToGray(rgb)
  if (options.mode === 'bw') return blackAndWhite(rgb, width, height, options.threshold)

  return assign(rgb, width, height, buildPalette(rgb, width, options))
}

// ---------------------------------------------------------------------------
// Pixels in
// ---------------------------------------------------------------------------

/**
 * RGBA to opaque RGB, three bytes per pixel, resolved against a white page.
 *
 * Dropping the alpha channel here rather than carrying it along means every
 * later loop reads three contiguous bytes and no stage has to decide again what
 * a half-transparent pixel means.
 */
function compositeOnWhite(raster: RasterData, count: number): Uint8Array {
  const src = raster.data
  const out = new Uint8Array(count * 3)
  const available = Math.min(count, src.length >> 2)
  // A buffer shorter than width*height leaves the tail white rather than black:
  // missing pixels should look like blank page to the tracer, not like ink.
  if (available < count) out.fill(255, available * 3)

  for (let i = 0; i < available; i++) {
    const s = i * 4
    const d = i * 3
    const alpha = src[s + 3]
    if (alpha >= 255) {
      out[d] = src[s]
      out[d + 1] = src[s + 1]
      out[d + 2] = src[s + 2]
    } else if (alpha < MOSTLY_TRANSPARENT) {
      out[d] = 255
      out[d + 1] = 255
      out[d + 2] = 255
    } else {
      const f = alpha / 255
      const page = 255 * (1 - f)
      out[d] = Math.round(src[s] * f + page)
      out[d + 1] = Math.round(src[s + 1] * f + page)
      out[d + 2] = Math.round(src[s + 2] * f + page)
    }
  }
  return out
}

/** Grayscale mode: every pixel becomes its own brightness, in place. */
function flattenToGray(rgb: Uint8Array): void {
  for (let d = 0; d < rgb.length; d += 3) {
    const y = Math.round(luminance(rgb[d], rgb[d + 1], rgb[d + 2]))
    rgb[d] = y
    rgb[d + 1] = y
    rgb[d + 2] = y
  }
}

/**
 * Black-and-white mode. No palette search at all: one comparison per pixel
 * against the panel's threshold, and a fixed two-entry palette in a fixed order
 * — black is always index 0 even for a picture that is mostly ink, because the
 * caller's Ignore White and its layer naming both depend on knowing which is
 * which.
 */
function blackAndWhite(rgb: Uint8Array, width: number, height: number, threshold: number): Quantized {
  const limit = clamp(threshold, 0, 255)
  const count = width * height
  const indices = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const d = i * 3
    indices[i] = luminance(rgb[d], rgb[d + 1], rgb[d + 2]) <= limit ? 0 : 1
  }
  return { palette: [rgba(0, 0, 0), rgba(255, 255, 255)], indices, width, height }
}

// ---------------------------------------------------------------------------
// Choosing the palette
// ---------------------------------------------------------------------------

/** Palette entries as a flat [r, g, b, r, g, b, ...] of 0..255 values. */
function buildPalette(rgb: Uint8Array, width: number, options: QuantizeOptions): Int32Array {
  const sample = sampleColors(rgb, width)
  const refined = refine(sample, medianCut(sample, targetColorCount(options)))
  // Automatic accuracy is the only mode that merges: its slider is "how far
  // apart must two colours be to stay apart", which median cut cannot express
  // because it splits by pixel count, not by distance.
  if (options.palette !== 'automatic') return refined.centres
  return mergeNeighbours(refined.centres, refined.counts, mergeDistance(options.colors))
}

/**
 * How many entries to aim for, from the panel's two-field colour control.
 *
 *   limited   — an exact count the user typed, 2..30.
 *   automatic — accuracy 1..100, squared so the low half of the slider stays in
 *               the handful-of-colours range where flat artwork lives.
 *   full-tone — accuracy 1..100 over the photographic range, up to the 256 an
 *               index byte can address.
 */
function targetColorCount(options: QuantizeOptions): number {
  if (options.palette === 'limited') return clamp(Math.round(options.colors), 2, 30)
  const accuracy = clamp(options.colors, 1, 100) / 100
  if (options.palette === 'full-tone') {
    return Math.min(MAX_PALETTE, Math.round(8 + 248 * Math.pow(accuracy, 1.5)))
  }
  return Math.round(2 + 30 * accuracy * accuracy)
}

/**
 * Automatic mode's merge radius in RGB Euclidean distance: 12 at full accuracy
 * (only all-but-identical colours collapse) rising to 72 at the bottom of the
 * slider, where a scan's paper, its shadow and its yellowing all become one.
 */
function mergeDistance(colors: number): number {
  return 12 + 60 * (1 - clamp(colors, 1, 100) / 100)
}

/**
 * The pixels the palette is chosen from — the whole buffer when the image is
 * small enough, otherwise every nth pixel.
 *
 * The stride is nudged off any divisor of the row width. A stride that divides
 * the width lands on the same few columns in every row, which on a striped or
 * dithered image samples one phase of the pattern and misses the others
 * entirely; a stride coprime with the width walks across the picture instead.
 *
 * The small case returns the caller's buffer rather than a copy: nothing here
 * writes to the sample — median cut sorts an index array beside it — so the
 * copy would only cost a megabyte and a pass.
 */
function sampleColors(rgb: Uint8Array, width: number): Uint8Array {
  const count = rgb.length / 3
  if (count <= MAX_SAMPLE) return rgb

  let stride = Math.ceil(count / MAX_SAMPLE)
  if (width % stride === 0) stride++
  const taken = Math.ceil(count / stride)
  const out = new Uint8Array(taken * 3)
  for (let i = 0, s = 0; i < taken; i++, s += stride) {
    const d = i * 3
    const p = s * 3
    out[d] = rgb[p]
    out[d + 1] = rgb[p + 1]
    out[d + 2] = rgb[p + 2]
  }
  return out
}

/**
 * A run of sampled pixels that share a box in RGB space. `start` and `end` are
 * a range in the order array, not in the sample itself: the pixels of a box are
 * kept contiguous by sorting that index array, so splitting a box costs no
 * allocation and boxes never copy colours around.
 */
interface ColorBox {
  start: number
  end: number
  /** The widest channel (0 = r, 1 = g, 2 = b) and its spread — where the next split goes. */
  axis: number
  range: number
}

/**
 * Median cut: split the widest box at the median of its widest channel until
 * there are `target` boxes or nothing left to split, then take each box's mean
 * colour.
 *
 * "Widest" is measured in raw channel units rather than anything perceptual,
 * which is the classic formulation and matches the merge distance the automatic
 * palette is specified in.
 */
function medianCut(sample: Uint8Array, target: number): Int32Array {
  const total = sample.length / 3
  const order = new Int32Array(total)
  for (let i = 0; i < total; i++) order[i] = i
  const scratch = new Int32Array(total)
  const histogram = new Int32Array(256)

  const boxes: ColorBox[] = [makeBox(sample, order, 0, total)]
  while (boxes.length < target) {
    // The widest box goes first, so the palette is spent where colours are most
    // spread out. A tie takes the earlier box, which keeps the run repeatable.
    let widest = 0
    let pick = -1
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].range > widest) {
        widest = boxes[i].range
        pick = i
      }
    }
    // Every remaining box holds a single colour: the image has fewer distinct
    // colours than were asked for, and that is the whole palette.
    if (pick < 0) break

    const box = boxes[pick]
    const at = splitBox(sample, order, scratch, histogram, box)
    boxes[pick] = makeBox(sample, order, box.start, at)
    boxes.push(makeBox(sample, order, at, box.end))
  }

  return boxMeans(sample, order, boxes)
}

/** The bounding box of a range of samples, and the channel to split it on. */
function makeBox(sample: Uint8Array, order: Int32Array, start: number, end: number): ColorBox {
  let minR = 255
  let minG = 255
  let minB = 255
  let maxR = 0
  let maxG = 0
  let maxB = 0
  for (let i = start; i < end; i++) {
    const d = order[i] * 3
    const r = sample[d]
    const g = sample[d + 1]
    const b = sample[d + 2]
    if (r < minR) minR = r
    if (r > maxR) maxR = r
    if (g < minG) minG = g
    if (g > maxG) maxG = g
    if (b < minB) minB = b
    if (b > maxB) maxB = b
  }

  let axis = 0
  let range = maxR - minR
  if (maxG - minG > range) {
    axis = 1
    range = maxG - minG
  }
  if (maxB - minB > range) {
    axis = 2
    range = maxB - minB
  }
  // A single-colour box has range 0 and is never picked for a split again.
  return { start, end, axis, range: range > 0 ? range : 0 }
}

/**
 * Sorts a box's samples by its split channel and returns the index the box
 * breaks at, so that [start, at) and [at, end) are both non-empty.
 *
 * The sort is a counting sort: channel values are bytes, so 256 buckets order
 * any box in one pass, which is what keeps the whole of median cut linear per
 * level instead of n log n. It is stable, so equal colours keep their original
 * order and two identical runs split identically.
 *
 * The cut goes at whichever value boundary sits closest to the halfway point —
 * a boundary, not the halfway index itself, because pixels of one colour cannot
 * be divided between two boxes. A box with a spread has at least two distinct
 * values and therefore at least one usable boundary.
 */
function splitBox(
  sample: Uint8Array,
  order: Int32Array,
  scratch: Int32Array,
  histogram: Int32Array,
  box: ColorBox,
): number {
  const { start, end, axis } = box
  const count = end - start
  histogram.fill(0)
  for (let i = start; i < end; i++) histogram[sample[order[i] * 3 + axis]]++

  const half = count / 2
  let split = -1
  let closest = Infinity
  let seen = 0
  for (let value = 0; value < 256; value++) {
    seen += histogram[value]
    if (seen <= 0 || seen >= count) continue
    const delta = Math.abs(seen - half)
    if (delta < closest) {
      closest = delta
      split = seen
    }
  }

  // Turn the histogram into bucket offsets, scatter, and copy the ordered run
  // back over the range it came from.
  let offset = start
  for (let value = 0; value < 256; value++) {
    const bucket = histogram[value]
    histogram[value] = offset
    offset += bucket
  }
  for (let i = start; i < end; i++) {
    const p = order[i]
    scratch[histogram[sample[p * 3 + axis]]++] = p
  }
  order.set(scratch.subarray(start, end), start)

  return start + split
}

/** Each box's mean colour, rounded — the palette median cut proposes. */
function boxMeans(sample: Uint8Array, order: Int32Array, boxes: readonly ColorBox[]): Int32Array {
  const centres = new Int32Array(boxes.length * 3)
  for (let j = 0; j < boxes.length; j++) {
    const { start, end } = boxes[j]
    let sumR = 0
    let sumG = 0
    let sumB = 0
    for (let i = start; i < end; i++) {
      const d = order[i] * 3
      sumR += sample[d]
      sumG += sample[d + 1]
      sumB += sample[d + 2]
    }
    const n = Math.max(1, end - start)
    const c = j * 3
    centres[c] = Math.round(sumR / n)
    centres[c + 1] = Math.round(sumG / n)
    centres[c + 2] = Math.round(sumB / n)
  }
  return centres
}

/**
 * One k-means pass over the sample: every pixel joins its nearest entry, then
 * every entry becomes the mean of the pixels that joined it.
 *
 * An entry that attracts nothing keeps its median-cut colour instead of being
 * dropped. Dropping it here would shrink a "limited to 8 colours" palette to
 * seven over a rounding accident; if it really is unused it disappears later,
 * when the full image — not just the sample — has voted.
 *
 * The counts come back with the centres because the automatic palette's merge
 * weighs entries by how many pixels they hold.
 */
function refine(sample: Uint8Array, centres: Int32Array): { centres: Int32Array; counts: Int32Array } {
  const k = centres.length / 3
  const total = sample.length / 3
  const nearest = buildNearest(centres, k)
  const sums = new Float64Array(k * 3)
  const counts = new Int32Array(k)

  for (let i = 0; i < total; i++) {
    const d = i * 3
    const j = nearest(sample[d], sample[d + 1], sample[d + 2])
    const c = j * 3
    sums[c] += sample[d]
    sums[c + 1] += sample[d + 1]
    sums[c + 2] += sample[d + 2]
    counts[j]++
  }

  const next = new Int32Array(k * 3)
  for (let j = 0; j < k; j++) {
    const c = j * 3
    if (counts[j] === 0) {
      next[c] = centres[c]
      next[c + 1] = centres[c + 1]
      next[c + 2] = centres[c + 2]
      continue
    }
    next[c] = Math.round(sums[c] / counts[j])
    next[c + 1] = Math.round(sums[c + 1] / counts[j])
    next[c + 2] = Math.round(sums[c + 2] / counts[j])
  }
  return { centres: next, counts }
}

/**
 * Automatic mode's merge: repeatedly join the closest pair of palette entries
 * while they are nearer than `maxDistance`.
 *
 * Closest pair first rather than a single sweep, because merging changes the
 * distances — two colours either side of a third only collapse together once
 * that third has absorbed one of them. The merged colour is the pixel-count
 * weighted mean, so folding a speck into a large region barely moves it, which
 * is the point: the region's own colour is the one the eye is looking at.
 *
 * At most 30-odd entries reach here (automatic's target caps at 32), so the
 * quadratic scan per merge is nothing.
 */
function mergeNeighbours(centres: Int32Array, counts: Int32Array, maxDistance: number): Int32Array {
  const limit = maxDistance * maxDistance
  const entries: Array<{ r: number; g: number; b: number; n: number }> = []
  for (let j = 0; j < counts.length; j++) {
    const c = j * 3
    entries.push({ r: centres[c], g: centres[c + 1], b: centres[c + 2], n: counts[j] })
  }

  for (;;) {
    let closest = Infinity
    let first = -1
    let second = -1
    for (let a = 0; a < entries.length; a++) {
      for (let b = a + 1; b < entries.length; b++) {
        const dr = entries[a].r - entries[b].r
        const dg = entries[a].g - entries[b].g
        const db = entries[a].b - entries[b].b
        const d = dr * dr + dg * dg + db * db
        if (d < closest) {
          closest = d
          first = a
          second = b
        }
      }
    }
    if (first < 0 || closest > limit) break

    const a = entries[first]
    const b = entries[second]
    const total = a.n + b.n
    // Unweighted when neither entry drew a sampled pixel, which only happens to
    // an entry k-means left untouched.
    const mix = (ca: number, cb: number): number =>
      total > 0 ? Math.round((ca * a.n + cb * b.n) / total) : Math.round((ca + cb) / 2)
    a.r = mix(a.r, b.r)
    a.g = mix(a.g, b.g)
    a.b = mix(a.b, b.b)
    a.n = total
    entries.splice(second, 1)
  }

  const merged = new Int32Array(entries.length * 3)
  for (let j = 0; j < entries.length; j++) {
    const c = j * 3
    merged[c] = entries[j].r
    merged[c + 1] = entries[j].g
    merged[c + 2] = entries[j].b
  }
  return merged
}

// ---------------------------------------------------------------------------
// Assigning every pixel
// ---------------------------------------------------------------------------

/**
 * Nearest palette entry to a colour — exactly, without touching every entry.
 *
 * This runs once per pixel against up to 256 entries, which makes it the most
 * expensive loop in the tracer if it is written as a plain scan. Sorting the
 * entries along their widest channel turns it into a search: binary search to
 * the entry nearest on that channel, then walk outwards and stop as soon as the
 * difference on that channel ALONE exceeds the best full distance found. The
 * prune is exact, because one channel's difference is a lower bound on the
 * distance, so this returns what a full scan would; a k-d tree would prune a
 * little harder and cost far more to build for 256 points.
 *
 * Equal distances go to the lower palette index, so the answer does not depend
 * on the sort order.
 */
function buildNearest(centres: Int32Array, k: number): (r: number, g: number, b: number) => number {
  let axis = 0
  let widest = -1
  for (let channel = 0; channel < 3; channel++) {
    let min = 255
    let max = 0
    for (let j = 0; j < k; j++) {
      const value = centres[j * 3 + channel]
      if (value < min) min = value
      if (value > max) max = value
    }
    if (max - min > widest) {
      widest = max - min
      axis = channel
    }
  }

  const sorted = Array.from({ length: k }, (_, j) => j)
  sorted.sort((a, b) => centres[a * 3 + axis] - centres[b * 3 + axis] || a - b)
  const keys = new Int32Array(k)
  const entry = new Int32Array(k)
  for (let i = 0; i < k; i++) {
    entry[i] = sorted[i]
    keys[i] = centres[sorted[i] * 3 + axis]
  }

  return (r: number, g: number, b: number): number => {
    const q = axis === 0 ? r : axis === 1 ? g : b
    let lo = 0
    let hi = k
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (keys[mid] < q) lo = mid + 1
      else hi = mid
    }

    let best = Infinity
    let bestEntry = 0
    // Outwards from the insertion point in both directions. The break is on a
    // strict >, so entries tied on the axis are all still examined and the
    // lowest index among equals wins.
    for (let i = lo; i < k; i++) {
      const along = keys[i] - q
      if (along * along > best) break
      const j = entry[i]
      const d = squaredDistance(centres, j, r, g, b)
      if (d < best || (d === best && j < bestEntry)) {
        best = d
        bestEntry = j
      }
    }
    for (let i = lo - 1; i >= 0; i--) {
      const along = q - keys[i]
      if (along * along > best) break
      const j = entry[i]
      const d = squaredDistance(centres, j, r, g, b)
      if (d < best || (d === best && j < bestEntry)) {
        best = d
        bestEntry = j
      }
    }
    return bestEntry
  }
}

/** Plain RGB Euclidean, squared — the metric the merge distance is stated in. */
function squaredDistance(centres: Int32Array, index: number, r: number, g: number, b: number): number {
  const c = index * 3
  const dr = centres[c] - r
  const dg = centres[c + 1] - g
  const db = centres[c + 2] - b
  return dr * dr + dg * dg + db * db
}

/**
 * Every pixel gets the index of its nearest palette entry, and the palette is
 * then reordered by how many pixels chose it.
 *
 * Entries nothing chose are dropped here rather than earlier: only the full
 * image can say an entry is unused, and an unused entry would become an empty
 * layer with a colour in the panel's swatch list and no pixels behind it.
 * Because those entries hold no pixels, dropping them changes no assignment.
 *
 * The palette cannot come out empty: the image has pixels, every pixel picks an
 * entry, and so at least one entry has a count.
 */
function assign(rgb: Uint8Array, width: number, height: number, centres: Int32Array): Quantized {
  const k = centres.length / 3
  const nearest = buildNearest(centres, k)
  const count = width * height
  const indices = new Uint8Array(count)
  const counts = new Int32Array(k)

  for (let i = 0; i < count; i++) {
    const d = i * 3
    const j = nearest(rgb[d], rgb[d + 1], rgb[d + 2])
    indices[i] = j
    counts[j]++
  }

  const used: number[] = []
  for (let j = 0; j < k; j++) {
    if (counts[j] > 0) used.push(j)
  }
  used.sort((a, b) => counts[b] - counts[a] || a - b)

  const remap = new Uint8Array(k)
  used.forEach((j, position) => {
    remap[j] = position
  })
  for (let i = 0; i < count; i++) indices[i] = remap[indices[i]]

  const palette = used.map((j) => rgba(centres[j * 3], centres[j * 3 + 1], centres[j * 3 + 2]))
  return { palette, indices, width, height }
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function rgba(r: number, g: number, b: number): RGBA {
  return { r, g, b, a: 1 }
}

/** Clamp that also answers `min` for a NaN, so a malformed option never leaks into a loop bound. */
function clamp(value: number, min: number, max: number): number {
  if (!(value > min)) return min
  return value < max ? value : max
}
