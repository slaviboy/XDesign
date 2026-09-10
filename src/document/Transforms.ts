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
 * A node's local matrix, on its own.
 *
 * Kept out of SceneGraph so that Scene3D — which SceneGraph itself depends on
 * for bounds and hit testing in perspective — can build on it without the two
 * modules importing each other. SceneGraph re-exports both functions, so every
 * existing caller still finds them where it always did.
 */

import {
  compose,
  rotation,
  scaling,
  skewing,
  translation,
  type Mat2D,
} from '../geometry/Matrix'
import type { DesignNode, Transform } from './types'

/**
 * A node's local -> parent matrix.
 *
 * Composed as T(x,y) · T(c) · R · K · S · T(-c), where c is the transform origin
 * in local units. Rotation and scale therefore happen about the origin point and
 * the node's `x,y` still means "where the local (0,0) corner lands", which keeps
 * the inspector's X/Y readouts stable under rotation.
 */
export function localMatrix(t: Transform): Mat2D {
  const cx = t.originX * t.width
  const cy = t.originY * t.height
  return compose(
    translation(-cx, -cy),
    scaling(t.scaleX, t.scaleY),
    skewing(t.skewX, t.skewY),
    rotation(t.rotation),
    translation(cx, cy),
    translation(t.x, t.y),
  )
}

export function nodeLocalMatrix(node: DesignNode): Mat2D {
  return localMatrix(node.transform)
}
