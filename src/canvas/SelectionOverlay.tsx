/**
 * Selection frame, transform handles, path points and gradient handles.
 *
 * Everything here is drawn in SCREEN space, outside the viewport's zoom
 * transform, for two reasons: handles stay a constant physical size at any zoom,
 * and none of it is ever part of the document — so it cannot be selected,
 * exported, or serialized by accident.
 *
 * During a drag the store is deliberately not written, so this component
 * subscribes to LiveTransform flushes and reads the in-flight matrices from
 * DragSession instead. That keeps the frame glued to the shapes at 60fps while
 * the document stays untouched until commit.
 */

import { memo, useEffect, useMemo, useReducer } from 'react'
import { applyToXY, type Mat2D, type Vec2 } from '../geometry/Matrix'
import { boundsFromPoints, type Bounds } from '../geometry/Bounds'
import {
  createMatrixCache,
  geometryBounds,
  localGeometryBounds,
  worldMatrix,
} from '../document/SceneGraph'
import { docToScreen } from './Viewport'
import { angleBetween, rotationCursor } from './cursors'
import { liveTransform } from './LiveTransform'
import { getDragMode, getLiveMatrix, getLiveRotation, getLiveSize, isDragging } from '../tools/DragSession'
import { getEditingSubpaths } from '../tools/PathEditing'
import { useDocument, useEditorStore } from '../state/hooks'
import { RESIZE_HANDLES, type ResizeHandle } from '../tools/DragSession'
import type { NodeId } from '../document/types'
import type { Viewport } from '../state/EditorStore'

const HANDLE_SIZE = 7
/**
 * Rotation grab area, just outside each corner.
 *
 * Bigger than the resize handle so the corner is easy to reach, and drawn
 * BEFORE the handles so that when the two overlap the handle wins the hit test
 * — resizing is the more common intent when the pointer is exactly on a handle.
 *
 * Sized as a trade-off: large enough to grab without precision, small enough
 * that a drag starting on nearby empty canvas is still a marquee rather than an
 * accidental rotation of whatever happens to be selected.
 */
const ROTATE_ZONE = 18

/** Where each handle sits, as a 0..1 fraction of the frame. */
const HANDLE_POS: Record<ResizeHandle, Vec2> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
}

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
}

/** Repaint on every LiveTransform flush so the frame tracks an in-flight drag. */
function useLiveTick(): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => liveTransform.subscribe(bump), [])
  return tick
}

interface Frame {
  /** Corners in screen space, TL TR BR BL. Rotated for a single selection. */
  corners: Vec2[]
  /** Axis-aligned screen bounds, for the readout badge. */
  screenBounds: Bounds
  /** Size shown in the badge, in document units. */
  size: { width: number; height: number }
  rotation: number
}

export const SelectionOverlay = memo(function SelectionOverlay() {
  const doc = useDocument()
  const selection = useEditorStore((s) => s.selection)
  const hoverId = useEditorStore((s) => s.hoverId)
  const viewport = useEditorStore((s) => s.viewport)
  const nodeEditingId = useEditorStore((s) => s.nodeEditingId)
  const editingContext = useEditorStore((s) => s.editingContext)
  const dragging = useEditorStore((s) => s.isDragging)
  const tick = useLiveTick()

  const frame = useMemo(
    () => computeFrame(doc, selection, viewport, tick),
    // `tick` intentionally participates: during a drag the document does not
    // change, and the tick is what tells us the live matrices moved.
    [doc, selection, viewport, tick],
  )

  const hoverOutline = useMemo(() => {
    if (!hoverId || selection.includes(hoverId) || dragging) return null
    if (!doc.nodes[hoverId]) return null
    return outlineFor(doc, hoverId, viewport)
  }, [doc, hoverId, selection, viewport, dragging])

  const contextOutline = useMemo(() => {
    if (!editingContext || !doc.nodes[editingContext]) return null
    return outlineFor(doc, editingContext, viewport)
  }, [doc, editingContext, viewport])

  return (
    <g className="selection-overlay" pointerEvents="none">
      {contextOutline && (
        <polygon
          className="context-outline"
          points={contextOutline.map((p) => `${p.x},${p.y}`).join(' ')}
        />
      )}
      {hoverOutline && (
        <polygon
          className="hover-outline"
          points={hoverOutline.map((p) => `${p.x},${p.y}`).join(' ')}
        />
      )}

      {nodeEditingId ? (
        <PathPointOverlay viewport={viewport} tick={tick} />
      ) : (
        frame && (
          <TransformFrame frame={frame} dragging={dragging} multiple={selection.length > 1} />
        )
      )}

      <MarqueeBox viewport={viewport} />
      <SnapGuides viewport={viewport} />
    </g>
  )
})

// ---------------------------------------------------------------------------
// Frame computation
// ---------------------------------------------------------------------------

