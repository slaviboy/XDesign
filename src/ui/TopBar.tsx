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
 * The application bar.
 *
 * Left: application menu, mark, editable document name, save status.
 * Center: Design / Prototype / Share.
 * Right: theme, grid, snapping, preview, zoom control.
 *
 * Prototype and Share render their real tab chrome but are explicitly marked as
 * not yet implemented rather than faked with dead controls — a disabled tab that
 * says so is honest; one that looks live and does nothing is not.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  exportPreferencesFlow, importFilesFlow, importPreferencesFlow, newDocument,
  openDocumentFlow, saveDocumentFlow,
} from '../app/fileOperations'
import { importTextIntoSelection } from '../app/textImport'
import { redo, undo } from '../state/DocumentStore'
import {
  alignSelection, clearGuides, copyGuides, deleteSelection, distributeSelection,
  flipSelection, groupSelection, maskWithShape, orderCommand, outlineStrokeSelection,
  pasteGuides, renameDocument, selectAll, setGuidesLocked, ungroupMask,
  ungroupSelection, updateSettings,
} from '../history/Commands'
import { copySelection, cutSelection, duplicateInPlace } from '../state/Clipboard'
import { pasteFromSystem } from '../state/SystemClipboard'
import { stepZoom, zoomTo, zoomToFit, zoomToSelection } from '../shortcuts/KeyboardManager'
import { canImageTrace, openImageTrace } from '../history/TraceCommands'
import { openDialog, setEditor, type WorkspaceTab } from '../state/EditorStore'
import { useDocumentStore, useEditorStore } from '../state/hooks'
import { artboardIds } from '../document/SceneGraph'
import { t } from '../i18n'
import { useLanguage } from '../state/hooks-i18n'
import { shortcutLabel } from '../shortcuts/keymap'
import { useKeymap } from '../shortcuts/useKeymap'
import { MenuHost, useMenuState, type MenuItemSpec } from './Menu'
import {
  getResolvedTheme,
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  toggleTheme,
  type ThemePreference,
} from '../state/theme'
import { Tooltip } from './primitives'
import { MenuIcon, PlayIcon, GridIcon, MagnetIcon, SunIcon, MoonIcon, MonitorIcon } from './icons'

