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
 * The canvas surface.
 *
 * Owns pointer capture, coordinate conversion and dispatch to the active tool.
 * Tools never see raw DOM events — they get a CanvasPointerEvent with document
 * coordinates already resolved, which is what keeps every tool agreeing about
 * where the cursor is at fractional zoom.
 *
 * Layer order matters and is deliberate:
 *   viewport group (pan/zoom)  -> grid, document, guides
 *   screen-space group          -> selection handles, tool previews, snap guides
 *
 * Handles live OUTSIDE the zoom transform so they stay a constant size on screen
 * at any zoom, and — more importantly — so they are never part of the document
 * and can never end up in an export.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { DocumentLayer } from './NodeRenderer'
import { SelectionOverlay } from './SelectionOverlay'
import { TracePreviewLayer } from './TracePreview'
import { TextEditOverlay } from './TextEditOverlay'
import { GridOverlay } from './GridOverlay'
import { ImportIcon } from '../ui/icons'
import { t } from '../i18n'
import { useLanguage } from '../state/hooks-i18n'
import { ArtboardGuides, GuideHandle, GuideReadout, GuideStrips } from './ArtboardGuides'
import { ToolOverlay } from './ToolOverlay'
import { ArtboardLabels, ArtboardNameEditor } from './ArtboardLabels'
import { TextEditor } from './TextEditor'
import { screenDistanceToDoc, screenToDoc, docToScreen } from './Viewport'
import { getTool } from '../tools/ToolRegistry'
import { documentStore, getDoc } from '../state/DocumentStore'
import { artboardAtPoint, geometryBounds } from '../document/SceneGraph'
import { toCss } from '../document/color'
import {
  endTextEditing,
  editorStore,
  panBy,
  refreshOverlay,
  setEditor,
  setViewport,
  zoomAt,
} from '../state/EditorStore'
import { useDocumentStore, useEditorStore } from '../state/hooks'
import { endPathEditing, syncPathEditing } from '../tools/PathEditing'
import { syncPen } from '../tools/PenTool'
import type { CanvasPointerEvent, ToolContext } from '../tools/types'
import type { Vec2 } from '../geometry/Matrix'

/** Screen-pixel hit tolerance, converted to document units per event. */
const HIT_TOLERANCE_PX = 4

export interface CanvasProps {
  onFilesDropped?: (files: FileList, at: Vec2) => void
  onContextMenu?: (screen: Vec2, doc: Vec2) => void
}

/** How much of the wheel's delta becomes zoom. Tuned against a trackpad pinch. */
const ZOOM_WHEEL_RATE = 0.01

/**
 * The largest delta one wheel event may contribute.
 *
 * A trackpad pinch arrives as a stream of small deltas — four to ten pixels an
 * event, sixty times a second — and the exponential above turns that into a
 * smooth ramp. A MOUSE wheel sends one notch of 100 to 120 in a single event,
 * and some send 240: through the same exponential that is a 2.7x jump per
 * notch, or 11x. Clamping to 25 caps one event at about 1.28x, which leaves the
 * pinch untouched (its deltas are far below the clamp) and turns a mouse notch
 * into a step you can actually stop on.
 */
const ZOOM_WHEEL_MAX_DELTA = 25

/**
 * The wheel's delta in pixels, whatever unit it arrived in.
 *
 * deltaMode is not always pixels: Firefox reports lines for a mouse wheel and
 * some browsers report pages. Reading deltaY raw makes a line-mode notch of 3
 * look like three pixels — a zoom that barely moves — while a pixel-mode notch
 * of 120 blows past everything.
 */
function wheelZoomDelta(e: WheelEvent, el: HTMLElement): number {
  const LINE_HEIGHT = 16
  const pixels =
    e.deltaMode === 1
      ? e.deltaY * LINE_HEIGHT
      : e.deltaMode === 2
        ? e.deltaY * el.clientHeight
        : e.deltaY
  return Math.max(-ZOOM_WHEEL_MAX_DELTA, Math.min(ZOOM_WHEEL_MAX_DELTA, pixels))
}

