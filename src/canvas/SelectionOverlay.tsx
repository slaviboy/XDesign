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

import { memo, useMemo } from 'react'
import { applyToXY, meanScale, type Mat2D, type Vec2 } from '../geometry/Matrix'
import { boundsFromPoints, type Bounds } from '../geometry/Bounds'
import {
  localContentBox,
  createMatrixCache,
  geometryBounds,
  localGeometryBounds,
  localMatrix,
  worldMatrix,
} from '../document/SceneGraph'
import { AnchorDot, HandleArm, HandleDot } from './overlayMarks'
import { docToScreen } from './Viewport'
import { intrinsicTextSize } from '../text/TextLayout'
import { fitTextHeight } from '../history/Commands'
import { measureBetween, type AxisDistance } from '../geometry/Distance'
import { unionAll } from '../geometry/Bounds'
import { angleBetween, rotationCursor } from './cursors'
import {
  getDragMode,
  getLiveBox,
  getLiveMatrix,
  getLiveRotation,
  getLiveSize,
  isDragging,
} from '../tools/DragSession'
import { getEditingSubpaths } from '../tools/PathEditing'
import { subpathsToPath } from '../geometry/PathPoints'
import { transformPath } from '../geometry/PathUtils'
import { getLiveRadius, radiusHandlePosition, type RadiusCorner } from '../tools/RadiusSession'
import { getLiveStarRatio } from '../tools/StarRatioSession'
import { starRatioHandlePoint } from '../geometry/ShapeGeometry'
import { multiply, toSvgMatrix } from '../geometry/Matrix'
import { isGradient, sortedStops } from './paint'
import { ANGULAR_RING, stopPointOnAxis } from '../tools/GradientSession'
import { toCss } from '../document/color'
import { cornerRadiusOf, isMaskGroup, supportsCornerRadius, type BoxCorner } from '../document/types'
import {
  ancestorIds,
  isEffectivelyLocked,
  worldMatrix as nodeWorldMatrix,
} from '../document/SceneGraph'
import { useDocument, useEditorStore, useLiveTransformTick } from '../state/hooks'
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

