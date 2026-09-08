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
 * Ruler guides, and the artboard edges you pull them out of.
 *
 * Adobe's model, which is not Photoshop's: there are no rulers down the side of
 * the window. "An area is added to the top and left of your artboards that
 * allow you to drag out guides" — so the grab handles are strips straddling
 * each artboard's own top and left border, and a guide belongs to the artboard
 * it came from.
 *
 * Stored in the document (so they are saved and restored) but never exported —
 * the exporter walks the scene graph, and guides are not nodes.
 *
 * Two coordinate spaces, on purpose:
 *  - the GUIDES draw in document space, inside the artboard's own matrix, so
 *    they move and scale with the artboard they belong to;
 *  - the STRIPS draw in screen space, so they stay a comfortable 12px target at
 *    any zoom, exactly as the artboard labels stay 11px type.
 */

import { memo, useCallback } from 'react'
import { toSvgMatrix } from '../geometry/Matrix'
import { artboardIds, geometryBounds, localMatrix } from '../document/SceneGraph'
import { beginGuideDrag, liveGuide, type LiveGuide } from '../tools/GuideDrag'
import { docToScreen } from './Viewport'
import { useDocument, useDocumentStore, useEditorStore } from '../state/hooks'
import { selectGuide } from '../state/EditorStore'
import { toCss } from '../document/color'
import type { ArtboardNode, Guide, NodeId } from '../document/types'

/** How far a grab strip reaches outside and inside its artboard edge, in px. */
const STRIP_OUTSIDE = 12
const STRIP_INSIDE = 3

/**
 * An artboard's guides, with the in-flight one standing in for its stored self.
 *
 * A guide being pulled out of the edge is not in the document at all yet, so it
 * is appended; one being moved replaces its own stored position.
 */
function isLive(guide: Guide, live: LiveGuide | null): boolean {
  if (!live) return false
  return live.guideId ? guide.id === live.guideId : guide.id === 'live'
}

function guidesOf(board: ArtboardNode, live: LiveGuide | null): Guide[] {
  const stored = board.guides ?? []
  if (!live || live.artboardId !== board.id) return stored

  // Dragged clear of the artboard: hidden, because releasing here removes it.
  // Showing a guide floating outside the artboard it belongs to would be a
  // picture of a state the model cannot hold.
  const extent = live.axis === 'x' ? board.transform.width : board.transform.height
  const outside = live.position < 0 || live.position > extent

  if (!live.guideId) {
    return outside ? stored : [...stored, { id: 'live', axis: live.axis, position: live.position }]
  }
  return stored.flatMap((g) => {
    if (g.id !== live.guideId) return [g]
    return outside ? [] : [{ ...g, position: live.position }]
  })
}

/** Everything a guide press needs from the DOM, in one place. */
function useStartDrag() {
  return useCallback(
    (
      e: React.PointerEvent<SVGElement>,
      artboardId: NodeId,
      axis: 'x' | 'y',
      guideId: string | null,
      drag = true,
    ) => {
      // Kept from the tools entirely: a guide is chrome, and dragging one must
      // work whichever instrument is selected.
      e.stopPropagation()
      if (guideId) selectGuide(artboardId, guideId)
      if (!drag) return
      const svg = e.currentTarget.ownerSVGElement
      if (!svg) return
      beginGuideDrag(artboardId, axis, guideId, e.nativeEvent, e.currentTarget, svg)
    },
    [],
  )
}

// ------------------------------------------------------------- the guides --

export const ArtboardGuides = memo(function ArtboardGuides() {
  const doc = useDocument()
  const visible = useDocumentStore((s) => s.doc.settings.guidesVisible)
  const color = useDocumentStore((s) => s.doc.settings.guideColor)
  const dragMode = useDocumentStore((s) => s.doc.settings.guideDragMode)
  const selected = useEditorStore((s) => s.selectedGuide)
  // A drag writes nothing to the document until it is released, so this is the
  // only thing that says the guide has moved. See GuideDrag.
  useEditorStore((s) => s.overlayTick)
  const live = liveGuide()
  const startDrag = useStartDrag()
  if (!visible) return null

  const boards = artboardIds(doc)
    .map((id) => doc.nodes[id])
    .filter(
      (n): n is ArtboardNode =>
        !!n &&
        n.type === 'artboard' &&
        n.visible &&
        (!!n.guides?.length || n.id === live?.artboardId),
    )
  if (boards.length === 0) return null

  return (
    <g className="artboard-guides" style={{ stroke: toCss(color) }}>
      {boards.map((board) => (
        <g key={board.id} transform={toSvgMatrix(localMatrix(board.transform))}>
          {guidesOf(board, live).map((g) => {
            const vertical = g.axis === 'x'
            const from = vertical
              ? { x1: g.position, y1: 0, x2: g.position, y2: board.transform.height }
              : { x1: 0, y1: g.position, x2: board.transform.width, y2: g.position }
            const isSelected =
              selected?.artboardId === board.id && selected.guideId === g.id
            return (
              <g key={g.id} data-guide={g.id}>
                {/* The grab target: invisible, and far wider than the line, so
                    a guide can be caught without pixel-hunting. Same idiom as
                    the radius handles — a transparent hit shape in front of art
                    that takes no pointer events.
                    In handle-only mode it still SELECTS, so a guide is always
                    reachable by clicking it; only the drag moves to the handle. */}
                {!board.guidesLocked && (
                  <line
                    {...from}
                    className="guide-hit"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="stroke"
                    style={{ cursor: dragMode === 'line' ? (vertical ? 'ew-resize' : 'ns-resize') : 'pointer' }}
                    onPointerDown={(e) => startDrag(e, board.id, g.axis, g.id, dragMode === 'line')}
                  />
                )}
                <line
                  {...from}
                  className={
                    `guide${board.guidesLocked ? ' locked' : ''}` +
                    (isLive(g, live) ? ' active' : '') +
                    (isSelected ? ' selected' : '')
                  }
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              </g>
            )
          })}
        </g>
      ))}
    </g>
  )
})

