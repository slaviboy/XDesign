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
 * 3D Transforms at the level of the scene graph.
 *
 * THE CAMERA. An object with a 3D transform is seen through a camera of its
 * own, PERSPECTIVE_DISTANCE in front of it and looking straight at its pivot.
 * That is what Adobe's own illustrations show: a card pushed back in Z shrinks
 * about its own centre, wherever on the artboard it sits, and a tilted card
 * looks the same wherever it is moved to. It is also what keeps the 2D
 * machinery intact — the projection happens entirely inside the node's local
 * space, so its `transform` still moves, rotates and scales the picture
 * exactly as it moves a flat one, and every gesture that edits `transform`
 * keeps working unchanged.
 *
 * THE SHARED SPACE. A plain group that is tilted, or sits inside a tilted
 * group, passes its 3D space down: its children are placed in it by their own
 * matrices and tilts, and the whole arrangement is seen through ONE camera,
 * the outermost group's. That is how a stack of cards at different depths
 * fans out when the stack is turned (CSS calls it preserve-3d). A mask group,
 * a repeat grid, a group with a shadow or blur, and every leaf is instead a
 * PLANE: drawn flat, then projected as one picture — a mask or a filter needs
 * a flat image to work on.
 *
 * DEPTH ORDER. Siblings paint back to front by depth rather than by layer
 * order, which is Adobe's rule — "when you change the Z depth value for any
 * object, XD does not support layer ordering methods". Equal depths keep their
 * layer order, so nothing changes for a document with no Z in it.
 *
 * Everything here is pure and DOM-free. Results are memoised per document
 * object: documents are immutable snapshots, so a new one means a new cache,
 * and an immer draft — which is mutated in place — is never cached at all.
 */

import { isDraft } from 'immer'
import { IDENTITY, invert, type Mat2D, type Vec2 } from '../geometry/Matrix'
import {
  MAT3_IDENTITY,
  MAT4_IDENTITY,
  homographyOfPlane,
  isAffineMat3,
  mat3FromMat2D,
  mat3Multiply,
  mat3ToMat2D,
  mat4ApplyPoint,
  mat4Compose,
  mat4FromMat2D,
  mat4Multiply,
  mat4Perspective,
  mat4RotateX,
  mat4RotateY,
  mat4Translate,
  mapPoint,
  type Mat3,
  type Mat4,
} from '../geometry/Perspective'
import { nodeLocalMatrix } from './Transforms'
import {
  hasStyle,
  isContainer,
  isMaskGroup,
  transform3dOf,
  type DesignDocument,
  type DesignNode,
  type NodeId,
} from './types'

/**
 * How far the camera stands from the plane it looks at, in document units.
 *
 * Matched by eye to Adobe's own screenshots: a portrait card turned 30° about
 * Y has its near edge about a fifth taller than its far one there, which is
 * what this distance gives a card of that size.
 */
export const PERSPECTIVE_DISTANCE = 800

/**
 * The Z field's range. The top end keeps an object a quarter of the camera
 * distance short of the eye — four times magnified — because past the eye
 * there is nothing to see, and near it every pixel is a smear.
 */
export const Z_DEPTH_MIN = -5000
export const Z_DEPTH_MAX = PERSPECTIVE_DISTANCE * 0.75

// ---------------------------------------------------------------------------
// Memo
// ---------------------------------------------------------------------------

const caches = new WeakMap<DesignDocument, Map<string, unknown>>()

function memo<T>(doc: DesignDocument, key: string, compute: () => T): T {
  // A draft is written to in place mid-transaction, so an answer cached from it
  // could be stale by the next line. Only finished snapshots are cached.
  if (isDraft(doc)) return compute()
  let cache = caches.get(doc)
  if (!cache) {
    cache = new Map()
    caches.set(doc, cache)
  }
  if (cache.has(key)) return cache.get(key) as T
  const value = compute()
  cache.set(key, value)
  return value
}

