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
 * React bindings for the two vanilla stores.
 *
 * Everything goes through useSyncExternalStore (via zustand's useStore), which is
 * concurrent-safe in React 19 and tear-free. Selectors are deliberately narrow:
 * a shape component subscribes to its own node only, so editing one rectangle
 * re-renders one element rather than the whole canvas.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react'
import { useStore } from 'zustand'
import { liveTransform } from '../canvas/LiveTransform'
import { documentStore, type DocumentState } from './DocumentStore'
import { editorStore, type EditorState } from './EditorStore'
import type { DesignNode, NodeId } from '../document/types'

export function useDocumentStore<T>(selector: (s: DocumentState) => T): T {
  return useStore(documentStore, selector)
}

export function useEditorStore<T>(selector: (s: EditorState) => T): T {
  return useStore(editorStore, selector)
}

export function useDocument() {
  return useStore(documentStore, (s) => s.doc)
}

/** Subscribe to a single node. The workhorse selector of the renderer. */
export function useNode(id: NodeId | null | undefined): DesignNode | undefined {
  return useStore(documentStore, (s) => (id ? s.doc.nodes[id] : undefined))
}

export function useNodeChildren(id: NodeId | null | undefined): readonly NodeId[] {
  const children = useStore(documentStore, (s) => {
    if (!id) return undefined
    const n = s.doc.nodes[id]
    return n && 'children' in n ? n.children : undefined
  })
  return children ?? EMPTY_IDS
}

const EMPTY_IDS: readonly NodeId[] = Object.freeze([])

export function useSelection(): readonly NodeId[] {
  return useStore(editorStore, (s) => s.selection)
}

/**
 * Resolve the selection to nodes.
 *
 * Deliberately derived here rather than stored: a `selectedNodes: Node[]` field
 * would get a fresh array identity on every document write and re-render every
 * consumer, which is exactly the pattern that makes big documents feel slow.
 */
export function useSelectedNodes(): DesignNode[] {
  const selection = useSelection()
  const doc = useDocument()
  return useMemo(
    () => selection.map((id) => doc.nodes[id]).filter((n): n is DesignNode => !!n),
    [selection, doc],
  )
}

export function useIsSelected(id: NodeId): boolean {
  return useStore(editorStore, (s) => s.selection.includes(id))
}

export function useViewport() {
  return useStore(editorStore, (s) => s.viewport)
}

export function useTool() {
  return useStore(editorStore, (s) => s.tool)
}

/**
 * Re-render on every LiveTransform flush.
 *
 * Drags deliberately make no store writes, so anything that must track a
 * gesture live — the selection frame, the inspector readouts — subscribes here
 * instead and reads the in-flight values from the session modules.
 *
 * This does mean the subscriber re-renders each animation frame while a drag is
 * running. That is a deliberate, bounded exception: the overlay and the
 * inspector are a few dozen elements each, whereas writing to the store would
 * re-run every node's selector, which is O(document).
 */
export function useLiveTransformTick(): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => liveTransform.subscribe(bump), [])
  return tick
}

export function useHistoryState() {
  return useStore(documentStore, (s) => s.history)
}

/**
 * Read a store value into a ref without subscribing.
 *
 * For values that a pointermove handler needs but that must not cause a render —
 * the transient-update pattern. The subscribe() return value is the unsubscribe
 * function, so it doubles as the effect cleanup.
 */
export function useEditorRef<T>(selector: (s: EditorState) => T): { current: T } {
  const ref = useRef<T>(selector(editorStore.getState()))
  useSyncExternalStore(
    useCallback((onChange) => {
      const unsub = editorStore.subscribe((s) => {
        const next = selector(s)
        if (next !== ref.current) {
          ref.current = next
          onChange()
        }
      })
      return unsub
    }, [selector]),
    () => ref.current,
    () => ref.current,
  )
  return ref
}