export function Canvas({ onFilesDropped, onContextMenu }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const lastScreenRef = useRef<Vec2>({ x: 0, y: 0 })
  const activePointerRef = useRef<number | null>(null)
  const dragDepthRef = useRef(0)

  const viewport = useEditorStore((s) => s.viewport)
  const canvasSize = useEditorStore((s) => s.canvasSize)
  const toolId = useEditorStore((s) => s.tool)
  const editingTextId = useEditorStore((s) => s.editingTextId)
  const guideColor = useDocumentStore((s) => s.doc.settings.guideColor)

  // --- coordinate helpers ---------------------------------------------------

  const toCanvasPoint = useCallback((clientX: number, clientY: number): Vec2 => {
    const rect = containerRef.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }, [])

  const ctx = useMemo<ToolContext>(
    () => ({
      doc: () => getDoc(),
      editor: () => editorStore.getState(),
      viewport: () => editorStore.getState().viewport,
      screenToDoc: (p) => screenToDoc(editorStore.getState().viewport, p),
      docToScreen: (p) => docToScreen(editorStore.getState().viewport, p),
      tolerance: () => screenDistanceToDoc(editorStore.getState().viewport, HIT_TOLERANCE_PX),
      refreshOverlay,
    }),
    [],
  )

  const buildEvent = useCallback(
    (e: ReactPointerEvent | PointerEvent): CanvasPointerEvent => {
      const screen = toCanvasPoint(e.clientX, e.clientY)
      const v = editorStore.getState().viewport
      const doc = screenToDoc(v, screen)
      const prev = lastScreenRef.current
      lastScreenRef.current = screen

      const target = e.target as Element | null
      const nodeEl = target?.closest?.('[data-node-id]') as HTMLElement | null
      const handleEl = target?.closest?.('[data-handle]') as HTMLElement | null

      return {
        screen,
        doc,
        deltaScreen: { x: screen.x - prev.x, y: screen.y - prev.y },
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        primaryModifier: e.metaKey || e.ctrlKey,
        button: e.button,
        buttons: e.buttons,
        pointerId: e.pointerId,
        targetNodeId: nodeEl?.dataset.nodeId ?? null,
        targetHandle: handleEl?.dataset.handle ?? null,
        targetCorner: handleEl?.dataset.corner ?? null,
        native: e as PointerEvent,
      }
    },
    [toCanvasPoint],
  )

  // --- size tracking --------------------------------------------------------

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      const current = editorStore.getState().canvasSize
      if (Math.abs(current.width - rect.width) > 0.5 || Math.abs(current.height - rect.height) > 0.5) {
        setEditor({ canvasSize: { width: rect.width, height: rect.height } })
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // `nodeEditingId` is the single source of truth for the point model: whoever
  // sets it opens the editor, whoever clears it closes the editor. That is what
  // lets the two pointer tools hand point editing back and forth without either
  // of them tearing it down in onDeactivate.
  useEffect(() => {
    return editorStore.subscribe((s) => {
      if (s.nodeEditingId) syncPathEditing()
      else endPathEditing()
    })
  }, [])

  // The document can change without the editor store changing at all — undo and
  // redo do exactly that. Without this, undoing a shape-to-path conversion left
  // the point model holding path data for a node that was a rectangle again,
  // and undoing an anchor mid-path left the pen ready to write the pre-undo
  // geometry straight back on the next click.
  useEffect(() => {
    return documentStore.subscribe(() => {
      if (editorStore.getState().nodeEditingId) syncPathEditing()
      syncPen()
    })
  }, [])

  // --- pointer ---------------------------------------------------------------

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      // Middle button always pans, whatever the active tool is.
      if (e.button === 1) {
        e.preventDefault()
        activePointerRef.current = e.pointerId
        svgRef.current?.setPointerCapture(e.pointerId)
        middlePanRef.current = true
        return
      }
      if (e.button !== 0) return

      // Committing an in-progress text edit before anything else runs.
      if (editorStore.getState().editingTextId) endTextEditing()

      const ev = buildEvent(e)
      lastScreenRef.current = ev.screen
      activePointerRef.current = e.pointerId
      svgRef.current?.setPointerCapture(e.pointerId)
      getTool(editorStore.getState().tool).onPointerDown?.(ev, ctx)
    },
    [buildEvent, ctx],
  )

  const middlePanRef = useRef(false)

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (middlePanRef.current) {
        panBy(e.movementX, e.movementY)
        return
      }
      // Coalesced events give us every sample the OS captured without firing a
      // handler per sample; the tool sees the latest position and the drag loop
      // still flushes once per frame.
      const native = e.nativeEvent
      const events =
        typeof native.getCoalescedEvents === 'function' && e.buttons !== 0
          ? native.getCoalescedEvents()
          : [native]
      const last = events[events.length - 1] ?? native
      getTool(editorStore.getState().tool).onPointerMove?.(buildEvent(last), ctx)
    },
    [buildEvent, ctx],
  )

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (middlePanRef.current) {
        middlePanRef.current = false
        if (activePointerRef.current !== null) {
          svgRef.current?.releasePointerCapture(activePointerRef.current)
          activePointerRef.current = null
        }
        return
      }
      if (activePointerRef.current !== e.pointerId) return
      getTool(editorStore.getState().tool).onPointerUp?.(buildEvent(e), ctx)
      try {
        svgRef.current?.releasePointerCapture(e.pointerId)
      } catch {
        // Capture may already be gone if the pointer left the window.
      }
      activePointerRef.current = null
    },
    [buildEvent, ctx],
  )

  const onDoubleClick = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      getTool(editorStore.getState().tool).onDoubleClick?.(buildEvent(e), ctx)
    },
    [buildEvent, ctx],
  )

  // --- wheel ----------------------------------------------------------------

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Registered natively (not via React) because it must be non-passive to
    // preventDefault, or the browser page-zooms on pinch and Ctrl+wheel.
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const screen = toCanvasPoint(e.clientX, e.clientY)
      const v = editorStore.getState().viewport

      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel; exponential mapping keeps the
        // zoom feeling linear to the fingers.
        const factor = Math.exp(-wheelZoomDelta(e, el) * ZOOM_WHEEL_RATE)
        zoomAt(screen.x, screen.y, v.zoom * factor)
      } else if (e.shiftKey) {
        panBy(-e.deltaY, 0)
      } else {
        panBy(-e.deltaX, -e.deltaY)
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [toCanvasPoint])

  // --- drag and drop --------------------------------------------------------

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      // Without preventDefault the browser navigates away to the dropped file.
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      const screen = toCanvasPoint(e.clientX, e.clientY)
      const count = e.dataTransfer.items?.length ?? 0
      // Named, because this is exactly where the file will be parented — the
      // same artboardAtPoint that containerAtPoint uses on the drop itself.
      const doc = getDoc()
      const artboardId = artboardAtPoint(doc, screenToDoc(editorStore.getState().viewport, screen))
      setEditor({
        dropIndicator: { x: screen.x, y: screen.y, label: dropLabel(count), artboardId },
      })
    },
    [toCanvasPoint],
  )

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current += 1
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current -= 1
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0
      setEditor({ dropIndicator: null })
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragDepthRef.current = 0
      setEditor({ dropIndicator: null })
      const screen = toCanvasPoint(e.clientX, e.clientY)
      const at = screenToDoc(editorStore.getState().viewport, screen)
      if (e.dataTransfer.files?.length) onFilesDropped?.(e.dataTransfer.files, at)
    },
    [onFilesDropped, toCanvasPoint],
  )

  const onContextMenuHandler = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const screen = toCanvasPoint(e.clientX, e.clientY)
      onContextMenu?.(screen, screenToDoc(editorStore.getState().viewport, screen))
    },
    [onContextMenu, toCanvasPoint],
  )

  const tool = getTool(toolId)
  const cursor = middlePanRef.current ? 'grabbing' : tool.cursor

  return (
    <div
      ref={containerRef}
      className="canvas-root"
      data-testid="canvas-root"
      // Read by the stylesheet, which stops the overlay's own cursors showing.
      data-fixed-cursor={tool.fixedCursor ? '' : undefined}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenuHandler}
      style={{ cursor }}
    >
      <svg
        ref={svgRef}
        className="canvas-svg"
        width={canvasSize.width}
        height={canvasSize.height}
        // The document's guide colour, as the token every guide rule reads — the
        // lines, the one being dragged, the strip they come out of and the snap
        // line an object makes against one. Setting it on the lines alone left
        // the rest in the stylesheet's default pink whatever Preferences said.
        style={{ '--guide': toCss(guideColor) } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <g
          className="viewport"
          transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
        >
          <GridOverlay />
          <DocumentLayer />
          {/* The Image Trace preview sits directly on the artwork it replaces,
              above the document and below the guides. */}
          <TracePreviewLayer />
          {/* The caret and highlight for rich text, above the glyphs they
              describe and below the guides. */}
          <TextEditOverlay />
          {/* Above the artwork: a guide is chrome and has to stay visible. */}
          <ArtboardGuides />
        </g>

        {/* Screen space: constant-size handles, previews, smart guides. */}
        <g className="overlay-layer">
          {/* Before the labels, so a label's own drag wins where they meet. */}
          <GuideStrips />
          <ArtboardLabels />
          <GuideHandle />
          <GuideReadout />
          <DropTarget />
          <SelectionOverlay />
          <ToolOverlay />
        </g>
      </svg>

      {editingTextId && <TextEditor nodeId={editingTextId} />}
      <ArtboardNameEditor />
      <DropIndicator />
    </div>
  )
}

