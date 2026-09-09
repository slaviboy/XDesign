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
 * The gestures — the things you do with a pointer and a modifier, which no
 * chord can express and which therefore cannot be rebound.
 *
 * The keyboard commands used to live here too, as a hand-written list that the
 * dialog displayed and the handler ignored. They are in commands.ts now, where
 * the handler reads them, so a described binding and a working one are the same
 * object. What is left is documentation: pointer behaviours the shortcuts
 * dialog should still teach.
 */

export interface GestureSpec {
  keys: string
  label: string
  group: string
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  ? '⌘'
  : 'Ctrl'
const ALT = MOD === '⌘' ? '⌥' : 'Alt'

export const IS_MAC = MOD === '⌘'

export const GESTURES: GestureSpec[] = [
  { group: 'Tools', keys: 'Space (hold)', label: 'Temporary pan' },

  // Pen — every modifier Adobe XD documents for drawing paths.
  { group: 'Pen', keys: 'Click', label: 'Corner point (straight segment)' },
  { group: 'Pen', keys: 'Drag', label: 'Smooth point (curve)' },
  { group: 'Pen', keys: `${ALT} drag`, label: 'Split the direction lines (cusp)' },
  { group: 'Pen', keys: `${ALT} click last point`, label: 'Retract the handle (curve then line)' },
  { group: 'Pen', keys: 'Shift', label: 'Constrain: 45 degrees placing, 15 dragging' },
  { group: 'Pen', keys: 'Click first point', label: 'Close the path (drag to shape it)' },
  { group: 'Pen', keys: 'Enter', label: 'End the open path' },
  { group: 'Pen', keys: 'Escape', label: 'End the path and return to Select' },
  { group: 'Pen', keys: 'Backspace', label: 'Remove the last point placed' },

  { group: 'Points', keys: 'Click with D', label: "Show a shape's points" },
  { group: 'Points', keys: 'Double-click shape', label: 'Edit its points' },
  { group: 'Points', keys: 'Drag a point', label: 'Converts the shape to a path' },
  { group: 'Points', keys: 'Double-click point', label: 'Convert corner and smooth' },
  { group: 'Points', keys: `${ALT} click point`, label: 'Convert corner and smooth' },
  { group: 'Points', keys: 'Click outline', label: 'Insert a point' },
  { group: 'Points', keys: `${ALT} drag handle`, label: 'Break the joint' },
  { group: 'Points', keys: 'Delete', label: 'Remove the selected point or handle' },

  { group: 'Transform', keys: 'Shift (drag)', label: 'Constrain proportions / axis' },
  { group: 'Transform', keys: `${ALT} (drag)`, label: 'Resize from center' },
  { group: 'Transform', keys: `${ALT} (handle)`, label: 'Break Bezier handle' },

  { group: 'View', keys: `${MOD}+scroll`, label: 'Zoom' },
]

/** The gesture rows for one group, in the order they were written. */
export function gesturesFor(group: string): GestureSpec[] {
  return GESTURES.filter((g) => g.group === group)
}

/** Groups that have gestures but no rebindable commands. */
export const GESTURE_ONLY_GROUPS = ['Pen', 'Points']

export const MOD_LABEL = MOD
export const ALT_LABEL = ALT
