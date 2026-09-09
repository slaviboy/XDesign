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
 * Image Trace: colour layers as bitmaps.
 *
 * Quantisation leaves one palette index per pixel. Everything after it —
 * boundary following, centreline extraction — wants a plain yes/no mask for
 * one colour and asks "is this pixel filled?" millions of times. This module
 * builds those masks and is the only place that knows how they are laid out.
 *
 * A byte per pixel rather than a packed bit. potrace packs its bitmap into
 * machine words and gains a fast "next set bit" scan from it, but the later
 * stages here touch pixels one at a time (the XOR that removes a traced
 * region, the neighbour counts in thinning), and a plain typed-array index
 * beats shift-and-mask for that. The mask is a quarter the size of the RGBA
 * input we already hold, so there is nothing worth saving.
 *
 * Two ways to build a layer, one per setting of the panel's Method control:
 *   abutting    — `layerBitmap`: exactly the pixels of one colour, so
 *                 neighbouring regions share an edge and nothing overlaps.
 *   overlapping — `unionLayers`: this colour together with every colour
 *                 painted on top of it, so the region extends underneath its
 *                 neighbours and the stacking hides the seams.
 *
 * `bitmapGet` answers 0 for any coordinate outside the image. The boundary
 * follower probes one pixel past the edge whenever an outline touches the
 * border; an implicit frame of empty pixels around the image is what lets it
 * apply the same rule at the edge as in the interior — the same trick as
 * potrace's BM_GET.
 */

import type { Bitmap, Quantized } from './types'

function emptyBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(width * height) }
}

/** The pixels of one palette entry. An index no pixel uses gives an empty mask. */
export function layerBitmap(q: Quantized, index: number): Bitmap {
  const bm = emptyBitmap(q.width, q.height)
  const src = q.indices
  const dst = bm.data
  for (let i = 0; i < dst.length; i++) {
    if (src[i] === index) dst[i] = 1
  }
  return bm
}

/**
 * The pixels of any of several palette entries.
 *
 * Membership goes through a 256-entry table rather than a Set: palette
 * indices are bytes, so one table lookup per pixel is the whole test, and
 * anything outside 0..255 can never match a pixel and is simply left out.
 */
export function unionLayers(q: Quantized, indices: readonly number[]): Bitmap {
  const member = new Uint8Array(256)
  for (const index of indices) {
    if (Number.isInteger(index) && index >= 0 && index < 256) member[index] = 1
  }
  const bm = emptyBitmap(q.width, q.height)
  const src = q.indices
  const dst = bm.data
  for (let i = 0; i < dst.length; i++) dst[i] = member[src[i]]
  return bm
}

/**
 * 1 if pixel (x, y) is filled, 0 if it is empty or lies outside the image.
 * Integer pixel coordinates: (0, 0) is the top-left pixel, (width - 1,
 * height - 1) the bottom-right one.
 */
export function bitmapGet(bm: Bitmap, x: number, y: number): 0 | 1 {
  if (x < 0 || y < 0 || x >= bm.width || y >= bm.height) return 0
  return bm.data[y * bm.width + x] ? 1 : 0
}

export function cloneBitmap(bm: Bitmap): Bitmap {
  return { width: bm.width, height: bm.height, data: new Uint8Array(bm.data) }
}

/** Number of filled pixels. */
export function countFilled(bm: Bitmap): number {
  const data = bm.data
  let n = 0
  for (let i = 0; i < data.length; i++) if (data[i]) n++
  return n
}

/**
 * Clears from `target` every pixel that is filled in `remove` — target &= ~remove,
 * in place. This is how the pixels the centreline pass claimed as strokes are
 * taken out of a layer before it is traced as fills.
 *
 * The two masks come from the same image and so are the same size, which is
 * the flat single-loop case. Should they ever differ, they are aligned at the
 * top-left corner and only the region they share is affected: like the rest
 * of the DOM-free layers this computes what the inputs allow rather than
 * throwing.
 */
export function subtractBitmap(target: Bitmap, remove: Bitmap): void {
  const dst = target.data
  const src = remove.data
  if (target.width === remove.width && target.height === remove.height) {
    for (let i = 0; i < dst.length; i++) if (src[i]) dst[i] = 0
    return
  }
  const width = Math.min(target.width, remove.width)
  const height = Math.min(target.height, remove.height)
  for (let y = 0; y < height; y++) {
    const dstRow = y * target.width
    const srcRow = y * remove.width
    for (let x = 0; x < width; x++) if (src[srcRow + x]) dst[dstRow + x] = 0
  }
}