/**
 * The artboard a dragged file is about to land in.
 *
 * A badge at the cursor says what will happen; this says WHERE, which is the
 * part the cursor cannot show — a file dropped an inch either side of an
 * artboard edge ends up somewhere quite different, and the two look identical
 * until it has happened.
 *
 * Screen space, so the outline stays a constant weight at any zoom rather than
 * becoming a hairline on a zoomed-out board.
 */
function DropTarget() {
  const indicator = useEditorStore((s) => s.dropIndicator)
  const viewport = useEditorStore((s) => s.viewport)
  const doc = useDocumentStore((s) => s.doc)
  if (!indicator?.artboardId) return null
  const node = doc.nodes[indicator.artboardId]
  if (!node || node.type !== 'artboard') return null

  const bounds = geometryBounds(doc, indicator.artboardId)
  const origin = docToScreen(viewport, { x: bounds.x, y: bounds.y })
  return (
    <rect
      className="drop-target"
      data-drop-target={indicator.artboardId}
      x={origin.x}
      y={origin.y}
      width={bounds.width * viewport.zoom}
      height={bounds.height * viewport.zoom}
      pointerEvents="none"
    />
  )
}

/**
 * What will happen, without where.
 *
 * The destination belongs to the panel's second line — putting it in both makes
 * the heading repeat the sentence underneath it.
 */