/**
 * The same document with some nodes swapped for other versions of themselves.
 *
 * How a gesture shows what it WOULD commit without writing to the store: the
 * drag and gizmo sessions patch the few nodes they are moving and everything
 * in here runs on the result. The node map is layered over the original with
 * Object.create, so building one costs the number of patches, not the size of
 * the document — which matters, because it happens every animation frame.
 * Lookups by id see the patches; enumerating the map does not, and nothing
 * that receives one of these enumerates it.
 */
export function patchDocument(
  doc: DesignDocument,
  patches: ReadonlyMap<NodeId, DesignNode>,
): DesignDocument {
  if (patches.size === 0) return doc
  const nodes = Object.create(doc.nodes) as Record<NodeId, DesignNode>
  // Defined, not assigned: the store's node map is frozen, and assigning to a
  // name its prototype holds read-only throws rather than shadowing it.
  for (const [id, node] of patches) {
    Object.defineProperty(nodes, id, { value: node, enumerable: true, writable: true, configurable: true })
  }
  return { ...doc, nodes }
}

// ---------------------------------------------------------------------------
// What passes its space down, and what is a flat picture
// ---------------------------------------------------------------------------

function hasOwnEffects(node: DesignNode): boolean {
  if (!hasStyle(node)) return false
  const { shadow, innerShadow, blur } = node.style
  return !!shadow?.visible || !!innerShadow?.visible || (!!blur?.visible && blur.amount > 0)
}

/**
 * Groups that CAN pass a 3D space down to their children.
 *
 * A mask clips with a flat outline, a repeat grid tiles a flat cell, and a
 * shadow or blur is a filter over a flat picture; each of those needs its
 * content flattened first, so each of them is drawn as one plane.
 */
function canOpenSpace(node: DesignNode): boolean {
  return node.type === 'group' && !isMaskGroup(node) && !hasOwnEffects(node)
}

/** Whether a 3D child sits below this node with nothing flattening in between. */
function hasOpen3d(doc: DesignDocument, id: NodeId): boolean {
  return memo(doc, `o:${id}`, () => {
    const node = doc.nodes[id]
    if (!node || !isContainer(node)) return false
    return node.children.some((childId) => {
      const child = doc.nodes[childId]
      if (!child) return false
      return !!transform3dOf(child) || (canOpenSpace(child) && hasOpen3d(doc, childId))
    })
  })
}

/**
 * True for a group whose children share its 3D space rather than being drawn
 * flat inside it: it is tilted itself or sits in such a group, it has 3D
 * content of its own, and nothing about it forces a flat picture.
 */
export function isPreserve3d(doc: DesignDocument, id: NodeId): boolean {
  return memo(doc, `p:${id}`, () => {
    const node = doc.nodes[id]
    if (!node || !canOpenSpace(node) || !hasOpen3d(doc, id)) return false
    if (transform3dOf(node)) return true
    return !!node.parentId && isPreserve3d(doc, node.parentId)
  })
}

/**
 * True when the node, or anything above it, is drawn in perspective.
 *
 * The question the 2D machinery asks before it trusts an affine world matrix:
 * for a node under a camera, that matrix describes where the artwork would be
 * if it were flat, not where it is.
 */
export function is3dAffected(doc: DesignDocument, id: NodeId): boolean {
  return memo(doc, `a:${id}`, () => {
    const node = doc.nodes[id]
    if (!node) return false
    if (transform3dOf(node)) return true
    return !!node.parentId && !!doc.nodes[node.parentId] && is3dAffected(doc, node.parentId)
  })
}

/** Whether anything in the selection is drawn in perspective. */
export function anyIn3d(doc: DesignDocument, ids: readonly NodeId[]): boolean {
  return ids.some((id) => is3dAffected(doc, id))
}

// ---------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------

/** The point a node turns and is looked at about: the same pivot its 2D rotation uses. */
export function pivotOf(node: DesignNode): Vec2 {
  const t = node.transform
  return { x: t.originX * t.width, y: t.originY * t.height }
}

