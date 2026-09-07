/**
 * The drag-to-draw shape tools: rectangle, ellipse, triangle, polygon, star, line.
 *
 * All six share one implementation because they differ only in which node they
 * construct. The shape is previewed in the overlay and only committed on
 * pointerup, so an accidental click does not leave an empty undo entry.
 *
 * Modifiers match every other vector tool: Shift constrains to a square/circle
 * (or a 45-degree line), Alt draws outward from the center.
 */

import { boundsFromCorners, type Bounds } from '../geometry/Bounds'
import {
  createEllipse,
  createLine,
  createPolygon,
  createRect,
  createStar,
  createTriangle,
} from '../document/NodeFactory'
import { insertNode } from '../history/Commands'
import { buildSnapContext, resolveSnap, type SnapContext } from './snapHelpers'
import { editorStore, refreshOverlay, setEditor, setTool } from '../state/EditorStore'
import type { DesignNode, Transform } from '../document/types'
import type { Vec2 } from '../geometry/Matrix'
import type { CanvasPointerEvent, Tool, ToolContext } from './types'
import type { ToolId } from '../state/EditorStore'

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'polygon' | 'star' | 'line'

/** Size used when the tool is clicked rather than dragged. */
const CLICK_DEFAULT_SIZE = 100
const DRAG_THRESHOLD_PX = 3

interface DrawState {
  active: boolean
  start: Vec2
  current: Vec2
  constrain: boolean
  fromCenter: boolean
  snap: SnapContext | null
  kind: ShapeKind | null
}

const draw: DrawState = {
  active: false,
  start: { x: 0, y: 0 },
  current: { x: 0, y: 0 },
  constrain: false,
  fromCenter: false,
  snap: null,
  kind: null,
}

/** Exposed so the overlay can draw the in-progress shape. */
export function getDrawPreview(): { bounds: Bounds; kind: ShapeKind } | null {
  if (!draw.active || !draw.kind) return null
  return { bounds: previewBounds(), kind: draw.kind }
}

function previewBounds(): Bounds {
  let { x: sx, y: sy } = draw.start
  let { x: cx, y: cy } = draw.current

  if (draw.constrain) {
    // Square/circle for area shapes; 45-degree increments for lines.
    if (draw.kind === 'line') {
      const dx = cx - sx
      const dy = cy - sy
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
      const len = Math.hypot(dx, dy)
      cx = sx + Math.cos(angle) * len
      cy = sy + Math.sin(angle) * len
    } else {
      const size = Math.max(Math.abs(cx - sx), Math.abs(cy - sy))
      cx = sx + Math.sign(cx - sx || 1) * size
      cy = sy + Math.sign(cy - sy || 1) * size
    }
  }

  if (draw.fromCenter) {
    const dx = cx - sx
    const dy = cy - sy
    sx -= dx
    sy -= dy
  }

  return draw.kind === 'line'
    ? { x: Math.min(sx, cx), y: Math.min(sy, cy), width: cx - sx, height: cy - sy }
    : boundsFromCorners(sx, sy, cx, cy)
}

function buildNode(kind: ShapeKind, bounds: Bounds, raw: Bounds): DesignNode {
  const transform: Partial<Transform> = {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  }
  switch (kind) {
    case 'rect':
      return createRect(transform)
    case 'ellipse':
      return createEllipse(transform)
    case 'triangle':
      return createTriangle(transform)
    case 'polygon':
      return createPolygon(transform, {}, 6)
    case 'star':
      return createStar(transform, {}, 5, 0.5)
    case 'line': {
      // A line keeps its true endpoints in local space so direction survives;
      // the bounding box is only its extent.
      const x1 = raw.width >= 0 ? 0 : Math.abs(raw.width)
      const y1 = raw.height >= 0 ? 0 : Math.abs(raw.height)
      const x2 = raw.width >= 0 ? Math.abs(raw.width) : 0
      const y2 = raw.height >= 0 ? Math.abs(raw.height) : 0
      return createLine(
        {
          x: Math.min(raw.x, raw.x + raw.width),
          y: Math.min(raw.y, raw.y + raw.height),
          width: Math.max(1, Math.abs(raw.width)),
          height: Math.max(1, Math.abs(raw.height)),
        },
        {},
        { x1, y1, x2, y2 },
      )
    }
  }
}

