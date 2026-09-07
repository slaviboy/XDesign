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
import { redo, undo } from '../state/DocumentStore'
import {
  alignSelection, deleteSelection, distributeSelection, flipSelection, groupSelection,
  maskWithShape, orderCommand, outlineStrokeSelection, renameDocument, selectAll,
  ungroupMask, ungroupSelection, updateSettings,
} from '../history/Commands'
import { copySelection, cutSelection, duplicateInPlace, paste } from '../state/Clipboard'
import { stepZoom, zoomTo, zoomToFit, zoomToSelection } from '../shortcuts/KeyboardManager'
import { openDialog, setEditor, type WorkspaceTab } from '../state/EditorStore'
import { useDocumentStore, useEditorStore } from '../state/hooks'
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
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const tab = useEditorStore((s) => s.tab)
  const selectionCount = useEditorStore((s) => s.selection.length)
  const menu = useMenuState()
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [themePreference, setLocalThemePreference] = useState<ThemePreference>(() => getThemePreference())
  useEffect(() => subscribeTheme((_, pref) => setLocalThemePreference(pref)), [])

  const buildMenu = useCallback((): MenuItemSpec[] => {
    const hasSelection = selectionCount > 0
    return [
      { label: 'New', shortcut: `${MOD}N`, onSelect: newDocument },
      { label: 'Open…', shortcut: `${MOD}O`, onSelect: () => void openDocumentFlow() },
      { label: 'Save', shortcut: `${MOD}S`, onSelect: () => void saveDocumentFlow(false) },
      { label: 'Save As…', shortcut: `⇧${MOD}S`, onSelect: () => void saveDocumentFlow(true) },
      { kind: 'separator' },
      { label: 'Import…', shortcut: `⇧${MOD}I`, onSelect: () => void importFilesFlow() },
      { label: 'Export…', shortcut: `${MOD}E`, onSelect: () => openDialog('export') },
      { kind: 'separator' },
      { label: 'Undo', shortcut: `${MOD}Z`, disabled: !history.canUndo, onSelect: () => undo() },
      { label: 'Redo', shortcut: `⇧${MOD}Z`, disabled: !history.canRedo, onSelect: () => redo() },
      { kind: 'separator' },
      { label: 'Cut', shortcut: `${MOD}X`, disabled: !hasSelection, onSelect: () => cutSelection() },
      { label: 'Copy', shortcut: `${MOD}C`, disabled: !hasSelection, onSelect: () => copySelection() },
      { label: 'Paste', shortcut: `${MOD}V`, onSelect: () => paste() },
      { label: 'Duplicate', shortcut: `${MOD}D`, disabled: !hasSelection, onSelect: () => duplicateInPlace() },
      { label: 'Delete', shortcut: 'Del', disabled: !hasSelection, onSelect: () => deleteSelection() },
      { label: 'Select All', shortcut: `${MOD}A`, onSelect: selectAll },
      { kind: 'separator' },
      {
        kind: 'submenu', label: 'Arrange',
        items: [
          { label: 'Group', shortcut: `${MOD}G`, disabled: selectionCount < 2, onSelect: () => groupSelection() },
          { label: 'Ungroup', shortcut: `⇧${MOD}G`, disabled: !hasSelection, onSelect: () => ungroupSelection() },
          { kind: 'separator' },
          // Adobe's own placement: Object > Mask With Shape, with Ungroup Mask
          // as the way back.
          {
            label: 'Mask With Shape',
            shortcut: `⇧${MOD}M`,
            disabled: selectionCount < 2,
            onSelect: () => maskWithShape(),
          },
          { label: 'Ungroup Mask', disabled: !hasSelection, onSelect: () => ungroupMask() },
          { kind: 'separator' },
          {
            kind: 'submenu',
            label: 'Path',
            items: [
              {
                label: 'Outline Stroke',
                shortcut: `⇧${MOD}O`,
                disabled: !hasSelection,
                onSelect: () => outlineStrokeSelection(),
              },
            ],
          },
          { kind: 'separator' },
          { label: 'Bring to Front', shortcut: `⇧${MOD}]`, disabled: !hasSelection, onSelect: () => orderCommand('front') },
          { label: 'Bring Forward', shortcut: `${MOD}]`, disabled: !hasSelection, onSelect: () => orderCommand('forward') },
          { label: 'Send Backward', shortcut: `${MOD}[`, disabled: !hasSelection, onSelect: () => orderCommand('backward') },
          { label: 'Send to Back', shortcut: `⇧${MOD}[`, disabled: !hasSelection, onSelect: () => orderCommand('back') },
          { kind: 'separator' },
          { label: 'Flip Horizontal', disabled: !hasSelection, onSelect: () => flipSelection('h') },
          { label: 'Flip Vertical', disabled: !hasSelection, onSelect: () => flipSelection('v') },
        ],
      },
      {
        kind: 'submenu', label: 'Align',
        items: [
          { label: 'Left', disabled: !hasSelection, onSelect: () => alignSelection('left') },
          { label: 'Center Horizontally', disabled: !hasSelection, onSelect: () => alignSelection('center-h') },
          { label: 'Right', disabled: !hasSelection, onSelect: () => alignSelection('right') },
          { label: 'Top', disabled: !hasSelection, onSelect: () => alignSelection('top') },
          { label: 'Center Vertically', disabled: !hasSelection, onSelect: () => alignSelection('center-v') },
          { label: 'Bottom', disabled: !hasSelection, onSelect: () => alignSelection('bottom') },
          { kind: 'separator' },
          { label: 'Distribute Horizontally', disabled: selectionCount < 3, onSelect: () => distributeSelection('horizontal') },
          { label: 'Distribute Vertically', disabled: selectionCount < 3, onSelect: () => distributeSelection('vertical') },
        ],
      },
      {
        kind: 'submenu', label: 'View',
        items: [
          { label: 'Zoom to Fit', shortcut: `${MOD}0`, onSelect: zoomToFit },
          { label: 'Zoom to 100%', shortcut: `${MOD}1`, onSelect: () => zoomTo(1) },
          { label: 'Zoom to Selection', shortcut: `${MOD}2`, disabled: !hasSelection, onSelect: zoomToSelection },
          { kind: 'separator' },
          { label: 'Show Grid', checked: gridVisible, onSelect: () => updateSettings({ gridVisible: !gridVisible }) },
          { label: 'Snapping', checked: snapEnabled, onSelect: () => setEditor({ snapEnabled: !snapEnabled }) },
        ],
      },
      { label: 'New Artboard…', onSelect: () => openDialog('artboard-preset') },
      {
        kind: 'submenu',
        label: 'Theme',
        items: [
          { label: 'Light', checked: themePreference === 'light', onSelect: () => setThemePreference('light') },
          { label: 'Dark', checked: themePreference === 'dark', onSelect: () => setThemePreference('dark') },
          { label: 'Follow system', checked: themePreference === 'system', onSelect: () => setThemePreference('system') },
        ],
      },
      { kind: 'separator' },
      { label: 'Preferences…', onSelect: () => openDialog('preferences') },
      { label: 'Keyboard Shortcuts', shortcut: `${MOD}/`, onSelect: () => openDialog('shortcuts') },
      { label: 'About XDesign', onSelect: () => openDialog('about') },
    ]
  }, [gridVisible, history.canRedo, history.canUndo, selectionCount, snapEnabled, themePreference])

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Tooltip label="Menu">
          <button
            ref={menuButtonRef}
            type="button"
            className="icon-button"
            aria-label="Application menu"
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
          aria-label="Document name"
          onChange={(e) => renameDocument(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <span className={`save-status${dirty ? ' dirty' : ''}`}>
          {dirty ? 'Unsaved changes' : 'Saved locally'}
        </span>
      </div>

      <nav className="tabs" aria-label="Workspace">
        <TabButton id="design" label="Design" active={tab === 'design'} />
        <TabButton id="prototype" label="Prototype" active={tab === 'prototype'} disabled />
        <TabButton id="share" label="Share" active={tab === 'share'} disabled />
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
    <Tooltip label={disabled ? `${label} is not implemented in this build` : label}>
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
    { label: 'Zoom to Fit', shortcut: `${MOD}0`, onSelect: zoomToFit },
    { label: 'Zoom to Selection', shortcut: `${MOD}2`, onSelect: zoomToSelection },
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
