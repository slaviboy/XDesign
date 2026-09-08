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
 * Patch-based undo/redo.
 *
 * History operates at the level of a *transaction*, not a mutation. A drag that
 * fires 200 pointermove events produces exactly one entry, because the
 * interaction engine opens a transaction on pointerdown and closes it on
 * pointerup. Storing immer patches rather than whole-document snapshots keeps
 * each entry proportional to what actually changed, so a 1000-node document
 * still undoes instantly.
 */

import { applyPatches, enablePatches, type Patch } from 'immer'

enablePatches()

export interface HistoryEntry {
  label: string
  patches: Patch[]
  inverse: Patch[]
  timestamp: number
  /**
   * Consecutive entries sharing a key merge into one, so dragging an opacity
   * slider is a single undo step rather than forty.
   */
  coalesceKey?: string
}

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  depth: number
}

const DEFAULT_LIMIT = 200
const COALESCE_WINDOW_MS = 600

export class HistoryManager<T> {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private listeners = new Set<(s: HistoryState) => void>()

  constructor(private limit: number = DEFAULT_LIMIT) {}

  /** Record a completed change. Returns false when nothing actually changed. */
  record(label: string, patches: Patch[], inverse: Patch[], coalesceKey?: string): boolean {
    if (patches.length === 0) return false

    const now = Date.now()
    const prev = this.undoStack[this.undoStack.length - 1]

    if (
      coalesceKey &&
      prev?.coalesceKey === coalesceKey &&
      now - prev.timestamp < COALESCE_WINDOW_MS
    ) {
      // Merge forward: keep the original inverse (the state before the whole
      // gesture) and extend the redo patches. Order matters — inverse patches
      // must be applied newest-first, so the new ones go on the front.
      prev.patches.push(...patches)
      prev.inverse.unshift(...inverse)
      prev.timestamp = now
      this.redoStack = []
      this.emit()
      return true
    }

    this.undoStack.push({ label, patches, inverse, timestamp: now, coalesceKey })
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
    this.emit()
    return true
  }

  undo(state: T): { state: T; label: string } | null {
    const entry = this.undoStack.pop()
    if (!entry) return null
    this.redoStack.push(entry)
    this.emit()
    return { state: applyPatches(state as object, entry.inverse) as T, label: entry.label }
  }

  redo(state: T): { state: T; label: string } | null {
    const entry = this.redoStack.pop()
    if (!entry) return null
    this.undoStack.push(entry)
    this.emit()
    return { state: applyPatches(state as object, entry.patches) as T, label: entry.label }
  }

  /** Prevent the next record() from merging into the current entry. */
  breakCoalescing(): void {
    const prev = this.undoStack[this.undoStack.length - 1]
    if (prev) prev.coalesceKey = undefined
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.emit()
  }

  getState(): HistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack[this.undoStack.length - 1]?.label ?? null,
      redoLabel: this.redoStack[this.redoStack.length - 1]?.label ?? null,
      depth: this.undoStack.length,
    }
  }

  subscribe(fn: (s: HistoryState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    const s = this.getState()
    for (const fn of this.listeners) fn(s)
  }
}
