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
