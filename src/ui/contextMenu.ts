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
import { copySelection, cutSelection, duplicateInPlace, hasClipboardContent, paste } from '../state/Clipboard'
import { getDoc } from '../state/DocumentStore'
import { editorStore, openDialog } from '../state/EditorStore'
import { isMaskGroup, isShape, type DesignDocument, type NodeId } from '../document/types'
import { artboardIds, blockedNodesAt, geometryBounds } from '../document/SceneGraph'
import { containsPoint } from '../geometry/Bounds'
import { MOD_LABEL } from '../shortcuts/bindings'
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
    label: 'Guides',
    items: [
      {
        label: 'Copy Guides',
        disabled: targets.length !== 1 || !any,
        onSelect: () => copyGuides(targets[0]!),
      },
      {
        label: 'Paste Guides',
        disabled: targets.length === 0 || !hasCopiedGuides(),
        onSelect: () => pasteGuides(targets),
      },
      { kind: 'separator' },
      {
        label: 'Remove All Guides',
        disabled: !any,
        onSelect: () => clearGuides(targets),
      },
      {
        label: 'Lock All Guides',
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
      items.push({ label: `Unlock “${node.name}”`, onSelect: () => setLocked([entry.id], false) })
    }
    if (entry.hidden) {
      items.push({ label: `Show “${node.name}”`, onSelect: () => setVisibility([entry.id], true) })
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
      { label: 'Paste', shortcut: `${MOD}V`, disabled: !hasClipboardContent(), onSelect: () => paste(at) },
      { kind: 'separator' },
      { label: 'Select All', shortcut: `${MOD}A`, onSelect: () => import('../history/Commands').then((m) => m.selectAll()) },
      { label: 'New Artboard…', onSelect: () => openDialog('artboard-preset') },
      ...(guideBoards.length ? [guidesSubmenu(doc, guideBoards)] : []),
      ...unblockItems(doc, at, selection),
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
    ...(guideBoards.length ? [guidesSubmenu(doc, guideBoards)] : []),
    ...unblockItems(doc, at, selection),
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