export const TopBar = memo(function TopBar() {
  // Every menu prints the chord its command is bound to, so a rebinding has to
  // redraw the bar that shows it.
  void useKeymap()
  const name = useDocumentStore((s) => s.doc.name)
  const dirty = useDocumentStore((s) => s.dirty)
  const history = useDocumentStore((s) => s.history)
  const gridVisible = useDocumentStore((s) => s.doc.settings.gridVisible)
  const guidesVisible = useDocumentStore((s) => s.doc.settings.guidesVisible)
  const doc = useDocumentStore((s) => s.doc)
  const selection = useEditorStore((s) => s.selection)
  // Selected artboards, or all of them: a document-level menu acts on the
  // document unless you have narrowed it yourself.
  const selectedBoards = selection.filter((id) => doc.nodes[id]?.type === 'artboard')
  const guideBoards = selectedBoards.length ? selectedBoards : artboardIds(doc)
  const guidesLocked =
    guideBoards.length > 0 &&
    guideBoards.every((id) => {
      const n = doc.nodes[id]
      return n?.type === 'artboard' && !!n.guidesLocked
    })
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const tab = useEditorStore((s) => s.tab)
  const selectionCount = useEditorStore((s) => s.selection.length)
  const languageTick = useLanguage()
  const menu = useMenuState()
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [themePreference, setLocalThemePreference] = useState<ThemePreference>(() => getThemePreference())
  useEffect(() => subscribeTheme((_, pref) => setLocalThemePreference(pref)), [])

  const buildMenu = useCallback((): MenuItemSpec[] => {
    const hasSelection = selectionCount > 0
    return [
      { label: t('menu.new'), shortcut: shortcutLabel('file.new'), onSelect: newDocument },
      { label: t('menu.open'), shortcut: shortcutLabel('file.open'), onSelect: () => void openDocumentFlow() },
      { label: t('menu.save'), shortcut: shortcutLabel('file.save'), onSelect: () => void saveDocumentFlow(false) },
      { label: t('menu.saveAs'), shortcut: shortcutLabel('file.saveAs'), onSelect: () => void saveDocumentFlow(true) },
      { kind: 'separator' },
      { label: t('menu.import'), shortcut: shortcutLabel('file.import'), onSelect: () => void importFilesFlow() },
      // Adobe's "Import text from text files". It is here as well as on the
      // Text panel because the panel only exists once a text object is
      // selected, and importing a file is how you make the first one.
      { label: t('menu.importText'), onSelect: () => void importTextIntoSelection() },
      { label: t('menu.export'), shortcut: shortcutLabel('file.export'), onSelect: () => openDialog('export') },
      { kind: 'separator' },
      { label: t('menu.undo'), shortcut: shortcutLabel('edit.undo'), disabled: !history.canUndo, onSelect: () => undo() },
      { label: t('menu.redo'), shortcut: shortcutLabel('edit.redo'), disabled: !history.canRedo, onSelect: () => redo() },
      { kind: 'separator' },
      { label: t('menu.cut'), shortcut: shortcutLabel('edit.cut'), disabled: !hasSelection, onSelect: () => cutSelection() },
      { label: t('menu.copy'), shortcut: shortcutLabel('edit.copy'), disabled: !hasSelection, onSelect: () => copySelection() },
      { label: t('menu.paste'), shortcut: shortcutLabel('edit.paste'), onSelect: () => void pasteFromSystem() },
      { label: t('menu.duplicate'), shortcut: shortcutLabel('edit.duplicate'), disabled: !hasSelection, onSelect: () => duplicateInPlace() },
      { label: t('menu.delete'), shortcut: 'Del', disabled: !hasSelection, onSelect: () => deleteSelection() },
      { label: t('menu.selectAll'), shortcut: shortcutLabel('edit.selectAll'), onSelect: selectAll },
      { kind: 'separator' },
      {
        kind: 'submenu', label: t('menu.arrange'),
        items: [
          { label: t('menu.group'), shortcut: shortcutLabel('arrange.group'), disabled: selectionCount < 2, onSelect: () => groupSelection() },
          { label: t('menu.ungroup'), shortcut: shortcutLabel('arrange.ungroup'), disabled: !hasSelection, onSelect: () => ungroupSelection() },
          { kind: 'separator' },
          // Adobe's own placement: Object > Mask With Shape, with Ungroup Mask
          // as the way back.
          {
            label: t('menu.maskWithShape'),
            shortcut: shortcutLabel('arrange.mask'),
            disabled: selectionCount < 2,
            onSelect: () => maskWithShape(),
          },
          { label: t('menu.ungroupMask'), disabled: !hasSelection, onSelect: () => ungroupMask() },
          { kind: 'separator' },
          {
            kind: 'submenu',
            label: t('menu.path'),
            items: [
              {
                label: t('menu.outlineStroke'),
                shortcut: shortcutLabel('arrange.outlineStroke'),
                disabled: !hasSelection,
                onSelect: () => outlineStrokeSelection(),
              },
            ],
          },
          { kind: 'separator' },
          { label: t('menu.bringToFront'), shortcut: shortcutLabel('arrange.front'), disabled: !hasSelection, onSelect: () => orderCommand('front') },
          { label: t('menu.bringForward'), shortcut: shortcutLabel('arrange.forward'), disabled: !hasSelection, onSelect: () => orderCommand('forward') },
          { label: t('menu.sendBackward'), shortcut: shortcutLabel('arrange.backward'), disabled: !hasSelection, onSelect: () => orderCommand('backward') },
          { label: t('menu.sendToBack'), shortcut: shortcutLabel('arrange.back'), disabled: !hasSelection, onSelect: () => orderCommand('back') },
          { kind: 'separator' },
          { label: t('menu.flipHorizontal'), disabled: !hasSelection, onSelect: () => flipSelection('h') },
          { label: t('menu.flipVertical'), disabled: !hasSelection, onSelect: () => flipSelection('v') },
        ],
      },
      {
        kind: 'submenu', label: t('menu.align'),
        items: [
          { label: t('menu.left'), disabled: !hasSelection, onSelect: () => alignSelection('left') },
          { label: t('menu.centerHorizontally'), disabled: !hasSelection, onSelect: () => alignSelection('center-h') },
          { label: t('menu.right'), disabled: !hasSelection, onSelect: () => alignSelection('right') },
          { label: t('menu.top'), disabled: !hasSelection, onSelect: () => alignSelection('top') },
          { label: t('menu.centerVertically'), disabled: !hasSelection, onSelect: () => alignSelection('center-v') },
          { label: t('menu.bottom'), disabled: !hasSelection, onSelect: () => alignSelection('bottom') },
          { kind: 'separator' },
          { label: t('menu.distributeHorizontally'), disabled: selectionCount < 3, onSelect: () => distributeSelection('horizontal') },
          { label: t('menu.distributeVertically'), disabled: selectionCount < 3, onSelect: () => distributeSelection('vertical') },
        ],
      },
      {
        kind: 'submenu', label: t('menu.view'),
        items: [
          { label: t('menu.zoomToFit'), shortcut: shortcutLabel('view.zoomFit'), onSelect: zoomToFit },
          { label: t('menu.zoomTo100'), shortcut: shortcutLabel('view.zoom100'), onSelect: () => zoomTo(1) },
          { label: t('menu.zoomToSelection'), shortcut: shortcutLabel('view.zoomSelection'), disabled: !hasSelection, onSelect: zoomToSelection },
          { kind: 'separator' },
          // Adobe keeps Image Trace on the Object menu; this build has no
          // Object menu, and View is where the panel that opens here lives.
          { label: t('menu.imageTrace'), disabled: !canImageTrace(), onSelect: () => openImageTrace() },
          { kind: 'separator' },
          { label: t('menu.showGrid'), shortcut: shortcutLabel('view.toggleGrid'), checked: gridVisible, onSelect: () => updateSettings({ gridVisible: !gridVisible }) },
          { label: t('menu.showGuides'), shortcut: shortcutLabel('view.toggleGuides'), checked: guidesVisible, onSelect: () => updateSettings({ guidesVisible: !guidesVisible }) },
          { label: t('menu.snapping'), shortcut: shortcutLabel('view.toggleSnapping'), checked: snapEnabled, onSelect: () => setEditor({ snapEnabled: !snapEnabled }) },
          { kind: 'separator' },
          // Adobe's Guides commands. With nothing selected they apply to every
          // artboard, which is what "Lock All Guides" means on a document.
          {
            kind: 'submenu',
            label: t('menu.guides'),
            items: [
              { label: t('menu.copyGuides'), disabled: guideBoards.length !== 1, onSelect: () => copyGuides(guideBoards[0]!) },
              { label: t('menu.pasteGuides'), disabled: !guideBoards.length, onSelect: () => pasteGuides(guideBoards) },
              { kind: 'separator' },
              { label: t('menu.removeAllGuides'), disabled: !guideBoards.length, onSelect: () => clearGuides(guideBoards) },
              {
                label: t('menu.lockAllGuides'),
                shortcut: shortcutLabel('view.lockGuides'),
                checked: guidesLocked,
                disabled: !guideBoards.length,
                onSelect: () => setGuidesLocked(guideBoards, !guidesLocked),
              },
            ],
          },
        ],
      },
      { label: t('menu.newArtboard'), onSelect: () => openDialog('artboard-preset') },
      {
        kind: 'submenu',
        label: t('menu.theme'),
        items: [
          { label: t('menu.themeLight'), checked: themePreference === 'light', onSelect: () => setThemePreference('light') },
          { label: t('menu.themeDark'), checked: themePreference === 'dark', onSelect: () => setThemePreference('dark') },
          { label: t('menu.themeSystem'), checked: themePreference === 'system', onSelect: () => setThemePreference('system') },
        ],
      },
      { kind: 'separator' },
      { label: t('menu.preferences'), testId: 'menu-preferences', onSelect: () => openDialog('preferences') },
      {
        label: t('menu.keyboardShortcuts'),
        shortcut: shortcutLabel('view.shortcuts'),
        testId: 'menu-shortcuts',
        onSelect: () => openDialog('shortcuts'),
      },
      { kind: 'separator' },
      // Flat rather than a submenu: every language this ships in would have
      // called that submenu the same word as Preferences directly above it.
      { label: t('menu.exportPreferences'), testId: 'menu-export-prefs', onSelect: () => exportPreferencesFlow() },
      { label: t('menu.importPreferences'), testId: 'menu-import-prefs', onSelect: () => void importPreferencesFlow() },
      { kind: 'separator' },
      { label: t('menu.about'), testId: 'menu-about', onSelect: () => openDialog('about') },
    ]
  }, [
    gridVisible, guidesVisible, guideBoards, guidesLocked, languageTick,
    history.canRedo, history.canUndo, selectionCount, snapEnabled, themePreference,
  ])

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Tooltip label="Menu">
          <button
            ref={menuButtonRef}
            type="button"
            className="icon-button"
            aria-label={t('app.menu')}
            data-testid="app-menu"
            onClick={() => {
              const rect = menuButtonRef.current?.getBoundingClientRect()
              // Anchored to the button's LEFT edge now that it opens from the
              // left of the bar; right-anchoring would run the panel off screen.
              menu.open(rect?.left ?? 0, (rect?.bottom ?? 0) + 4, buildMenu())
            }}
          >
            <MenuIcon />
          </button>
        </Tooltip>
        <span className="app-mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 32 32">
            <path d="M9 9l14 14M23 9L9 23" strokeWidth="3.4" strokeLinecap="round" />
          </svg>
        </span>
        <input
          className="doc-name"
          value={name}
          aria-label={t('app.documentName')}
          onChange={(e) => renameDocument(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <span className={`save-status${dirty ? ' dirty' : ''}`}>
          {dirty ? t('app.unsavedChanges') : t('app.savedLocally')}
        </span>
      </div>

      <nav className="tabs" aria-label="Workspace">
        <TabButton id="design" label={t('tab.design')} active={tab === 'design'} />
        <TabButton id="prototype" label={t('tab.prototype')} active={tab === 'prototype'} disabled />
        <TabButton id="share" label={t('tab.share')} active={tab === 'share'} disabled />
      </nav>

      <div className="topbar-right">
        <ThemeToggle />
        <Tooltip label="Show grid" shortcut={shortcutLabel('view.toggleGrid')}>
          <button
            type="button"
            className={`icon-button${gridVisible ? ' active' : ''}`}
            aria-label="Show grid"
            onClick={() => updateSettings({ gridVisible: !gridVisible })}
          >
            <GridIcon />
          </button>
        </Tooltip>
        <Tooltip label="Snapping" shortcut={shortcutLabel('view.toggleSnapping')}>
          <button
            type="button"
            className={`icon-button${snapEnabled ? ' active' : ''}`}
            aria-label="Snapping"
            onClick={() => setEditor({ snapEnabled: !snapEnabled })}
          >
            <MagnetIcon />
          </button>
        </Tooltip>
        <Tooltip label="Preview — fit artwork to the window" shortcut={shortcutLabel('view.zoomFit')}>
          <button type="button" className="icon-button" aria-label="Preview" onClick={zoomToFit}>
            <PlayIcon />
          </button>
        </Tooltip>

        <ZoomControl />

      </div>

      <MenuHost menu={menu.menu} onClose={menu.close} />
    </header>
  )
})

/**
 * Cycles light -> dark -> follow-system.
 *
 * Three states rather than two because "follow the OS" is a real preference:
 * a two-way switch would silently stop tracking the system the first time it
 * is touched. The icon shows the CURRENT state, and the tooltip names what a
 * click will do next.
 */
function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(() => getThemePreference())
  const [resolved, setResolved] = useState(() => getResolvedTheme())

  useEffect(
    () =>
      subscribeTheme((nextResolved, nextPreference) => {
        setResolved(nextResolved)
        setPreference(nextPreference)
      }),
    [],
  )

  // The icon shows where a click will take you, which is the convention users
  // read fastest: a moon means "switch to dark".
  const goingDark = resolved === 'light'
  const label =
    preference === 'system'
      ? `Following system theme (${resolved}) — switch to ${goingDark ? 'dark' : 'light'}`
      : `Switch to ${goingDark ? 'dark' : 'light'} theme`

  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        data-testid="theme-toggle"
        data-theme-preference={preference}
        data-theme={resolved}
        onClick={() => toggleTheme()}
      >
        {preference === 'system' ? <MonitorIcon /> : goingDark ? <MoonIcon /> : <SunIcon />}
      </button>
    </Tooltip>
  )
}

