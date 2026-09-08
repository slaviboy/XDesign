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
 * Right-click menu contents.
 *
 * Built from the same command functions the toolbar and keyboard use, so a
 * context-menu action and its shortcut cannot drift apart.
 */

import {
  alignSelection, canMaskSelection, canOutlineStrokeSelection, clearGuides, copyGuides,
  deleteSelection, distributeSelection, flipSelection, groupSelection, hasCopiedGuides,
  maskWithShape, orderCommand, outlineStrokeSelection, pasteGuides, rotateSelection,
  setGuidesLocked, setLocked, setMarkedForExport, setVisibility, ungroupMask,
  ungroupSelection,
} from '../history/Commands'
import { runBooleanOperation } from '../history/BooleanCommands'
import { copySelection, cutSelection, duplicateInPlace } from '../state/Clipboard'
// Paste is never disabled: what another application has copied cannot be probed
// synchronously, and a greyed-out Paste right after copying an image in Finder
// is exactly the bug this routes around. pasteFromSystem says so instead.
import { pasteFromSystem } from '../state/SystemClipboard'
import { getDoc } from '../state/DocumentStore'
import { editorStore, openDialog } from '../state/EditorStore'
import { isMaskGroup, isShape, type DesignDocument, type NodeId } from '../document/types'
import { artboardIds, blockedNodesAt, geometryBounds } from '../document/SceneGraph'
import { containsPoint } from '../geometry/Bounds'
import { MOD_LABEL } from '../shortcuts/bindings'
import { t } from '../i18n'
import type { MenuItemSpec } from './Menu'
import type { Vec2 } from '../geometry/Matrix'

const MOD = MOD_LABEL

/**
 * The artboards a Guides command should act on.
 *
 * Selected artboards if there are any; otherwise the one under the pointer, so
 * right-clicking empty artboard space reaches its guides — which is where Adobe
 * puts the command ("right-click on the artboard and select Guides > Lock All
 * Guides").
 */
function guideTargets(doc: DesignDocument, selection: readonly NodeId[], at: Vec2): NodeId[] {
  const selected = selection.filter((id) => doc.nodes[id]?.type === 'artboard')
  if (selected.length > 0) return selected
  const under = artboardIds(doc).filter((id) => containsPoint(geometryBounds(doc, id), at))
  return under.length ? [under[under.length - 1]!] : []
}

/** Adobe's Guides submenu, shared by the empty-canvas and selection menus. */
function guidesSubmenu(doc: DesignDocument, targets: readonly NodeId[]): MenuItemSpec {
  const boards = targets.map((id) => doc.nodes[id]).filter((n) => n?.type === 'artboard')
  const locked = boards.length > 0 && boards.every((n) => n && 'guidesLocked' in n && n.guidesLocked)
  const any = boards.some((n) => n && 'guides' in n && !!n.guides?.length)
  return {
    kind: 'submenu',
    label: t('menu.guides'),
    items: [
      {
        label: t('menu.copyGuides'),
        disabled: targets.length !== 1 || !any,
        onSelect: () => copyGuides(targets[0]!),
      },
      {
        label: t('menu.pasteGuides'),
        disabled: targets.length === 0 || !hasCopiedGuides(),
        onSelect: () => pasteGuides(targets),
      },
      { kind: 'separator' },
      {
        label: t('menu.removeAllGuides'),
        disabled: !any,
        onSelect: () => clearGuides(targets),
      },
      {
        label: t('menu.lockAllGuides'),
        shortcut: `⇧${MOD};`,
        checked: locked,
        disabled: targets.length === 0,
        onSelect: () => setGuidesLocked(targets, !locked),
      },
    ],
  }
}

/**
 * Offers a way back to something the pointer cannot otherwise reach.
 *
 * A locked object takes no pointer events; a hidden one is not drawn. Either
 * way a right-click over it finds bare canvas, and the Layers panel is the only
 * route back — which is no help at all when the layer tree is long and you are
 * looking straight at the thing you want. This puts the object's own name in
 * the menu wherever it happens to be, including when it is the topmost thing
 * there and nothing else is competing for the click.
 */
function unblockItems(
  doc: DesignDocument,
  at: Vec2,
  selection: readonly NodeId[],
): MenuItemSpec[] {
  const blocked = blockedNodesAt(doc, at, { tolerance: HIT_SLACK })
  if (blocked.length === 0) return []

  const items: MenuItemSpec[] = []
  for (const entry of blocked.slice(0, MAX_UNBLOCK_ITEMS)) {
    const node = doc.nodes[entry.id]
    if (!node) continue
    // Already selected: the Lock and Hide entries above act on it, and two ways
    // to do the same thing in one menu is worse than one.
    if (selection.includes(entry.id)) continue
    if (entry.locked) {
      items.push({ label: t('menu.unlockNamed', { name: node.name }), onSelect: () => setLocked([entry.id], false) })
    }
    if (entry.hidden) {
      items.push({ label: t('menu.showNamed', { name: node.name }), onSelect: () => setVisibility([entry.id], true) })
    }
  }
  return items.length ? [{ kind: 'separator' }, ...items] : []
}

