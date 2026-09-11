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
 * Image Trace, as document operations.
 *
 * Opening and adjusting a trace is editor state (TraceStore). The one thing
 * that reaches the document is the commit: the image node is replaced, in
 * place and in z-order, by a group of ordinary path nodes carrying the traced
 * shapes — so the result is exactly as editable as anything drawn by hand, and
 * one undo brings the picture back.
 *
 * Coordinates: the engine works in image pixels. The image node may be scaled,
 * rotated, or skewed, so each path's data is scaled from pixels into the node's
 * local box and the group takes over the image's transform wholesale. Whatever
 * the picture looked like on the canvas, the trace lands exactly over it.
 */

import { addNode, removeNodes } from '../document/DocumentModel'
import { createGroup, createPath } from '../document/NodeFactory'
import {
  DEFAULT_STROKE, isContainer,
  type ImageNode, type NodeId, type Paint, type PathNode, type RGBA,
} from '../document/types'
import { pathBounds, transformPath } from '../geometry/PathUtils'
import { scaling, translation } from '../geometry/Matrix'
import { documentStore, getDoc, transaction, type DocumentState } from '../state/DocumentStore'
import { editorStore, notify, setSelection } from '../state/EditorStore'
import { closeTraceSession, openTraceSession, traceForCommit, traceStore } from '../state/TraceStore'
import { commitCropMode } from '../tools/CropSession'
import type { TraceResult } from '../trace/types'

/** The single selected image, if that is what the selection is. */
export function traceableImage(): ImageNode | null {
  const doc = getDoc()
  const selection = editorStore.getState().selection
  if (selection.length !== 1) return null
  const node = doc.nodes[selection[0]!]
  if (!node || node.type !== 'image' || node.locked) return null
  return doc.assets[node.assetId]?.dataUrl ? node : null
}

export function canImageTrace(): boolean {
  return traceableImage() !== null
}

/** View ▸ Image Trace. */
export function openImageTrace(nodeId?: NodeId): void {
  // A crop in progress is applied first: the trace is of the image as it is
  // about to be, not as it was before the handles moved.
  commitCropMode()
  const doc = getDoc()
  const node = nodeId ? doc.nodes[nodeId] : traceableImage()
  if (!node || node.type !== 'image') {
    notify('info', 'Select an image to trace.')
    return
  }
  const dataUrl = doc.assets[node.assetId]?.dataUrl
  if (!dataUrl) {
    notify('warn', 'This image has no pixel data to trace.')
    return
  }
  setSelection([node.id])
  // Only the kept part: the traced paths land in the image's box, which is
  // the kept part, so tracing the whole picture would squeeze all of it in.
  void openTraceSession(node.id, dataUrl, node.crop)
}

export function cancelImageTrace(): void {
  closeTraceSession()
}

/**
 * The Trace button. Traces with the current settings if the preview is stale,
 * then swaps the image for the paths.
 */
export async function commitImageTrace(): Promise<NodeId | null> {
  const session = traceStore.getState().session
  if (!session) return null
  const result = await traceForCommit()
  // The panel may have been closed, or the trace failed, while we waited.
  if (!result || traceStore.getState().session?.nodeId !== session.nodeId) return null

  const groupId = replaceImageWithTrace(session.nodeId, result)
  closeTraceSession()
  if (groupId) {
    setSelection([groupId])
    notify(
      'success',
      result.paths.length === 1 ? 'Traced 1 path.' : `Traced ${result.paths.length} paths.`,
      undefined,
      2500,
    )
  }
  return groupId
}

/**
 * Build the nodes and splice them in where the image was. Exported for tests;
 * the panel goes through commitImageTrace.
 */
export function replaceImageWithTrace(nodeId: NodeId, result: TraceResult): NodeId | null {
  let groupId: NodeId | null = null

  const ok = transaction('Image Trace', (draft) => {
    const image = draft.nodes[nodeId]
    if (!image || image.type !== 'image') return false
    const parentId = image.parentId ?? draft.rootId
    const parent = draft.nodes[parentId]
    if (!parent || !isContainer(parent)) return false

    const paths = buildTracedNodes(image, result)
    if (paths.length === 0) return false

    // The group inherits the image's whole transform, so a rotated or skewed
    // picture yields an identically rotated or skewed trace.
    const group = createGroup(
      paths.map((p) => p.id),
      { ...image.transform },
    )
    group.name = image.name ? `${image.name} Trace` : 'Image Trace'
    group.style.opacity = image.style.opacity
    group.style.blendMode = image.style.blendMode
    // The group has the image's box, so it has its pivot too, and the same
    // tilt puts the trace exactly where the picture was.
    if (image.transform3d) group.transform3d = { ...image.transform3d }

    for (const path of paths) {
      path.parentId = group.id
      draft.nodes[path.id] = path
    }

    const at = parent.children.indexOf(nodeId)
    addNode(draft, group, parentId, at < 0 ? parent.children.length : at)
    removeNodes(draft, [nodeId])
    groupId = group.id
    return undefined
  })

  return ok ? groupId : null
}

/**
 * One PathNode per traced shape, local to the image's box.
 *
 * Each path is rebased so its own local origin is its bounding-box corner —
 * the convention every other path in the document follows, and what makes the
 * inspector's X/Y and the resize handles behave.
 */
function buildTracedNodes(image: ImageNode, result: TraceResult): PathNode[] {
  const sx = image.transform.width / Math.max(1, result.width)
  const sy = image.transform.height / Math.max(1, result.height)
  const toLocal = scaling(sx, sy)

  const nodes: PathNode[] = []
  let index = 0
  for (const traced of result.paths) {
    index++
    const scaled = transformPath(traced.d, toLocal)
    const b = pathBounds(scaled)
    if (!Number.isFinite(b.width) || !Number.isFinite(b.height)) continue
    const localD = transformPath(scaled, translation(-b.x, -b.y))

    const strokeWidth = traced.stroke ? Math.max(0.1, traced.strokeWidth * (sx + sy) / 2) : 0
    const path = createPath(
      localD,
      { x: b.x, y: b.y, width: Math.max(0.5, b.width), height: Math.max(0.5, b.height) },
      {
        fill: traced.fill ? solid(traced.fill) : { type: 'none' },
        fillRule: 'nonzero',
        stroke: traced.stroke
          ? { ...DEFAULT_STROKE, paint: solid(traced.stroke), width: strokeWidth, cap: 'round', join: 'round' }
          : { ...DEFAULT_STROKE },
      },
      !!traced.fill,
    )
    path.name = traced.stroke && !traced.fill ? `Stroke ${index}` : `Path ${index}`
    nodes.push(path)
  }
  return nodes
}

function solid(color: RGBA): Paint {
  return { type: 'solid', color: { ...color } }
}

/**
 * Close the session if the image being traced leaves the document — deleted,
 * undone away, or replaced by loading another file. The panel would otherwise
 * go on offering settings for a picture that is no longer there.
 *
 * Installed once at startup; returns the unsubscribe for symmetry with the
 * other installers.
 */
export function installTraceReconciler(): () => void {
  return documentStore.subscribe((state: DocumentState) => {
    const session = traceStore.getState().session
    if (session && state.doc.nodes[session.nodeId]?.type !== 'image') closeTraceSession()
  })
}
