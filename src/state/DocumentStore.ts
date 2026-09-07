/**
 * The document store.
 *
 * A vanilla zustand store (not a React hook) so non-React code — tools, the
 * renderer's direct-DOM fast path, exporters, autosave — can read and subscribe
 * without a component. React binds to it through `useDocument` in hooks.ts.
 *
 * PERFORMANCE CONTRACT, and the single most important rule in this codebase:
 * do NOT call these mutators on every pointermove. Every store write runs every
 * subscribed component's selector, which is O(nodes) per frame. Interactive
 * drags instead write transforms straight to the mounted SVG elements via
 * LiveTransform, then commit ONE transaction on pointerup. See tools/DragSession.
 */

import { createStore } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import { produceWithPatches, enableMapSet, type Patch } from 'immer'
import { HistoryManager, type HistoryState } from '../history/HistoryManager'
import { createDocument } from '../document/NodeFactory'
import type { DesignDocument, DesignNode, ImageAsset, NodeId } from '../document/types'

enableMapSet()

export interface DocumentState {
  doc: DesignDocument
  /** Bumped on every committed change; cheap way for consumers to detect staleness. */
  version: number
  /** False once the document matches what is on disk. */
  dirty: boolean
  history: HistoryState
}

export interface TransactionOptions {
  /** Consecutive transactions with the same key collapse into one undo entry. */
  coalesceKey?: string
  /** Apply the change without recording history (used when loading a file). */
  silent?: boolean
}

const history = new HistoryManager<DesignDocument>()

export const documentStore = createStore<DocumentState>()(
  subscribeWithSelector((): DocumentState => ({
    doc: createDocument('Untitled'),
    version: 0,
    dirty: false,
    history: history.getState(),
  })),
)

export function getDoc(): DesignDocument {
  return documentStore.getState().doc
}

export function getNodeById(id: NodeId | null | undefined): DesignNode | undefined {
  return id ? documentStore.getState().doc.nodes[id] : undefined
}

/**
 * Run a mutation and record it as one undo step.
 *
 * The recipe mutates a draft; immer produces the forward and inverse patches.
 * Returning `false` from the recipe aborts the transaction with no history entry
 * — useful when a command discovers mid-flight that there is nothing to do.
 */
export function transaction(
  label: string,
  recipe: (draft: DesignDocument) => void | false,
  options: TransactionOptions = {},
): boolean {
  const before = documentStore.getState().doc
  let aborted = false

  const [next, patches, inverse] = produceWithPatches(before, (draft) => {
    const result = recipe(draft as DesignDocument)
    if (result === false) aborted = true
    else (draft as DesignDocument).modifiedAt = Date.now()
  })

  if (aborted || patches.length === 0) return false

  if (!options.silent) history.record(label, patches as Patch[], inverse as Patch[], options.coalesceKey)

  documentStore.setState({
    doc: next,
    version: documentStore.getState().version + 1,
    dirty: true,
    history: history.getState(),
  })
  return true
}

/** Replace the whole document (open, new, recover). Clears history. */
export function replaceDocument(doc: DesignDocument, markClean = true): void {
  history.clear()
  documentStore.setState({
    doc,
    version: documentStore.getState().version + 1,
    dirty: !markClean,
    history: history.getState(),
  })
}

export function markSaved(): void {
  documentStore.setState({ dirty: false })
}

export function undo(): boolean {
  const result = history.undo(documentStore.getState().doc)
  if (!result) return false
  documentStore.setState({
    doc: result.state,
    version: documentStore.getState().version + 1,
    dirty: true,
    history: history.getState(),
  })
  return true
}

export function redo(): boolean {
  const result = history.redo(documentStore.getState().doc)
  if (!result) return false
  documentStore.setState({
    doc: result.state,
    version: documentStore.getState().version + 1,
    dirty: true,
    history: history.getState(),
  })
  return true
}

/** Stop the next transaction merging into the current undo entry. */
export function breakHistoryCoalescing(): void {
  history.breakCoalescing()
  documentStore.setState({ history: history.getState() })
}

export function clearHistory(): void {
  history.clear()
  documentStore.setState({ history: history.getState() })
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export function addAsset(asset: ImageAsset): void {
  transaction('Add image', (draft) => {
    draft.assets[asset.id] = asset
  })
}

export function getAsset(id: string): ImageAsset | undefined {
  return documentStore.getState().doc.assets[id]
}

/**
 * Drop assets no node references any more.
 * Called before save so deleted images do not bloat the file forever.
 */
export function pruneUnusedAssets(): number {
  const doc = documentStore.getState().doc
  const used = new Set<string>()
  for (const node of Object.values(doc.nodes)) {
    if (node.type === 'image') used.add(node.assetId)
  }
  const orphans = Object.keys(doc.assets).filter((id) => !used.has(id))
  if (orphans.length === 0) return 0
  transaction('Prune assets', (draft) => {
    for (const id of orphans) delete draft.assets[id]
  })
  return orphans.length
}

export { history }