/** Enough to reach a hairline, in document units at 100%. */
const HIT_SLACK = 4

/** More than a few names turns the menu into a layer panel. */
const MAX_UNBLOCK_ITEMS = 5

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
  const guideBoards = guideTargets(doc, selection, at)

  if (!has) {
    return [
      { label: t('menu.paste'), shortcut: `${MOD}V`, onSelect: () => void pasteFromSystem({ at }) },
      { kind: 'separator' },
      { label: t('menu.selectAll'), shortcut: `${MOD}A`, onSelect: () => import('../history/Commands').then((m) => m.selectAll()) },
      { label: t('menu.newArtboard'), onSelect: () => openDialog('artboard-preset') },
      ...(guideBoards.length ? [guidesSubmenu(doc, guideBoards)] : []),
      ...unblockItems(doc, at, selection),
      { kind: 'separator' },
      { label: t('menu.export'), shortcut: `${MOD}E`, onSelect: () => openDialog('export') },
    ]
  }

  return [
    { label: t('menu.cut'), shortcut: `${MOD}X`, onSelect: () => cutSelection() },
    { label: t('menu.copy'), shortcut: `${MOD}C`, onSelect: () => copySelection() },
    { label: t('menu.paste'), shortcut: `${MOD}V`, onSelect: () => void pasteFromSystem({ at }) },
    { label: t('menu.duplicate'), shortcut: `${MOD}D`, onSelect: () => duplicateInPlace() },
    { label: t('menu.delete'), shortcut: 'Del', onSelect: () => deleteSelection() },
    { kind: 'separator' },
    { label: t('menu.group'), shortcut: `${MOD}G`, disabled: !multiple, onSelect: () => groupSelection() },
    {
      label: t('menu.ungroup'),
      shortcut: `⇧${MOD}G`,
      disabled: !nodes.some((n) => n!.type === 'group'),
      onSelect: () => ungroupSelection(),
    },
    {
      label: t('menu.maskWithShape'),
      shortcut: `⇧${MOD}M`,
      disabled: !canMaskSelection(),
      onSelect: () => maskWithShape(),
    },
    // Adobe: "select the object and right-click ... and select Ungroup Mask
    // from the context menu."
    {
      label: t('menu.ungroupMask'),
      disabled: !nodes.some((n) => isMaskGroup(n)),
      onSelect: () => ungroupMask(),
    },
    {
      label: t('menu.outlineStroke'),
      shortcut: `⇧${MOD}O`,
      disabled: !canOutlineStrokeSelection(),
      onSelect: () => outlineStrokeSelection(),
    },
    ...(guideBoards.length ? [guidesSubmenu(doc, guideBoards)] : []),
    ...unblockItems(doc, at, selection),
    { kind: 'separator' },
    {
      kind: 'submenu',
      label: t('menu.arrange'),
      items: [
        { label: t('menu.bringToFront'), shortcut: `⇧${MOD}]`, onSelect: () => orderCommand('front') },
        { label: t('menu.bringForward'), shortcut: `${MOD}]`, onSelect: () => orderCommand('forward') },
        { label: t('menu.sendBackward'), shortcut: `${MOD}[`, onSelect: () => orderCommand('backward') },
        { label: t('menu.sendToBack'), shortcut: `⇧${MOD}[`, onSelect: () => orderCommand('back') },
      ],
    },
    {
      kind: 'submenu',
      label: t('menu.transform'),
      items: [
        { label: t('menu.flipHorizontal'), onSelect: () => flipSelection('h') },
        { label: t('menu.flipVertical'), onSelect: () => flipSelection('v') },
        { kind: 'separator' },
        { label: t('menu.rotate90cw'), onSelect: () => rotateSelection(90) },
        { label: t('menu.rotate90ccw'), onSelect: () => rotateSelection(-90) },
        { label: t('menu.rotate180'), onSelect: () => rotateSelection(180) },
      ],
    },
    {
      kind: 'submenu',
      label: t('menu.align'),
      items: [
        { label: t('menu.left'), onSelect: () => alignSelection('left') },
        { label: t('menu.centerHorizontally'), onSelect: () => alignSelection('center-h') },
        { label: t('menu.right'), onSelect: () => alignSelection('right') },
        { label: t('menu.top'), onSelect: () => alignSelection('top') },
        { label: t('menu.centerVertically'), onSelect: () => alignSelection('center-v') },
        { label: t('menu.bottom'), onSelect: () => alignSelection('bottom') },
        { kind: 'separator' },
        { label: t('menu.distributeHorizontally'), disabled: nodes.length < 3, onSelect: () => distributeSelection('horizontal') },
        { label: t('menu.distributeVertically'), disabled: nodes.length < 3, onSelect: () => distributeSelection('vertical') },
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
