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
import { LayersPanel } from '../ui/LayersPanel'
import { Notifications } from '../ui/Notifications'
import { ExportDialog } from '../ui/ExportDialog'
import {
  AboutDialog, ArtboardPresetDialog, NewDocumentDialog, PreferencesDialog,
  RecoveryDialog, ShortcutsDialog,
} from '../ui/Dialogs'
import { MenuHost, useMenuState } from '../ui/Menu'
import { buildContextMenu } from '../ui/contextMenu'
import { installKeyboard } from '../shortcuts/KeyboardManager'
import { importFiles, importFromClipboardEvent } from '../images/ImageImporter'
import {
  adoptRecoveredDocument, importFilesFlow, openDocumentFlow, saveDocumentFlow,
} from './fileOperations'
import { checkForRecovery, dismissRecovery, startAutosave, stopAutosave, type RecoveryOffer } from '../persistence/Autosave'
import { screenDistanceToDoc, screenToDoc, docToScreen } from '../canvas/Viewport'
import { getDoc } from '../state/DocumentStore'
import {
  closeDialog, editorStore, openDialog, refreshOverlay, setEditor,
} from '../state/EditorStore'
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

  // ---- paste into the canvas ----------------------------------------------
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      // Let a focused field handle its own paste.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      const { viewport, canvasSize } = editorStore.getState()
      const at = screenToDoc(viewport, { x: canvasSize.width / 2, y: canvasSize.height / 2 })
      void importFromClipboardEvent(e, at).then((created) => {
        // Only fall back to the internal clipboard if nothing came from the OS.
        if (!created || created.length === 0) {
          void import('../state/Clipboard').then((m) => m.paste())
        }
      })
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // ---- stop the browser navigating away on a stray file drop ---------------
  useEffect(() => {
    const prevent = (e: DragEvent) => {
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
            adoptRecoveredDocument(recovery.doc)
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
