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
 * Editing a shape by editing its SVG code.
 *
 * The edit is found by difference, never by replacement. The code that was
 * shown and the code as edited are both read back through the importer, and
 * only what differs between the two readings is written to the object. So a
 * star whose colour is changed in the code stays a star — its code is a
 * <path>, and replacing the object with the reading would have flattened it
 * into one — and whatever the code cannot say, a shadow's settings, a stroke
 * drawn inside the edge, a name, is left exactly as it was. The two readings
 * go through the same importer, so its small rounding differences cancel out
 * rather than masquerading as edits.
 *
 * Only a change to the geometry that the object's own kind cannot hold — a
 * <rect> retyped as a <circle> — replaces the object, and then it keeps its
 * id, name, place in the layers and everything else the code does not carry.
 */

import { transformFromMatrix } from '../document/DocumentModel'
import { worldMatrix } from '../document/SceneGraph'
import { hasStyle, type DesignNode, type NodeId, type Style } from '../document/types'
import { IDENTITY, invert, multiply, type Mat2D } from '../geometry/Matrix'
import { transaction } from '../state/DocumentStore'
import { readSvgShape, type CodeShape } from '../svg/SvgCode'

export type SvgCodeResult = { ok: true; changed: boolean } | { ok: false; error: string }

/** The fields that make up each kind's geometry, beyond its box. */
const GEOMETRY_FIELDS: Record<string, readonly string[]> = {
  rect: ['cornerRadius'],
  ellipse: [],
  line: ['x1', 'y1', 'x2', 'y2'],
  path: ['d', 'closed'],
  polygon: ['sides', 'starRatio', 'cornerRadius'],
}

const STYLE_FIELDS = ['fill', 'fillOpacity', 'fillRule', 'strokeOpacity', 'opacity', 'blendMode'] as const

/**
 * The stroke's settings SVG can state. Alignment is left out: SVG only draws
 * centred strokes, so the code always reads back "center", and taking that as
 * an edit would move every inside or outside border.
 */
const STROKE_FIELDS = ['paint', 'width', 'cap', 'join', 'miterLimit', 'dashArray', 'dashOffset'] as const

/**
 * Apply `code` to the object, as an edit of `shown` — the code it was showing.
 * Consecutive calls with the same `coalesceKey` are one undo step, which is
 * what typing in the box is.
 */
export function applySvgCode(
  id: NodeId,
  code: string,
  shown: string,
  coalesceKey?: string,
): SvgCodeResult {
  const edit = readSvgShape(code)
  if ('error' in edit) return { ok: false, error: edit.error }
  // Code that no longer reads — not expected, as it came from the exporter —
  // leaves nothing to compare with, so everything in the edit counts.
  const base = readOrNull(shown)

  let changed = false
  transaction(
    'Edit SVG code',
    (draft) => {
      const node = draft.nodes[id]
      if (!node || !hasStyle(node)) return false

      const geometryChanged = !base || geometryKey(base.node) !== geometryKey(edit.node)
      const placeChanged = !base || !sameMatrix(base.world, edit.world)
      const style = mergeStyle(node.style, base?.node.style ?? null, edit.node.style)

      const parentWorld: Mat2D = node.parentId ? worldMatrix(draft, node.parentId) : IDENTITY
      const placed = transformFromMatrix(
        multiply(invert(parentWorld), edit.world),
        edit.node.transform.width,
        edit.node.transform.height,
        node.transform.originX,
        node.transform.originY,
      )

      if (geometryChanged && edit.node.type !== node.type) {
        const replacement = {
          ...structuredClone(edit.node),
          id: node.id,
          name: node.name,
          parentId: node.parentId,
          visible: node.visible,
          locked: node.locked,
          markedForExport: node.markedForExport,
          transform: placed,
          style: style ?? node.style,
        } as DesignNode
        if (node.transform3d) replacement.transform3d = node.transform3d
        if (node.metadata) replacement.metadata = node.metadata
        draft.nodes[id] = replacement
        changed = true
        return undefined
      }

      if (geometryChanged) {
        const target = node as unknown as Record<string, unknown>
        const source = edit.node as unknown as Record<string, unknown>
        for (const field of GEOMETRY_FIELDS[node.type] ?? []) {
          if (field in source) target[field] = structuredClone(source[field])
        }
        // Hand-edited geometry is no longer what a boolean operation made.
        if (node.type === 'path') {
          delete node.booleanOp
          delete node.booleanSources
        }
      }
      if (geometryChanged || placeChanged) node.transform = placed
      if (style) node.style = style
      changed = geometryChanged || placeChanged || !!style
      return changed ? undefined : false
    },
    { coalesceKey },
  )
  return { ok: true, changed }
}

function readOrNull(code: string): CodeShape | null {
  const read = readSvgShape(code)
  return 'error' in read ? null : read
}

/** The object's style with each setting the edit changed taken from it; null when none changed. */
function mergeStyle(current: Style, base: Style | null, edit: Style): Style | null {
  const next: Style = { ...current, stroke: { ...current.stroke } }
  let changed = false
  for (const key of STYLE_FIELDS) {
    if (base && same(base[key], edit[key])) continue
    if (same(current[key], edit[key])) continue
    ;(next as unknown as Record<string, unknown>)[key] = structuredClone(edit[key])
    changed = true
  }
  for (const key of STROKE_FIELDS) {
    if (base && same(base.stroke[key], edit.stroke[key])) continue
    if (same(current.stroke[key], edit.stroke[key])) continue
    ;(next.stroke as unknown as Record<string, unknown>)[key] = structuredClone(edit.stroke[key])
    changed = true
  }
  return changed ? next : null
}

function geometryKey(node: DesignNode): string {
  const record = node as unknown as Record<string, unknown>
  const fields = (GEOMETRY_FIELDS[node.type] ?? []).map((f) => record[f])
  return JSON.stringify([node.type, near(node.transform.width), near(node.transform.height), fields], (_, v) =>
    typeof v === 'number' ? near(v) : v,
  )
}

function sameMatrix(a: Mat2D, b: Mat2D): boolean {
  return a.every((v, i) => Math.abs(v - b[i]!) <= 1e-6 * Math.max(1, Math.abs(v)))
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a, (_, v) => (typeof v === 'number' ? near(v) : v)) ===
    JSON.stringify(b, (_, v) => (typeof v === 'number' ? near(v) : v))
}

/** Rounded well past anything visible, so reading noise is not an edit. */
function near(v: number): number {
  return Math.round(v * 1e6) / 1e6
}
