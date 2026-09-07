/**
 * The keyboard map, in one place, so the shortcuts dialog and the handler can
 * never disagree about what a key does.
 */

export interface ShortcutSpec {
  keys: string
  label: string
  group: string
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  ? '⌘'
  : 'Ctrl'
const ALT = MOD === '⌘' ? '⌥' : 'Alt'

export const IS_MAC = MOD === '⌘'

export const SHORTCUTS: ShortcutSpec[] = [
  { group: 'Tools', keys: 'V', label: 'Selection' },
  { group: 'Tools', keys: 'R', label: 'Rectangle' },
  { group: 'Tools', keys: 'E', label: 'Ellipse' },
  { group: 'Tools', keys: 'Y', label: 'Polygon (triangle, n-gon or star)' },
  { group: 'Tools', keys: 'L', label: 'Line' },
  { group: 'Tools', keys: 'P', label: 'Pen' },
  { group: 'Tools', keys: 'N', label: 'Pencil' },
  { group: 'Tools', keys: 'T', label: 'Text' },
  { group: 'Tools', keys: 'A', label: 'Artboard' },
  { group: 'Tools', keys: 'Z', label: 'Zoom' },
  { group: 'Tools', keys: 'H', label: 'Hand' },

  // Pen — every modifier Adobe XD documents for drawing paths.
  { group: 'Pen', keys: 'Click', label: 'Corner point (straight segment)' },
  { group: 'Pen', keys: 'Drag', label: 'Smooth point (curve)' },
  { group: 'Pen', keys: 'Alt drag', label: 'Split the direction lines (cusp)' },
  { group: 'Pen', keys: 'Alt click last point', label: 'Retract the handle (curve then line)' },
  { group: 'Pen', keys: 'Shift', label: 'Constrain: 45 degrees placing, 15 dragging' },
  { group: 'Pen', keys: 'Click first point', label: 'Close the path (drag to shape it)' },
  { group: 'Pen', keys: 'Enter', label: 'End the open path' },
  { group: 'Pen', keys: 'Escape', label: 'End the path and return to Select' },
  { group: 'Pen', keys: 'Backspace', label: 'Remove the last point placed' },
  { group: 'Points', keys: 'Double-click path', label: 'Edit its points' },
  { group: 'Points', keys: 'Double-click point', label: 'Convert corner and smooth' },
  { group: 'Points', keys: 'Alt click point', label: 'Convert corner and smooth' },
  { group: 'Points', keys: 'Click outline', label: 'Insert a point' },
  { group: 'Points', keys: 'Alt drag handle', label: 'Break the joint' },
  { group: 'Points', keys: 'Delete', label: 'Remove the selected point or handle' },
  { group: 'Tools', keys: 'Space (hold)', label: 'Temporary pan' },

  { group: 'File', keys: `${MOD}+N`, label: 'New document' },
  { group: 'File', keys: `${MOD}+O`, label: 'Open…' },
  { group: 'File', keys: `${MOD}+S`, label: 'Save' },
  { group: 'File', keys: `⇧${MOD}+S`, label: 'Save As…' },
  { group: 'File', keys: `${MOD}+E`, label: 'Export…' },
  { group: 'File', keys: `⇧${MOD}+I`, label: 'Import…' },

  { group: 'Edit', keys: `${MOD}+Z`, label: 'Undo' },
  { group: 'Edit', keys: `⇧${MOD}+Z`, label: 'Redo' },
  { group: 'Edit', keys: `${MOD}+C`, label: 'Copy' },
  { group: 'Edit', keys: `${MOD}+X`, label: 'Cut' },
  { group: 'Edit', keys: `${MOD}+V`, label: 'Paste' },
  { group: 'Edit', keys: `${MOD}+D`, label: 'Duplicate' },
  { group: 'Edit', keys: `${MOD}+A`, label: 'Select all' },
  { group: 'Edit', keys: 'Delete', label: 'Delete selection' },
  { group: 'Edit', keys: 'Esc', label: 'Deselect / exit group' },

  { group: 'Arrange', keys: `${MOD}+G`, label: 'Group' },
  { group: 'Arrange', keys: `⇧${MOD}+G`, label: 'Ungroup' },
  { group: 'Arrange', keys: `${MOD}+]`, label: 'Bring forward' },
  { group: 'Arrange', keys: `⇧${MOD}+]`, label: 'Bring to front' },
  { group: 'Arrange', keys: `${MOD}+[`, label: 'Send backward' },
  { group: 'Arrange', keys: `⇧${MOD}+[`, label: 'Send to back' },
  { group: 'Arrange', keys: `${MOD}+L`, label: 'Lock / unlock' },
  { group: 'Arrange', keys: `⇧${MOD}+H`, label: 'Hide / show' },

  { group: 'Transform', keys: 'Arrows', label: 'Nudge 1px' },
  { group: 'Transform', keys: '⇧+Arrows', label: 'Nudge 10px' },
  { group: 'Transform', keys: 'Shift (drag)', label: 'Constrain proportions / axis' },
  { group: 'Transform', keys: `${ALT} (drag)`, label: 'Resize from center' },
  { group: 'Transform', keys: `${ALT} (handle)`, label: 'Break Bezier handle' },

  { group: 'View', keys: `${MOD}+0`, label: 'Zoom to fit' },
  { group: 'View', keys: `${MOD}+1`, label: 'Zoom to 100%' },
  { group: 'View', keys: `${MOD}+2`, label: 'Zoom to selection' },
  { group: 'View', keys: `${MOD}+=`, label: 'Zoom in' },
  { group: 'View', keys: `${MOD}+-`, label: 'Zoom out' },
  { group: 'View', keys: `${MOD}+'`, label: 'Toggle grid' },
  { group: 'View', keys: `${MOD}+;`, label: 'Toggle guides' },
  { group: 'View', keys: `⇧${MOD}+;`, label: 'Toggle snapping' },
  { group: 'View', keys: `${MOD}+scroll`, label: 'Zoom' },
]

export function shortcutGroups(): Array<{ group: string; items: ShortcutSpec[] }> {
  const order = ['Tools', 'File', 'Edit', 'Arrange', 'Transform', 'View']
  return order
    .map((group) => ({ group, items: SHORTCUTS.filter((s) => s.group === group) }))
    .filter((g) => g.items.length > 0)
}

export const MOD_LABEL = MOD
export const ALT_LABEL = ALT