function computeFrame(
  doc: ReturnType<typeof useDocument>,
  selection: readonly NodeId[],
  viewport: Viewport,
  _tick: number,
): Frame | null {
  if (selection.length === 0) return null
  const cache = createMatrixCache()

  if (selection.length === 1) {
    const id = selection[0]!
    const node = doc.nodes[id]
    if (!node) return null
    // Live matrices win during a drag; the document has not been written yet.
    const world = getLiveMatrix(id) ?? cache.world(doc, id)
    const liveSize = getLiveSize(id)
    const local = liveSize
      ? { x: 0, y: 0, width: liveSize.width, height: liveSize.height }
      : localGeometryBounds(node)

    const cornersDoc = [
      applyToXY(world, local.x, local.y),
      applyToXY(world, local.x + local.width, local.y),
      applyToXY(world, local.x + local.width, local.y + local.height),
      applyToXY(world, local.x, local.y + local.height),
    ]
    const corners = cornersDoc.map((p) => docToScreen(viewport, p))
    const rotation =
      (Math.atan2(corners[1]!.y - corners[0]!.y, corners[1]!.x - corners[0]!.x) * 180) / Math.PI

    return {
      corners,
      screenBounds: boundsFromPoints(corners),
      size: { width: local.width, height: local.height },
      rotation,
    }
  }

  // Multi-selection uses an axis-aligned frame, which is what makes a mixed-
  // rotation selection resize predictably.
  const boxes = selection.map((id) => {
    const live = getLiveMatrix(id)
    if (live) {
      const node = doc.nodes[id]
      if (!node) return null
      const lb = localGeometryBounds(node)
      return boundsFromPoints([
        applyToXY(live, lb.x, lb.y),
        applyToXY(live, lb.x + lb.width, lb.y),
        applyToXY(live, lb.x + lb.width, lb.y + lb.height),
        applyToXY(live, lb.x, lb.y + lb.height),
      ])
    }
    return geometryBounds(doc, id, cache)
  })
  const valid = boxes.filter((b): b is Bounds => !!b)
  if (valid.length === 0) return null

  const minX = Math.min(...valid.map((b) => b.x))
  const minY = Math.min(...valid.map((b) => b.y))
  const maxX = Math.max(...valid.map((b) => b.x + b.width))
  const maxY = Math.max(...valid.map((b) => b.y + b.height))
  const cornersDoc = [
    { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY },
  ]
  const corners = cornersDoc.map((p) => docToScreen(viewport, p))

  return {
    corners,
    screenBounds: boundsFromPoints(corners),
    size: { width: maxX - minX, height: maxY - minY },
    rotation: 0,
  }
}

function outlineFor(
  doc: ReturnType<typeof useDocument>,
  id: NodeId,
  viewport: Viewport,
): Vec2[] | null {
  const node = doc.nodes[id]
  if (!node) return null
  const world: Mat2D = worldMatrix(doc, id)
  const b = node.type === 'group' || node.type === 'artboard'
    ? null
    : localGeometryBounds(node)
  if (!b) {
    const gb = geometryBounds(doc, id)
    return [
      { x: gb.x, y: gb.y }, { x: gb.x + gb.width, y: gb.y },
      { x: gb.x + gb.width, y: gb.y + gb.height }, { x: gb.x, y: gb.y + gb.height },
    ].map((p) => docToScreen(viewport, p))
  }
  return [
    applyToXY(world, b.x, b.y),
    applyToXY(world, b.x + b.width, b.y),
    applyToXY(world, b.x + b.width, b.y + b.height),
    applyToXY(world, b.x, b.y + b.height),
  ].map((p) => docToScreen(viewport, p))
}

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------

