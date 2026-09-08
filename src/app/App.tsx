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
 * Application shell.
 *
 * Wires the stores, the keyboard layer, autosave and the panels together, and
 * owns the few pieces of cross-cutting behaviour that do not belong to any one
 * panel: paste-into-canvas, the context menu, panel resizing, and the crash
 * recovery prompt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '../canvas/Canvas'
import { Toolbar } from '../ui/Toolbar'
import { TopBar } from '../ui/TopBar'
import { PropertyInspector } from '../ui/PropertyInspector'
import { InspectorToolbar } from '../ui/InspectorToolbar'
import { LayersPanel } from '../ui/LayersPanel'
import { ensureDictionaries } from '../text/spellcheck'
import { Notifications } from '../ui/Notifications'
import { ExportDialog } from '../ui/ExportDialog'
import {
  AboutDialog, ArtboardPresetDialog, NewDocumentDialog, PreferencesDialog,
  RecoveryDialog, ShortcutsDialog,
} from '../ui/Dialogs'
import { MenuHost, useMenuState } from '../ui/Menu'
import { buildContextMenu } from '../ui/contextMenu'
import { installKeyboard } from '../shortcuts/KeyboardManager'
import { importFiles } from '../images/ImageImporter'
import { installSystemClipboard } from '../state/SystemClipboard'
import {
  adoptRecoveredDocument, importFilesFlow, openDocumentFlow, saveDocumentFlow,
} from './fileOperations'
import { checkForRecovery, dismissRecovery, startAutosave, stopAutosave, type RecoveryOffer } from '../persistence/Autosave'
import { screenDistanceToDoc, screenToDoc, docToScreen } from '../canvas/Viewport'
import { getDoc } from '../state/DocumentStore'
import {
  closeDialog, editorStore, openDialog, refreshOverlay, setEditor,
  setToolDeactivateHandler,
} from '../state/EditorStore'
import { getTool } from '../tools/ToolRegistry'
import { useEditorStore } from '../state/hooks'
import type { ToolContext } from '../tools/types'
import type { Vec2 } from '../geometry/Matrix'

