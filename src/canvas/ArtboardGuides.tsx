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
import { beginGuideDrag, liveGuide } from '../tools/GuideDrag'
import { docToScreen } from './Viewport'
import { useDocument, useDocumentStore, useEditorStore } from '../state/hooks'
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
function guidesOf(board: ArtboardNode, live: ReturnType<typeof liveGuide>): Guide[] {
  const stored = board.guides ?? []
  if (!live || live.artboardId !== board.id) return stored
  if (!live.guideId) {
    return [...stored, { id: 'live', axis: live.axis, position: live.position }]
  }
  return stored.map((g) => (g.id === live.guideId ? { ...g, position: live.position } : g))
}

/** Everything a guide press needs from the DOM, in one place. */
function useStartDrag() {
  return useCallback(
    (
      e: React.PointerEvent<SVGElement>,
      artboardId: NodeId,
      axis: 'x' | 'y',
      guideId: string | null,
    ) => {
      // Kept from the tools entirely: a guide is chrome, and dragging one must
      // work whichever instrument is selected.
      e.stopPropagation()
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
    <g className="artboard-guides">
      {boards.map((board) => (
        <g key={board.id} transform={toSvgMatrix(localMatrix(board.transform))}>
          {guidesOf(board, live).map((g) => {
            const vertical = g.axis === 'x'
            const from = vertical
              ? { x1: g.position, y1: 0, x2: g.position, y2: board.transform.height }
              : { x1: 0, y1: g.position, x2: board.transform.width, y2: g.position }
            return (
              <g key={g.id} data-guide={g.id}>
                {/* The grab target: invisible, and far wider than the line, so
                    a guide can be caught without pixel-hunting. Same idiom as
                    the radius handles — a transparent hit shape in front of art
                    that takes no pointer events. */}
                {!board.guidesLocked && (
                  <line
                    {...from}
                    className="guide-hit"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="stroke"
                    style={{ cursor: vertical ? 'ew-resize' : 'ns-resize' }}
                    onPointerDown={(e) => startDrag(e, board.id, g.axis, g.id)}
                  />
                )}
                <line
                  {...from}
                  className={`guide${board.guidesLocked ? ' locked' : ''}`}
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

