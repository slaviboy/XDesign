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
 * Cropping an image, non-destructively.
 *
 * The picture is never cut. A cropped image node keeps its whole asset and
 * records which part of it is kept (`ImageNode.crop`, fractions of the whole);
 * its box is resized to exactly that part. Everything that reads the box —
 * bounds, selection, hit testing, snapping, masks, export, Image Trace — then
 * treats the kept part as the image, with no knowledge of cropping at all.
 *
 * Cropping must not move what stays. The box's origin moves to the kept part's
 * corner, and the node turns and scales about a pivot inside its box, so the
 * transform is re-solved rather than the size simply written: see cropToRect.
 *
 * DOM-free.
 */

import { applyToVector } from '../geometry/Matrix'
import { linearPart, resizeBoxInPlace } from './DocumentModel'
import type { Bounds } from '../geometry/Bounds'
import type { ImageAsset, ImageCrop, ImageNode, Transform } from './types'

export const FULL_CROP: ImageCrop = { x: 0, y: 0, width: 1, height: 1 }

/**
 * The smallest kept part, as a fraction of the whole. Stops a crop collapsing
 * to nothing, where the box would have no size to scale the picture from.
 */
const MIN_CROP_FRACTION = 1e-4

/** Crops closer to the whole picture than this are the whole picture. */
const FULL_EPSILON = 1e-6

export function cropOf(node: ImageNode): ImageCrop {
  return node.crop ?? FULL_CROP
}

export function isCropped(node: ImageNode): boolean {
  return !!node.crop && !isFullCrop(node.crop)
}

function isFullCrop(c: ImageCrop): boolean {
  return (
    Math.abs(c.x) < FULL_EPSILON &&
    Math.abs(c.y) < FULL_EPSILON &&
    Math.abs(c.width - 1) < FULL_EPSILON &&
    Math.abs(c.height - 1) < FULL_EPSILON
  )
}

/**
 * The whole picture in the node's own units — where it lies relative to the
 * box when nothing is cut away. The box itself is {0, 0, width, height}.
 */
export function fullImageFrame(node: ImageNode): Bounds {
  const c = cropOf(node)
  const width = node.transform.width / c.width
  const height = node.transform.height / c.height
  return { x: -c.x * width, y: -c.y * height, width, height }
}

/**
 * The size the whole picture is laid out at when drawn: its pixel size where
 * that is known, and a unit square where it is not. Only the proportions of
 * the kept part within it matter, so a unit square is still exact.
 */
export function pictureSize(asset: Pick<ImageAsset, 'width' | 'height'> | undefined): {
  width: number
  height: number
} {
  const w = asset?.width ?? 0
  const h = asset?.height ?? 0
  return w > 0 && h > 0 ? { width: w, height: h } : { width: 1, height: 1 }
}

/** The kept part as an SVG viewBox over a picture laid out at `size`. */
export function cropViewBox(crop: ImageCrop, size: { width: number; height: number }): string {
  const n = (v: number) => Math.round(v * 1e6) / 1e6
  return [crop.x * size.width, crop.y * size.height, crop.width * size.width, crop.height * size.height]
    .map(n)
    .join(' ')
}

/** `rect` held inside `frame`, and at least `min` on each side. */
export function clampToFrame(rect: Bounds, frame: Bounds, min: number): Bounds {
  const width = Math.min(frame.width, Math.max(min, rect.width))
  const height = Math.min(frame.height, Math.max(min, rect.height))
  const x = Math.min(frame.x + frame.width - width, Math.max(frame.x, rect.x))
  const y = Math.min(frame.y + frame.height - height, Math.max(frame.y, rect.y))
  return { x, y, width, height }
}

/**
 * Keep the part of the picture under `rect`, given in the node's current own
 * units (the box is {0, 0, width, height}; the whole picture is
 * fullImageFrame). Returns the node's new crop — undefined for the whole
 * picture, which is how a crop is undone entirely — and the transform that
 * puts the new, smaller or larger box exactly over that part.
 *
 * The box's origin moves to the rect's corner. A node maps a point p of its
 * box to x + c + L·(p − c), c being the pivot, so holding every point of the
 * picture where it is gives the resize-in-place solution plus L·r for the
 * origin's move r. Rotation, scale and skew are carried over untouched.
 */
export function cropToRect(
  node: ImageNode,
  rect: Bounds,
): { crop: ImageCrop | undefined; transform: Transform } {
  const frame = fullImageFrame(node)
  const kept = clampToFrame(rect, frame, Math.min(frame.width, frame.height) * MIN_CROP_FRACTION)

  const crop: ImageCrop = {
    x: (kept.x - frame.x) / frame.width,
    y: (kept.y - frame.y) / frame.height,
    width: kept.width / frame.width,
    height: kept.height / frame.height,
  }

  const resized = resizeBoxInPlace(node.transform, kept.width, kept.height)
  const moved = applyToVector(linearPart(node.transform), { x: kept.x, y: kept.y })
  return {
    crop: isFullCrop(crop) ? undefined : crop,
    transform: { ...resized, x: resized.x + moved.x, y: resized.y + moved.y },
  }
}

/** The transform and crop that show the whole picture again, in place. */
export function uncropped(node: ImageNode): { crop: undefined; transform: Transform } {
  return { crop: undefined, transform: cropToRect(node, fullImageFrame(node)).transform }
}

/**
 * A crop read from a file, made safe: finite, inside the picture, and not
 * empty. Null when there is nothing sensible to keep — the whole picture is
 * then shown, which is the least surprising way for a damaged crop to fail.
 */
export function sanitizeCrop(value: unknown): ImageCrop | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  const nums = [c.x, c.y, c.width, c.height]
  if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const [x, y, width, height] = nums as number[]
  if (width! <= 0 || height! <= 0) return null
  const cx = Math.min(1, Math.max(0, x!))
  const cy = Math.min(1, Math.max(0, y!))
  const cw = Math.min(1 - cx, width!)
  const ch = Math.min(1 - cy, height!)
  if (cw < MIN_CROP_FRACTION || ch < MIN_CROP_FRACTION) return null
  const crop = { x: cx, y: cy, width: cw, height: ch }
  return isFullCrop(crop) ? null : crop
}