/** Matches the platform default; only used for the fit-to-text handle below. */
const DOUBLE_CLICK_MS = 400

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
  const gradientEditing = useEditorStore((s) => s.gradientEditing)
  const editingContext = useEditorStore((s) => s.editingContext)
  const dragging = useEditorStore((s) => s.isDragging)
  // A single Fixed Size text box whose content is taller than it is. Adobe marks
  // the bottom handle red so the cropping is visible rather than silent.
  const overflowId = useMemo(() => {
    if (selection.length !== 1) return null
    const node = doc.nodes[selection[0]!]
    if (node?.type !== 'text' || node.textStyle.sizing !== 'fixed') return null
    const needed = intrinsicTextSize(node.text, node.textStyle, node.transform.width, node.runs).height
    return needed > node.transform.height + 0.5 ? node.id : null
  }, [doc, selection])
  const tick = useLiveTransformTick()

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
      <MeasureOverlay />
      {hoverOutline && (
        <polygon
          className="hover-outline"
          points={hoverOutline.map((p) => `${p.x},${p.y}`).join(' ')}
        />
      )}

      {!nodeEditingId && !gradientEditing && selection.length === 1 && (
        <RadiusHandles nodeId={selection[0]!} viewport={viewport} tick={tick} />
      )}


      {nodeEditingId ? (
        <PathPointOverlay viewport={viewport} tick={tick} />
      ) : (
        frame && (
          <TransformFrame
        frame={frame}
        dragging={dragging}
        multiple={selection.length > 1}
        overflowId={overflowId}
      />
        )
      )}

      {/* After the frame, deliberately: a linear gradient's default endpoints sit
          exactly on the nw and ne resize handles, and while the picker is open
          the gradient is what the user came to edit. */}
      {!nodeEditingId && gradientEditing && (
        <GradientHandles
          nodeId={gradientEditing.nodeId}
          target={gradientEditing.target}
          viewport={viewport}
          tick={tick}
        />
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
    let world = getLiveMatrix(id) ?? cache.world(doc, id)
    // A resize in flight owns the box, corner included: a path's geometry need
    // not start at its local origin, and the resize keeps it where it starts.
    const liveBox = getLiveBox(id)
    // A group's stored box is written once and never refitted, so framing it
    // draws handles that are not on the artwork the moment a child moves.
    // Measuring the contents puts them back on it.
    let local = liveBox ?? localContentBox(doc, node)

    // A mask group shows only what its mask reveals, so the frame is the
    // mask's — framing the union would draw a rectangle round artwork that is
    // hidden. Composed from the group's live matrix rather than read off the
    // mask directly, so it still tracks a drag.
    const mask = isMaskGroup(node) ? doc.nodes[node.maskId] : undefined
    if (mask && !liveBox) {
      world = multiply(world, localMatrix(mask.transform))
      local = localContentBox(doc, mask)
    }

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

/**
 * Double-click the red bottom handle to fit a Fixed Size box to its text.
 *
 * Detected here rather than with onDoubleClick because the canvas captures the
 * pointer on its own <svg> at pointerdown, which retargets the click and
 * dblclick that follow — a React onDoubleClick on this rect would simply never
 * fire. The first press still starts an ordinary resize, so the handle keeps
 * working as a handle; only the second press within the double-click window
 * fits instead, and stops there so no drag begins behind it.
 */
let lastOverflowPress = 0

function onOverflowHandleDown(e: React.PointerEvent, id: NodeId): void {
  const now = e.timeStamp
  const isSecond = now - lastOverflowPress < DOUBLE_CLICK_MS
  lastOverflowPress = isSecond ? 0 : now
  if (!isSecond) return
  e.stopPropagation()
  e.preventDefault()
  fitTextHeight(id)
}

function TransformFrame({
  frame,
  dragging,
  multiple,
  overflowId,
}: {
  frame: Frame
  dragging: boolean
  multiple: boolean
  /** A Fixed Size text box whose content does not fit, if that is what is selected. */
  overflowId: NodeId | null
}) {
  const textOverflows = !!overflowId
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
        // Adobe: when Fixed Size text does not fit, "XD indicates this with a
        // red bottom resize handle", and double-clicking it fits the box to the
        // content.
        const overflowing = h === 's' && textOverflows
        return (
          <rect
            key={h}
            data-handle={h}
            className={`resize-handle${overflowing ? ' overflowing' : ''}`}
            x={p.x - HANDLE_SIZE / 2}
            y={p.y - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            pointerEvents="all"
            style={{ cursor: HANDLE_CURSOR[h] }}
            onPointerDown={
              overflowing ? (e) => onOverflowHandleDown(e, overflowId!) : undefined
            }
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

/**
 * How far the selection is from whatever is hovered, while Alt is held.
 *
 * A dashed line per axis with the gap on it, which is Adobe's measure gesture.
 * Only axes on which the two boxes are actually SEPARATED get a line: two boxes
 * that overlap horizontally have no horizontal distance, and drawing one would
 * be inventing a number.
 *
 * The hovered object also gets an outline, because a measurement is only
 * meaningful once you can see which two things it is between.
 */
function MeasureOverlay() {
  const doc = useDocument()
  const viewport = useEditorStore((s) => s.viewport)
  const selection = useEditorStore((s) => s.selection)
  const measureTo = useEditorStore((s) => s.measureTo)
  if (!measureTo || selection.length === 0) return null

  const target = doc.nodes[measureTo]
  if (!target) return null
  const cache = createMatrixCache()
  const from = unionAll(selection.map((id) => geometryBounds(doc, id, cache)))
  const to = geometryBounds(doc, measureTo, cache)
  if (from.width === 0 && from.height === 0) return null

  const gaps = measureBetween(from, to)
  const outline = outlineFor(doc, measureTo, viewport)

  return (
    <g className="measure-overlay" pointerEvents="none">
      {outline && (
        <polygon className="measure-target" points={outline.map((p) => `${p.x},${p.y}`).join(' ')} />
      )}
      {gaps.horizontal && <MeasureLine axis="x" gap={gaps.horizontal} viewport={viewport} />}
      {gaps.vertical && <MeasureLine axis="y" gap={gaps.vertical} viewport={viewport} />}
    </g>
  )
}

function MeasureLine({
  axis,
  gap,
  viewport,
}: {
  axis: 'x' | 'y'
  gap: AxisDistance
  viewport: Viewport
}) {
  const a = docToScreen(viewport, axis === 'x' ? { x: gap.from, y: gap.at } : { x: gap.at, y: gap.from })
  const b = docToScreen(viewport, axis === 'x' ? { x: gap.to, y: gap.at } : { x: gap.at, y: gap.to })
  const label = String(Math.round(gap.distance))

  return (
    <g data-measure={axis}>
      <line className="measure-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      {/* End caps, so a short gap still reads as a measurement rather than as
          a stray dash. */}
      <line
        className="measure-cap"
        x1={axis === 'x' ? a.x : a.x - 4}
        y1={axis === 'x' ? a.y - 4 : a.y}
        x2={axis === 'x' ? a.x : a.x + 4}
        y2={axis === 'x' ? a.y + 4 : a.y}
      />
      <line
        className="measure-cap"
        x1={axis === 'x' ? b.x : b.x - 4}
        y1={axis === 'x' ? b.y - 4 : b.y}
        x2={axis === 'x' ? b.x : b.x + 4}
        y2={axis === 'x' ? b.y + 4 : b.y}
      />
      <MeasureBadge x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} text={label} />
    </g>
  )
}

/** The number, on a chip so it stays legible over artwork of any colour. */
function MeasureBadge({ x, y, text }: { x: number; y: number; text: string }) {
  const width = text.length * 6.6 + 12
  return (
    <g className="measure-badge" transform={`translate(${x - width / 2} ${y - 9})`}>
      <rect width={width} height={18} rx={3} />
      <text x={width / 2} y={13} textAnchor="middle">
        {text}
      </text>
    </g>
  )
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
// Corner radius handles
// ---------------------------------------------------------------------------

/** Keeps the handle grabbable when the radius is 0, in screen pixels. */
const RADIUS_HANDLE_MIN_INSET = 13
/** Below this on-screen size the shape is too small to host a handle. */
const RADIUS_HANDLE_MIN_SHAPE = 34

function RadiusHandles({
  nodeId,
  viewport,
  tick,
}: {
  nodeId: NodeId
  viewport: Viewport
  tick: number
}) {
  void tick
  const doc = useDocument()
  const node = doc.nodes[nodeId]
  if (!node || !supportsCornerRadius(node)) return null
  // Honours a locked ANCESTOR, matching every other edit path — a child of a
  // locked group is still selectable from the Layers panel.
  if (isEffectivelyLocked(doc, nodeId)) return null
  // Inside a repeat grid only the first cell registers with LiveTransform, so a
  // radius drag could preview on one cell while committing to all of them.
  if (ancestorIds(doc, nodeId).some((a) => doc.nodes[a]?.type === 'repeat-grid')) return null

  // Live matrix wins during a gesture, exactly as computeFrame does — otherwise
  // the dots stay pinned at the pre-drag position for the whole of a move or
  // resize, floating outside the shape while remaining live pointer targets.
  const live = getLiveMatrix(nodeId)
  const world = live ?? nodeWorldMatrix(doc, nodeId)
  const liveSize = getLiveSize(nodeId)
  // Screen pixels per local unit, so the minimum inset is a constant on screen
  // regardless of zoom or how far the node's ancestors have scaled it.
  const pxPerLocal = meanScale(world) * viewport.zoom
  if (pxPerLocal <= 0) return null

  const width = liveSize?.width ?? node.transform.width
  const height = liveSize?.height ?? node.transform.height
  if (width * pxPerLocal < RADIUS_HANDLE_MIN_SHAPE) return null
  if (height * pxPerLocal < RADIUS_HANDLE_MIN_SHAPE) return null

  const minInset = RADIUS_HANDLE_MIN_INSET / pxPerLocal
  const sized = liveSize
    ? { ...node, transform: { ...node.transform, width, height } }
    : node

  // A box has four independently reachable corners; a polygon's vertices are
  // generated from its sides, so one handle drives the single scalar radius.
  const corners: RadiusCorner[] =
    node.type === 'rect' || node.type === 'image'
      ? ['nw', 'ne', 'se', 'sw']
      : ['vertex']

  // The Star Ratio handle sits on the first inner vertex — at ratio 1 that is an
  // edge midpoint, which is how a plain polygon advertises the gesture.
  let starHandle: { x: number; y: number } | null = null
  if (node.type === 'polygon') {
    const ratio = getLiveStarRatio(nodeId) ?? node.starRatio
    const at = starRatioHandlePoint(width, height, node.sides, ratio)
    starHandle = docToScreen(viewport, applyToXY(world, at.x, at.y))
  }

  return (
    <g className="radius-handles">
      {starHandle && (
        <g data-handle="star-ratio">
          {/* Invisible, larger target so the dot is easy to grab. */}
          <circle
            cx={starHandle.x}
            cy={starHandle.y}
            r={9}
            fill="transparent"
            pointerEvents="all"
            style={{ cursor: 'move' }}
          />
          <circle
            className="star-ratio-handle"
            cx={starHandle.x}
            cy={starHandle.y}
            r={4}
            pointerEvents="none"
          />
        </g>
      )}
      {corners.map((corner) => {
        // Per-corner radius, so independent corners each show their own inset.
        const boxCorner = corner === 'vertex' ? undefined : (corner as BoxCorner)
        const radius = getLiveRadius(nodeId, boxCorner) ?? cornerRadiusOf(node, boxCorner)
        const local = radiusHandlePosition(sized, corner, radius, minInset)
        if (!local) return null
        const p = docToScreen(viewport, applyToXY(world, local.x, local.y))
        return (
          <g key={corner} data-handle="radius" data-corner={corner}>
            {/* Invisible, larger target so the dot is easy to grab. */}
            <circle
              cx={p.x}
              cy={p.y}
              r={9}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: 'nwse-resize' }}
            />
            <circle className="radius-handle-ring" cx={p.x} cy={p.y} r={4.5} pointerEvents="none" />
            <circle className="radius-handle-dot" cx={p.x} cy={p.y} r={1.5} pointerEvents="none" />
          </g>
        )
      })}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Gradient handles
// ---------------------------------------------------------------------------

/**
 * The on-canvas gradient editor.
 *
 * Adobe lists this as a component of the gradient colour picker, so it is gated
 * on `gradientEditing` — set while the picker is open — rather than on selection
 * alone. That also disambiguates the fill's gradient from the stroke's.
 *
 * Everything is placed by crossing objectBoundingBox units into local space:
 * `unit x (width, height) -> local -> world -> screen`. Skipping that scale is
 * the classic way to get a widget that looks right on a square node and drifts
 * off the paint on every other one.
 */
function GradientHandles({
  nodeId,
  target,
  viewport,
  tick,
}: {
  nodeId: NodeId
  target: 'fill' | 'stroke'
  viewport: Viewport
  tick: number
}) {
  void tick
  const doc = useDocument()
  const activeStop = useEditorStore((s) => s.activeGradientStop)
  const node = doc.nodes[nodeId]
  if (!node || !('style' in node)) return null
  if (isEffectivelyLocked(doc, nodeId)) return null
  // Note: no repeat-grid bail-out here, unlike RadiusHandles. That guard exists
  // because only cell 0 registers with LiveTransform; this widget writes to the
  // store, which every cell renders from, so it works inside a grid.

  const paint = target === 'stroke' ? node.style.stroke.paint : node.style.fill
  if (!isGradient(paint)) return null

  const live = getLiveMatrix(nodeId)
  const world = live ?? nodeWorldMatrix(doc, nodeId)
  const liveSize = getLiveSize(nodeId)
  const width = liveSize?.width ?? node.transform.width
  const height = liveSize?.height ?? node.transform.height
  if (width <= 0 || height <= 0) return null
  // Below this the handles pile into an unusable cluster, the same reason the
  // radius dots hide on a tiny shape.
  const pxPerLocal = meanScale(world) * viewport.zoom
  if (Math.min(width, height) * pxPerLocal < RADIUS_HANDLE_MIN_SHAPE) return null

  /** unit -> screen, the whole chain in one place. */
  const toScreen = (ux: number, uy: number) =>
    docToScreen(viewport, applyToXY(world, ux * width, uy * height))

  const stops = sortedStops(paint.stops)

  // Where the widget's axis runs, in unit space: the segment for a linear
  // gradient, the +x radius ray for a radial one, the rotation ray for angular.
  let a: { x: number; y: number }
  let b: { x: number; y: number }
  if (paint.type === 'linear') {
    a = { x: paint.x1, y: paint.y1 }
    b = { x: paint.x2, y: paint.y2 }
  } else if (paint.type === 'radial') {
    a = { x: paint.cx, y: paint.cy }
    b = { x: paint.cx + paint.r, y: paint.cy }
  } else {
    const rad = (paint.rotation * Math.PI) / 180
    a = { x: paint.cx, y: paint.cy }
    b = { x: paint.cx + Math.cos(rad) * ANGULAR_RING, y: paint.cy + Math.sin(rad) * ANGULAR_RING }
  }

  const pa = toScreen(a.x, a.y)
  const pb = toScreen(b.x, b.y)

  // The painted extent of a radial gradient is an ELLIPSE, because the unit
  // square is scaled by the box — a circle would not touch the paint's edge on
  // any node that is not square. Drawn as a transformed circle so rotation and
  // shear come along too.
  const ring =
    paint.type === 'radial'
      ? {
          cx: paint.cx * width,
          cy: paint.cy * height,
          rx: paint.r * width,
          ry: paint.r * height,
        }
      : null

  return (
    <g className="gradient-handles">
      {ring && (
        <ellipse
          className="gradient-ring"
          cx={ring.cx}
          cy={ring.cy}
          rx={ring.rx}
          ry={ring.ry}
          transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom}) ${toSvgMatrix(world)}`}
          pointerEvents="none"
        />
      )}

      {/* The segment doubles as a grab target: dragging it moves the whole
          gradient, which is Adobe's "drag the segment to change direction". */}
      <g data-handle="gradient" data-corner="segment">
        <line
          x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
          stroke="transparent"
          strokeWidth={10}
          pointerEvents="all"
          style={{ cursor: 'move' }}
        />
        <line className="gradient-axis" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} pointerEvents="none" />
      </g>

      {stops.map((stop) => {
        // Through the paint's own axis, so an angular gradient's stops sit on the
        // ring at the angle they paint rather than strung along a straight line.
        const u = stopPointOnAxis(paint, stop.offset)
        const p = toScreen(u.x, u.y)
        return (
          <g key={stop.id} data-handle="gradient" data-corner="stop" data-stop={stop.id}>
            <circle cx={p.x} cy={p.y} r={8} fill="transparent" pointerEvents="all" style={{ cursor: 'grab' }} />
            {/* Opaque backing, so a translucent stop is readable over artwork. */}
            <circle className="gradient-stop-base" cx={p.x} cy={p.y} r={4} pointerEvents="none" />
            <circle
              className={`gradient-stop-dot${stop.id === activeStop ? ' active' : ''}`}
              cx={p.x}
              cy={p.y}
              r={4}
              fill={toCss(stop.color)}
              pointerEvents="none"
            />
          </g>
        )
      })}

      {[
        { corner: paint.type === 'linear' ? 'start' : 'center', p: pa, cursor: 'move' },
        {
          corner: paint.type === 'linear' ? 'end' : paint.type === 'radial' ? 'radius' : 'angle',
          p: pb,
          cursor: paint.type === 'linear' ? 'move' : 'crosshair',
        },
      ].map(({ corner, p, cursor }) => (
        <g key={corner} data-handle="gradient" data-corner={corner}>
          <circle cx={p.x} cy={p.y} r={9} fill="transparent" pointerEvents="all" style={{ cursor }} />
          <circle className="gradient-endpoint" cx={p.x} cy={p.y} r={5} pointerEvents="none" />
        </g>
      ))}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Path point editing
// ---------------------------------------------------------------------------

function PathPointOverlay({ viewport, tick }: { viewport: Viewport; tick: number }) {
  void tick
  const editing = getEditingSubpaths()
  const selectedPoints = useEditorStore((s) => s.selectedPoints)
  const selectedSegments = useEditorStore((s) => s.selectedSegments)
  if (!editing) return null

  const toScreen = (x: number, y: number): Vec2 =>
    docToScreen(viewport, applyToXY(editing.world, x, y))

  // The outline being edited, drawn on top of the artwork.
  //
  // Without it the points float over a filled shape with nothing joining them,
  // and on a shape whose fill matches its surroundings there is no visible edge
  // at all. Screen space, so the hairline stays a hairline at any zoom, and it
  // is drawn from the LIVE point model rather than the document so it tracks a
  // drag frame by frame.
  const outline = transformPath(
    subpathsToPath(editing.subs),
    multiply([viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y], editing.world),
  )

  // A selected segment is drawn as a thicker line over the outline, so it is
  // obvious which edges a drag is about to move — the anchors alone cannot say
  // it, since a segment is selected without either of its ends being.
  const segmentPaths = selectedSegments.flatMap((segment) => {
    const sub = editing.subs[segment.subpath]
    if (!sub) return []
    const from = sub.points[segment.index]
    const to = sub.points[segment.index + 1] ?? (sub.closed ? sub.points[0] : undefined)
    if (!from || !to) return []
    const a = toScreen(from.x, from.y)
    const b = toScreen(to.x, to.y)
    // Through the handles when there are any, so the highlight follows a curve
    // rather than cutting the corner off it.
    const c1 = from.outX !== null && from.outY !== null ? toScreen(from.outX, from.outY) : null
    const c2 = to.inX !== null && to.inY !== null ? toScreen(to.inX, to.inY) : null
    const d =
      c1 || c2
        ? `M ${a.x} ${a.y} C ${(c1 ?? a).x} ${(c1 ?? a).y} ${(c2 ?? b).x} ${(c2 ?? b).y} ${b.x} ${b.y}`
        : `M ${a.x} ${a.y} L ${b.x} ${b.y}`
    return [{ key: `${segment.subpath}-${segment.index}`, d }]
  })

  return (
    <g className="path-points">
      <path className="edit-outline" d={outline} />
      {segmentPaths.map((segment) => (
        <path key={segment.key} className="selected-segment" d={segment.d} />
      ))}
      {editing.subs.map((sub, si) =>
        sub.points.map((p, i) => {
          const a = toScreen(p.x, p.y)
          const hIn = p.inX !== null && p.inY !== null ? toScreen(p.inX, p.inY) : null
          const hOut = p.outX !== null && p.outY !== null ? toScreen(p.outX, p.outY) : null
          // Matched on the subpath too: a bare index lit up the matching point
          // of every ring at once.
          const selected = selectedPoints.some(
            (r) => r.subpath === si && r.index === i && r.kind === 'anchor',
          )
          return (
            <g key={`${si}-${i}`}>
              {hIn && <HandleArm from={a} to={hIn} />}
              {hOut && <HandleArm from={a} to={hOut} />}
              {hIn && <HandleDot x={hIn.x} y={hIn.y} />}
              {hOut && <HandleDot x={hOut.x} y={hOut.y} />}
              <AnchorDot x={a.x} y={a.y} selected={selected} />
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