/**
 * The node's own tilt and depth, about its pivot, in its local space.
 *
 * Y first, then X, then the depth — CSS's `translateZ(z) rotateX() rotateY()`.
 * Turning about the object's own vertical axis and then tipping it is what the
 * gizmo's two directions feel like: a turntable and a nod.
 */
export function tiltMatrix(node: DesignNode): Mat4 {
  const t3 = transform3dOf(node)
  if (!t3) return MAT4_IDENTITY
  const p = pivotOf(node)
  return mat4Compose(
    mat4Translate(-p.x, -p.y, 0),
    mat4RotateY(t3.rotateY),
    mat4RotateX(t3.rotateX),
    mat4Translate(0, 0, t3.z),
    mat4Translate(p.x, p.y, 0),
  )
}

/** The camera a 3D object is seen through, in its local space: perspective about its pivot. */
export function cameraMatrix(node: DesignNode): Mat4 {
  const p = pivotOf(node)
  return mat4Compose(
    mat4Translate(-p.x, -p.y, 0),
    mat4Perspective(PERSPECTIVE_DISTANCE),
    mat4Translate(p.x, p.y, 0),
  )
}

/** The 3D space a node sits in, when it sits in one. */
export interface Space3D {
  /** The object whose camera the space is seen through. */
  rootId: NodeId
  /** This node's local 3D coordinates -> the root's, before the camera. */
  chain: Mat4
  /** The root's camera, in the root's local space. */
  camera: Mat4
  /** The root's local space, after the camera -> world. */
  outer: Mat3
}

export interface NodeMapping {
  /**
   * Local (x, y) -> world, as a homography. Affine for any node with no
   * camera above it, in which case it is exactly the world matrix.
   */
  toWorld: Mat3
  /** Set for a 3D object and for everything in a shared 3D space. */
  space?: Space3D
}

/**
 * How a node's local space lands in the world, through every camera above it.
 *
 * Three cases, by what the PARENT is:
 *   a group sharing its 3D space  the node joins it: its chain is the parent's
 *                                 followed by its own matrix and tilt, and the
 *                                 same camera sees it.
 *   anything else, node tilted    the node is a new 3D object with its own
 *                                 camera, placed by its matrix in whatever
 *                                 the parent's plane is.
 *   anything else, node flat      a flat node on the parent's plane: the
 *                                 parent's map followed by its own matrix.
 *
 * The third case is also what puts the children of a tilted card on the card:
 * the card is a plane, and they are drawn flat inside it.
 */
export function nodeMapping(doc: DesignDocument, id: NodeId): NodeMapping {
  return memo(doc, `m:${id}`, () => {
    const node = doc.nodes[id]
    if (!node) return { toWorld: MAT3_IDENTITY }
    const local = nodeLocalMatrix(node)
    const parentId = node.parentId && doc.nodes[node.parentId] ? node.parentId : null

    if (parentId && isPreserve3d(doc, parentId)) {
      const shared = nodeMapping(doc, parentId).space
      if (shared) {
        const chain = mat4Multiply(shared.chain, mat4Multiply(mat4FromMat2D(local), tiltMatrix(node)))
        const space: Space3D = { ...shared, chain }
        return { toWorld: mat3Multiply(shared.outer, homographyOfPlane(mat4Multiply(shared.camera, chain))), space }
      }
    }

    const parentMap = parentId ? nodeMapping(doc, parentId).toWorld : MAT3_IDENTITY
    const outer = mat3Multiply(parentMap, mat3FromMat2D(local))
    if (!transform3dOf(node)) return { toWorld: outer }

    const chain = tiltMatrix(node)
    const camera = cameraMatrix(node)
    return {
      toWorld: mat3Multiply(outer, homographyOfPlane(mat4Multiply(camera, chain))),
      space: { rootId: id, chain, camera, outer },
    }
  })
}