const LABELS: Record<ShapeKind, { label: string; shortcut: string }> = {
  rect: { label: 'Rectangle', shortcut: 'R' },
  ellipse: { label: 'Ellipse', shortcut: 'E' },
  triangle: { label: 'Triangle', shortcut: 'Y' },
  polygon: { label: 'Polygon', shortcut: 'G' },
  star: { label: 'Star', shortcut: 'S' },
  line: { label: 'Line', shortcut: 'L' },
}

export function createShapeTool(kind: ShapeKind): Tool {
  return {
    id: kind as ToolId,
    cursor: 'crosshair',
    label: LABELS[kind].label,
    shortcut: LABELS[kind].shortcut,

    onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
      const editor = editorStore.getState()
      draw.active = true
      draw.kind = kind
      draw.start = e.doc
      draw.current = e.doc
      draw.constrain = e.shiftKey
      draw.fromCenter = e.altKey
      draw.snap = buildSnapContext(
        ctx.doc(),
        new Set(),
        ctx.viewport(),
        editor.canvasSize,
        editor.snapEnabled,
      )
      refreshOverlay()
    },

    onPointerMove(e: CanvasPointerEvent): void {
      if (!draw.active) return
      draw.current = e.doc
      draw.constrain = e.shiftKey
      draw.fromCenter = e.altKey

      // Snap the corner being dragged so new shapes align to existing ones.
      if (draw.snap && !e.primaryModifier) {
        const b = previewBounds()
        const snap = resolveSnap(b, draw.snap)
        if (snap.dx || snap.dy) {
          draw.current = { x: draw.current.x + snap.dx, y: draw.current.y + snap.dy }
        }
        setEditor({ snapGuides: snap.lines })
      }
      refreshOverlay()
    },

    onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
      if (!draw.active) return
      const zoom = ctx.viewport().zoom
      const dragged =
        Math.hypot(e.doc.x - draw.start.x, e.doc.y - draw.start.y) * zoom >= DRAG_THRESHOLD_PX

      let bounds = previewBounds()
      const raw = {
        x: draw.start.x,
        y: draw.start.y,
        width: draw.current.x - draw.start.x,
        height: draw.current.y - draw.start.y,
      }

      if (!dragged) {
        // A plain click drops a default-sized shape centered on the click.
        bounds = {
          x: draw.start.x - CLICK_DEFAULT_SIZE / 2,
          y: draw.start.y - CLICK_DEFAULT_SIZE / 2,
          width: CLICK_DEFAULT_SIZE,
          height: CLICK_DEFAULT_SIZE,
        }
        raw.width = CLICK_DEFAULT_SIZE
        raw.height = kind === 'line' ? 0 : CLICK_DEFAULT_SIZE
        raw.x = bounds.x
        raw.y = bounds.y
      }

      draw.active = false
      draw.kind = null
      draw.snap = null
      setEditor({ snapGuides: [] })
      refreshOverlay()

      if (bounds.width < 0.5 && bounds.height < 0.5) return
      insertNode(buildNode(kind, bounds, raw))
      // Match XD: drop back to the selection tool so the new shape can be tweaked.
      setTool('select')
    },

    onKeyDown(e: KeyboardEvent): boolean {
      if (e.key === 'Escape' && draw.active) {
        draw.active = false
        draw.kind = null
        setEditor({ snapGuides: [] })
        refreshOverlay()
        return true
      }
      return false
    },

    onDeactivate(): void {
      draw.active = false
      draw.kind = null
      draw.snap = null
      setEditor({ snapGuides: [] })
    },
  }
}

export const rectangleTool = createShapeTool('rect')
export const ellipseTool = createShapeTool('ellipse')
export const triangleTool = createShapeTool('triangle')
export const polygonTool = createShapeTool('polygon')
export const starTool = createShapeTool('star')
export const lineTool = createShapeTool('line')
