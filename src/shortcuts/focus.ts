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
 * "Is something else already using the keyboard?"
 *
 * Its own module because both the keyboard layer and the clipboard layer need
 * it, and each of those imports the other.
 */

/**
 * True when focus is somewhere that owns its own typing and editing — a field,
 * a textarea, the canvas text editor. Global shortcuts and clipboard handling
 * both have to stand aside: typing "r" in the layer-rename box must not switch
 * to the rectangle tool, and pasting into it must not drop an image on the
 * canvas.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  )
}
