/**
 * The 60fps fast path.
 *
 * During a drag we do NOT write to the document store. Every store write runs
 * every subscribed component's selector, which is O(nodes) per frame — with 1000
 * nodes that is what turns a smooth drag into a slideshow. Instead the renderer
 * registers each node's SVG element here, the interaction engine pushes matrices
 * and attribute overrides straight onto those elements, and exactly one
 * transaction is committed on pointerup.
 *
 * Writes are coalesced into a single requestAnimationFrame flush, so N
 * pointermove events in one frame cost one DOM write per affected node.
 *
 * Original attribute values are snapshotted on first override so that a
 * cancelled gesture (Escape mid-drag) restores exactly, without needing a
 * store round-trip.
 */

import { toSvgMatrix, type Mat2D } from '../geometry/Matrix'
import type { NodeId } from '../document/types'

export interface LiveOverride {
  transform?: Mat2D
  /** Raw SVG attributes, e.g. { d: 'M…' } or { width: '120' }. */
  attrs?: Record<string, string>
}

type Listener = () => void

class LiveTransformChannel {
  private elements = new Map<NodeId, Set<SVGElement>>()
  private pending = new Map<NodeId, LiveOverride>()
  private originals = new Map<NodeId, Map<string, string | null>>()
  private listeners = new Set<Listener>()
  private rafHandle = 0
  private active = false

  /**
   * Called by the renderer for every node element it mounts.
   *
   * A key may hold SEVERAL elements: a stroke-aligned shape draws its outline
   * as a fill path plus a stroke path plus a clip or mask in defs, and an image
   * draws its through a clipPath. Overriding only one of them leaves the rest
   * showing pre-drag geometry for the whole gesture.
   */
  register(id: NodeId, el: SVGElement | null): void {
    if (!el) {
      this.elements.delete(id)
      return
    }
    const set = this.elements.get(id)
    if (set) set.add(el)
    else this.elements.set(id, new Set([el]))
  }

  /** Detach one element without dropping its siblings under the same key. */
  unregister(id: NodeId, el: SVGElement): void {
    const set = this.elements.get(id)
    if (!set) return
    set.delete(el)
    if (set.size === 0) this.elements.delete(id)
  }

  isActive(): boolean {
    return this.active
  }

  /** Open a gesture. Overrides applied after this are reversible via cancel(). */
  begin(): void {
    this.active = true
    this.originals.clear()
  }

  set(id: NodeId, override: LiveOverride): void {
    const existing = this.pending.get(id)
    this.pending.set(id, existing ? { ...existing, ...override, attrs: { ...existing.attrs, ...override.attrs } } : override)
    this.schedule()
  }

  setMany(entries: Iterable<[NodeId, LiveOverride]>): void {
    for (const [id, o] of entries) this.set(id, o)
  }

  /** Commit point: drop overrides and let the next React render own the DOM. */
  end(): void {
    this.active = false
    this.pending.clear()
    this.originals.clear()
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle)
      this.rafHandle = 0
    }
    this.emit()
  }

  /** Abort: put every touched attribute back exactly as it was. */
  cancel(): void {
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle)
      this.rafHandle = 0
    }
    for (const [id, attrs] of this.originals) {
      const set = this.elements.get(id)
      if (!set) continue
      for (const el of set) {
        for (const [name, value] of attrs) {
          if (value === null) el.removeAttribute(name)
          else el.setAttribute(name, value)
        }
      }
    }
    this.active = false
    this.pending.clear()
    this.originals.clear()
    this.emit()
  }

  /**
   * Subscribe to flushes. The selection overlay uses this to redraw its handles
   * in lockstep with the shapes, without going through React either.
   */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private schedule(): void {
    if (this.rafHandle) return
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = 0
      this.flush()
    })
  }

  private flush(): void {
    for (const [id, override] of this.pending) {
      const set = this.elements.get(id)
      if (!set) continue

      let snapshot = this.originals.get(id)
      if (!snapshot) {
        snapshot = new Map()
        this.originals.set(id, snapshot)
      }

      for (const el of set) {
        if (override.transform) {
          if (!snapshot.has('transform')) snapshot.set('transform', el.getAttribute('transform'))
          el.setAttribute('transform', toSvgMatrix(override.transform))
        }
        if (override.attrs) {
          for (const [name, value] of Object.entries(override.attrs)) {
            if (!snapshot.has(name)) snapshot.set(name, el.getAttribute(name))
            el.setAttribute(name, value)
          }
        }
      }
    }
    this.pending.clear()
    this.emit()
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}

export const liveTransform = new LiveTransformChannel()