// ------------------------------------------------------------- the strips --

/**
 * The pull-out areas along each artboard's top and left border.
 *
 * Biased outward — 12px outside the edge against 3px inside — so they sit in
 * the margin around the artboard rather than over the artwork, while still
 * covering the border itself, which is what Adobe tells you to hover.
 */
export const GuideStrips = memo(function GuideStrips() {
  const doc = useDocument()
  const viewport = useEditorStore((s) => s.viewport)
  const visible = useDocumentStore((s) => s.doc.settings.guidesVisible)
  const startDrag = useStartDrag()
  if (!visible) return null

  const boards = artboardIds(doc)
  if (boards.length === 0) return null

  return (
    <g className="guide-strips">
      {boards.map((id) => {
        const node = doc.nodes[id]
        if (!node || node.type !== 'artboard' || !node.visible || node.guidesLocked) return null
        const b = geometryBounds(doc, id)
        const origin = docToScreen(viewport, { x: b.x, y: b.y })
        const width = b.width * viewport.zoom
        const height = b.height * viewport.zoom
        // Nothing to grab on an artboard scrolled off screen, or one zoomed so
        // far out that the two strips would overlap each other.
        if (width < STRIP_OUTSIDE * 2 || height < STRIP_OUTSIDE * 2) return null

        return (
          <g key={id}>
            <rect
              className="guide-strip"
              data-guide-strip="x"
              data-artboard={id}
              x={origin.x - STRIP_OUTSIDE}
              y={origin.y}
              width={STRIP_OUTSIDE + STRIP_INSIDE}
              height={height}
              style={{ cursor: 'ew-resize' }}
              onPointerDown={(e) => startDrag(e, id, 'x', null)}
            />
            <rect
              className="guide-strip"
              data-guide-strip="y"
              data-artboard={id}
              x={origin.x}
              y={origin.y - STRIP_OUTSIDE}
              width={width}
              height={STRIP_OUTSIDE + STRIP_INSIDE}
              style={{ cursor: 'ns-resize' }}
              onPointerDown={(e) => startDrag(e, id, 'y', null)}
            />
          </g>
        )
      })}
    </g>
  )
})

// ------------------------------------------------------------ the readout --

/**
 * The rule sits ON the artboard's border, with its numbers just above it.
 *
 * The artboard's name label occupies the same strip, so it is hidden for the
 * length of the drag rather than the rule being pushed off the edge it is
 * measuring — the whole point of the rule is that it lines up with the border.
 */
const RULE_OFFSET = 0

/**
 * What a guide being dragged tells you: where it is, and what it divides.
 *
 * Two readings, because they answer different questions. The chip by the
 * cursor gives the guide's own coordinate — the number you would type into a
 * field. The pair along the artboard's edge gives the distance to each side of
 * it, which is what you are usually actually after when placing a guide: a
 * margin, or a column.
 *
 * Screen space, so the type stays legible at any zoom, like the artboard labels.
 */
