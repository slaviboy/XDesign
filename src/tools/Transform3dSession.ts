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
 * The 3D gizmo's gesture.
 *
 * Adobe: "click and drag the gizmo icon that appears at the center of the
 * object" to turn it about X and Y, and "hover on the center point of the
 * gizmo ... you can move the selected object up and down" to change its depth.
 * So the rings turn it — sideways for Y, up and down for X, like rolling a ball
 * under the hand — and the centre pushes it toward or away from you.
 *
 * The same three-phase contract as DragSession: the press snapshots, every move
 * publishes live values without touching the store, and the release commits
 * one transaction. The live values are what the renderer, the overlay and the
 * inspector read until then.
 */

import { transaction } from '../state/DocumentStore'
import { editorStore } from '../state/EditorStore'
import { normalizeTransform3d } from '../history/Commands'
import { isEffectivelyLocked } from '../document/SceneGraph'
import { supports3d, type DesignDocument, type NodeId, type Transform3D } from '../document/types'
import type { Vec2 } from '../geometry/Matrix'

export type Transform3dMode = 'rotate' | 'depth'

/** Degrees of turn per screen pixel of drag. Half a degree: 180° is a 360px drag. */
export const GIZMO_DEGREES_PER_PX = 0.5
/** What Shift snaps an angle to — the same step the 2D rotate handles use. */
const ANGLE_SNAP = 15
/** What Shift snaps a depth to. */
const DEPTH_SNAP = 10

interface Session {
  mode: Transform3dMode
  start: Vec2
  zoom: number
  initial: Map<NodeId, Transform3D>
  moved: boolean
}

const ZERO: Transform3D = { rotateX: 0, rotateY: 0, z: 0 }

let session: Session | null = null
let live: ReadonlyMap<NodeId, Transform3D> = new Map()
const listeners = new Set<() => void>()

function publish(next: ReadonlyMap<NodeId, Transform3D>): void {
  live = next
  for (const fn of listeners) fn()
}

/** Subscribe to live-value changes. Returns the unsubscribe. */
export function subscribeLive3d(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** The in-flight 3D transform of a node under the gizmo, zero included. */
export function getLiveTransform3d(id: NodeId): Transform3D | undefined {
  return live.get(id)
}

/** Every in-flight value. A new map per update, so its identity is a version. */
export function getLive3dMap(): ReadonlyMap<NodeId, Transform3D> {
  return live
}

export function isTransform3dDragging(): boolean {
  return session !== null
}

export function getTransform3dMode(): Transform3dMode | null {
  return session?.mode ?? null
}

/**
 * Start turning or pushing the selection. False when there is nothing that
 * can take a 3D transform — an artboard, or only locked objects.
 */
export function beginTransform3d(
  doc: DesignDocument,
  ids: readonly NodeId[],
  mode: Transform3dMode,
  startScreen: Vec2,
  zoom: number,
): boolean {
  const usable = ids.filter((id) => supports3d(doc.nodes[id]) && !isEffectivelyLocked(doc, id))
  if (usable.length === 0) return false
  const initial = new Map<NodeId, Transform3D>()
  for (const id of usable) initial.set(id, { ...ZERO, ...doc.nodes[id]!.transform3d })
  session = { mode, start: startScreen, zoom: zoom > 0 ? zoom : 1, initial, moved: false }
  publish(new Map(initial))
  editorStore.setState({ isDragging: true })
  return true
}

const snapTo = (value: number, step: number) => Math.round(value / step) * step

/**
 * Follow the pointer, in SCREEN pixels: the gizmo is a constant size on
 * screen, so how far a drag turns the object should not depend on the zoom.
 * A depth, on the other hand, is a document distance, so that one is divided
 * by the zoom — the object moves as far as the pointer does.
 */
export function updateTransform3d(screen: Vec2, snap: boolean): void {
  const s = session
  if (!s) return
  const dx = screen.x - s.start.x
  const dy = screen.y - s.start.y
  if (dx !== 0 || dy !== 0) s.moved = true

  const next = new Map<NodeId, Transform3D>()
  for (const [id, start] of s.initial) {
    if (s.mode === 'rotate') {
      // Sideways turns about the vertical axis, so dragging right brings the
      // left edge forward; up tips the top edge away, so dragging up is +X.
      let rotateY = start.rotateY + dx * GIZMO_DEGREES_PER_PX
      let rotateX = start.rotateX - dy * GIZMO_DEGREES_PER_PX
      if (snap) {
        rotateY = snapTo(rotateY, ANGLE_SNAP)
        rotateX = snapTo(rotateX, ANGLE_SNAP)
      }
      next.set(id, normalizeTransform3d({ ...start, rotateX, rotateY }) ?? ZERO)
    } else {
      // Up comes toward you: the object grows, which is what "up" looks like.
      let z = start.z - dy / s.zoom
      if (snap) z = snapTo(z, DEPTH_SNAP)
      next.set(id, normalizeTransform3d({ ...start, z }) ?? ZERO)
    }
  }
  publish(next)
}

/** Close the gesture with one transaction, or none if nothing moved. */
export function commitTransform3d(): boolean {
  const s = session
  if (!s) return false
  const values = live
  session = null
  publish(new Map())
  editorStore.setState({ isDragging: false })
  if (!s.moved) return false

  return transaction(s.mode === 'rotate' ? '3D Rotate' : 'Z Depth', (draft) => {
    let touched = false
    for (const [id, value] of values) {
      const node = draft.nodes[id]
      if (!node) continue
      const clean = normalizeTransform3d(value)
      if (clean) node.transform3d = clean
      else if (node.transform3d) delete node.transform3d
      else continue
      touched = true
    }
    return touched ? undefined : false
  })
}

/** Abandon the gesture: nothing was written, so dropping the live values is all it takes. */
export function cancelTransform3d(): void {
  if (!session) return
  session = null
  publish(new Map())
  editorStore.setState({ isDragging: false })
}
