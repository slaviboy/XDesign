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
 * Screen <-> document coordinate conversion.
 *
 * The pointer is converted to document space exactly once per event, here, and
 * never via getScreenCTM(): that API does not exist in jsdom, returns a fake
 * identity in happy-dom, and — more importantly — mixing it with our own pan/zoom
 * would give two sources of truth that disagree at fractional zoom levels.
 */

import { compose, scaling, translation, type Mat2D, type Vec2 } from '../geometry/Matrix'
import { transformBounds, type Bounds } from '../geometry/Bounds'
import type { Viewport } from '../state/EditorStore'

/** Document space -> screen space. */
export function viewportMatrix(v: Viewport): Mat2D {
  return compose(scaling(v.zoom, v.zoom), translation(v.x, v.y))
}

export function docToScreen(v: Viewport, p: Vec2): Vec2 {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y }
}

export function screenToDoc(v: Viewport, p: Vec2): Vec2 {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom }
}

export function docToScreenBounds(v: Viewport, b: Bounds): Bounds {
  return transformBounds(b, viewportMatrix(v))
}

export function screenToDocBounds(v: Viewport, b: Bounds): Bounds {
  return {
    x: (b.x - v.x) / v.zoom,
    y: (b.y - v.y) / v.zoom,
    width: b.width / v.zoom,
    height: b.height / v.zoom,
  }
}

/** Convert a screen-pixel tolerance (hit radius, snap distance) to document units. */
export function screenDistanceToDoc(v: Viewport, px: number): number {
  return px / (v.zoom || 1)
}

/** Viewport that fits `content` inside a canvas of `size`, with padding in px. */
export function fitViewport(
  content: Bounds,
  size: { width: number; height: number },
  padding = 48,
  maxZoom = 4,
): Viewport {
  if (content.width <= 0 || content.height <= 0) {
    return { x: size.width / 2, y: size.height / 2, zoom: 1 }
  }
  const availW = Math.max(1, size.width - padding * 2)
  const availH = Math.max(1, size.height - padding * 2)
  const zoom = Math.min(maxZoom, Math.min(availW / content.width, availH / content.height))
  return {
    zoom,
    x: padding + (availW - content.width * zoom) / 2 - content.x * zoom,
    y: padding + (availH - content.height * zoom) / 2 - content.y * zoom,
  }
}

/** Viewport that centers `content` at the given zoom without rescaling. */
export function centerViewport(
  content: Bounds,
  size: { width: number; height: number },
  zoom: number,
): Viewport {
  return {
    zoom,
    x: size.width / 2 - (content.x + content.width / 2) * zoom,
    y: size.height / 2 - (content.y + content.height / 2) * zoom,
  }
}

/** The zoom presets offered in the view menu. */
export const ZOOM_PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 2, 4, 8] as const

/** Next preset above the current zoom — backs Cmd+= stepping. */
export function nextZoomStep(current: number, direction: 1 | -1): number {
  const presets = ZOOM_PRESETS
  if (direction > 0) {
    for (const p of presets) if (p > current + 1e-6) return p
    return Math.min(64, current * 2)
  }
  for (let i = presets.length - 1; i >= 0; i--) {
    if (presets[i]! < current - 1e-6) return presets[i]!
  }
  return Math.max(0.02, current / 2)
}

/** The document-space rectangle currently visible — used to cull offscreen nodes. */
export function visibleDocBounds(
  v: Viewport,
  size: { width: number; height: number },
  overscan = 200,
): Bounds {
  const tl = screenToDoc(v, { x: -overscan, y: -overscan })
  const br = screenToDoc(v, { x: size.width + overscan, y: size.height + overscan })
  return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y }
}
