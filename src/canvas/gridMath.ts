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
 * Grid level-of-detail, shared by the canvas grid and the artboard grids.
 *
 * One definition so the two cannot drift: an 8px grid at 5% zoom is a solid
 * block of ink either way, and both step up to the next multiple rather than
 * drawing it.
 */

/** Below this on-screen spacing the grid is stepped up to the next multiple. */
export const MIN_SCREEN_SPACING = 6

/**
 * The cell size to actually draw, doubled until a cell is at least
 * `minSpacing` pixels on screen.
 *
 * Powers of two of the authored size, so every line drawn is a real grid line
 * — stepping by 1.5x would put lines where the grid has none.
 */
export function gridStepForZoom(
  size: number,
  zoom: number,
  minSpacing = MIN_SCREEN_SPACING,
): number {
  if (!(size > 0) || !(zoom > 0)) return size
  let step = size
  // Bounded: at the minimum zoom this doubles a few dozen times at most, and
  // the guard stops a pathological zoom spinning forever.
  for (let i = 0; i < 64 && step * zoom < minSpacing; i++) step *= 2
  return step
}
