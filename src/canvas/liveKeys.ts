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
 * The keys elements register under with the LiveTransform channel.
 *
 * Their own module so the tools that push live updates and the renderer that
 * mounts the elements can both name a key without importing each other. Before
 * this they lived in NodeRenderer, which made a tool importing a key and the
 * renderer reading a tool's live size into a cycle.
 */

import type { NodeId } from '../document/types'

/** A node's geometry element, as opposed to its group: the path, the picture. */
export const geomKey = (id: NodeId): string => `${id}::geom`

/** An artboard's clip rect. */
export const clipKey = (id: NodeId): string => `${id}::clip`

/**
 * A node's effect filter.
 *
 * The filter region is in user space and sized from the node's box, so a live
 * resize has to move it too — otherwise the shape is clipped to whatever size
 * it was when React last rendered, which looks like the effect (and half the
 * shape) vanishing until the mouse comes up.
 */
export const fxKey = (id: NodeId): string => `${id}::fx`
