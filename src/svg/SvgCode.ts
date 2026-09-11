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
 * A shape as SVG code, and SVG code read back as a shape.
 *
 * The code is the exporter's own output for the one object — the same markup
 * an SVG export or a copy writes — framed on the object in document
 * coordinates, as XD's Copy SVG Code frames it: the viewBox is where the
 * object is on the canvas, and the element carries its whole transform. So the
 * position and the turn can be edited in the code as well as the geometry and
 * the paint.
 *
 * Reading goes through the real importer, the one that imports files, so the
 * code box understands exactly the SVG an import would — and is exactly as
 * safe, sanitizer and all.
 */

import { exportNodesToSvg } from './SvgExporter'
import { formatSvg } from './SvgFormat'
import { importSvg } from './SvgImporter'
import { createMatrixCache, localMatrix, renderBoundsOfNodes } from '../document/SceneGraph'
import { is3dAffected } from '../document/Scene3D'
import { hasStyle, type DesignDocument, type DesignNode, type NodeId, type Style } from '../document/types'
import { IDENTITY, invert, multiply, type Mat2D } from '../geometry/Matrix'
import { roundOut } from '../geometry/Bounds'
import { parsePreserveAspectRatio, viewBoxMatrix } from '../geometry/ViewBox'

/** The objects the code view is for: every kind of drawn shape. */
const CODE_TYPES = new Set(['rect', 'ellipse', 'polygon', 'line', 'path'])

export function supportsSvgCode(node: DesignNode | undefined): boolean {
  return !!node && CODE_TYPES.has(node.type)
}

/**
 * Whether the code can be edited back into the object. A tilted object's code
 * is its projection — a mesh of pieces, not the shape — so it can be read and
 * copied, but typing into it would describe something else.
 */
export function canEditSvgCode(doc: DesignDocument, id: NodeId): boolean {
  return supportsSvgCode(doc.nodes[id]) && !is3dAffected(doc, id)
}

/** One object's SVG, laid out one element per line — the code that can be edited back. */
export async function svgCodeFor(doc: DesignDocument, id: NodeId): Promise<string> {
  return codeFor(doc, [id])
}

/**
 * Several objects' SVG, as copying them would write it — a group, a
 * multi-selection. Read-only: there is no one shape to edit it back into.
 */
export async function svgCodeForNodes(doc: DesignDocument, ids: readonly NodeId[]): Promise<string> {
  return codeFor(doc, ids.filter((id) => doc.nodes[id]))
}

/**
 * The whole scene's SVG: every artboard and every object on the canvas
 * around them, in layer order, as an SVG export of all of it would write —
 * pictures left out.
 */
export async function svgCodeForScene(doc: DesignDocument): Promise<string> {
  const root = doc.nodes[doc.rootId]
  const ids = root && 'children' in root ? root.children.filter((id) => doc.nodes[id]?.visible) : []
  return codeFor(doc, ids)
}

/**
 * The code for `ids`, framed on them in document coordinates, bitmaps left
 * out: in a code view a picture is a screenful of base64 that buries the
 * markup around it.
 *
 * Framed on whole units: the exporter writes width and height rounded, so a
 * fractional frame would read back very slightly scaled — enough to count as
 * an edit nobody made.
 */
async function codeFor(doc: DesignDocument, ids: readonly NodeId[]): Promise<string> {
  if (ids.length === 0) return formatSvg('<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>')
  // Nudged inward first: a curve's bounds come out a hair past a whole number
  // (199.9999…), and rounding that out would move the frame by a unit for no
  // visible reason.
  const raw = renderBoundsOfNodes(doc, ids, createMatrixCache())
  const bounds = roundOut({ x: raw.x + 1e-6, y: raw.y + 1e-6, width: raw.width - 2e-6, height: raw.height - 2e-6 })
  const { svg } = await exportNodesToSvg(doc, ids, {
    bounds: { ...bounds, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) },
    textHandling: 'reference',
    imageHandling: 'omit',
  })
  return formatSvg(svg)
}

/** A shape read from code, with where it sits in the document. */
export interface CodeShape {
  node: DesignNode & { style: Style }
  /** Its placement in document space, box origin included. */
  world: Mat2D
}

/**
 * Read code back into one shape.
 *
 * Groups holding a single child are looked through — wrapping a shape in a
 * <g> to move it is ordinary SVG — with their transform and opacity carried
 * down onto it. Anything that is not, in the end, exactly one shape is refused
 * with a reason, rather than half-applied.
 */
export function readSvgShape(code: string): CodeShape | { error: string } {
  let result
  try {
    result = importSvg(code, 'Shape')
  } catch {
    return { error: 'This SVG could not be read.' }
  }
  if (!result.rootId) {
    return { error: result.warnings[0] ?? 'This SVG has no shape in it.' }
  }

  let node = result.nodes[result.rootId]!
  let matrix = localMatrix(node.transform)
  let opacity = 1
  while ((node.type === 'group' || node.type === 'artboard') && node.children.length === 1) {
    if (hasStyle(node)) opacity *= node.style.opacity
    node = result.nodes[node.children[0]!]!
    matrix = multiply(matrix, localMatrix(node.transform))
  }
  if (!supportsSvgCode(node) || !hasStyle(node)) {
    return { error: 'The code must describe one shape: a path, line, rectangle, ellipse or polygon.' }
  }

  // The importer maps the root viewBox onto the SVG's own size, so every
  // imported position is relative to the viewBox corner. Undoing that mapping
  // puts the shape back where the viewBox says it is in the document.
  const world = multiply(invert(rootMatrix(code, result.size)), matrix)
  return { node: { ...node, style: { ...node.style, opacity: node.style.opacity * opacity } }, world }
}

function rootMatrix(code: string, size: { width: number; height: number }): Mat2D {
  if (typeof DOMParser === 'undefined') return IDENTITY
  const root = new DOMParser().parseFromString(code, 'image/svg+xml').documentElement
  const nums = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if (nums.length !== 4 || !nums.every(Number.isFinite) || nums[2]! <= 0 || nums[3]! <= 0) return IDENTITY
  const [x, y, width, height] = nums as [number, number, number, number]
  return viewBoxMatrix(
    { x, y, width, height },
    size.width || width,
    size.height || height,
    parsePreserveAspectRatio(root.getAttribute('preserveAspectRatio')),
  )
}