export function App() {
  const dialog = useEditorStore((s) => s.dialog)
  const inspectorWidth = useEditorStore((s) => s.inspectorWidth)
  const layersHeight = useEditorStore((s) => s.layersHeight)
  const menu = useMenuState()
  const [recovery, setRecovery] = useState<RecoveryOffer | null>(null)

  const ctx = useMemo<ToolContext>(
    () => ({
      doc: () => getDoc(),
      editor: () => editorStore.getState(),
      viewport: () => editorStore.getState().viewport,
      screenToDoc: (p) => screenToDoc(editorStore.getState().viewport, p),
      docToScreen: (p) => docToScreen(editorStore.getState().viewport, p),
      tolerance: () => screenDistanceToDoc(editorStore.getState().viewport, 4),
      refreshOverlay,
    }),
    [],
  )

  // ---- tool teardown -------------------------------------------------------
  // Registered here because EditorStore cannot import the tool registry without
  // a cycle. This is what makes Tool.onDeactivate actually run.
  useEffect(() => {
    setToolDeactivateHandler((outgoing) => getTool(outgoing).onDeactivate?.(ctx))
    return () => setToolDeactivateHandler(null)
  }, [ctx])

  // ---- keyboard ------------------------------------------------------------
  useEffect(
    () =>
      installKeyboard(ctx, {
        onNew: () => openDialog('new-document'),
        onOpen: () => void openDocumentFlow(),
        onSave: () => void saveDocumentFlow(false),
        onSaveAs: () => void saveDocumentFlow(true),
        onExport: () => openDialog('export'),
        onImport: () => void importFilesFlow(),
        onShortcuts: () => openDialog('shortcuts'),
      }),
    [ctx],
  )

  // ---- autosave and recovery ----------------------------------------------
  useEffect(() => {
    startAutosave()
    void checkForRecovery().then((offer) => {
      if (offer) setRecovery(offer)
    })
    return () => stopAutosave()
  }, [])

  // ---- system clipboard ----------------------------------------------------
  useEffect(() => installSystemClipboard(), [])

  // ---- stop the browser navigating away on a stray file drop ---------------
  useEffect(() => {
    // Dropping a file on a page normally makes the browser navigate to it,
    // which would throw away the document. This guard blocks that everywhere
    // EXCEPT over the canvas.
    //
    // The exception is essential: these listeners are on window, so they run
    // after the canvas's own handler in the bubble phase. Unconditionally
    // setting dropEffect = 'none' here overrode the canvas's 'copy', the
    // browser concluded the drop was not allowed, and the drop event never
    // fired — which is why dragging an image from the desktop did nothing.
    const overCanvas = (e: DragEvent): boolean =>
      !!(e.target as Element | null)?.closest?.('[data-testid="canvas-root"]')

    const prevent = (e: DragEvent) => {
      if (overCanvas(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  // ---- warn on close with unsaved work ------------------------------------
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editorStore.getState().isDragging) return
      // Autosave already protects the work; this is only to prevent surprise.
      const dirty = (window as unknown as { __xdesignDirty?: boolean }).__xdesignDirty
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Fetched after the first paint, never before it: the app is usable without
  // a dictionary, and 12 MB of word lists must not stand between the user and
  // their document.
  useEffect(() => {
    void ensureDictionaries()
  }, [])

  const onFilesDropped = useCallback((files: FileList, at: Vec2) => {
    void importFiles(files, at)
  }, [])

  const onContextMenu = useCallback(
    (screen: Vec2, doc: Vec2) => {
      menu.open(screen.x, screen.y, buildContextMenu(doc))
    },
    [menu],
  )

  return (
    <div className="app">
      <TopBar />
      <div
        className="app-body"
        style={{ gridTemplateColumns: `var(--toolbar-width) 1fr ${inspectorWidth}px` }}
      >
        <Toolbar />
        <Canvas onFilesDropped={onFilesDropped} onContextMenu={onContextMenu} />
        <aside className="inspector" style={{ width: inspectorWidth }}>
          <InspectorResizer />
          <InspectorToolbar />
          <PropertyInspector />
          <LayersResizer />
          <div style={{ height: layersHeight, display: 'flex', flexDirection: 'column' }}>
            <LayersPanel />
          </div>
        </aside>
      </div>

      {dialog === 'export' && <ExportDialog />}
      {dialog === 'preferences' && <PreferencesDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      {dialog === 'about' && <AboutDialog />}
      {dialog === 'new-document' && <NewDocumentDialog />}
      {dialog === 'artboard-preset' && <ArtboardPresetDialog />}

      {recovery && (
        <RecoveryDialog
          offer={recovery}
          onRecover={() => {
            void adoptRecoveredDocument(recovery.doc)
            void dismissRecovery(recovery.doc.id)
            setRecovery(null)
          }}
          onDiscard={() => {
            void dismissRecovery(recovery.doc.id)
            setRecovery(null)
          }}
        />
      )}

      <MenuHost menu={menu.menu} onClose={menu.close} />
      <Notifications />
    </div>
  )
}

/** Drag the border between the canvas and the inspector. */
function InspectorResizer() {
  const dragging = useRef(false)
  return (
    <div
      className="inspector-resizer"
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const width = Math.min(460, Math.max(200, window.innerWidth - e.clientX))
        setEditor({ inspectorWidth: width })
      }}
      onPointerUp={(e) => {
        dragging.current = false
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* released */ }
      }}
    />
  )
}

function LayersResizer() {
  const dragging = useRef(false)
  return (
    <div
      className="layers-resizer"
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const height = Math.min(window.innerHeight - 200, Math.max(120, window.innerHeight - e.clientY))
        setEditor({ layersHeight: height })
      }}
      onPointerUp={(e) => {
        dragging.current = false
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* released */ }
      }}
    />
  )
}

export { closeDialog }
