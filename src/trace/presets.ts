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
 * Image Trace presets.
 *
 * Illustrator's list, with values chosen for this engine rather than copied
 * blind — the sliders mean the same things, but the numbers behind them are
 * this tracer's. A preset is a starting point that gets you within one or two
 * adjustments of what you want, which is why there is one per KIND of source:
 * a photograph, a flat logo, a pencil sketch, a technical drawing.
 *
 * The panel shows "Custom" whenever the settings match none of these, which is
 * what `matchingPreset` is for: the comparison is over every field, so changing
 * one slider and changing it back returns you to the named preset rather than
 * stranding you on Custom.
 */

import type { TraceOptions, TracePreset } from './types'

/**
 * Black and white at the midpoint, moderate everything else. What Illustrator
 * calls "Default", and the right answer for a logo, which is most of what gets
 * traced.
 */
export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  mode: 'bw',
  palette: 'automatic',
  colors: 50,
  threshold: 128,
  paths: 50,
  corners: 75,
  noise: 25,
  method: 'abutting',
  fills: true,
  strokes: false,
  strokeWidth: 10,
  snapToLines: true,
  ignoreWhite: false,
}

/** A preset written as its difference from the default, which is how they read. */
function preset(id: string, label: string, options: Partial<TraceOptions>): TracePreset {
  return { id, label, options: { ...DEFAULT_TRACE_OPTIONS, ...options } }
}

export const TRACE_PRESETS: TracePreset[] = [
  preset('default', 'Default', {}),

  // Photographs. Full tone keeps the gradations a photograph is made of;
  // overlapping regions hide the hairline seams that abutting shapes show
  // where hundreds of colours meet.
  preset('high-fidelity-photo', 'High Fidelity Photo', {
    mode: 'color',
    palette: 'full-tone',
    colors: 85,
    paths: 90,
    corners: 60,
    noise: 5,
    method: 'overlapping',
  }),
  preset('low-fidelity-photo', 'Low Fidelity Photo', {
    mode: 'color',
    palette: 'automatic',
    colors: 40,
    paths: 60,
    corners: 70,
    noise: 15,
    method: 'overlapping',
  }),

  // Flat artwork, where the colour count is the whole point and the user is
  // choosing it exactly.
  preset('3-colors', '3 Colors', { mode: 'color', palette: 'limited', colors: 3, noise: 20 }),
  preset('6-colors', '6 Colors', { mode: 'color', palette: 'limited', colors: 6, noise: 20 }),
  preset('16-colors', '16 Colors', { mode: 'color', palette: 'limited', colors: 16, noise: 20 }),
  preset('shades-of-gray', 'Shades of Gray', {
    mode: 'grayscale',
    palette: 'limited',
    colors: 8,
    noise: 20,
  }),

  preset('black-and-white-logo', 'Black and White Logo', {
    paths: 60,
    corners: 80,
    noise: 20,
  }),

  // Drawings. A pencil line is thin and grey, so the threshold goes up to
  // catch it, and strokes are on so a line comes out as a line.
  preset('sketched-art', 'Sketched Art', {
    threshold: 200,
    paths: 80,
    corners: 80,
    noise: 10,
    strokes: true,
    strokeWidth: 6,
  }),
  preset('silhouettes', 'Silhouettes', {
    paths: 30,
    corners: 60,
    noise: 60,
    ignoreWhite: true,
  }),
  preset('line-art', 'Line Art', {
    threshold: 200,
    paths: 70,
    corners: 75,
    noise: 10,
    fills: false,
    strokes: true,
    strokeWidth: 6,
    ignoreWhite: true,
  }),
  preset('technical-drawing', 'Technical Drawing', {
    threshold: 220,
    paths: 90,
    corners: 100,
    noise: 5,
    strokes: true,
    strokeWidth: 3,
    snapToLines: true,
    ignoreWhite: true,
  }),
]

export function presetById(id: string): TracePreset | undefined {
  return TRACE_PRESETS.find((p) => p.id === id)
}

/**
 * The preset these settings match exactly, or null for "Custom".
 *
 * Every field counts, including the ones a given mode ignores — `threshold` in
 * colour mode, say. Two settings that trace identically but read differently
 * in the panel are not the same preset, and claiming they were would make the
 * dropdown lie about what the other controls say.
 */
export function matchingPreset(options: TraceOptions): string | null {
  for (const preset of TRACE_PRESETS) {
    let same = true
    for (const key of Object.keys(preset.options) as Array<keyof TraceOptions>) {
      if (preset.options[key] !== options[key]) {
        same = false
        break
      }
    }
    if (same) return preset.id
  }
  return null
}
