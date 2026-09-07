/**
 * Right-click menu contents.
 *
 * Built from the same command functions the toolbar and keyboard use, so a
 * context-menu action and its shortcut cannot drift apart.
 */

import {
  alignSelection, canMaskSelection, canOutlineStrokeSelection, deleteSelection,
  distributeSelection, flipSelection, groupSelection, maskWithShape, orderCommand,
  outlineStrokeSelection, rotateSelection, setLocked, setMarkedForExport,
  setVisibility, ungroupMask, ungroupSelection,
} from '../history/Commands'
import { runBooleanOperation } from '../history/BooleanCommands'
import { copySelection, cutSelection, duplicateInPlace, hasClipboardContent, paste } from '../state/Clipboard'
import { getDoc } from '../state/DocumentStore'
import { editorStore, openDialog } from '../state/EditorStore'
import { isMaskGroup, isShape } from '../document/types'
import { MOD_LABEL } from '../shortcuts/bindings'
import type { MenuItemSpec } from './Menu'
import type { Vec2 } from '../geometry/Matrix'

const MOD = MOD_LABEL

export function buildContextMenu(at: Vec2): MenuItemSpec[] {
  const doc = getDoc()
  const selection = editorStore.getState().selection
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean)
  const has = nodes.length > 0
  const multiple = nodes.length > 1
  const shapes = nodes.filter((n) => isShape(n!))
  const allLocked = has && nodes.every((n) => n!.locked)
  const allHidden = has && nodes.every((n) => !n!.visible)
  const allMarked = has && nodes.every((n) => n!.markedForExport)

  if (!has) {
    return [
      { label: 'Paste', shortcut: `${MOD}V`, disabled: !hasClipboardContent(), onSelect: () => paste(at) },
      { kind: 'separator' },
      { label: 'Select All', shortcut: `${MOD}A`, onSelect: () => import('../history/Commands').then((m) => m.selectAll()) },
      { label: 'New Artboard…', onSelect: () => openDialog('artboard-preset') },
      { kind: 'separator' },
      { label: 'Export…', shortcut: `${MOD}E`, onSelect: () => openDialog('export') },
    ]
  }

  return [
    { label: 'Cut', shortcut: `${MOD}X`, onSelect: () => cutSelection() },
    { label: 'Copy', shortcut: `${MOD}C`, onSelect: () => copySelection() },
    { label: 'Paste', shortcut: `${MOD}V`, disabled: !hasClipboardContent(), onSelect: () => paste(at) },
    { label: 'Duplicate', shortcut: `${MOD}D`, onSelect: () => duplicateInPlace() },
    { label: 'Delete', shortcut: 'Del', onSelect: () => deleteSelection() },
    { kind: 'separator' },
    { label: 'Group', shortcut: `${MOD}G`, disabled: !multiple, onSelect: () => groupSelection() },
    {
      label: 'Ungroup',
      shortcut: `⇧${MOD}G`,
      disabled: !nodes.some((n) => n!.type === 'group'),
      onSelect: () => ungroupSelection(),
    },
    {
      label: 'Mask With Shape',
      shortcut: `⇧${MOD}M`,
      disabled: !canMaskSelection(),
      onSelect: () => maskWithShape(),
    },
    // Adobe: "select the object and right-click ... and select Ungroup Mask
    // from the context menu."
    {
      label: 'Ungroup Mask',
      disabled: !nodes.some((n) => isMaskGroup(n)),
      onSelect: () => ungroupMask(),
    },
    {
      label: 'Outline Stroke',
      shortcut: `⇧${MOD}O`,
      disabled: !canOutlineStrokeSelection(),
      onSelect: () => outlineStrokeSelection(),
    },
    { kind: 'separator' },
    {
      kind: 'submenu',
      label: 'Arrange',
      items: [
        { label: 'Bring to Front', shortcut: `⇧${MOD}]`, onSelect: () => orderCommand('front') },
        { label: 'Bring Forward', shortcut: `${MOD}]`, onSelect: () => orderCommand('forward') },
        { label: 'Send Backward', shortcut: `${MOD}[`, onSelect: () => orderCommand('backward') },
        { label: 'Send to Back', shortcut: `⇧${MOD}[`, onSelect: () => orderCommand('back') },
      ],
    },
    {
      kind: 'submenu',
      label: 'Transform',
      items: [
        { label: 'Flip Horizontal', onSelect: () => flipSelection('h') },
        { label: 'Flip Vertical', onSelect: () => flipSelection('v') },
        { kind: 'separator' },
        { label: 'Rotate 90° CW', onSelect: () => rotateSelection(90) },
        { label: 'Rotate 90° CCW', onSelect: () => rotateSelection(-90) },
        { label: 'Rotate 180°', onSelect: () => rotateSelection(180) },
      ],
    },
    {
      kind: 'submenu',
      label: 'Align',
      items: [
        { label: 'Left', onSelect: () => alignSelection('left') },
        { label: 'Center Horizontally', onSelect: () => alignSelection('center-h') },
        { label: 'Right', onSelect: () => alignSelection('right') },
        { label: 'Top', onSelect: () => alignSelection('top') },
        { label: 'Center Vertically', onSelect: () => alignSelection('center-v') },
        { label: 'Bottom', onSelect: () => alignSelection('bottom') },
        { kind: 'separator' },
        { label: 'Distribute Horizontally', disabled: nodes.length < 3, onSelect: () => distributeSelection('horizontal') },
        { label: 'Distribute Vertically', disabled: nodes.length < 3, onSelect: () => distributeSelection('vertical') },
      ],
    },
    {
      kind: 'submenu',
      label: 'Combine',
      items: [
        { label: 'Union', disabled: shapes.length < 2, onSelect: () => void runBooleanOperation('union') },
        { label: 'Subtract', disabled: shapes.length < 2, onSelect: () => void runBooleanOperation('subtract') },
        { label: 'Intersect', disabled: shapes.length < 2, onSelect: () => void runBooleanOperation('intersect') },
        { label: 'Exclude', disabled: shapes.length < 2, onSelect: () => void runBooleanOperation('exclude') },
      ],
    },
    { kind: 'separator' },
    {
      label: allLocked ? 'Unlock' : 'Lock',
      shortcut: `${MOD}L`,
      onSelect: () => setLocked(selection, !allLocked),
    },
    {
      label: allHidden ? 'Show' : 'Hide',
      shortcut: `⇧${MOD}H`,
      onSelect: () => setVisibility(selection, allHidden),
    },
    { kind: 'separator' },
    {
      label: allMarked ? 'Unmark for Export' : 'Mark for Export',
      checked: allMarked,
      onSelect: () => setMarkedForExport(selection, !allMarked),
    },
    { label: 'Export Selection…', shortcut: `${MOD}E`, onSelect: () => openDialog('export') },
  ]
}
