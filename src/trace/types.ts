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
 * Image Trace: the shared vocabulary.
 *
 * The pipeline turns a raster into editable vector paths in five stages, each a
 * pure function of the one before it, and each in its own module so it can be
 * tested with a hand-built input rather than a whole image:
 *
 *   RasterData --quantize--> palette + index map
 *              --bitmap----> one packed Bitmap per colour layer
 *              --decompose-> closed PixelPaths on the pixel grid
 *              --polygon---> the fewest straight segments that stay within half
 *                            a pixel of every boundary point
 *              --smooth----> Bezier segments, corners kept where the polygon
 *                            turns sharply, curves elsewhere
 *              --render----> SVG path data
 *
 * The tracing stages follow the algorithm Peter Selinger describes in "Potrace:
 * a polygon-based tracing algorithm" (2003) — path decomposition, optimal
 * polygon, vertex adjustment, corner analysis with alphamax, curve optimisation
 * — implemented here from that description. It is what Illustrator's own tracer
 * descends from, which is why its controls map onto these parameters so
 * directly.
 *
 * Everything here is DOM-free. Pixels arrive as a plain RGBA buffer so the whole
 * pipeline runs in a worker and in plain node under test.
 */

import type { RGBA } from '../document/types'

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** RGBA pixels, row-major, four bytes per pixel — the shape ImageData has. */
export interface RasterData {
  width: number
  height: number
  data: Uint8ClampedArray
}

// ---------------------------------------------------------------------------
// Options — the Image Trace panel, one field per control
// ---------------------------------------------------------------------------

export type TraceMode = 'color' | 'grayscale' | 'bw'

/**
 * How the palette is chosen.
 *   automatic — `colors` is a 1..100 accuracy: more means more colours are
 *               kept apart, fewer means near-duplicates merge.
 *   limited   — `colors` is an exact count, 2..30.
 *   full-tone — `colors` is a 1..100 accuracy over a much larger range,
 *               for photographs.
 */
export type TracePalette = 'automatic' | 'limited' | 'full-tone'

/**
 *   abutting    — every colour region is traced exactly, so neighbouring
 *                 regions share an edge and nothing overlaps.
 *   overlapping — each region is traced as if it extended under the ones
 *                 painted on top of it, so stacking hides the seams.
 */
export type TraceMethod = 'abutting' | 'overlapping'

export interface TraceOptions {
  mode: TraceMode
  palette: TracePalette
  /** Meaning depends on `palette`; see TracePalette. Ignored in bw mode. */
  colors: number
  /** 0..255. bw mode only: luminance at or below this is black. */
  threshold: number
  /**
   * 0..100, Illustrator's "Paths". Low fits loosely with few anchors; High
   * follows the pixels closely. Drives the curve-optimisation tolerance.
   */
  paths: number
  /**
   * 0..100, Illustrator's "Corners". More corners keeps sharp turns as corner
   * points; fewer smooths them into curves. Drives potrace's alphamax.
   */
  corners: number
  /** 1..100 px. Regions with fewer pixels than this are ignored (turdsize). */
  noise: number
  method: TraceMethod
  /** Trace regions as filled shapes. */
  fills: boolean
  /** Trace thin features as centreline strokes. */
  strokes: boolean
  /** Features wider than this are fills even when strokes are on. Pixels. */
  strokeWidth: number
  /** Replace curves that barely bend with straight lines. */
  snapToLines: boolean
  /** Do not trace white (or near-white) regions at all. */
  ignoreWhite: boolean
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** One traced shape, in IMAGE PIXEL coordinates: (0,0) is the top-left pixel corner. */
export interface TracedPath {
  d: string
  fill: RGBA | null
  stroke: RGBA | null
  /** Pixels; only meaningful when `stroke` is set. */
  strokeWidth: number
  /** Anchor points in the path, for the panel's readout. */
  anchors: number
}

export interface TraceResult {
  paths: TracedPath[]
  /** Distinct colours used, after ignore-white and empty-layer pruning. */
  colorCount: number
  anchorCount: number
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Intermediate stages
// ---------------------------------------------------------------------------

/**
 * One colour layer as a bit-per-pixel mask, stored a byte per pixel for
 * simplicity: 1 is filled, 0 is empty. Row-major, `width * height` long.
 */
export interface Bitmap {
  width: number
  height: number
  data: Uint8Array
}

export interface Quantized {
  /** Palette entries, opaque. */
  palette: RGBA[]
  /** Palette index per pixel, row-major, `width * height` long. */
  indices: Uint8Array
  width: number
  height: number
}

/**
 * A closed boundary on the pixel grid.
 *
 * Vertices are CORNERS of pixels — integer coordinates where (0,0) is the
 * top-left corner of the top-left pixel and (width, height) the bottom-right
 * corner of the bottom-right pixel — so a single filled pixel at (3,5) traces
 * to the four points (3,5) (4,5) (4,6) (3,6). The path is implicitly closed:
 * the last point connects back to the first.
 *
 * `sign` is +1 for a path that encloses filled pixels (an outer boundary) and
 * -1 for one that encloses empty pixels inside a filled region (a hole). Holes
 * are separate paths, wound the other way, so a nonzero fill rule renders the
 * hole empty without any explicit parenting.
 *
 * `area` is the enclosed pixel count, used for the noise threshold.
 */
export interface PixelPath {
  /** Flat [x0, y0, x1, y1, ...]. */
  points: Int32Array
  sign: 1 | -1
  area: number
}

/**
 * The optimal polygon for a PixelPath: indices into `points` of the vertices
 * kept, in path order. Every dropped point lies within half a pixel of the
 * segment that replaced it.
 */
export type Polygon = Int32Array

export interface Vec2 {
  x: number
  y: number
}

/**
 * One piece of a smoothed curve. The segment starts wherever the previous one
 * ended (or at `Curve.start` for the first).
 *
 *   corner — two straight lines: to `c`, then to `end`. potrace's corner.
 *   curve  — one cubic Bezier with control points `c1`, `c2` ending at `end`.
 *   line   — one straight line to `end`. Produced by snap-to-lines, and by
 *            curve optimisation when a run of curves is straight enough.
 */
export type Segment =
  | { kind: 'corner'; c: Vec2; end: Vec2 }
  | { kind: 'curve'; c1: Vec2; c2: Vec2; end: Vec2 }
  | { kind: 'line'; end: Vec2 }

export interface Curve {
  start: Vec2
  segments: Segment[]
  /**
   * Absent or true: the last segment's end joins back to `start` (a region
   * outline). False: an open stroke centreline — rendered without Z.
   */
  closed?: boolean
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface TracePreset {
  id: string
  label: string
  options: TraceOptions
}