function TabButton({
  id, label, active, disabled,
}: {
  id: WorkspaceTab
  label: string
  active: boolean
  disabled?: boolean
}) {
  return (
    <Tooltip label={disabled ? t('tab.notImplemented', { name: label }) : label}>
      <button
        type="button"
        className={`tab${active ? ' active' : ''}`}
        disabled={disabled}
        aria-current={active ? 'page' : undefined}
        onClick={() => setEditor({ tab: id })}
      >
        {label}
      </button>
    </Tooltip>
  )
}

function ZoomControl() {
  const zoom = useEditorStore((s) => s.viewport.zoom)
  const menu = useMenuState()
  const ref = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState<string | null>(null)

  const items: MenuItemSpec[] = [
    { label: t('menu.zoomToFit'), shortcut: shortcutLabel('view.zoomFit'), onSelect: zoomToFit },
    { label: t('menu.zoomToSelection'), shortcut: shortcutLabel('view.zoomSelection'), onSelect: zoomToSelection },
    { kind: 'separator' },
    ...[0.1, 0.25, 0.5, 0.75, 1, 2, 4, 8].map((z) => ({
      label: `${Math.round(z * 100)}%`,
      onSelect: () => zoomTo(z),
    })),
  ]

  return (
    <div className="zoom-control">
      <button type="button" className="icon-button" aria-label="Zoom out" onClick={() => stepZoom(-1)}>−</button>
      <input
        className="zoom-value"
        aria-label="Zoom level"
        data-testid="zoom-value"
        value={draft ?? `${Math.round(zoom * 100)}%`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            const v = Number.parseFloat((e.target as HTMLInputElement).value)
            if (Number.isFinite(v) && v > 0) zoomTo(v / 100)
            setDraft(null)
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur() }
        }}
        onBlur={() => setDraft(null)}
      />
      <button type="button" className="icon-button" aria-label="Zoom in" onClick={() => stepZoom(1)}>+</button>
      <Tooltip label="Zoom presets">
        <button
          ref={ref}
          type="button"
          className="icon-button"
          aria-label="Zoom presets"
          onClick={() => {
            const rect = ref.current?.getBoundingClientRect()
            menu.open((rect?.right ?? 0) - 160, (rect?.bottom ?? 0) + 4, items)
          }}
        >
          ▾
        </button>
      </Tooltip>
      <MenuHost menu={menu.menu} onClose={menu.close} />
    </div>
  )
}
