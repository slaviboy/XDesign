/**
 * Freehand pencil.
 *
 * Captures the pointer trail, then simplifies it with Douglas-Peucker before
 * fitting smooth cubics. Without the simplify pass a single stroke arrives with
 * hundreds of near-duplicate points, which makes the resulting path miserable to
 * edit and bloats the file.
 *
 * Simplification tolerance is expressed in screen pixels and divided by zoom, so
 * drawing at 400% captures the detail the user can actually see.
 */

import { pathBounds } from '../geometry/PathUtils'
import { simplifyPoints, smoothPolylineToPath } from '../geometry/ShapeGeometry'
import { transformPath } from '../geometry/PathUtils'
import { createPath } from '../document/NodeFactory'
import { insertNode } from '../history/Commands'
import { refreshOverlay, setTool } from '../state/EditorStore'
import { DEFAULT_STROKE } from '../document/types'
import type { Vec2 } from '../geometry/Matrix'
import type { CanvasPointerEvent, Tool, ToolContext } from './types'

const SIMPLIFY_PX = 2

let trail: Vec2[] = []
let drawing = false

export function getPencilPreview(): Vec2[] | null {
  return drawing && trail.length > 1 ? trail : null
}

export const pencilTool: Tool = {
  id: 'pencil',
  cursor: 'crosshair',
  label: 'Pencil',
  shortcut: 'N',

  onPointerDown(e: CanvasPointerEvent): void {
    drawing = true
    trail = [e.doc]
    refreshOverlay()
  },

  onPointerMove(e: CanvasPointerEvent): void {
    if (!drawing) return
    const last = trail[trail.length - 1]
    // Drop sub-pixel jitter before it reaches the simplifier.
    if (last && Math.hypot(e.doc.x - last.x, e.doc.y - last.y) < 0.5) return
    trail.push(e.doc)
    refreshOverlay()
  },

  onPointerUp(_e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!drawing) return
    drawing = false
    const captured = trail
    trail = []
    refreshOverlay()
    if (captured.length < 2) return

    const tolerance = SIMPLIFY_PX / (ctx.viewport().zoom || 1)
    const simplified = simplifyPoints(captured, tolerance)
    const worldD = smoothPolylineToPath(simplified)
    if (!worldD) return

    const b = pathBounds(worldD)
    // Rebase into local space so the node's transform starts at the origin.
    const localD = transformPath(worldD, [1, 0, 0, 1, -b.x, -b.y])

    insertNode(
      createPath(
        localD,
        { x: b.x, y: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height) },
        {
          fill: { type: 'none' },
          stroke: {
            ...DEFAULT_STROKE,
            paint: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } },
            width: 2,
            cap: 'round',
            join: 'round',
          },
        },
        false,
      ),
    )
    setTool('select')
  },

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && drawing) {
      drawing = false
      trail = []
      refreshOverlay()
      return true
    }
    return false
  },

  onDeactivate(): void {
    drawing = false
    trail = []
  },
}
