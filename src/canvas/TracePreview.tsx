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
 * The live Image Trace preview.
 *
 * Illustrator's View control on the Image Trace panel is not decoration: the
 * only way to judge a trace is against the picture it came from, and each of
 * its five settings answers a different question. Tracing Result shows what you
 * will get; Outlines shows where the anchors went; Outlines with Source shows
 * how far the vectors drifted from the pixels; Source shows what you started
 * with.
 *
 * So the preview is two cooperating pieces. This layer draws the traced paths
 * over the artwork in the viewport's own space, and `useTraceHidesSource` tells
 * the image node whether to draw itself at all — a real hide rather than
 * something painted over it, because a trace with Ignore White on leaves the
 * background transparent and any cover-up would show through it.
 *
 * Nothing here touches the document. Until the Trace button is pressed the
 * image is still an image, and closing the panel leaves no trace of the trace.
 */

import { memo } from 'react'
import { useStore } from 'zustand'
import { traceStore, type TraceView } from '../state/TraceStore'
import { useDocument } from '../state/hooks'
import { worldMatrix } from '../document/SceneGraph'
import { multiply, scaling, toSvgMatrix } from '../geometry/Matrix'
import { toCss } from '../document/color'
import type { NodeId } from '../document/types'

export function traceViewShowsSource(view: TraceView): boolean {
  return view === 'source' || view === 'outlines-source'
}

export function traceViewShowsResult(view: TraceView): boolean {
  return view === 'result' || view === 'result-outlines'
}

export function traceViewShowsOutlines(view: TraceView): boolean {
  return view === 'result-outlines' || view === 'outlines' || view === 'outlines-source'
}

/**
 * Whether the image node with this id is being traced in a view that replaces
 * it. Subscribed per node, so opening the panel re-renders one image and
 * nothing else on the canvas.
 */
export function useTraceHidesSource(id: NodeId): boolean {
  return useStore(traceStore, (s) => {
    const session = s.session
    if (!session || session.nodeId !== id) return false
    // Preview off means the artwork stays exactly as it is until Trace is
    // pressed — the whole point of the checkbox.
    if (!session.preview) return false
    // Before the first result there is nothing to show instead, and a canvas
    // that goes blank while the first trace runs reads as a bug.
    if (!session.result) return false
    return !traceViewShowsSource(session.view)
  })
}

/** Mounted once by Canvas, inside the viewport transform. */
export const TracePreviewLayer = memo(function TracePreviewLayer() {
  const session = useStore(traceStore, (s) => s.session)
  const doc = useDocument()

  if (!session?.result || !session.preview) return null
  const node = doc.nodes[session.nodeId]
  if (!node || node.type !== 'image' || !node.visible) return null

  const result = session.result
  const showResult = traceViewShowsResult(session.view)
  const showOutlines = traceViewShowsOutlines(session.view)
  if (!showResult && !showOutlines) return null

  // Image pixels into the node's local box, then that box into world space.
  const toLocal = scaling(
    node.transform.width / Math.max(1, result.width),
    node.transform.height / Math.max(1, result.height),
  )
  const matrix = multiply(worldMatrix(doc, session.nodeId), toLocal)

  return (
    <g className="trace-preview" transform={toSvgMatrix(matrix)} pointerEvents="none">
      {showResult &&
        result.paths.map((path, i) => (
          <path
            key={`f${i}`}
            d={path.d}
            fill={path.fill ? toCss(path.fill) : 'none'}
            fillRule="nonzero"
            stroke={path.stroke ? toCss(path.stroke) : 'none'}
            strokeWidth={path.stroke ? path.strokeWidth : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      {showOutlines &&
        result.paths.map((path, i) => (
          <path
            key={`o${i}`}
            className="trace-outline"
            d={path.d}
            fill="none"
            // A hairline at every zoom: the outline is there to show where the
            // curve went, and a stroke that scales with the artwork hides it.
            vectorEffect="non-scaling-stroke"
          />
        ))}
    </g>
  )
})