export const GuideReadout = memo(function GuideReadout() {
  const doc = useDocument()
  const viewport = useEditorStore((s) => s.viewport)
  // The drag writes nothing to the document, so this is the only signal.
  useEditorStore((s) => s.overlayTick)
  const live = liveGuide()
  if (!live) return null

  const board = doc.nodes[live.artboardId]
  if (!board || board.type !== 'artboard') return null
  const bounds = geometryBounds(doc, live.artboardId)
  const origin = docToScreen(viewport, { x: bounds.x, y: bounds.y })
  const vertical = live.axis === 'x'
  const extent = vertical ? board.transform.width : board.transform.height
  const span = extent * viewport.zoom
  const at = (vertical ? origin.x : origin.y) + live.position * viewport.zoom

  // The two distances the guide divides the artboard into.
  const before = Math.round(live.position)
  const after = Math.round(extent - live.position)
  const start = vertical ? origin.x : origin.y
  const end = start + span
  const rule = (vertical ? origin.y : origin.x) - RULE_OFFSET

  return (
    <g className="guide-readout" pointerEvents="none">
      {vertical ? (
        <>
          <line className="guide-rule" x1={start} y1={rule} x2={end} y2={rule} />
          <text className="guide-measure" x={(start + at) / 2} y={rule - 6} textAnchor="middle">
            {before}
          </text>
          <text className="guide-measure" x={(at + end) / 2} y={rule - 6} textAnchor="middle">
            {after}
          </text>
        </>
      ) : (
        <>
          <line className="guide-rule" x1={rule} y1={start} x2={rule} y2={end} />
          {/* Upright rather than rotated with the rule: a number read sideways
              is slower than one read straight, and there is room beside it. */}
          <text className="guide-measure" x={rule - 6} y={(start + at) / 2} textAnchor="end">
            {before}
          </text>
          <text className="guide-measure" x={rule - 6} y={(at + end) / 2} textAnchor="end">
            {after}
          </text>
        </>
      )}

      {live.pointer && (
        <GuideChip
          x={live.pointer.x + 18}
          y={live.pointer.y - 14}
          axis={live.axis}
          value={Math.round(live.position)}
        />
      )}
    </g>
  )
})

/** The coordinate chip that follows the cursor: a dimmed axis, then the value. */
function GuideChip({
  x,
  y,
  axis,
  value,
}: {
  x: number
  y: number
  axis: 'x' | 'y'
  value: number
}) {
  const label = String(value)
  const width = label.length * 7.6 + 28
  return (
    <g className="guide-chip" transform={`translate(${x} ${y})`} data-guide-readout={`${axis}${value}`}>
      <rect width={width} height={26} rx={4} />
      <text x={11} y={17} className="guide-chip-axis">
        {axis.toUpperCase()}
      </text>
      <text x={26} y={17}>
        {label}
      </text>
    </g>
  )
}

// ------------------------------------------------------------- the handle --

/** Radius of the grab knob on a selected guide, in px. */
const HANDLE_RADIUS = 6

/**
 * The drag handle on the selected guide.
 *
 * Two jobs at once, which is why it is worth its own element: it shows WHICH
 * guide is selected, at the artboard's edge where it cannot be lost among the
 * artwork, and it is a target that can always be dragged — including when the
 * line itself has been set not to be.
 *
 * Screen space, beside the strips, so it stays the same comfortable size at any
 * zoom rather than becoming a speck or a slab.
 */
export const GuideHandle = memo(function GuideHandle() {
  const doc = useDocument()
  const viewport = useEditorStore((s) => s.viewport)
  const visible = useDocumentStore((s) => s.doc.settings.guidesVisible)
  const color = useDocumentStore((s) => s.doc.settings.guideColor)
  const selected = useEditorStore((s) => s.selectedGuide)
  // Follows the guide while it is being dragged, like everything else here.
  useEditorStore((s) => s.overlayTick)
  const live = liveGuide()
  const startDrag = useStartDrag()
  if (!visible || !selected) return null

  const board = doc.nodes[selected.artboardId]
  if (!board || board.type !== 'artboard' || board.guidesLocked) return null
  const guide = board.guides?.find((g) => g.id === selected.guideId)
  if (!guide) return null

  const position =
    live && live.guideId === guide.id && live.artboardId === board.id
      ? live.position
      : guide.position
  const extent = guide.axis === 'x' ? board.transform.width : board.transform.height
  // Hidden along with the guide when it has been dragged clear of the artboard.
  if (position < 0 || position > extent) return null

  const bounds = geometryBounds(doc, selected.artboardId)
  const origin = docToScreen(viewport, { x: bounds.x, y: bounds.y })
  const vertical = guide.axis === 'x'
  const at = (vertical ? origin.x : origin.y) + position * viewport.zoom

  // Centred ON the artboard's border, straddling it, so the knob reads as
  // belonging to the edge the guide is measured from rather than floating
  // beside it.
  const cx = vertical ? at : origin.x
  const cy = vertical ? origin.y : at

  return (
    <circle
      cx={cx}
      cy={cy}
      r={HANDLE_RADIUS}
      className="guide-handle"
      data-guide-handle={guide.id}
      // White fill with the guide's own colour as the stroke: it has to read
      // against both the artboard and the pasteboard it sits between, and the
      // stroke is what ties it to the guide it belongs to.
      style={{ stroke: toCss(color), cursor: vertical ? 'ew-resize' : 'ns-resize' }}
      onPointerDown={(e) => startDrag(e, board.id, guide.axis, guide.id)}
    />
  )
})