function dropLabel(count: number): string {
  return count > 1 ? t('drop.importCount', { count }) : t('drop.import')
}

/**
 * What a dragged file is about to become.
 *
 * Two presentations of one thing. Over an artboard there is a region to fill,
 * so it fills it: a message centred in the target, big enough to read without
 * looking for it, which is what every drop zone worth the name does. Over bare
 * pasteboard there is no region — the file lands wherever the cursor is — so it
 * shrinks to a chip at the cursor, which is the only honest place to put it.
 *
 * HTML rather than SVG text: this is a paragraph with a heading, and laying that
 * out in SVG means measuring strings by hand.
 */
function DropIndicator() {
  void useLanguage()
  const indicator = useEditorStore((s) => s.dropIndicator)
  const viewport = useEditorStore((s) => s.viewport)
  const doc = useDocumentStore((s) => s.doc)
  if (!indicator) return null

  const board = indicator.artboardId ? doc.nodes[indicator.artboardId] : undefined
  if (!board || board.type !== 'artboard') {
    return (
      <div className="drop-indicator" style={{ left: indicator.x, top: indicator.y }}>
        {indicator.label}
      </div>
    )
  }

  const bounds = geometryBounds(doc, board.id)
  const origin = docToScreen(viewport, { x: bounds.x, y: bounds.y })
  const width = bounds.width * viewport.zoom
  const height = bounds.height * viewport.zoom

  return (
    <div
      className="drop-message"
      style={{ left: origin.x, top: origin.y, width, height }}
      data-drop-message={board.id}
    >
      {/* Below this the words would be wider than the artboard and the panel
          would be describing itself rather than the target. */}
      {width > 220 && height > 140 && (
        <div className="drop-message-body">
          <ImportIcon size={28} />
          <strong>{indicator.label}</strong>
          <span>{t('drop.release', { name: board.name })}</span>
        </div>
      )}
    </div>
  )
}

export { setViewport }
