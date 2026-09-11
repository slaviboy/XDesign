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
 * Artboard name labels, and renaming one in place.
 *
 * Drawn in screen space above each artboard so they stay legible at any zoom,
 * and are never part of the document — clicking one selects the artboard, but
 * nothing here can be exported.
 *
 * Double-clicking a label renames it. The editor is a real HTML <input> living
 * beside the SVG rather than anything inside it: a caret, a text selection and
 * IME composition are things only a real input gives you, and the label is
 * screen-space already, so nothing is lost by leaving the SVG for it.
 *
 * Dragging a label moves the artboard, whatever tool is selected. The label
 * follows it frame by frame, which is why this reads the live matrix rather
 * than the document: a drag deliberately writes nothing until it is released,
 * so a label positioned from the document alone would sit still while the
 * artboard it names slid out from under it.
 */

import { memo, useLayoutEffect, useRef, useState } from 'react'
import { docToScreen } from './Viewport'
import { geometryBounds, artboardIds, localGeometryBounds } from '../document/SceneGraph'
import { transformBounds } from '../geometry/Bounds'
import { renameNode } from '../history/Commands'
import { beginArtboardLabelDrag } from '../tools/ArtboardLabelDrag'
import { getLiveMatrix } from '../tools/DragSession'
import { liveGuide } from '../tools/GuideDrag'
import { setEditor, setSelection } from '../state/EditorStore'
import { useDocument, useEditorStore, useLiveTransformTick } from '../state/hooks'
import type { DesignDocument, DesignNode, NodeId } from '../document/types'

export const ArtboardLabels = memo(function ArtboardLabels() {
  const doc = useDocument()
  const viewport = useEditorStore((s) => s.viewport)
  const selection = useEditorStore((s) => s.selection)
  const renaming = useEditorStore((s) => s.renamingArtboardId)
  // The guide readout draws its rule along the artboard's top border, where the
  // name sits. Two things cannot share that strip, and the measurement is the
  // one that is only there for a moment.
  useEditorStore((s) => s.overlayTick)
  const measuring = !!liveGuide()
  // Re-renders on every live-transform frame, so a label tracks the artboard
  // through a drag instead of jumping to it on release.
  void useLiveTransformTick()
  const boards = artboardIds(doc)
  if (boards.length === 0 || measuring) return null

  return (
    <g className="artboard-labels">
      {boards.map((id) => {
        const node = doc.nodes[id]
        if (!node || !node.visible) return null
        // The input stands in for the label it is editing, so the two never
        // show the name twice.
        if (renaming === id) return null
        const bounds = labelAnchor(doc, id, node)
        const p = docToScreen(viewport, { x: bounds.x, y: bounds.y })
        // Skip labels that have scrolled out of view.
        if (p.y < -40 || p.y > 4000) return null
        return (
          <text
            key={id}
            className={`artboard-label${selection.includes(id) ? ' selected' : ''}`}
            x={p.x}
            y={p.y - 7}
            pointerEvents="all"
            onPointerDown={(e) => {
              // Kept from the tools entirely: dragging a name moves its
              // artboard whichever instrument happens to be selected, so the
              // active tool must never see this press.
              e.stopPropagation()
              // A right-press names the artboard the menu about to open is
              // for — without this, Copy there copied whatever was selected
              // before. Part of a larger selection, it leaves that alone.
              if (e.button === 2) {
                if (!selection.includes(id)) setSelection([id])
                return
              }
              const svg = e.currentTarget.ownerSVGElement
              if (!svg) return
              beginArtboardLabelDrag(id, e.nativeEvent, e.currentTarget, svg)
            }}
            onDoubleClick={(e) => {
              // Stopped here, or the canvas would also read this as a
              // double-click on the artwork and try to step into the artboard.
              e.stopPropagation()
              setSelection([id])
              setEditor({ renamingArtboardId: id })
            }}
          >
            {node.name}
          </text>
        )
      })}
    </g>
  )
})

/**
 * Where the label sits: the artboard's top-left, in document space.
 *
 * The live matrix wins while a drag is in flight — it is the only place the new
 * position exists until the gesture commits.
 */
function labelAnchor(doc: DesignDocument, id: NodeId, node: DesignNode) {
  const live = getLiveMatrix(id)
  return live ? transformBounds(localGeometryBounds(node), live) : geometryBounds(doc, id)
}

/** Mounted beside the canvas SVG; renders only while a label is being renamed. */
export function ArtboardNameEditor() {
  const id = useEditorStore((s) => s.renamingArtboardId)
  // Keyed by node so renaming a different artboard remounts, which is what
  // makes the draft below a one-time snapshot of the name.
  return id ? <ArtboardNameInput key={id} nodeId={id} /> : null
}

function ArtboardNameInput({ nodeId }: { nodeId: NodeId }) {
  const doc = useDocument()
  const viewport = useEditorStore((s) => s.viewport)
  const node = doc.nodes[nodeId]
  const [draft, setDraft] = useState(node?.name ?? '')
  const ref = useRef<HTMLInputElement>(null)
  // Escape must not be undone by the blur that immediately follows it.
  const cancelled = useRef(false)

  useLayoutEffect(() => {
    // The whole name is selected on entry: renaming an artboard replaces the
    // name far more often than it edits one character of it.
    ref.current?.select()
  }, [])

  if (!node) return null

  const bounds = geometryBounds(doc, nodeId)
  const p = docToScreen(viewport, { x: bounds.x, y: bounds.y })

  const close = () => setEditor({ renamingArtboardId: null })
  const commit = () => {
    const next = draft.trim()
    // An empty name is a slip, not an instruction; keep the old one.
    if (next && next !== node.name) renameNode(nodeId, next)
    close()
  }

  return (
    <input
      ref={ref}
      autoFocus
      className="artboard-rename"
      aria-label="Artboard name"
      data-testid="artboard-rename"
      // Sat where the label's own baseline is, so the name does not jump.
      style={{ left: p.x - 4, top: p.y - 20 }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        // Kept away from the global shortcut layer, or typing "Home page"
        // would swap tools halfway through the word.
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          cancelled.current = true
          close()
        }
      }}
      onBlur={() => {
        if (!cancelled.current) commit()
      }}
    />
  )
}
