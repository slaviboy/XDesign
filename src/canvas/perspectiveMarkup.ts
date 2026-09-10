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
 * How a plane in perspective is written as SVG.
 *
 * Shared by the live renderer and the SVG exporter, for the same reason
 * effects.ts and paint.ts are: the canvas and the file come from one piece of
 * code, so a tilted card cannot look one way on screen and another in a PNG.
 *
 * The flat artwork is written ONCE, into <defs>, and every triangle of the
 * mesh draws it again through a <use> carrying that triangle's affine map,
 * cut down to the triangle by a mask. A mask rather than a clip path, and a
 * crisp-edged one, deliberately: a clip path is always antialiased, so two
 * triangles sharing an edge each cover the pixels on it only partly, and the
 * seam shows through as a faint lattice over the whole object. A mask is
 * drawn like any other shape, so it honours shape-rendering="crispEdges";
 * aliased triangles that share exact corners tile the plane with every pixel
 * owned by exactly one of them, and there is no seam at all. The artwork's
 * own edges stay antialiased — the mesh reaches past them, so its aliased
 * boundary falls on empty space.
 */

import { union, type Bounds } from '../geometry/Bounds'
import {
  isAffineMat3,
  perspectiveMesh,
  projectedBounds,
  type Mat3,
  type WarpTriangle,
} from '../geometry/Perspective'
import { flatRenderBox } from '../document/SceneGraph'
import type { DesignDocument, DesignNode } from '../document/types'

/** Id of the flat artwork a plane's triangles draw. */
export const planeContentId = (nodeId: string): string => `p3d-${nodeId}`

/** Id of one triangle's mask. */
export const planeMaskId = (nodeId: string, index: number): string => `p3d-${nodeId}-${index}`

/**
 * How finely to cut. The canvas redraws every triangle whenever anything near
 * it changes, so it settles for half a pixel and a cap; an export is drawn
 * once and can afford to be finer.
 */
export const CANVAS_MESH = { tolerance: 0.5, maxTriangles: 256 } as const
export const EXPORT_MESH = { tolerance: 0.35, maxTriangles: 1024 } as const

/**
 * The zoom a mesh is cut for, in steps of √2.
 *
 * A mesh fine enough for 800% is wasteful at 100% and a coarse one wobbles
 * zoomed in, so the canvas re-cuts as you zoom — but only when the zoom has
 * moved a whole step, not on every notch of the wheel.
 */
export function meshZoomBucket(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) return 1
  return 2 ** (Math.round(Math.log2(zoom) * 2) / 2)
}

/**
 * The region of a plane's own space its mesh has to cover: everything its body
 * draws, its own effects aside (they are applied after projection).
 *
 * A resize in flight owns the box, because the document has not been told the
 * new geometry yet — a path's data in particular is only rewritten on commit.
 */
export function planeDomain(doc: DesignDocument, node: DesignNode, liveBox?: Bounds): Bounds {
  const box = flatRenderBox(doc, node, false)
  const domain = liveBox ? union(box, liveBox) : box
  // A hair of margin, so the mesh's aliased outer edge never meets an
  // antialiased edge of the artwork.
  const m = Math.max(1, Math.max(domain.width, domain.height) * 0.002)
  return { x: domain.x - m, y: domain.y - m, width: domain.width + 2 * m, height: domain.height + 2 * m }
}

/**
 * The triangles for a plane, or null when the projection is affine — depth
 * with no tilt is a plain scale about the pivot, which SVG draws exactly with
 * one transform and no mesh at all.
 */
export function planeMesh(
  h: Mat3,
  domain: Bounds,
  pxPerUnit: number,
  quality: { tolerance: number; maxTriangles: number },
): WarpTriangle[] | null {
  if (isAffineMat3(h)) return null
  return perspectiveMesh(h, domain, { pxPerUnit, ...quality })
}

/**
 * A number for a triangle's corner.
 *
 * Neighbouring triangles must write their shared corner as the very same
 * string, or the crisp masks stop meeting exactly. The mesh hands both of them
 * the same float, and this turns equal floats into equal text.
 */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 1e4) / 1e4
  return Object.is(r, -0) ? '0' : String(r)
}

/** A triangle as path data, in the projected space. */
export function trianglePath(t: WarpTriangle): string {
  const [a, b, c] = t.points
  return `M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}L${fmt(c.x)} ${fmt(c.y)}Z`
}

/**
 * The region a triangle's mask is rendered over.
 *
 * Just the triangle's bounds, padded so that rounding can never shave its
 * edge: left to the default — a slab ten per cent bigger than the whole masked
 * artwork — every triangle would rasterise the full object offscreen.
 */
export function triangleRegion(t: WarpTriangle, pad: number): Bounds {
  const xs = t.points.map((p) => p.x)
  const ys = t.points.map((p) => p.y)
  const x = Math.min(...xs) - pad
  const y = Math.min(...ys) - pad
  return {
    x: Math.round(x * 1e3) / 1e3,
    y: Math.round(y * 1e3) / 1e3,
    width: Math.round((Math.max(...xs) + pad - x) * 1e3) / 1e3,
    height: Math.round((Math.max(...ys) + pad - y) * 1e3) / 1e3,
  }
}

/**
 * Where an effect's filter region lands once its object is projected.
 *
 * A 3D object's own shadow and blur are applied to its projected picture,
 * not inside it — one filter over the result instead of one per triangle,
 * which is the difference between smooth and unusable once a mesh has a
 * hundred triangles.
 */
export function projectedRegion(h: Mat3, region: Bounds): Bounds {
  return projectedBounds(h, region) ?? region
}
