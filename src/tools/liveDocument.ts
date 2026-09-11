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
 * The document as it would be if the gesture in flight were committed.
 *
 * A flat object in a drag needs none of this: LiveTransform writes its new
 * matrix straight onto its <g>. Something in perspective is different — how a
 * tilted card is drawn depends on its size, its pivot and every tilt above it,
 * and those are not attributes that can be written; the projection has to be
 * worked out again. So the few nodes a gesture is moving are patched into a
 * copy of the document here, and the renderer, the selection overlay and the
 * inspector all read that copy. They cannot disagree about where something is,
 * because they are all asking the same document.
 *
 * Nothing is written to the store, which is still the rule that matters.
 */

import { IDENTITY, invert, multiply } from '../geometry/Matrix'
import { transformFromMatrix } from '../document/DocumentModel'
import { worldMatrix } from '../document/SceneGraph'
import { patchDocument } from '../document/Scene3D'
import { getLiveMatrices, getLiveSize } from './DragSession'
import { getLiveRadius } from './RadiusSession'
import { getLiveStarRatio } from './StarRatioSession'
import { getLive3dMap } from './Transform3dSession'
import type { DesignDocument, DesignNode, NodeId } from '../document/types'

/**
 * A polygon as the radius or star-ratio drag in flight would leave it.
 *
 * Its rounded outline changes with both — and with it the frame round it and
 * the size the inspector reads — while neither drag writes the document until
 * it is let go of. Measured from the document, the frame stood still while the
 * shape shrank away from it.
 */
export function withLiveShape(node: DesignNode): DesignNode {
  if (node.type !== 'polygon') return node
  const radius = getLiveRadius(node.id)
  const ratio = getLiveStarRatio(node.id)
  if (radius === null && ratio === null) return node
  return { ...node, cornerRadius: radius ?? node.cornerRadius, starRatio: ratio ?? node.starRatio }
}

let memo: {
  doc: DesignDocument
  matrices: ReadonlyMap<NodeId, unknown>
  live3d: ReadonlyMap<NodeId, unknown>
  result: DesignDocument
} | null = null

export function liveDocument(doc: DesignDocument): DesignDocument {
  const matrices = getLiveMatrices()
  const live3d = getLive3dMap()
  if (matrices.size === 0 && live3d.size === 0) return doc
  // Every component that asks during one frame gets the same object back, so
  // everything memoised on it downstream is shared too.
  if (memo && memo.doc === doc && memo.matrices === matrices && memo.live3d === live3d) {
    return memo.result
  }

  const patches = new Map<NodeId, DesignNode>()
  for (const [id, world] of matrices) {
    const node = doc.nodes[id]
    if (!node) continue
    // An ancestor can be in the same gesture, and then ITS live matrix is the
    // truthful parent — the same rule the inspector's readouts follow.
    const parentWorld = node.parentId
      ? (matrices.get(node.parentId) ?? worldMatrix(doc, node.parentId))
      : IDENTITY
    const size = getLiveSize(id)
    const transform = transformFromMatrix(
      multiply(invert(parentWorld), world),
      size?.width ?? node.transform.width,
      size?.height ?? node.transform.height,
      node.transform.originX,
      node.transform.originY,
    )
    patches.set(id, { ...node, transform } as DesignNode)
  }
  for (const [id, t3] of live3d) {
    const base = patches.get(id) ?? doc.nodes[id]
    if (!base) continue
    patches.set(id, { ...base, transform3d: t3 } as DesignNode)
  }

  const result = patchDocument(doc, patches)
  memo = { doc, matrices, live3d, result }
  return result
}