/**
 * The homography a node's flat artwork is drawn with, inside its 3D root's
 * own group — local (x, y) -> the root's local space, after the camera.
 *
 * Relative to the root rather than the world because that is where the
 * renderer draws it: inside the root's ordinary <g transform>, so moving or
 * rotating the root is still one attribute write, whatever is tilted in it.
 */
export function planeHomography(doc: DesignDocument, id: NodeId): Mat3 | null {
  const space = nodeMapping(doc, id).space
  return space ? homographyOfPlane(mat4Multiply(space.camera, space.chain)) : null
}

/** Where a local point of the node lands in the world, or null when it cannot be seen. */
export function localToWorld(doc: DesignDocument, id: NodeId, p: Vec2): Vec2 | null {
  return mapPoint(nodeMapping(doc, id).toWorld, p.x, p.y)
}

/**
 * The world matrix of the frame a node's selection box is drawn in.
 *
 * For anything under a camera, the frame is the space of the 3D object that
 * owns the camera, AFTER the projection: the box is the bounds of the
 * projected artwork there, and it turns with that object's 2D rotation the way
 * a flat object's frame does. When even that space is not flat — a 3D object
 * inside another tilted one — there is no frame to turn with, and the box is
 * simply axis-aligned in the world.
 */
export function frameMatrix(doc: DesignDocument, id: NodeId): Mat2D {
  let cur: NodeId | null = id
  while (cur && doc.nodes[cur]) {
    const space = nodeMapping(doc, cur).space
    if (space) return isAffineMat3(space.outer) ? mat3ToMat2D(space.outer) : IDENTITY
    cur = doc.nodes[cur]!.parentId
  }
  return IDENTITY
}

/**
 * The map from a node's local space into its frame (see frameMatrix).
 *
 * World, then back out through the frame's own matrix: the frame is affine by
 * construction, so this stays a homography.
 */
export function localToFrame(doc: DesignDocument, id: NodeId, frame: Mat2D): Mat3 {
  return mat3Multiply(mat3FromMat2D(invert(frame)), nodeMapping(doc, id).toWorld)
}

// ---------------------------------------------------------------------------
// Depth
// ---------------------------------------------------------------------------

/**
 * How near a child is, for painting order.
 *
 * In a shared space, the depth of its pivot once every tilt above it has been
 * applied — so turning a stack of cards round brings the back one to the
 * front. Anywhere else each 3D object has a camera of its own and there is no
 * common space to measure in, so its Z field is its depth, and a flat object's
 * is 0.
 */
function depthOf(doc: DesignDocument, id: NodeId, shared: boolean): number {
  const node = doc.nodes[id]
  if (!node) return 0
  if (!shared) return transform3dOf(node)?.z ?? 0
  const space = nodeMapping(doc, id).space
  if (!space) return 0
  const p = pivotOf(node)
  return mat4ApplyPoint(space.chain, p.x, p.y, 0).z
}

/**
 * Children of a container in the order they paint, back to front.
 *
 * Stable, so equal depths keep their layer order — and returns the input
 * itself when every depth is equal, which is every container in a document
 * without 3D in it.
 */
export function depthSorted(
  doc: DesignDocument,
  containerId: NodeId,
  ids: readonly NodeId[],
): readonly NodeId[] {
  if (ids.length < 2) return ids
  const shared = isPreserve3d(doc, containerId)
  const keys = ids.map((id) => depthOf(doc, id, shared))
  if (keys.every((k) => Math.abs(k - keys[0]!) < 1e-9)) return ids
  return ids
    .map((id, i) => ({ id, i, k: keys[i]! }))
    .sort((a, b) => (Math.abs(a.k - b.k) < 1e-9 ? a.i - b.i : a.k - b.k))
    .map((e) => e.id)
}

/** A container's children in paint order. */
export function paintOrder(doc: DesignDocument, containerId: NodeId): readonly NodeId[] {
  const node = doc.nodes[containerId]
  if (!node || !isContainer(node)) return []
  return depthSorted(doc, containerId, node.children)
}
