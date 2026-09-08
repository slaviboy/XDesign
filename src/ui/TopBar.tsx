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
  importFilesFlow, newDocument, openDocumentFlow, saveDocumentFlow,
} from '../app/fileOperations'
import { importTextIntoSelection } from '../app/textImport'
import { redo, undo } from '../state/DocumentStore'
import {
  alignSelection, clearGuides, copyGuides, deleteSelection, distributeSelection,
  flipSelection, groupSelection, maskWithShape, orderCommand, outlineStrokeSelection,
  pasteGuides, renameDocument, selectAll, setGuidesLocked, ungroupMask,
  ungroupSelection, updateSettings,
} from '../history/Commands'
import { copySelection, cutSelection, duplicateInPlace, paste } from '../state/Clipboard'
import { stepZoom, zoomTo, zoomToFit, zoomToSelection } from '../shortcuts/KeyboardManager'
import { openDialog, setEditor, type WorkspaceTab } from '../state/EditorStore'
import { useDocumentStore, useEditorStore } from '../state/hooks'
import { artboardIds } from '../document/SceneGraph'
import { t } from '../i18n'
import { useLanguage } from '../state/hooks-i18n'
import { MOD_LABEL } from '../shortcuts/bindings'
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

const MOD = MOD_LABEL

export const TopBar = memo(function TopBar() {
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
      { label: t('menu.new'), shortcut: `${MOD}N`, onSelect: newDocument },
      { label: t('menu.open'), shortcut: `${MOD}O`, onSelect: () => void openDocumentFlow() },
      { label: t('menu.save'), shortcut: `${MOD}S`, onSelect: () => void saveDocumentFlow(false) },
      { label: t('menu.saveAs'), shortcut: `⇧${MOD}S`, onSelect: () => void saveDocumentFlow(true) },
      { kind: 'separator' },
      { label: t('menu.import'), shortcut: `⇧${MOD}I`, onSelect: () => void importFilesFlow() },
      // Adobe's "Import text from text files". It is here as well as on the
      // Text panel because the panel only exists once a text object is
      // selected, and importing a file is how you make the first one.
      { label: t('menu.importText'), onSelect: () => void importTextIntoSelection() },
      { label: t('menu.export'), shortcut: `${MOD}E`, onSelect: () => openDialog('export') },
      { kind: 'separator' },
      { label: t('menu.undo'), shortcut: `${MOD}Z`, disabled: !history.canUndo, onSelect: () => undo() },
      { label: t('menu.redo'), shortcut: `⇧${MOD}Z`, disabled: !history.canRedo, onSelect: () => redo() },
      { kind: 'separator' },
      { label: t('menu.cut'), shortcut: `${MOD}X`, disabled: !hasSelection, onSelect: () => cutSelection() },
      { label: t('menu.copy'), shortcut: `${MOD}C`, disabled: !hasSelection, onSelect: () => copySelection() },
      { label: t('menu.paste'), shortcut: `${MOD}V`, onSelect: () => paste() },
      { label: t('menu.duplicate'), shortcut: `${MOD}D`, disabled: !hasSelection, onSelect: () => duplicateInPlace() },
      { label: t('menu.delete'), shortcut: 'Del', disabled: !hasSelection, onSelect: () => deleteSelection() },
      { label: t('menu.selectAll'), shortcut: `${MOD}A`, onSelect: selectAll },
      { kind: 'separator' },
      {
        kind: 'submenu', label: t('menu.arrange'),
        items: [
          { label: t('menu.group'), shortcut: `${MOD}G`, disabled: selectionCount < 2, onSelect: () => groupSelection() },
          { label: t('menu.ungroup'), shortcut: `⇧${MOD}G`, disabled: !hasSelection, onSelect: () => ungroupSelection() },
          { kind: 'separator' },
          // Adobe's own placement: Object > Mask With Shape, with Ungroup Mask
          // as the way back.
          {
            label: t('menu.maskWithShape'),
            shortcut: `⇧${MOD}M`,
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
                shortcut: `⇧${MOD}O`,
                disabled: !hasSelection,
                onSelect: () => outlineStrokeSelection(),
              },
            ],
          },
          { kind: 'separator' },
          { label: t('menu.bringToFront'), shortcut: `⇧${MOD}]`, disabled: !hasSelection, onSelect: () => orderCommand('front') },
          { label: t('menu.bringForward'), shortcut: `${MOD}]`, disabled: !hasSelection, onSelect: () => orderCommand('forward') },
          { label: t('menu.sendBackward'), shortcut: `${MOD}[`, disabled: !hasSelection, onSelect: () => orderCommand('backward') },
          { label: t('menu.sendToBack'), shortcut: `⇧${MOD}[`, disabled: !hasSelection, onSelect: () => orderCommand('back') },
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
          { label: t('menu.zoomToFit'), shortcut: `${MOD}0`, onSelect: zoomToFit },
          { label: t('menu.zoomTo100'), shortcut: `${MOD}1`, onSelect: () => zoomTo(1) },
          { label: t('menu.zoomToSelection'), shortcut: `${MOD}2`, disabled: !hasSelection, onSelect: zoomToSelection },
          { kind: 'separator' },
          { label: t('menu.showGrid'), shortcut: `${MOD}'`, checked: gridVisible, onSelect: () => updateSettings({ gridVisible: !gridVisible }) },
          { label: t('menu.showGuides'), shortcut: `${MOD};`, checked: guidesVisible, onSelect: () => updateSettings({ guidesVisible: !guidesVisible }) },
          { label: t('menu.snapping'), shortcut: `⇧${MOD}'`, checked: snapEnabled, onSelect: () => setEditor({ snapEnabled: !snapEnabled }) },
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
                shortcut: `⇧${MOD};`,
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
      { label: t('menu.preferences'), onSelect: () => openDialog('preferences') },
      { label: t('menu.keyboardShortcuts'), shortcut: `${MOD}/`, onSelect: () => openDialog('shortcuts') },
      { label: t('menu.about'), onSelect: () => openDialog('about') },
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
        <Tooltip label="Show grid" shortcut={`${MOD}'`}>
          <button
            type="button"
            className={`icon-button${gridVisible ? ' active' : ''}`}
            aria-label="Show grid"
            onClick={() => updateSettings({ gridVisible: !gridVisible })}
          >
            <GridIcon />
          </button>
        </Tooltip>
        <Tooltip label="Snapping" shortcut={`⇧${MOD};`}>
          <button
            type="button"
            className={`icon-button${snapEnabled ? ' active' : ''}`}
            aria-label="Snapping"
            onClick={() => setEditor({ snapEnabled: !snapEnabled })}
          >
            <MagnetIcon />
          </button>
        </Tooltip>
        <Tooltip label="Preview — fit artwork to the window" shortcut={`${MOD}0`}>
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
    { label: t('menu.zoomToFit'), shortcut: `${MOD}0`, onSelect: zoomToFit },
    { label: t('menu.zoomToSelection'), shortcut: `${MOD}2`, onSelect: zoomToSelection },
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
