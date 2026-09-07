/**
 * The drag-to-draw shape tools: rectangle, ellipse, polygon, line.
 *
 * All four share one implementation because they differ only in which node they
 * construct. Triangle and star are not tools: they are a polygon with three
 * corners, and a polygon with a star ratio below 100% — exactly as in XD. The shape is previewed in the overlay and only committed on
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
} from '../document/NodeFactory'
import { insertNode } from '../history/Commands'
import { buildSnapContext, resolveSnap, snapAngle, type SnapContext } from './snapHelpers'
import { editorStore, refreshOverlay, setEditor, setTool } from '../state/EditorStore'
import type { DesignNode, Transform } from '../document/types'
import type { Vec2 } from '../geometry/Matrix'
import type { CanvasPointerEvent, Tool, ToolContext } from './types'
import type { ToolId } from '../state/EditorStore'

export type ShapeKind = 'rect' | 'ellipse' | 'polygon' | 'line'

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

/** The two endpoints of the gesture, after Shift and Alt have been applied. */
interface DrawSegment {
  a: Vec2
  b: Vec2
}

/**
 * Exposed so the overlay can draw the in-progress shape.
 *
 * The segment rides along because a line is not symmetric: its box says how big
 * it is but not which way round it runs, and the overlay has to draw the same
 * direction the commit will store.
 */
export function getDrawPreview(): {
  bounds: Bounds
  kind: ShapeKind
  segment: DrawSegment
} | null {
  if (!draw.active || !draw.kind) return null
  const segment = previewSegment()
  return { bounds: boundsOf(segment), kind: draw.kind, segment }
}

/**
 * The gesture's resolved endpoints — the single source of truth.
 *
 * Everything downstream (the preview, the snap box, the discard guard and the
 * committed node) derives from these, so Shift and Alt cannot apply to some of
 * them and not others.
 */
function previewSegment(): DrawSegment {
  let { x: sx, y: sy } = draw.start
  let { x: cx, y: cy } = draw.current

  if (draw.constrain) {
    // Square/circle for area shapes; 45-degree increments for lines.
    if (draw.kind === 'line') {
      const snapped = snapAngle({ x: sx, y: sy }, { x: cx, y: cy }, 45)
      cx = snapped.x
      cy = snapped.y
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

  return { a: { x: sx, y: sy }, b: { x: cx, y: cy } }
}

/**
 * The gesture's bounding box — ALWAYS unsigned, for every kind.
 *
 * The line used to get a signed box here (min corner, but signed width/height).
 * Every consumer reads it as a normal AABB, so that one inconsistency produced
 * four separate bugs: the preview drew a full drag-delta away from the pointer,
 * an up-left drag was silently discarded by the size guard, snapping saw its
 * right and bottom edges inverted, and the committed node disagreed with the
 * preview. Direction now lives in the segment, where it belongs.
 */
function boundsOf(segment: DrawSegment): Bounds {
  return boundsFromCorners(segment.a.x, segment.a.y, segment.b.x, segment.b.y)
}

function previewBounds(): Bounds {
  return boundsOf(previewSegment())
}

function buildNode(kind: ShapeKind, bounds: Bounds, segment: DrawSegment): DesignNode {
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
    case 'polygon':
      return createPolygon(transform)
    case 'line':
      // A line keeps its true endpoints in local space so direction survives;
      // the bounding box is only its extent. Rebasing the SAME endpoints the
      // preview drew is what makes Shift-45 and Alt-from-centre reach the
      // document — they used to stop at the preview.
      return createLine(transform, {}, {
        x1: segment.a.x - bounds.x,
        y1: segment.a.y - bounds.y,
        x2: segment.b.x - bounds.x,
        y2: segment.b.y - bounds.y,
      })
  }
}

const LABELS: Record<ShapeKind, { label: string; shortcut: string }> = {
  rect: { label: 'Rectangle', shortcut: 'R' },
  ellipse: { label: 'Ellipse', shortcut: 'E' },
  polygon: { label: 'Polygon', shortcut: 'Y' },
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

      let segment = previewSegment()

      if (!dragged) {
        // A plain click drops a default-sized shape centered on the click — for
        // a line, a horizontal one THROUGH the click rather than above it.
        const half = CLICK_DEFAULT_SIZE / 2
        segment =
          kind === 'line'
            ? {
                a: { x: draw.start.x - half, y: draw.start.y },
                b: { x: draw.start.x + half, y: draw.start.y },
              }
            : {
                a: { x: draw.start.x - half, y: draw.start.y - half },
                b: { x: draw.start.x + half, y: draw.start.y + half },
              }
      }
      const bounds = boundsOf(segment)

      draw.active = false
      draw.kind = null
      draw.snap = null
      setEditor({ snapGuides: [] })
      refreshOverlay()

      if (bounds.width < 0.5 && bounds.height < 0.5) return
      insertNode(buildNode(kind, bounds, segment))
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
export const polygonTool = createShapeTool('polygon')
export const lineTool = createShapeTool('line')