function TransformFrame({
  frame,
  dragging,
  multiple,
}: {
  frame: Frame
  dragging: boolean
  multiple: boolean
}) {
  const [tl, tr, , bl] = frame.corners as [Vec2, Vec2, Vec2, Vec2]

  const at = (f: Vec2): Vec2 => ({
    x: tl.x + (tr.x - tl.x) * f.x + (bl.x - tl.x) * f.y,
    y: tl.y + (tr.y - tl.y) * f.x + (bl.y - tl.y) * f.y,
  })

  const frameCenter = at({ x: 0.5, y: 0.5 })

  const mode = getDragMode()
  const showBadge = dragging && (mode === 'resize' || mode === 'move')

  return (
    <g className="transform-frame">
      <polygon
        className="selection-frame"
        points={frame.corners.map((p) => `${p.x},${p.y}`).join(' ')}
      />

      {/* Rotation zones sit just outside each corner. Drawn before the resize
          handles so the handle wins where the two overlap. Rendered for
          multi-selection too — rotating a group of objects about their shared
          centre is exactly what the frame implies. */}
      {(['nw', 'ne', 'se', 'sw'] as ResizeHandle[]).map((h) => {
        const p = at(HANDLE_POS[h])
        const ox = h.includes('w') ? -ROTATE_ZONE / 2 : ROTATE_ZONE / 2
        const oy = h.includes('n') ? -ROTATE_ZONE / 2 : ROTATE_ZONE / 2
        // Direction from the frame's centre out to this corner, in screen
        // space — so the cursor already reflects the object's rotation and the
        // viewport, not just which corner was nominally grabbed.
        const outward = angleBetween(frameCenter, p)
        return (
          <rect
            key={`rot-${h}`}
            data-handle="rotate"
            data-corner={h}
            className="rotate-zone"
            x={p.x + ox - ROTATE_ZONE / 2}
            y={p.y + oy - ROTATE_ZONE / 2}
            width={ROTATE_ZONE}
            height={ROTATE_ZONE}
            pointerEvents="all"
            style={{ cursor: rotationCursor(outward) }}
          />
        )
      })}

      {RESIZE_HANDLES.map((h) => {
        const p = at(HANDLE_POS[h])
        return (
          <rect
            key={h}
            data-handle={h}
            className="resize-handle"
            x={p.x - HANDLE_SIZE / 2}
            y={p.y - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            pointerEvents="all"
            style={{ cursor: HANDLE_CURSOR[h] }}
          />
        )
      })}

      {showBadge && (
        <SizeBadge
          x={frame.screenBounds.x + frame.screenBounds.width / 2}
          y={frame.screenBounds.y + frame.screenBounds.height + 18}
          text={`${Math.round(frame.size.width)} × ${Math.round(frame.size.height)}`}
        />
      )}
      {dragging && mode === 'rotate' && (
        <SizeBadge
          x={frame.screenBounds.x + frame.screenBounds.width / 2}
          y={frame.screenBounds.y - 14}
          // A multi-selection's frame is axis-aligned, so its own angle is
          // always 0 — the turn so far is the only meaningful figure there.
          // A single object reports its resulting absolute angle.
          text={
            multiple
              ? `${signed(Math.round(getLiveRotation()))}°`
              : `${Math.round(frame.rotation)}°`
          }
        />
      )}
    </g>
  )
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

function SizeBadge({ x, y, text }: { x: number; y: number; text: string }) {
  const width = text.length * 6.6 + 12
  return (
    <g className="size-badge" transform={`translate(${x - width / 2} ${y - 9})`}>
      <rect width={width} height={18} rx={3} />
      <text x={width / 2} y={13} textAnchor="middle">
        {text}
      </text>
    </g>
  )
}

// ---------------------------------------------------------------------------
// Path point editing
// ---------------------------------------------------------------------------

function PathPointOverlay({ viewport, tick }: { viewport: Viewport; tick: number }) {
  void tick
  const editing = getEditingSubpaths()
  const selectedPoints = useEditorStore((s) => s.selectedPointIndices)
  if (!editing) return null

  const toScreen = (x: number, y: number): Vec2 =>
    docToScreen(viewport, applyToXY(editing.world, x, y))

  return (
    <g className="path-points">
      {editing.subs.map((sub, si) =>
        sub.points.map((p, i) => {
          const a = toScreen(p.x, p.y)
          const hIn = p.inX !== null && p.inY !== null ? toScreen(p.inX, p.inY) : null
          const hOut = p.outX !== null && p.outY !== null ? toScreen(p.outX, p.outY) : null
          const selected = selectedPoints.includes(i)
          return (
            <g key={`${si}-${i}`}>
              {hIn && <line className="handle-arm" x1={a.x} y1={a.y} x2={hIn.x} y2={hIn.y} />}
              {hOut && <line className="handle-arm" x1={a.x} y1={a.y} x2={hOut.x} y2={hOut.y} />}
              {hIn && <circle className="bezier-handle" cx={hIn.x} cy={hIn.y} r={3.5} />}
              {hOut && <circle className="bezier-handle" cx={hOut.x} cy={hOut.y} r={3.5} />}
              <rect
                className={selected ? 'anchor-point selected' : 'anchor-point'}
                x={a.x - 3.5}
                y={a.y - 3.5}
                width={7}
                height={7}
              />
            </g>
          )
        }),
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Marquee and snap guides
// ---------------------------------------------------------------------------

function MarqueeBox({ viewport }: { viewport: Viewport }) {
  const marquee = useEditorStore((s) => s.marquee)
  if (!marquee) return null
  const tl = docToScreen(viewport, { x: marquee.x, y: marquee.y })
  const br = docToScreen(viewport, {
    x: marquee.x + marquee.width,
    y: marquee.y + marquee.height,
  })
  return (
    <rect
      className="marquee"
      x={Math.min(tl.x, br.x)}
      y={Math.min(tl.y, br.y)}
      width={Math.abs(br.x - tl.x)}
      height={Math.abs(br.y - tl.y)}
    />
  )
}

function SnapGuides({ viewport }: { viewport: Viewport }) {
  const guides = useEditorStore((s) => s.snapGuides)
  if (guides.length === 0) return null
  return (
    <g className="snap-guides">
      {guides.map((g, i) => {
        if (g.axis === 'x') {
          const p = docToScreen(viewport, { x: g.position, y: g.start })
          const q = docToScreen(viewport, { x: g.position, y: g.end })
          return <line key={i} className={`snap-guide ${g.kind}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
        }
        const p = docToScreen(viewport, { x: g.start, y: g.position })
        const q = docToScreen(viewport, { x: g.end, y: g.position })
        return <line key={i} className={`snap-guide ${g.kind}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
      })}
    </g>
  )
}

export { isDragging }
